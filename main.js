const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { execFile, exec, spawn } = require('child_process');
const Store = require('./store');

const store = new Store();

const CURRENT_VERSION = '1.0.1';
const UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/PaltoCraft/PaltoCraft/main/version.json';

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function getDefaultGameDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA, '.minecraft');
  } else if (process.platform === 'darwin') {
    return path.join(process.env.HOME, 'Library', 'Application Support', 'minecraft');
  } else {
    return path.join(process.env.HOME, '.minecraft');
  }
}

async function getRequiredJavaVersion(mcVersion, allVersionsManifest) {
  try {
    const verEntry = (allVersionsManifest || []).find(v => v.id === mcVersion);
    if (verEntry && verEntry.url) {
      const json = await fetchJson(verEntry.url);
      if (json && json.javaVersion && json.javaVersion.majorVersion) {
        return json.javaVersion.majorVersion;
      }
    }
  } catch {}

  if (!mcVersion) return 17;
  if (/^[ab]/.test(mcVersion)) return 8;
  if (/^\d{2}w/.test(mcVersion)) return 21;
  const parts = mcVersion.split('.').map(n => parseInt(n) || 0);
  const minor = parts[1] ?? 0;
  if (minor >= 21) return 21;
  if (minor >= 17) return 17;
  return 8;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'PaltoCraft/1.0' }, timeout: 10000 }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      res.on('error', reject);
    }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
  });
}

function getJavaDir(gameDir, javaVer) {
  return path.join(gameDir || getDefaultGameDir(), 'runtime', `java-${javaVer}`);
}

function findJavaExe(javaDir) {
  if (!fs.existsSync(javaDir)) return null;
  const entries = fs.readdirSync(javaDir);
  for (const entry of entries) {
    const exe = path.join(javaDir, entry, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (fs.existsSync(exe)) return exe;
  }
  const flat = path.join(javaDir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (fs.existsSync(flat)) return flat;
  return null;
}

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const lib = url.startsWith('https') ? https : http;

    const request = (u) => lib.get(u, { headers: { 'User-Agent': 'PaltoCraft/1.0' } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        return request(res.headers.location);
      }
      if (res.statusCode !== 200) {
        file.destroy();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      res.on('data', chunk => {
        received += chunk.length;
        file.write(chunk);
        if (total && onProgress) onProgress(received, total);
      });
      res.on('end', () => { file.end(); resolve(); });
      res.on('error', reject);
    });
    request(url);
    file.on('error', reject);
  });
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    if (process.platform === 'win32') {
      const cmd = `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force"`;
      exec(cmd, { timeout: 120000 }, (err) => err ? reject(err) : resolve());
    } else {
      exec(`tar -xzf "${zipPath}" -C "${destDir}"`, { timeout: 120000 }, (err) => err ? reject(err) : resolve());
    }
  });
}

