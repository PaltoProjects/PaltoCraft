const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { execFile, exec, spawn } = require('child_process');
const Store = require('./store');

const store = new Store();

const CURRENT_VERSION = '1.3';
const UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/PaltoProjects/PaltoCraft/main/version.json';

// ── Discord Rich Presence ─────────────────────────────────────────────────────
let _drpc = null;
let _drpcReady = false;
let _drpcStartTs = null;

const DISCORD_CLIENT_ID = '1508812481953402970';

function initDiscordRPC() {
  try {
    const RPC = require('discord-rpc');
    if (_drpc) { try { _drpc.destroy(); } catch {} }
    _drpcReady = false;
    _drpc = new RPC.Client({ transport: 'ipc' });
    _drpc.on('ready', () => { _drpcReady = true; setDiscordActivity('В главном меню'); });
    _drpc.login({ clientId: DISCORD_CLIENT_ID }).catch(() => { _drpc = null; _drpcReady = false; });
  } catch {}
}

function setDiscordActivity(state) {
  if (!_drpc || !_drpcReady) return;
  try {
    _drpc.setActivity({
      details: 'PaltoCraft Launcher',
      state: state || 'В главном меню',
      startTimestamp: _drpcStartTs,
      largeImageKey: 'paltocraft',
      largeImageText: 'PaltoCraft — Minecraft Launcher',
      instance: false
    });
  } catch {}
}

function clearDiscordActivity() {
  if (!_drpc || !_drpcReady) return;
  try { _drpc.clearActivity(); } catch {}
  _drpcStartTs = null;
}

