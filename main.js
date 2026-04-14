const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { execFile, exec, spawn } = require('child_process');
const Store = require('./store');

const store = new Store();

const CURRENT_VERSION = '1.0.3';
const UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/PaltoCraft/PaltoCraft/main/version.json';

function checkIntegrity() {
  const manifestPath = path.join(__dirname, 'integrity.json');
  if (!fs.existsSync(manifestPath)) return;

  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { return; }

  const files = ['renderer.js', 'preload.js', 'index.html', 'styles.css'];
  for (const file of files) {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) continue;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    if (manifest[file] && hash !== manifest[file]) {
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'PaltoCraft',
        message: 'Файлы лаунчера повреждены или изменены.\nТребуется переустановка.',
        buttons: ['Переустановить']
      });
      shell.openExternal('https://github.com/PaltoCraft/PaltoCraft/releases/latest');
      app.quit();
      return;
    }
  }
}

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
let activeGameProcess = null;
let tray = null;
let isQuitting = false;

// ── Single-instance lock ──────────────────────────────────────────────────────
const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
// ─────────────────────────────────────────────────────────────────────────────

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets', 'icon.ico'));
  tray.setToolTip('PaltoCraft');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Открыть PaltoCraft',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
      }
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);

  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

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

  // Hide to tray instead of closing when X is clicked
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

app.whenReady().then(() => {
  try { checkIntegrity(); } catch {}
  createWindow();
  createTray();
});

app.on('before-quit', () => { isQuitting = true; });
app.on('window-all-closed', () => { /* kept alive via tray */ });

ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow.hide());

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

ipcMain.handle('ensure-vanilla', async (_, mcVersion, gameDir) => {
  const send = (data) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mod-status', data); };
  try {
    const dir = gameDir || getDefaultGameDir();
    const versionDir = path.join(dir, 'versions', mcVersion);
    const versionJsonPath = path.join(versionDir, mcVersion + '.json');
    const versionJarPath = path.join(versionDir, mcVersion + '.jar');

    if (fs.existsSync(versionJarPath) && fs.existsSync(versionJsonPath)) {
      return { success: true, already: true };
    }

    if (!fs.existsSync(versionDir)) fs.mkdirSync(versionDir, { recursive: true });

    send({ stage: 'fetch-vanilla-manifest', ver: mcVersion });
    const manifest = await fetchJson('https://launchermeta.mojang.com/mc/game/version_manifest.json');
    const entry = (manifest.versions || []).find(v => v.id === mcVersion);
    if (!entry) throw new Error('Версия ' + mcVersion + ' не найдена в манифесте Mojang');

    let versionData;
    if (!fs.existsSync(versionJsonPath)) {
      send({ stage: 'fetch-vanilla-json', ver: mcVersion });
      versionData = await fetchJson(entry.url);
      fs.writeFileSync(versionJsonPath, JSON.stringify(versionData, null, 2));
    } else {
      versionData = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
    }

    if (!fs.existsSync(versionJarPath)) {
      const jarUrl = versionData.downloads && versionData.downloads.client && versionData.downloads.client.url;
      if (!jarUrl) throw new Error('Не найдена ссылка на jar для ' + mcVersion);
      send({ stage: 'downloading-vanilla', ver: mcVersion });
      await downloadFile(jarUrl, versionJarPath, (received, total) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mod-progress', { received, total });
      });
    }

    send({ stage: 'done-vanilla', ver: mcVersion });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
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
    store.set('auth-refresh', xboxManager.save()); // Microsoft refresh token

    return { success: true, token: mclcToken, profile };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('launch-minecraft', async (_, options) => {
  try {
    const { Client } = require('minecraft-launcher-core');
    const launcher = new Client();

    let storedToken = store.get('auth-token');
    if (!storedToken) {
      return { success: false, error: 'Not authenticated' };
    }

    // Check if stored JWT access token is expired
    const refreshToken = store.get('auth-refresh');
    let tokenExpired = false;
    try {
      const parts = (storedToken.access_token || '').split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (payload.exp && payload.exp * 1000 < Date.now()) {
          tokenExpired = true;
        }
      }
    } catch {}

    if (tokenExpired && !refreshToken) {
      // No refresh token (old login) — force re-login
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('launch-log', { type: 'error', msg: 'Сессия истекла. Выйдите из аккаунта и войдите снова.' });
      }
      return { success: false, error: 'Сессия истекла — выйдите из аккаунта и войдите снова в лаунчере.' };
    }

    // Refresh Microsoft session before launching to fix "Invalid session" on online servers
    if (refreshToken) {
      try {
        const { Auth } = require('msmc');
        const authManager = new Auth('select_account');
        const xboxManager = await authManager.refresh(refreshToken);
        const mcToken = await xboxManager.getMinecraft();
        storedToken = mcToken.mclc();
        store.set('auth-token', storedToken);
        store.set('auth-refresh', xboxManager.save());
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('launch-log', { type: 'info', msg: 'Сессия авторизации обновлена.' });
        }
      } catch (refreshErr) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('launch-log', { type: 'warn', msg: 'Не удалось обновить сессию: ' + refreshErr.message });
        }
        if (tokenExpired) {
          return { success: false, error: 'Сессия истекла — выйдите из аккаунта и войдите снова.' };
        }
      }
    }

    const gameDir = options.gameDir || getDefaultGameDir();

    if (!fs.existsSync(gameDir)) {
      fs.mkdirSync(gameDir, { recursive: true });
    }

    // For modded versions (Fabric/Forge/NeoForge): use MCLC's 'custom' field.
    // options.version = base MC version (e.g. '1.21.11')
    // options.customVersion = loader version ID (e.g. 'fabric-loader-0.16.x-1.21.11')
    const versionBlock = options.customVersion
      ? { number: options.version, type: options.versionType || 'release', custom: options.customVersion }
      : { number: options.version, type: options.versionType || 'release' };

    const launchOptions = {
      authorization: storedToken,
      root: gameDir,
      version: versionBlock,
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
      activeGameProcess = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('launch-close', code);
        if (options.hideLauncher) mainWindow.show();
      }
    });

    activeGameProcess = await launcher.launch(launchOptions);

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