async function getAdoptiumDownloadUrl(javaVersion) {
  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.arch === 'x64' ? 'x64' : 'x86';

  const apiUrl = `https://api.adoptium.net/v3/assets/latest/${javaVersion}/hotspot?architecture=${arch}&image_type=jre&os=${os}&vendor=eclipse`;

  return new Promise((resolve, reject) => {
    https.get(apiUrl, { headers: { 'User-Agent': 'PaltoCraft/1.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (!json.length) return reject(new Error('Adoptium: нет релизов для Java ' + javaVersion));
          const pkg = json[0].binary?.package;
          if (!pkg?.link) return reject(new Error('Adoptium: не найдена ссылка на скачивание'));
          resolve({ url: pkg.link, size: pkg.size, checksum: pkg.checksum });
        } catch (e) { reject(e); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

ipcMain.handle('check-update', async () => {
  try {
    const json = await fetchJson(UPDATE_CHECK_URL);
    if (!json || !json.version) return { hasUpdate: false };
    const hasUpdate = compareVersions(json.version, CURRENT_VERSION) > 0;
    return { hasUpdate, version: json.version, url: json.url, notes: json.notes || '' };
  } catch (err) {
    return { hasUpdate: false, error: err.message };
  }
});

ipcMain.handle('download-update', async (_, url) => {
  const tmpPath = path.join(app.getPath('temp'), 'PaltoCraft-Update.exe');
  try {
    await downloadFile(url, tmpPath, (received, total) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-progress', { received, total });
      }
    });
    return { success: true, path: tmpPath };
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    return { success: false, error: err.message };
  }
});

ipcMain.handle('install-update', (_, installerPath) => {
  try {
    const child = spawn(installerPath, [], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    setTimeout(() => app.quit(), 300);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('check-java', async (_, mcVersion, gameDir, versionsManifest) => {
  const javaVer = await getRequiredJavaVersion(mcVersion, versionsManifest);
  const javaDir = getJavaDir(gameDir, javaVer);
  const javaExe = findJavaExe(javaDir);
  return { javaVer, javaDir, javaExe, downloaded: !!javaExe };
});

ipcMain.handle('download-java', async (_, javaVer, gameDir) => {
  const javaDir = getJavaDir(gameDir, javaVer);
  const tmpZip = path.join(app.getPath('temp'), `java-${javaVer}-jre.zip`);

  try {
    mainWindow.webContents.send('java-status', { stage: 'fetch-url', javaVer });
    const { url, size } = await getAdoptiumDownloadUrl(javaVer);

    mainWindow.webContents.send('java-status', { stage: 'downloading', javaVer, size });
    await downloadFile(url, tmpZip, (received, total) => {
      mainWindow.webContents.send('java-progress', { received, total });
    });

    mainWindow.webContents.send('java-status', { stage: 'extracting', javaVer });
    await extractZip(tmpZip, javaDir);

    try { fs.unlinkSync(tmpZip); } catch {}

    const javaExe = findJavaExe(javaDir);
    if (!javaExe) throw new Error('java.exe не найден после распаковки');

    mainWindow.webContents.send('java-status', { stage: 'done', javaVer, javaExe });
    return { success: true, javaExe };
  } catch (err) {
    try { if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip); } catch {}
    return { success: false, error: err.message };
  }
});

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 620,
    minWidth: 900,
    minHeight: 560,
    frame: false,
    transparent: false,
    resizable: true,
    backgroundColor: '#0f0f17',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow.close());

ipcMain.handle('store-get', (_, key) => store.get(key));
ipcMain.handle('store-set', (_, key, value) => store.set(key, value));
ipcMain.handle('store-delete', (_, key) => store.delete(key));

ipcMain.handle('get-default-gamedir', () => getDefaultGameDir());

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Выберите папку .minecraft',
    defaultPath: getDefaultGameDir()
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('check-version', (_, gameDir, version) => {
  const dir = gameDir || getDefaultGameDir();
  const jarPath = path.join(dir, 'versions', version, `${version}.jar`);
  return fs.existsSync(jarPath);
});

ipcMain.handle('auth-microsoft', async () => {
  try {
    const { Auth } = require('msmc');
    const authManager = new Auth('select_account');

    authManager.on('load', (asset, message) => {
      mainWindow.webContents.send('auth-update', { asset, message });
    });

    const xboxManager = await authManager.launch('electron');
    const mcToken = await xboxManager.getMinecraft();
    const mclcToken = mcToken.mclc();
    const profile = mcToken.profile;

    store.set('auth-token', mclcToken);
    store.set('auth-profile', profile);

    return { success: true, token: mclcToken, profile };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('launch-minecraft', async (_, options) => {
  try {
    const { Client } = require('minecraft-launcher-core');
    const launcher = new Client();

    const storedToken = store.get('auth-token');
    if (!storedToken) {
      return { success: false, error: 'Not authenticated' };
    }

    const gameDir = options.gameDir || getDefaultGameDir();

    if (!fs.existsSync(gameDir)) {
      fs.mkdirSync(gameDir, { recursive: true });
    }

    const launchOptions = {
      authorization: storedToken,
      root: gameDir,
      version: {
        number: options.version,
        type: options.versionType || 'release'
      },
      memory: {
        max: `${options.maxRam || 4}G`,
        min: `${options.minRam || 2}G`
      },
      javaPath: options.javaPath || 'java',
      overrides: {
        detached: false
      },
      window: {
        width: options.winWidth || 854,
        height: options.winHeight || 480,
        fullscreen: options.fullscreen || false
      }
    };

    if (options.jvmArgs) {
      launchOptions.customArgs = options.jvmArgs.split(' ').filter(Boolean);
    }

    launcher.on('debug', (e) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('launch-log', { type: 'debug', msg: String(e) });
      }
    });
    launcher.on('data', (e) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('launch-log', { type: 'data', msg: String(e) });
      }
    });
    launcher.on('progress', (e) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('launch-progress', e);
      }
    });
    launcher.on('close', (code) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('launch-close', code);
        if (options.hideLauncher) mainWindow.show();
      }
    });

    await launcher.launch(launchOptions);

    if (options.closeLauncher) {
      mainWindow.close();
    } else if (options.hideLauncher) {
      mainWindow.hide();
    }

    return { success: true };
  } catch (err) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-skin-data', async (_, uuidOrUrl) => {

  const fetchBuffer = (url) => new Promise((resolve) => {
    try {
      const lib = String(url).startsWith('https') ? https : http;
      const req = lib.get(String(url), { headers: { 'User-Agent': 'PaltoCraft/1.0' }, timeout: 8000 }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          fetchBuffer(res.headers.location).then(resolve);
          return;
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.on('error', (e) => { console.error('[skin] fetch error:', e.message); resolve(null); });
    } catch (e) {
      console.error('[skin] fetchBuffer threw:', e.message);
      resolve(null);
    }
  });

  try {
    let skinUrl = uuidOrUrl;

    if (!uuidOrUrl.startsWith('http')) {
      const profileBuf = await fetchBuffer(
        `https://sessionserver.mojang.com/session/minecraft/profile/${uuidOrUrl}`
      );
      if (!profileBuf) return null;
      const profileJson = JSON.parse(profileBuf.toString('utf8'));
      const texProp = (profileJson.properties || []).find(p => p.name === 'textures');
      if (!texProp) return null;
      const textures = JSON.parse(Buffer.from(texProp.value, 'base64').toString('utf8'));
      skinUrl = textures?.textures?.SKIN?.url;
      if (!skinUrl) return null;
    }

    const imgBuf = await fetchBuffer(skinUrl);
    if (!imgBuf) return null;
    return `data:image/png;base64,${imgBuf.toString('base64')}`;
  } catch {
    return null;
  }
});

ipcMain.handle('get-versions', async () => {
  try {
    return new Promise((resolve) => {
      const req = https.get(
        'https://launchermeta.mojang.com/mc/game/version_manifest.json',
        { timeout: 10000 },
        (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const manifest = JSON.parse(data);
              resolve({ success: true, versions: manifest.versions });
            } catch {
              resolve({ success: false, versions: [] });
            }
          });
        }
      );
      req.on('timeout', () => { req.destroy(); resolve({ success: false, versions: [] }); });
      req.on('error', (e) => resolve({ success: false, error: e.message, versions: [] }));
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
});