function checkIntegrity() {
  const manifestPath = path.join(__dirname, 'integrity.json');
  if (!fs.existsSync(manifestPath)) return;

  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { return; }

  const files = ['main.js', 'preload.js', 'renderer.js', 'store.js', 'index.html', 'styles.css'];
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
      shell.openExternal('https://github.com/PaltoProjects/PaltoCraft/releases/latest');
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

// Safely send to the renderer only when the window is still alive.
function sendToWindow(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function fetchJson(url, _redirects = 0) {
  return new Promise((resolve, reject) => {
    if (_redirects > 5) return reject(new Error('too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'PaltoCraft/1.0' }, timeout: 10000 }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return fetchJson(next, _redirects + 1).then(resolve).catch(reject);
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

// Downloads a URL to destPath. Optional `integrity` = { algo, hash } verifies
// the file hash after download (e.g. { algo: 'sha512', hash: '...' }) and
// rejects on mismatch, deleting the partial file.
// `allowedHosts` (optional) restricts which hosts the download — including any
// redirect target — may come from. Used for executables/installers that are run
// afterwards, so a redirect can't divert the download to an attacker host.
function hostAllowed(u, allowedHosts) {
  if (!allowedHosts || !allowedHosts.length) return true;
  try {
    const host = new URL(u).host.toLowerCase();
    return allowedHosts.some(h => host === h || host.endsWith('.' + h));
  } catch { return false; }
}

function downloadFile(url, destPath, onProgress, integrity, allowedHosts) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const hasher = integrity && integrity.hash ? crypto.createHash(integrity.algo || 'sha256') : null;
    let settled = false;

    const cleanup = (err) => {
      if (settled) return;
      settled = true;
      file.destroy();
      try { fs.unlinkSync(destPath); } catch {}
      reject(err);
    };

    if (!hostAllowed(url, allowedHosts)) return cleanup(new Error('Недопустимый источник загрузки'));

    const request = (u, redirects) => {
      const lib = u.startsWith('https') ? https : http;
      const req = lib.get(u, { headers: { 'User-Agent': 'PaltoCraft/1.0' }, timeout: 30000 }, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (redirects > 5) return cleanup(new Error('too many redirects'));
          const next = new URL(res.headers.location, u).toString();
          if (!hostAllowed(next, allowedHosts)) return cleanup(new Error('Недопустимый источник загрузки (редирект)'));
          return request(next, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return cleanup(new Error(`HTTP ${res.statusCode}`));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        res.on('data', chunk => {
          received += chunk.length;
          if (hasher) hasher.update(chunk);
          // Respect backpressure: pause the socket if the file buffer is full.
          if (!file.write(chunk)) {
            res.pause();
            file.once('drain', () => res.resume());
          }
          if (total && onProgress) onProgress(received, total);
        });
        res.on('end', () => {
          file.end(() => {
            if (hasher) {
              const got = hasher.digest('hex').toLowerCase();
              if (got !== String(integrity.hash).toLowerCase()) {
                try { fs.unlinkSync(destPath); } catch {}
                return reject(new Error('Контрольная сумма файла не совпадает — загрузка отклонена'));
              }
            }
            settled = true;
            resolve();
          });
        });
        res.on('error', cleanup);
      });
      req.on('error', cleanup);
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
    };

    request(url, 0);
    file.on('error', cleanup);
  });
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    if (process.platform === 'win32') {
      // execFile avoids shell — no injection via path characters.
      // Single quotes inside PS literal strings are escaped by doubling.
      const safeZip = zipPath.replace(/'/g, "''");
      const safeDest = destDir.replace(/'/g, "''");
      execFile('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${safeZip}' -DestinationPath '${safeDest}' -Force`
      ], { timeout: 120000 }, (err) => err ? reject(err) : resolve());
    } else {
      execFile('tar', ['-xzf', zipPath, '-C', destDir], { timeout: 120000 },
        (err) => err ? reject(err) : resolve());
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

// Holds the update metadata fetched from the trusted version.json in the
// main process. The renderer never supplies the URL or hash used for the
// actual download/verification — it only triggers the action.
let _pendingUpdate = null;

ipcMain.handle('check-update', async () => {
  try {
    const json = await fetchJson(UPDATE_CHECK_URL);
    if (!json || !json.version) return { hasUpdate: false };
    const hasUpdate = compareVersions(json.version, CURRENT_VERSION) > 0;
    _pendingUpdate = hasUpdate
      ? { version: json.version, url: json.url, sha256: json.sha256 || null }
      : null;
    return { hasUpdate, version: json.version, notes: json.notes || '' };
  } catch (err) {
    return { hasUpdate: false, error: err.message };
  }
});

const UPDATE_INSTALLER_PATH = () => path.join(app.getPath('temp'), 'PaltoCraft-Update.exe');

ipcMain.handle('download-update', async () => {
  // Use only the trusted values captured during check-update. Ignore anything
  // the renderer might pass so a compromised renderer can't substitute its own
  // installer + matching hash.
  if (!_pendingUpdate || !_pendingUpdate.url) {
    return { success: false, error: 'Нет доступного обновления' };
  }
  if (!_pendingUpdate.sha256) {
    return { success: false, error: 'У обновления нет контрольной суммы — установка отменена' };
  }
  const { url, sha256 } = _pendingUpdate;
  // Only allow downloading the installer over HTTPS from the official repo host.
  let host = '';
  try { host = new URL(url).host.toLowerCase(); } catch {}
  const allowedHosts = ['github.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com'];
  if (!url.startsWith('https://') || !allowedHosts.some(h => host === h || host.endsWith('.' + h))) {
    return { success: false, error: 'Недопустимый источник обновления' };
  }
  const tmpPath = UPDATE_INSTALLER_PATH();
  try {
    await downloadFile(url, tmpPath, (received, total) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-progress', { received, total });
      }
    });
    const fileHash = crypto.createHash('sha256').update(fs.readFileSync(tmpPath)).digest('hex');
    if (fileHash.toLowerCase() !== sha256.toLowerCase()) {
      fs.unlinkSync(tmpPath);
      return { success: false, error: 'Контрольная сумма не совпадает — файл повреждён или подменён' };
    }
    return { success: true, path: tmpPath };
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    return { success: false, error: err.message };
  }
});

ipcMain.handle('install-update', (_, installerPath) => {
  const expected = path.resolve(UPDATE_INSTALLER_PATH());
  if (!installerPath || path.resolve(installerPath) !== expected) {
    return { success: false, error: 'Недопустимый путь к установщику' };
  }
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
    sendToWindow('java-status', { stage: 'fetch-url', javaVer });
    const { url, size, checksum } = await getAdoptiumDownloadUrl(javaVer);

    sendToWindow('java-status', { stage: 'downloading', javaVer, size });
    // Adoptium publishes a sha256 checksum for each package — verify it.
    await downloadFile(url, tmpZip, (received, total) => {
      sendToWindow('java-progress', { received, total });
    }, checksum ? { algo: 'sha256', hash: checksum } : null);

    sendToWindow('java-status', { stage: 'extracting', javaVer });
    await extractZip(tmpZip, javaDir);

    try { fs.unlinkSync(tmpZip); } catch {}

    const javaExe = findJavaExe(javaDir);
    if (!javaExe) throw new Error('java.exe не найден после распаковки');

    sendToWindow('java-status', { stage: 'done', javaVer, javaExe });
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
    width: 1280,
    height: 780,
    minWidth: 900,
    minHeight: 560,
    frame: false,
    transparent: false,
    resizable: true,
    backgroundColor: '#0f0f17',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.maximize();
  mainWindow.setMenuBarVisibility(false);

  // Never let the renderer navigate away from the local app or open new windows.
  // Any external link is handed to the OS browser instead of loading in-app.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

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
  try { initDiscordRPC(); } catch {}
});

app.on('before-quit', () => { isQuitting = true; });
app.on('window-all-closed', () => { /* kept alive via tray */ });

ipcMain.on('window-minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});
ipcMain.on('window-maximize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window-close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
});

const SENSITIVE_KEYS = ['auth-token', 'auth-refresh', 'auth-profile', 'github-token'];

// Keys whose DECRYPTED value must never be handed to the renderer. The renderer
// only needs to know *that* a session exists (see 'auth-status'); the raw
// Microsoft/Minecraft access token, the refresh token and the GitHub write-token
// stay in the main process. Otherwise the at-rest encryption is pointless — any
// renderer-side code execution could just ask for the plaintext. 'auth-profile'
// (name / uuid / skin) is non-secret and stays readable for the UI.
const RENDERER_PRIVATE_KEYS = ['auth-token', 'auth-refresh', 'github-token'];

function secureGet(key) {
  if (SENSITIVE_KEYS.includes(key)) return store.encryptedGet(key);
  return store.get(key);
}
function secureSet(key, value) {
  if (SENSITIVE_KEYS.includes(key)) { store.encryptedSet(key, value); return; }
  store.set(key, value);
}

ipcMain.handle('store-get', (_, key) => {
  if (RENDERER_PRIVATE_KEYS.includes(key)) return null;
  return secureGet(key);
});
ipcMain.handle('store-set', (_, key, value) => {
  // The renderer must not be able to overwrite the private credentials either.
  if (RENDERER_PRIVATE_KEYS.includes(key)) return;
  secureSet(key, value);
});
ipcMain.handle('store-delete', (_, key) => store.delete(key));

// Safe way for the renderer to learn auth state without ever seeing the token.
ipcMain.handle('auth-status', () => ({ loggedIn: !!secureGet('auth-token') }));

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

    secureSet('auth-token', mclcToken);
    secureSet('auth-profile', profile);
    secureSet('auth-refresh', xboxManager.save());

    // Do NOT return the token to the renderer — it never needs the raw access
    // token (launch happens in main). Hand back only the non-secret profile.
    return { success: true, profile };
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    let code = 'UNKNOWN';
    if (msg.includes('does not have game') || msg.includes('does not own') || msg.includes('not own') || msg.includes('no game') || msg.includes('game ownership')) {
      code = 'NO_LICENSE';
    } else if (msg.includes('cancel') || msg.includes('closed') || msg.includes('abort') || msg.includes('user closed')) {
      code = 'CANCELLED';
    } else if (msg.includes('network') || msg.includes('fetch') || msg.includes('enotfound') || msg.includes('timeout')) {
      code = 'NETWORK';
    }
    return { success: false, error: code, errorDetail: err.message };
  }
});

ipcMain.handle('launch-minecraft', async (_, options) => {
  try {
    const { Client } = require('minecraft-launcher-core');
    const launcher = new Client();

    let storedToken = secureGet('auth-token');
    if (!storedToken) {
      return { success: false, error: 'Not authenticated' };
    }

    // Check if stored JWT access token is expired
    const refreshToken = secureGet('auth-refresh');
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
        secureSet('auth-token', storedToken);
        secureSet('auth-refresh', xboxManager.save());
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

    const sharedDir = (options.sharedDir && options.sharedDir.trim())
      ? path.resolve(options.sharedDir)
      : getDefaultGameDir();

    if (!fs.existsSync(sharedDir)) {
      fs.mkdirSync(sharedDir, { recursive: true });
    }

    // Build mirror URL overrides — replace Mojang CDN with user-selected mirror.
    // The mirror serves game assets that are loaded into the JVM, so only allow
    // HTTPS from a known-good mirror host; anything else falls back to Mojang to
    // prevent a compromised renderer from injecting a malicious asset source.
    const ASSET_MIRROR_HOSTS = ['bmclapi2.bangbang93.com', 'bmclapi.bangbang93.com'];
    const urlOverrides = {};
    let activeMirror = '';
    if (options.assetMirror) {
      try {
        const mu = new URL(String(options.assetMirror));
        const host = mu.host.toLowerCase();
        if (mu.protocol === 'https:' && ASSET_MIRROR_HOSTS.some(h => host === h || host.endsWith('.' + h))) {
          activeMirror = options.assetMirror;
          urlOverrides.resource = activeMirror; // overrides resources.download.minecraft.net
        }
      } catch {}
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('launch-log', {
        type: 'info',
        msg: `Зеркало ассетов: ${activeMirror || 'Mojang (официальное)'}${(options.assetMirror && !activeMirror) ? ' (указанное зеркало отклонено — недопустимый хост)' : ''}`
      });
    }

    const launchOptions = {
      authorization: storedToken,
      // root — путь к .minecraft (где MCLC хранит versions/, libraries/)
      // для мод-профилей это sharedDir, для ваниллы gameDir === sharedDir
      root: sharedDir,
      version: versionBlock,
      memory: {
        max: `${options.maxRam || 4}G`,
        min: `${options.minRam || 2}G`
      },
      javaPath: options.javaPath || 'java',
      overrides: {
        detached: false,
        cwd: sharedDir,
        assetRoot: path.join(sharedDir, 'assets'),
        libraryRoot: path.join(sharedDir, 'libraries'),
        // gameDirectory задаёт --gameDir для Minecraft (моды, конфиги, сохранения)
        // для мод-профилей это папка инстанса; для ванилла-запуска gameDir === sharedDir
        ...(gameDir !== sharedDir ? { gameDirectory: gameDir } : {}),
        ...(Object.keys(urlOverrides).length ? { url: urlOverrides } : {})
      },
      window: {
        width: options.winWidth || 854,
        height: options.winHeight || 480,
        fullscreen: options.fullscreen || false
      }
    };

    if (options.jvmArgs) {
      const args = options.jvmArgs.split(' ').filter(Boolean);
      const blocked = args.filter(a => /^-javaagent:/i.test(a) || /^-agentlib:/i.test(a) || /^-agentpath:/i.test(a));
      if (blocked.length) {
        return { success: false, error: 'Недопустимые JVM аргументы: ' + blocked.join(', ') };
      }
      launchOptions.customArgs = args;
    }

    launcher.on('debug', (e) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('launch-log', { type: 'debug', msg: String(e) });
      }
    });
    launcher.on('data', (e) => {
      const msg = String(e);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('launch-log', { type: 'data', msg });
      }
      // Discord RPC — detect server / singleplayer from game log
      const srvMatch = msg.match(/Connecting to (.+?), \d+/i);
      if (srvMatch) { setDiscordActivity(`Играет на ${srvMatch[1]}`); }
      else if (/Saving and quitting world|Leaving level/i.test(msg)) { setDiscordActivity('В главном меню'); }
      else if (/Loading level|Preparing level/i.test(msg)) { setDiscordActivity('Играет в одиночную'); }
    });
    launcher.on('progress', (e) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('launch-progress', e);
      }
    });
    launcher.on('close', (code) => {
      activeGameProcess = null;
      clearDiscordActivity();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('launch-close', code);
        if (options.hideLauncher) mainWindow.show();
      }
    });

    activeGameProcess = await launcher.launch(launchOptions);
    _drpcStartTs = new Date();
    setDiscordActivity('Загружает Minecraft...');

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

ipcMain.handle('read-crash-log', async (_, gameDir, launchTime) => {
  const dir = gameDir || getDefaultGameDir();
  let text = null;

  try {
    const crashDir = path.join(dir, 'crash-reports');
    if (fs.existsSync(crashDir)) {
      const files = fs.readdirSync(crashDir)
        .filter(f => f.endsWith('.txt'))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(crashDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      if (files.length > 0 && (!launchTime || files[0].mtime >= launchTime - 5000)) {
        const content = fs.readFileSync(path.join(crashDir, files[0].name), 'utf-8');
        text = content.split('\n').slice(0, 60).join('\n').trim();
      }
    }
  } catch {}

  if (!text) {
    try {
      const logPath = path.join(dir, 'logs', 'latest.log');
      if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, 'utf-8');
        const lines = content.split('\n');
        const relevant = [];
        for (let i = 0; i < lines.length; i++) {
          if (/Exception in thread|Caused by:|A fatal error|FATAL\]|ERROR\].*(?:Exception|Error:)/i.test(lines[i])) {
            relevant.push(...lines.slice(i, Math.min(i + 35, lines.length)));
            break;
          }
        }
        text = (relevant.length > 0 ? relevant : lines.slice(-25)).join('\n').trim();
      }
    } catch {}
  }

  return { text: text || 'Лог недоступен.' };
});

// Only these hosts may be contacted when resolving a skin. Prevents the
// renderer from turning this handler into an SSRF probe of arbitrary hosts.
const SKIN_ALLOWED_HOSTS = ['textures.minecraft.net', 'sessionserver.mojang.com'];
function isAllowedSkinUrl(u) {
  try {
    const parsed = new URL(String(u));
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.host.toLowerCase();
    return SKIN_ALLOWED_HOSTS.some(h => host === h || host.endsWith('.' + h));
  } catch { return false; }
}

ipcMain.handle('get-skin-data', async (_, uuidOrUrl) => {

  const fetchBuffer = (url) => new Promise((resolve) => {
    if (!isAllowedSkinUrl(url)) { resolve(null); return; }
    try {
      const lib = https;
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

    if (!String(uuidOrUrl).startsWith('http')) {
      // Treat as a Minecraft UUID — must be exactly 32 hex chars (dashes stripped)
      // to avoid path injection into the Mojang URL.
      const uuid = String(uuidOrUrl).replace(/-/g, '');
      if (!/^[0-9a-f]{32}$/i.test(uuid)) return null;
      const profileBuf = await fetchBuffer(
        `https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`
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
    // This jar is executed afterwards (java -jar ... --installClient), so pin the
    // download to the official Forge maven and forbid redirects off-host.
    await downloadFile(dlUrl, tmpPath, (received, total) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mod-progress', { received, total });
    }, null, ['maven.minecraftforge.net', 'files.minecraftforge.net']);
    send({ stage: 'installing-forge', ver: mcVersion });
    const dir = gameDir || getDefaultGameDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const lpPath = path.join(dir, 'launcher_profiles.json');
    if (!fs.existsSync(lpPath)) {
      fs.writeFileSync(lpPath, JSON.stringify({ profiles: {}, settings: {}, version: 3 }), 'utf8');
    }
    const mcMinor = parseInt((mcVersion.split('.')[1]) || '0');
    const javaVerForForge = mcMinor >= 17 ? 17 : (mcMinor >= 16 ? 11 : 8);
    const javaExe = findJavaExe(getJavaDir(dir, javaVerForForge))
                 || findJavaExe(getJavaDir(dir, 17))
                 || findJavaExe(getJavaDir(dir, 8))
                 || 'java';
    await new Promise((resolve, reject) => {
      let out = '';
      const child = spawn(javaExe, ['-jar', tmpPath, '--installClient'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        cwd: dir
      });
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Forge installer завис (таймаут 5 мин). Проблема с доступом к серверам Mojang/Forge.'));
      }, 5 * 60 * 1000);
      const onData = (d) => {
        const line = d.toString();
        out += line;
        line.split('\n').filter(l => l.trim()).forEach(l => send({ stage: 'forge-log', line: l.trim() }));
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) return resolve();
        const tail = out.trim().slice(-600);
        reject(new Error(`Forge installer завершился с кодом ${code} (java: ${javaExe})\n${tail}`));
      });
      child.on('error', (e) => { clearTimeout(timeout); reject(new Error(`Не удалось запустить Java: ${e.message} (путь: ${javaExe})`)); });
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
    // Executed afterwards (java -jar ... --installClient) — pin to the official
    // NeoForge maven and forbid redirects off-host.
    await downloadFile(dlUrl, tmpPath, (received, total) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mod-progress', { received, total });
    }, null, ['maven.neoforged.net']);
    send({ stage: 'installing-neoforge', ver: mcVersion });
    const dir = gameDir || getDefaultGameDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const lpPathNeo = path.join(dir, 'launcher_profiles.json');
    if (!fs.existsSync(lpPathNeo)) {
      fs.writeFileSync(lpPathNeo, JSON.stringify({ profiles: {}, settings: {}, version: 3 }), 'utf8');
    }
    const javaExe = findJavaExe(getJavaDir(dir, 21)) || 'java';
    await new Promise((resolve, reject) => {
      let out = '';
      const child = spawn(javaExe, ['-jar', tmpPath, '--installClient'], {
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, cwd: dir
      });
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('NeoForge installer завис (таймаут 5 мин). Проблема с доступом к серверам Mojang/NeoForge.'));
      }, 5 * 60 * 1000);
      const onData = (d) => {
        const line = d.toString();
        out += line;
        line.split('\n').filter(l => l.trim()).forEach(l => send({ stage: 'neoforge-log', line: l.trim() }));
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) return resolve();
        reject(new Error(`NeoForge installer завершился с кодом ${code} (java: ${javaExe})\n${out.trim().slice(-600)}`));
      });
      child.on('error', (e) => { clearTimeout(timeout); reject(new Error(`Не удалось запустить Java: ${e.message} (путь: ${javaExe})`)); });
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
    // Never trust the API-supplied filename for a path — strip any directory
    // component so it can't escape modsDir (e.g. "../../...").
    const safeName = path.basename(String(file.filename || ''));
    if (!safeName || safeName === '.' || safeName === '..') return { success: false, error: 'Некорректное имя файла мода' };
    const dir = gameDir || getDefaultGameDir();
    // Use version-specific subfolder so mods don't conflict across versions
    // Fabric Loader automatically loads mods from mods/{mcVersion}/ subfolder
    const modsDir = path.join(dir, 'mods', mcVersion);
    if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });
    const dest = path.join(modsDir, safeName);
    if (fs.existsSync(dest)) return { success: true, skipped: true };
    send({ stage: 'downloading-mod', modId, filename: file.filename });
    const integrity = file.hashes && file.hashes.sha512 ? { algo: 'sha512', hash: file.hashes.sha512 } : null;
    await downloadFile(file.url, dest, null, integrity);
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
  try {
    const resolved = path.resolve(String(folderPath || ''));
    let st;
    try { st = fs.statSync(resolved); }
    catch { return { success: false, error: 'Путь не найден' }; }
    // Only allow opening directories. This prevents a compromised renderer
    // from using shell.openPath to execute an arbitrary file.
    if (!st.isDirectory()) {
      return { success: false, error: 'Можно открывать только папки' };
    }
    await shell.openPath(resolved);
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
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
    const url = 'https://raw.githubusercontent.com/PaltoProjects/PaltoCraft/main/servers.json';
    const json = await fetchJson(url);
    return Array.isArray(json) ? json : [];
  } catch { return []; }
});

// ── Admin: publish servers.json straight to GitHub ───────────────────────────
// The write-capable GitHub token is stored ENCRYPTED on the admin's machine only
// (DPAPI via SENSITIVE_KEYS) and never ships in the build. A non-admin can call
// these handlers, but without a token that has write access to the repo every
// request fails — possession of the token is the real authorization.
const GH_OWNER = 'PaltoProjects';
const GH_REPO = 'PaltoCraft';
const GH_FILE = 'servers.json';
const GH_BRANCH = 'main';

function githubRequest(method, apiPath, token, bodyObj) {
  return new Promise((resolve, reject) => {
    const data = bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path: apiPath,
      method,
      headers: {
        'User-Agent': 'PaltoCraft-Admin',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {})
      },
      timeout: 15000
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch {}
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

ipcMain.handle('admin-has-token', () => !!secureGet('github-token'));

ipcMain.handle('admin-set-token', (_, token) => {
  if (typeof token !== 'string' || !token.trim()) return { success: false, error: 'Пустой токен' };
  secureSet('github-token', token.trim());
  return { success: true };
});

ipcMain.handle('admin-clear-token', () => { store.delete('github-token'); return { success: true }; });

ipcMain.handle('admin-publish-servers', async (_, list) => {
  try {
    const token = secureGet('github-token');
    if (!token) return { success: false, error: 'NO_TOKEN' };
    if (!Array.isArray(list)) return { success: false, error: 'Неверные данные' };

    // Sanitize so a stray/oversized field can't bloat or break the file.
    const clean = list
      .filter(s => s && typeof s === 'object')
      .map(s => ({
        name: String(s.name || '').slice(0, 100),
        ip: String(s.ip || '').slice(0, 200),
        version: String(s.version || '').slice(0, 50)
      }))
      .filter(s => s.name || s.ip);

    const content = Buffer.from(JSON.stringify(clean, null, 2) + '\n').toString('base64');

    // Need the current file SHA to update it (omit when the file doesn't exist yet).
    let sha;
    const getRes = await githubRequest('GET', `/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_FILE}?ref=${GH_BRANCH}`, token);
    if (getRes.status === 200 && getRes.json) sha = getRes.json.sha;
    else if (getRes.status === 401 || getRes.status === 403) return { success: false, error: 'Токен недействителен или нет прав на запись' };
    else if (getRes.status !== 404) return { success: false, error: `GitHub GET ${getRes.status}: ${getRes.json && getRes.json.message || ''}` };

    const putRes = await githubRequest('PUT', `/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_FILE}`, token, {
      message: 'admin: update servers.json',
      content,
      branch: GH_BRANCH,
      ...(sha ? { sha } : {})
    });
    if (putRes.status === 200 || putRes.status === 201) {
      return { success: true, count: clean.length };
    }
    if (putRes.status === 401 || putRes.status === 403) return { success: false, error: 'Токен недействителен или нет прав на запись' };
    return { success: false, error: `GitHub PUT ${putRes.status}: ${putRes.json && putRes.json.message || ''}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

function safeCacheKey(key) {
  if (typeof key !== 'string' || key.length === 0 || key.length > 200) return null;
  if (!/^[\w\-.]+$/.test(key)) return null;
  // Defence in depth: never let the cache write a file with an executable
  // extension (so it can't be combined with shell.openPath to run code).
  if (/\.(exe|bat|cmd|com|scr|ps1|psm1|msi|vbs|vbe|js|jse|jar|dll|lnk|sh|app|reg|hta|wsf|cpl)$/i.test(key)) return null;
  return key;
}

ipcMain.handle('cache-set', (_, key, value) => {
  const safe = safeCacheKey(key);
  if (!safe) return false;
  try {
    const cacheDir = path.join(app.getPath('userData'), 'cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, safe), value, 'utf8');
    return true;
  } catch { return false; }
});

ipcMain.handle('cache-get', (_, key) => {
  const safe = safeCacheKey(key);
  if (!safe) return null;
  try {
    const filePath = path.join(app.getPath('userData'), 'cache', safe);
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

// ── Mod Profile Management ────────────────────────────────────────────────────
function getModProfilesPath() {
  return path.join(app.getPath('userData'), 'mod-profiles.json');
}

function loadModProfiles() {
  const f = getModProfilesPath();
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; }
}

function saveModProfiles(profiles) {
  fs.writeFileSync(getModProfilesPath(), JSON.stringify(profiles, null, 2));
}

function getProfileInstanceDir(profile) {
  if (profile.gameDir) return profile.gameDir;
  return path.join(app.getPath('userData'), 'instances', profile.id);
}

ipcMain.handle('mod-profiles-list', () => loadModProfiles());

ipcMain.handle('mod-profile-save', (_, profile) => {
  try {
    const profiles = loadModProfiles();
    const idx = profiles.findIndex(p => p.id === profile.id);
    if (idx >= 0) profiles[idx] = profile; else profiles.push(profile);
    saveModProfiles(profiles);
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('mod-profile-delete', (_, profileId) => {
  try {
    saveModProfiles(loadModProfiles().filter(p => p.id !== profileId));
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('mod-profile-gamedir', (_, profileId) => {
  const profile = loadModProfiles().find(p => p.id === profileId);
  return profile ? getProfileInstanceDir(profile) : null;
});

ipcMain.handle('modrinth-search', async (_, query, mcVersion, loader, offset) => {
  try {
    const facets = [['project_type:mod']];
    if (loader && loader !== 'vanilla') facets.push([`categories:${loader}`]);
    if (mcVersion) facets.push([`versions:${mcVersion}`]);
    const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query || '')}&facets=${encodeURIComponent(JSON.stringify(facets))}&limit=20&offset=${offset || 0}&index=relevance`;
    const result = await fetchJson(url);
    return { success: true, hits: result.hits || [], totalHits: result.total_hits || 0 };
  } catch (err) { return { success: false, error: err.message, hits: [] }; }
});

// ── Modrinth installed-mods map (projectId → filename) ───────────────────────
function getModrinthMapPath(profile) {
  return path.join(getProfileInstanceDir(profile), 'mods', '.modrinth.json');
}
function readModrinthMap(profile) {
  const p = getModrinthMapPath(profile);
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}
function saveModrinthMap(profile, map) {
  const modsDir = path.join(getProfileInstanceDir(profile), 'mods');
  if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });
  fs.writeFileSync(getModrinthMapPath(profile), JSON.stringify(map, null, 2));
}

ipcMain.handle('modrinth-installed-ids', (_, profileId) => {
  const profile = loadModProfiles().find(p => p.id === profileId);
  if (!profile) return {};
  const map = readModrinthMap(profile);
  // Verify files still exist; clean up stale entries
  const modsDir = path.join(getProfileInstanceDir(profile), 'mods');
  let changed = false;
  for (const [pid, fname] of Object.entries(map)) {
    const base = path.basename(fname);
    const exists = fs.existsSync(path.join(modsDir, base)) ||
                   fs.existsSync(path.join(modsDir, base + '.disabled'));
    if (!exists) { delete map[pid]; changed = true; }
  }
  if (changed) saveModrinthMap(profile, map);
  return map; // { projectId: filename }
});

ipcMain.handle('modrinth-install-mod', async (_, profileId, projectId) => {
  const send = (data) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mod-dl-progress', data); };
  try {
    const profile = loadModProfiles().find(p => p.id === profileId);
    if (!profile) return { success: false, error: 'Профиль не найден' };

    let url = `https://api.modrinth.com/v2/project/${projectId}/version?game_versions=${encodeURIComponent(JSON.stringify([profile.mcVersion]))}`;
    if (profile.loader && profile.loader !== 'vanilla') {
      url += `&loaders=${encodeURIComponent(JSON.stringify([profile.loader]))}`;
    }
    send({ stage: 'fetch-versions', projectId });
    const versions = await fetchJson(url);
    if (!versions || !versions.length) return { success: false, notFound: true };

    const file = versions[0].files.find(f => f.primary) || versions[0].files[0];
    if (!file) return { success: false, error: 'Файл мода не найден' };

    // Never trust the API-supplied filename for a path — strip any directory
    // component so it can't escape modsDir (e.g. "../../...").
    const safeName = path.basename(String(file.filename || ''));
    if (!safeName || safeName === '.' || safeName === '..') return { success: false, error: 'Некорректное имя файла мода' };

    const modsDir = path.join(getProfileInstanceDir(profile), 'mods');
    if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });

    const dest = path.join(modsDir, safeName);
    if (fs.existsSync(dest)) {
      // Already on disk — ensure mapping is saved
      const map = readModrinthMap(profile);
      if (!map[projectId]) { map[projectId] = safeName; saveModrinthMap(profile, map); }
      return { success: true, skipped: true, filename: safeName };
    }

    send({ stage: 'downloading', filename: safeName });
    const integrity = file.hashes && file.hashes.sha512 ? { algo: 'sha512', hash: file.hashes.sha512 } : null;
    await downloadFile(file.url, dest, (received, total) => {
      send({ stage: 'progress', received, total });
    }, integrity);

    // Save projectId → filename mapping
    const map = readModrinthMap(profile);
    map[projectId] = safeName;
    saveModrinthMap(profile, map);

    return { success: true, skipped: false, filename: safeName };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('mod-list-installed', (_, profileId) => {
  try {
    const profile = loadModProfiles().find(p => p.id === profileId);
    if (!profile) return { success: false, error: 'Профиль не найден' };
    const modsDir = path.join(getProfileInstanceDir(profile), 'mods');
    if (!fs.existsSync(modsDir)) return { success: true, mods: [] };
    const mods = fs.readdirSync(modsDir)
      .filter(f => f.endsWith('.jar') || f.endsWith('.jar.disabled'))
      .sort()
      .map(filename => ({
        filename,
        enabled: filename.endsWith('.jar'),
        displayName: filename.replace(/\.jar(\.disabled)?$/, '').replace(/-[\d.+\-mc]+[\d.]*$/, '').replace(/[-_]/g, ' ').trim()
      }));
    return { success: true, mods };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('mod-toggle', (_, profileId, filename) => {
  try {
    const profile = loadModProfiles().find(p => p.id === profileId);
    if (!profile) return { success: false, error: 'Профиль не найден' };
    const safe = path.basename(filename);
    if (!safe.endsWith('.jar') && !safe.endsWith('.jar.disabled')) return { success: false, error: 'Invalid file' };
    const modsDir = path.join(getProfileInstanceDir(profile), 'mods');
    const toName = safe.endsWith('.jar') ? safe + '.disabled' : safe.replace(/\.disabled$/, '');
    fs.renameSync(path.join(modsDir, safe), path.join(modsDir, toName));
    return { success: true, newFilename: toName };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('mod-delete-file', (_, profileId, filename) => {
  try {
    const profile = loadModProfiles().find(p => p.id === profileId);
    if (!profile) return { success: false, error: 'Профиль не найден' };
    const safe = path.basename(filename);
    const modsDir = path.join(getProfileInstanceDir(profile), 'mods');
    const filePath = path.join(modsDir, safe);
    if (!path.resolve(filePath).startsWith(path.resolve(modsDir) + path.sep)) return { success: false, error: 'Invalid path' };
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    // Remove from Modrinth mapping if present
    const map = readModrinthMap(profile);
    const baseNoDisabled = safe.replace(/\.disabled$/, '');
    for (const [pid, fname] of Object.entries(map)) {
      if (path.basename(fname) === baseNoDisabled || path.basename(fname) === safe) {
        delete map[pid];
      }
    }
    saveModrinthMap(profile, map);
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});