ipcMain.handle('check-loader', (_, loader, mcVersion, gameDir) => {
  const dir = gameDir || getDefaultGameDir();
  const versionsDir = path.join(dir, 'versions');
  if (!fs.existsSync(versionsDir)) return { installed: false, versionId: null };
  const entries = fs.readdirSync(versionsDir);
  let found = null;
  if (loader === 'fabric') {
    found = entries.find(e => e.startsWith('fabric-loader-') && e.endsWith('-' + mcVersion));
  } else if (loader === 'forge') {
    found = entries.find(e => e.startsWith('forge-' + mcVersion + '-') || e.startsWith(mcVersion + '-forge'));
  } else if (loader === 'neoforge') {
    const minorVer = mcVersion.split('.').slice(1).join('.');
    found = entries.find(e => e.startsWith('neoforge-' + minorVer + '.'));
  }
  return { installed: !!found, versionId: found || null };
});

ipcMain.handle('install-fabric', async (_, mcVersion, gameDir) => {
  const send = (data) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mod-status', data); };
  try {
    send({ stage: 'fetch-loader', ver: mcVersion });
    const loaders = await fetchJson('https://meta.fabricmc.net/v2/versions/loader/' + mcVersion);
    if (!loaders || !loaders.length) throw new Error('Нет Fabric loader для версии ' + mcVersion);
    const loaderVer = loaders[0].loader.version;
    const versionId = 'fabric-loader-' + loaderVer + '-' + mcVersion;
    send({ stage: 'fetch-profile', ver: mcVersion });
    const profile = await fetchJson('https://meta.fabricmc.net/v2/versions/loader/' + mcVersion + '/' + loaderVer + '/profile/json');
    const dir = gameDir || getDefaultGameDir();
    const versionDir = path.join(dir, 'versions', versionId);
    if (!fs.existsSync(versionDir)) fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(path.join(versionDir, versionId + '.json'), JSON.stringify(profile, null, 2));

    const baseVersionDir = path.join(dir, 'versions', mcVersion);
    const baseVersionJson = path.join(baseVersionDir, mcVersion + '.json');
    if (!fs.existsSync(baseVersionJson)) {
      send({ stage: 'fetch-base', ver: mcVersion });
      try {
        const manifest = await fetchJson('https://launchermeta.mojang.com/mc/game/version_manifest.json');
        const entry = (manifest.versions || []).find(v => v.id === mcVersion);
        if (entry) {
          const baseData = await fetchJson(entry.url);
          if (!fs.existsSync(baseVersionDir)) fs.mkdirSync(baseVersionDir, { recursive: true });
          fs.writeFileSync(baseVersionJson, JSON.stringify(baseData, null, 2));
        }
      } catch {}
    }

    send({ stage: 'done', ver: mcVersion });
    return { success: true, versionId };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('install-forge', async (_, mcVersion, gameDir) => {
  const send = (data) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mod-status', data); };
  try {
    send({ stage: 'fetch-forge-meta', ver: mcVersion });
    const meta = await fetchJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
    const forgeVer = meta.promos[mcVersion + '-recommended'] || meta.promos[mcVersion + '-latest'];
    if (!forgeVer) throw new Error('Нет Forge для версии ' + mcVersion);
    const fullVer = mcVersion + '-' + forgeVer;
    const installerName = 'forge-' + fullVer + '-installer.jar';
    const dlUrl = 'https://maven.minecraftforge.net/net/minecraftforge/forge/' + fullVer + '/' + installerName;
    const tmpPath = path.join(app.getPath('temp'), installerName);
    send({ stage: 'downloading-forge', ver: mcVersion });
    await downloadFile(dlUrl, tmpPath, (received, total) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mod-progress', { received, total });
    });
    send({ stage: 'installing-forge', ver: mcVersion });
    const dir = gameDir || getDefaultGameDir();
    const javaExe = findJavaExe(getJavaDir(dir, 17)) || 'java';
    await new Promise((resolve, reject) => {
      const child = spawn(javaExe, ['-jar', tmpPath, '--installClient'], { stdio: 'ignore', windowsHide: true });
      child.on('close', (code) => { code === 0 ? resolve() : reject(new Error('Forge installer завершился с кодом ' + code)); });
      child.on('error', reject);
    });
    try { fs.unlinkSync(tmpPath); } catch {}
    send({ stage: 'done', ver: mcVersion });
    const versionsDir = path.join(dir, 'versions');
    const entries = fs.existsSync(versionsDir) ? fs.readdirSync(versionsDir) : [];
    const found = entries.find(e => e.startsWith('forge-' + mcVersion + '-') || e.startsWith(mcVersion + '-forge'));
    return { success: true, versionId: found || ('forge-' + fullVer) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('install-neoforge', async (_, mcVersion, gameDir) => {
  const send = (data) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mod-status', data); };
  try {
    send({ stage: 'fetch-neoforge-meta', ver: mcVersion });
    const minorVer = mcVersion.split('.').slice(1).join('.');
    const xmlData = await new Promise((resolve, reject) => {
      https.get('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml',
        { headers: { 'User-Agent': 'PaltoCraft/1.0' } }, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => resolve(d));
          res.on('error', reject);
        }).on('error', reject);
    });
    const matches = [...xmlData.matchAll(/<version>([^<]+)<\/version>/g)]
      .map(m => m[1]).filter(v => v.startsWith(minorVer + '.')).sort();
    if (!matches.length) throw new Error('Нет NeoForge для версии ' + mcVersion);
    const neoVer = matches[matches.length - 1];
    const installerName = 'neoforge-' + neoVer + '-installer.jar';
    const dlUrl = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/' + neoVer + '/' + installerName;
    const tmpPath = path.join(app.getPath('temp'), installerName);
    send({ stage: 'downloading-neoforge', ver: mcVersion });
    await downloadFile(dlUrl, tmpPath, (received, total) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mod-progress', { received, total });
    });
    send({ stage: 'installing-neoforge', ver: mcVersion });
    const dir = gameDir || getDefaultGameDir();
    const javaExe = findJavaExe(getJavaDir(dir, 21)) || 'java';
    await new Promise((resolve, reject) => {
      const child = spawn(javaExe, ['-jar', tmpPath, '--installClient'], { stdio: 'ignore', windowsHide: true });
      child.on('close', (code) => { code === 0 ? resolve() : reject(new Error('NeoForge installer завершился с кодом ' + code)); });
      child.on('error', reject);
    });
    try { fs.unlinkSync(tmpPath); } catch {}
    send({ stage: 'done', ver: mcVersion });
    return { success: true, versionId: 'neoforge-' + neoVer };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('download-mod-modrinth', async (_, modId, mcVersion, loader, gameDir) => {
  const send = (data) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mod-status', data); };
  try {
    const apiUrl = 'https://api.modrinth.com/v2/project/' + modId + '/version?game_versions=%5B%22' + mcVersion + '%22%5D&loaders=%5B%22' + loader + '%22%5D';
    const versions = await fetchJson(apiUrl);
    if (!versions || !versions.length) return { success: false, notFound: true };
    const file = versions[0].files.find(f => f.primary) || versions[0].files[0];
    if (!file) return { success: false, notFound: true };
    const dir = gameDir || getDefaultGameDir();
    const modsDir = path.join(dir, 'mods');
    if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });
    const dest = path.join(modsDir, file.filename);
    if (fs.existsSync(dest)) return { success: true, skipped: true };
    send({ stage: 'downloading-mod', modId, filename: file.filename });
    await downloadFile(file.url, dest);
    return { success: true, skipped: false };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('kill-game', () => {
  try {
    if (activeGameProcess) {
      activeGameProcess.kill('SIGKILL');
      activeGameProcess = null;
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-path', async (_, folderPath) => {
  try { await shell.openPath(folderPath); return { success: true }; }
  catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('check-admin', (_, uuid) => {
  if (!uuid) return false;
  const h = '__ADMIN_HASH__';
  if (!h || h.startsWith('__')) return false;
  const hash = crypto.createHash('sha256').update(String(uuid).replace(/-/g, '')).digest('hex');
  return hash === h;
});

ipcMain.handle('get-servers', async () => {
  try {
    const url = 'https://raw.githubusercontent.com/' + 'PaltoCraft/PaltoCraft/main/servers.json';
    const json = await fetchJson(url);
    return Array.isArray(json) ? json : [];
  } catch { return []; }
});

ipcMain.handle('cache-set', (_, key, value) => {
  try {
    const cacheDir = path.join(app.getPath('userData'), 'cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, key), value, 'utf8');
    return true;
  } catch { return false; }
});

ipcMain.handle('cache-get', (_, key) => {
  try {
    const filePath = path.join(app.getPath('userData'), 'cache', key);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch { return null; }
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
