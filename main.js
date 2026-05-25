const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const Store = require('./store');

const store = new Store();

// Single source of truth: read version from package.json
let CURRENT_VERSION = '0.0.0';
try {
  CURRENT_VERSION = require('./package.json').version || '0.0.0';
} catch {}
const USER_AGENT = `PaltoCraft/${CURRENT_VERSION}`;
const UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/PaltoCraft/PaltoCraft/main/version.json';

// Encrypted-at-rest keys (use OS keychain via safeStorage). Auth tokens go here.
const ENCRYPTED_KEYS = new Set(['auth-token', 'auth-refresh', 'auth-profile']);

// Allowed cache keys — strict allowlist, prevents path traversal in cache-set/get.
const SAFE_KEY_RE = /^[A-Za-z0-9._-]+$/;
function isValidCacheKey(key) {
  return typeof key === 'string' && key.length > 0 && key.length <= 128 && SAFE_KEY_RE.test(key);
}

// Safe webContents.send — no-op if window is missing or destroyed.
function safeSend(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function checkIntegrity() {
  const manifestPath = path.join(__dirname, 'integrity.json');
  if (!fs.existsSync(manifestPath)) return;

  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { return; }

  // Cover all JS that runs in-process plus renderer assets.
  const files = Object.keys(manifest);
  for (const file of files) {
    if (!SAFE_KEY_RE.test(file)) continue; // ignore weird entries
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

// SemVer-ish: parses MAJOR.MINOR.PATCH(-prerelease). Pre-release versions are LOWER than release of the same triple.
function compareVersions(a, b) {
  const parse = (v) => {
    const m = String(v).trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:[-+](.+))?$/);
    if (!m) return null;
    return {
      nums: [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3] || '0', 10)],
      pre: m[4] || ''
    };
  };
  const pa = parse(a), pb = parse(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] > pb.nums[i]) return 1;
    if (pa.nums[i] < pb.nums[i]) return -1;
  }
  // No pre-release outranks any pre-release of the same numeric version.
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && !pb.pre) return -1;
  if (pa.pre === pb.pre) return 0;
  return pa.pre < pb.pre ? -1 : 1;
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

// Authoritative source: version JSON from Mojang manifest (`javaVersion.majorVersion`).
// Fallback heuristic covers ranges Mojang actually shipped:
//   1.16 → 8, 1.17 → 16, 1.18–1.20.4 → 17, 1.20.5+/1.21+ → 21.
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
  if (/^[ab]/.test(mcVersion)) return 8; // alpha/beta
  // Snapshot id like 24w14a — use latest LTS the era is on.
  if (/^\d{2}w/.test(mcVersion)) {
    const year = parseInt(mcVersion.slice(0, 2), 10);
    if (year >= 24) return 21;
    if (year >= 21) return 17;
    return 8;
  }
  const parts = mcVersion.split('.').map(n => parseInt(n, 10) || 0);
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  if (minor >= 21) return 21;
  if (minor === 20 && patch >= 5) return 21;
  if (minor >= 18) return 17;
  if (minor === 17) return 16;
  return 8;
}

function fetchJson(url, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': USER_AGENT }, timeout: 15000 }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return fetchJson(res.headers.location, depth + 1).then(resolve, reject);
      }
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

function getJavaDir(gameDir, javaVer) {
  return path.join(gameDir || getDefaultGameDir(), 'runtime', `java-${javaVer}`);
}

function findJavaExe(javaDir) {
  if (!fs.existsSync(javaDir)) return null;
  const exeName = process.platform === 'win32' ? 'java.exe' : 'java';
  // Look 1 level deep (Adoptium archives unpack as jdk-XX.Y.Z+N/bin/java) then flat fallback.
  try {
    for (const entry of fs.readdirSync(javaDir)) {
      // macOS bundles: jdk-XX.jdk/Contents/Home/bin/java
      const macHome = path.join(javaDir, entry, 'Contents', 'Home', 'bin', exeName);
      if (fs.existsSync(macHome)) return macHome;
      const exe = path.join(javaDir, entry, 'bin', exeName);
      if (fs.existsSync(exe)) return exe;
    }
  } catch {}
  const flat = path.join(javaDir, 'bin', exeName);
  if (fs.existsSync(flat)) return flat;
  return null;
}

// Compute sha256 of a file, returns hex string.
function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', c => hash.update(c));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// Same for sha1 (Modrinth provides sha1 + sha512).
function sha1OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(filePath);
    stream.on('data', c => hash.update(c));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// Robust downloader: timeout, redirect cap, backpressure via pipe, waits for fs flush, optional sha256/sha1 verify.
function downloadFile(url, destPath, onProgress, opts = {}) {
  const { expectedSha256, expectedSha1, timeoutMs = 60_000, maxRedirects = 5 } = opts;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmpPath = destPath + '.part';

  return new Promise((resolve, reject) => {
    let redirects = 0;
    let activeReq = null;
    let file = null;

    const cleanup = () => {
      try { if (file && !file.destroyed) file.destroy(); } catch {}
      try { if (activeReq && !activeReq.destroyed) activeReq.destroy(); } catch {}
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    };

    const fail = (err) => { cleanup(); reject(err); };

    const start = (currentUrl) => {
      let lib;
      try { lib = currentUrl.startsWith('https') ? https : http; }
      catch (e) { return fail(e); }

      file = fs.createWriteStream(tmpPath);
      file.on('error', fail);

      activeReq = lib.get(currentUrl, { headers: { 'User-Agent': USER_AGENT }, timeout: timeoutMs }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          try { file.destroy(); } catch {}
          if (++redirects > maxRedirects) return fail(new Error('too many redirects'));
          return start(new URL(res.headers.location, currentUrl).toString());
        }
        if (res.statusCode !== 200) {
          res.resume();
          return fail(new Error(`HTTP ${res.statusCode} for ${currentUrl}`));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        res.on('data', chunk => {
          received += chunk.length;
          if (total && onProgress) onProgress(received, total);
        });
        res.on('error', fail);
        file.on('finish', async () => {
          try {
            if (expectedSha256) {
              const actual = await sha256OfFile(tmpPath);
              if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
                return fail(new Error(`SHA-256 mismatch (expected ${expectedSha256}, got ${actual})`));
              }
            }
            if (expectedSha1) {
              const actual = await sha1OfFile(tmpPath);
              if (actual.toLowerCase() !== expectedSha1.toLowerCase()) {
                return fail(new Error(`SHA-1 mismatch (expected ${expectedSha1}, got ${actual})`));
              }
            }
            fs.renameSync(tmpPath, destPath);
            resolve();
          } catch (e) { fail(e); }
        });
        res.pipe(file);
      });
      activeReq.on('error', fail);
      activeReq.on('timeout', () => activeReq.destroy(new Error('download timeout')));
    };

    start(url);
  });
}

// Extract archive. Win uses Expand-Archive for .zip, tar for .tar.gz. Linux/macOS use system tar (handles both).
// All paths passed as argv (no shell interpolation → no injection).
function extractArchive(archivePath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    const isTarGz = /\.tar\.gz$|\.tgz$/i.test(archivePath);

    let cmd, args;
    if (process.platform === 'win32' && !isTarGz) {
      // PowerShell argv (no string interpolation — each arg is a separate process argument).
      cmd = 'powershell.exe';
      args = [
        '-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath ${JSON.stringify(archivePath)} -DestinationPath ${JSON.stringify(destDir)} -Force`
      ];
    } else {
      // Modern Windows ships bsdtar (tar.exe) and handles both .zip and .tar.gz. Linux/macOS tar same.
      cmd = process.platform === 'win32' ? 'tar.exe' : 'tar';
      args = ['-xf', archivePath, '-C', destDir];
    }

    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', c => { stderr += String(c); });
    const killTimer = setTimeout(() => { try { child.kill(); } catch {} }, 180_000);
    child.on('close', (code) => {
      clearTimeout(killTimer);
      if (code === 0) resolve();
      else reject(new Error(`extract failed (code ${code}): ${stderr.slice(0, 400)}`));
    });
    child.on('error', (e) => { clearTimeout(killTimer); reject(e); });
  });
}
// Back-compat alias.
const extractZip = extractArchive;

async function getAdoptiumDownloadUrl(javaVersion) {
  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  let arch;
  if (process.arch === 'x64') arch = 'x64';
  else if (process.arch === 'arm64') arch = 'aarch64';
  else if (process.arch === 'ia32') arch = 'x86';
  else arch = process.arch;

  const apiUrl = `https://api.adoptium.net/v3/assets/latest/${javaVersion}/hotspot?architecture=${arch}&image_type=jre&os=${os}&vendor=eclipse`;
  const json = await fetchJson(apiUrl);
  if (!Array.isArray(json) || !json.length) {
    throw new Error('Adoptium: нет релизов для Java ' + javaVersion + ' (' + os + '/' + arch + ')');
  }
  const pkg = json[0].binary && json[0].binary.package;
  if (!pkg || !pkg.link) throw new Error('Adoptium: не найдена ссылка на скачивание');
  return { url: pkg.link, size: pkg.size, checksum: pkg.checksum, name: pkg.name };
}

ipcMain.handle('check-update', async () => {
  try {
    const json = await fetchJson(UPDATE_CHECK_URL);
    if (!json || !json.version) return { hasUpdate: false };
    const hasUpdate = compareVersions(json.version, CURRENT_VERSION) > 0;
    return { hasUpdate, version: json.version, url: json.url, notes: json.notes || '', sha256: json.sha256 || null };
  } catch (err) {
    return { hasUpdate: false, error: err.message };
  }
});

ipcMain.handle('download-update', async (_, url, expectedSha256) => {
  const tmpPath = path.join(app.getPath('temp'), 'PaltoCraft-Update.exe');
  try {
    await downloadFile(url, tmpPath, (received, total) => {
      safeSend('update-progress', { received, total });
    }, { expectedSha256: expectedSha256 || undefined, timeoutMs: 300_000 });
    return { success: true, path: tmpPath };
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    try { if (fs.existsSync(tmpPath + '.part')) fs.unlinkSync(tmpPath + '.part'); } catch {}
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
  let tmpArchive = null;

  try {
    safeSend('java-status', { stage: 'fetch-url', javaVer });
    const { url, size, checksum, name } = await getAdoptiumDownloadUrl(javaVer);
    const ext = (name && name.toLowerCase().endsWith('.tar.gz')) ? '.tar.gz'
              : (name && name.toLowerCase().endsWith('.zip'))    ? '.zip'
              : (process.platform === 'win32' ? '.zip' : '.tar.gz');
    tmpArchive = path.join(app.getPath('temp'), `paltocraft-java-${javaVer}${ext}`);

    safeSend('java-status', { stage: 'downloading', javaVer, size });
    await downloadFile(url, tmpArchive, (received, total) => {
      safeSend('java-progress', { received, total });
    }, { expectedSha256: checksum || undefined, timeoutMs: 600_000 });

    safeSend('java-status', { stage: 'extracting', javaVer });
    await extractArchive(tmpArchive, javaDir);

    try { fs.unlinkSync(tmpArchive); } catch {}

    const javaExe = findJavaExe(javaDir);
    if (!javaExe) throw new Error('Java executable не найден после распаковки');

    safeSend('java-status', { stage: 'done', javaVer, javaExe });
    return { success: true, javaExe };
  } catch (err) {
    try { if (tmpArchive && fs.existsSync(tmpArchive)) fs.unlinkSync(tmpArchive); } catch {}
    try { if (tmpArchive && fs.existsSync(tmpArchive + '.part')) fs.unlinkSync(tmpArchive + '.part'); } catch {}
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
  try {
    tray = new Tray(path.join(__dirname, 'assets', 'icon.ico'));
  } catch (e) {
    console.warn('[tray] failed to create:', e.message);
    return;
  }
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
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);

  // Block all navigation — the launcher is single-page; clicks to external URLs go to the OS browser.
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) { try { shell.openExternal(url); } catch {} }
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
});

app.on('before-quit', () => { isQuitting = true; });
app.on('window-all-closed', () => { /* kept alive via tray */ });

ipcMain.on('window-minimize', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize(); });
ipcMain.on('window-maximize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window-close', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide(); });

// Store: encrypt confidential keys at rest via Electron safeStorage (DPAPI/Keychain/libsecret).
function encryptStoreValue(value) {
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) return value;
  const json = JSON.stringify(value);
  const buf = safeStorage.encryptString(json);
  return { __enc: 'safeStorage', data: buf.toString('base64') };
}
function decryptStoreValue(stored) {
  if (!stored || typeof stored !== 'object' || stored.__enc !== 'safeStorage') return stored;
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) return null;
  try {
    const buf = Buffer.from(stored.data, 'base64');
    return JSON.parse(safeStorage.decryptString(buf));
  } catch { return null; }
}

ipcMain.handle('store-get', (_, key) => {
  if (typeof key !== 'string' || !SAFE_KEY_RE.test(key)) return undefined;
  const raw = store.get(key);
  if (ENCRYPTED_KEYS.has(key)) return decryptStoreValue(raw);
  return raw;
});
ipcMain.handle('store-set', (_, key, value) => {
  if (typeof key !== 'string' || !SAFE_KEY_RE.test(key)) return false;
  if (ENCRYPTED_KEYS.has(key)) store.set(key, encryptStoreValue(value));
  else store.set(key, value);
  return true;
});
ipcMain.handle('store-delete', (_, key) => {
  if (typeof key !== 'string' || !SAFE_KEY_RE.test(key)) return false;
  store.delete(key);
  return true;
});

// Internal helpers for main-process code that needs to read encrypted values directly.
function storeGetSecure(key) {
  const raw = store.get(key);
  return ENCRYPTED_KEYS.has(key) ? decryptStoreValue(raw) : raw;
}
function storeSetSecure(key, value) {
  if (ENCRYPTED_KEYS.has(key)) store.set(key, encryptStoreValue(value));
  else store.set(key, value);
}

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
  const send = (data) => safeSend('mod-status', data);
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
      const clientInfo = versionData.downloads && versionData.downloads.client;
      const jarUrl = clientInfo && clientInfo.url;
      const jarSha1 = clientInfo && clientInfo.sha1;
      if (!jarUrl) throw new Error('Не найдена ссылка на jar для ' + mcVersion);
      send({ stage: 'downloading-vanilla', ver: mcVersion });
      await downloadFile(jarUrl, versionJarPath, (received, total) => {
        safeSend('mod-progress', { received, total });
      }, { expectedSha1: jarSha1 || undefined, timeoutMs: 600_000 });
    }

    send({ stage: 'done-vanilla', ver: mcVersion });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('auth-microsoft', async () => {
  let authManager;
  const onLoad = (asset, message) => safeSend('auth-update', { asset, message });
  try {
    const { Auth } = require('msmc');
    authManager = new Auth('select_account');
    authManager.on('load', onLoad);

    const xboxManager = await authManager.launch('electron');
    const mcToken = await xboxManager.getMinecraft();
    const mclcToken = mcToken.mclc();
    const profile = mcToken.profile;

    storeSetSecure('auth-token', mclcToken);
    storeSetSecure('auth-profile', profile);
    storeSetSecure('auth-refresh', xboxManager.save()); // Microsoft refresh token

    return { success: true, token: mclcToken, profile };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    try { if (authManager && typeof authManager.removeListener === 'function') authManager.removeListener('load', onLoad); } catch {}
    try { if (authManager && typeof authManager.removeAllListeners === 'function') authManager.removeAllListeners('load'); } catch {}
  }
});

ipcMain.handle('launch-minecraft', async (_, options) => {
  try {
    const { Client } = require('minecraft-launcher-core');
    const launcher = new Client();

    let storedToken = storeGetSecure('auth-token');
    if (!storedToken) {
      return { success: false, error: 'Not authenticated' };
    }

    // Check if stored JWT access token is expired
    const refreshToken = storeGetSecure('auth-refresh');
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
      safeSend('launch-log', { type: 'error', msg: 'Сессия истекла. Выйдите из аккаунта и войдите снова.' });
      return { success: false, error: 'Сессия истекла — выйдите из аккаунта и войдите снова в лаунчере.' };
    }

    // Refresh Microsoft session before launching to fix "Invalid session" on online servers
    if (refreshToken) {
      let refreshAuth;
      try {
        const { Auth } = require('msmc');
        refreshAuth = new Auth('select_account');
        const xboxManager = await refreshAuth.refresh(refreshToken);
        const mcToken = await xboxManager.getMinecraft();
        storedToken = mcToken.mclc();
        storeSetSecure('auth-token', storedToken);
        storeSetSecure('auth-refresh', xboxManager.save());
        safeSend('launch-log', { type: 'info', msg: 'Сессия авторизации обновлена.' });
      } catch (refreshErr) {
        safeSend('launch-log', { type: 'warn', msg: 'Не удалось обновить сессию: ' + refreshErr.message });
        if (tokenExpired) {
          return { success: false, error: 'Сессия истекла — выйдите из аккаунта и войдите снова.' };
        }
      } finally {
        try { refreshAuth && refreshAuth.removeAllListeners && refreshAuth.removeAllListeners(); } catch {}
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

    // Collect JVM args. For Fabric, optionally inject -Dfabric.addMods so a per-version mods folder loads.
    const extraJvm = [];
    if (options.jvmArgs) {
      for (const a of String(options.jvmArgs).split(' ')) {
        if (a) extraJvm.push(a);
      }
    }
    if (options.fabricExtraModsDir) {
      extraJvm.push(`-Dfabric.addMods=${options.fabricExtraModsDir}`);
    }

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

    if (extraJvm.length) {
      launchOptions.customArgs = extraJvm;
    }

    launcher.on('debug', (e) => {
      safeSend('launch-log', { type: 'debug', msg: String(e) });
    });
    launcher.on('data', (e) => {
      safeSend('launch-log', { type: 'data', msg: String(e) });
    });
    launcher.on('progress', (e) => {
      safeSend('launch-progress', e);
    });
    launcher.on('close', (code) => {
      activeGameProcess = null;
      // Drop all listeners we attached to this launcher to avoid retention.
      try { launcher.removeAllListeners(); } catch {}
      safeSend('launch-close', code);
      if (mainWindow && !mainWindow.isDestroyed() && options.hideLauncher) mainWindow.show();
    });

    activeGameProcess = await launcher.launch(launchOptions);

    if (options.closeLauncher) {
      // Allow the close handler to actually quit instead of hiding to tray.
      isQuitting = true;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
      // Schedule app.quit() in case close() is also intercepted somewhere.
      setTimeout(() => { try { app.quit(); } catch {} }, 300);
    } else if (options.hideLauncher) {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
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
    // Forge produces several layouts depending on installer/MC version:
    //   <mcVer>-forge-<forgeVer>     (modern 1.16+)
    //   forge-<mcVer>-<forgeVer>     (older installers)
    //   <mcVer>-forge<forgeVer>      (some very old)
    found = entries.find(e =>
      e === mcVersion + '-forge' ||
      e.startsWith(mcVersion + '-forge-') ||
      e.startsWith(mcVersion + '-forge') ||
      e.startsWith('forge-' + mcVersion + '-') ||
      e.startsWith(mcVersion + '-Forge')
    );
  } else if (loader === 'neoforge') {
    const minorVer = mcVersion.split('.').slice(1).join('.');
    found = entries.find(e => e.startsWith('neoforge-' + minorVer + '.'));
  }
  return { installed: !!found, versionId: found || null };
});

ipcMain.handle('install-fabric', async (_, mcVersion, gameDir) => {
  const send = (data) => safeSend('mod-status', data);
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

// Pick the Java the Forge/NeoForge installer itself runs on. The launcher's own Java cache is preferred,
// otherwise fall back to system 'java'. Old Forge (≤1.12) needs Java 8, modern 1.16–1.20 Java 17,
// 1.20.5+/1.21+ Java 21.
function pickInstallerJava(mcVersion, gameDir) {
  const needed = (() => {
    if (!mcVersion) return 17;
    const parts = mcVersion.split('.').map(n => parseInt(n, 10) || 0);
    const minor = parts[1] ?? 0, patch = parts[2] ?? 0;
    if (minor <= 12) return 8;
    if (minor <= 16) return 8;
    if (minor === 17) return 16;
    if (minor === 20 && patch >= 5) return 21;
    if (minor >= 21) return 21;
    return 17;
  })();

  const dir = gameDir || getDefaultGameDir();
  // Try the exact required java, then a few fallbacks in priority order.
  const candidates = [needed, 17, 21, 8, 16, 11];
  const seen = new Set();
  for (const v of candidates) {
    if (seen.has(v)) continue;
    seen.add(v);
    const exe = findJavaExe(getJavaDir(dir, v));
    if (exe) return exe;
  }
  return 'java';
}

ipcMain.handle('install-forge', async (_, mcVersion, gameDir) => {
  const send = (data) => safeSend('mod-status', data);
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
      safeSend('mod-progress', { received, total });
    }, { timeoutMs: 600_000 });
    send({ stage: 'installing-forge', ver: mcVersion });
    const dir = gameDir || getDefaultGameDir();
    const javaExe = pickInstallerJava(mcVersion, dir);
    await new Promise((resolve, reject) => {
      const child = spawn(javaExe, ['-jar', tmpPath, '--installClient', dir], { stdio: 'ignore', windowsHide: true });
      const killTimer = setTimeout(() => { try { child.kill(); } catch {}; reject(new Error('Forge installer timed out')); }, 600_000);
      child.on('close', (code) => { clearTimeout(killTimer); code === 0 ? resolve() : reject(new Error('Forge installer завершился с кодом ' + code)); });
      child.on('error', (e) => { clearTimeout(killTimer); reject(e); });
    });
    try { fs.unlinkSync(tmpPath); } catch {}
    send({ stage: 'done', ver: mcVersion });
    const versionsDir = path.join(dir, 'versions');
    const entries = fs.existsSync(versionsDir) ? fs.readdirSync(versionsDir) : [];
    const found = entries.find(e =>
      e === mcVersion + '-forge' ||
      e.startsWith(mcVersion + '-forge-') ||
      e.startsWith(mcVersion + '-forge') ||
      e.startsWith('forge-' + mcVersion + '-')
    );
    return { success: true, versionId: found || ('forge-' + fullVer) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('install-neoforge', async (_, mcVersion, gameDir) => {
  const send = (data) => safeSend('mod-status', data);
  try {
    send({ stage: 'fetch-neoforge-meta', ver: mcVersion });
    const minorVer = mcVersion.split('.').slice(1).join('.');
    const xmlData = await new Promise((resolve, reject) => {
      const req = https.get('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml',
        { headers: { 'User-Agent': USER_AGENT }, timeout: 15_000 }, (res) => {
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode} fetching NeoForge metadata`));
          }
          let d = '';
          res.setEncoding('utf8');
          res.on('data', c => d += c);
          res.on('end', () => resolve(d));
          res.on('error', reject);
        });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('timeout')));
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
      safeSend('mod-progress', { received, total });
    }, { timeoutMs: 600_000 });
    send({ stage: 'installing-neoforge', ver: mcVersion });
    const dir = gameDir || getDefaultGameDir();
    const javaExe = pickInstallerJava(mcVersion, dir);
    await new Promise((resolve, reject) => {
      const child = spawn(javaExe, ['-jar', tmpPath, '--installClient', dir], { stdio: 'ignore', windowsHide: true });
      const killTimer = setTimeout(() => { try { child.kill(); } catch {}; reject(new Error('NeoForge installer timed out')); }, 600_000);
      child.on('close', (code) => { clearTimeout(killTimer); code === 0 ? resolve() : reject(new Error('NeoForge installer завершился с кодом ' + code)); });
      child.on('error', (e) => { clearTimeout(killTimer); reject(e); });
    });
    try { fs.unlinkSync(tmpPath); } catch {}
    send({ stage: 'done', ver: mcVersion });
    return { success: true, versionId: 'neoforge-' + neoVer };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Download a mod from Modrinth. For Fabric we keep the per-version subfolder (mods/{mcVer}/) only when the
// caller passes useSubfolder=true (renderer adds -Dfabric.addMods JVM arg in that case). For Forge/NeoForge,
// the loader can't read subfolders — we install directly into mods/ so the game actually loads them.
ipcMain.handle('download-mod-modrinth', async (_, modId, mcVersion, loader, gameDir, useSubfolder) => {
  const send = (data) => safeSend('mod-status', data);
  try {
    const apiUrl = 'https://api.modrinth.com/v2/project/' + encodeURIComponent(modId)
      + '/version?game_versions=' + encodeURIComponent(JSON.stringify([mcVersion]))
      + '&loaders=' + encodeURIComponent(JSON.stringify([loader]));
    const versions = await fetchJson(apiUrl);
    if (!Array.isArray(versions) || !versions.length) return { success: false, notFound: true };
    // Pick newest by publish date (API order isn't contractually newest-first).
    versions.sort((a, b) => new Date(b.date_published || 0) - new Date(a.date_published || 0));
    const release = versions[0];
    const file = (release.files || []).find(f => f.primary) || (release.files || [])[0];
    if (!file) return { success: false, notFound: true };
    const dir = gameDir || getDefaultGameDir();
    const modsDir = useSubfolder ? path.join(dir, 'mods', mcVersion) : path.join(dir, 'mods');
    if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });
    const dest = path.join(modsDir, file.filename);
    if (fs.existsSync(dest)) return { success: true, skipped: true, dest };
    send({ stage: 'downloading-mod', modId, filename: file.filename });
    const sha1 = file.hashes && file.hashes.sha1;
    await downloadFile(file.url, dest, undefined, { expectedSha1: sha1 || undefined, timeoutMs: 300_000 });
    return { success: true, skipped: false, dest };
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

// External URLs only — block file://, javascript:, etc. so renderer can't trick the main process.
ipcMain.handle('open-external', async (_, url) => {
  try {
    if (typeof url !== 'string') return { success: false, error: 'bad url' };
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return { success: false, error: 'protocol not allowed' };
    await shell.openExternal(parsed.toString());
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('get-app-version', () => CURRENT_VERSION);

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
    if (!isValidCacheKey(key)) return false;
    const cacheDir = path.join(app.getPath('userData'), 'cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    const filePath = path.join(cacheDir, key);
    // Defense in depth: ensure we never escape the cache dir even if the regex changed.
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(cacheDir) + path.sep)) return false;
    if (typeof value !== 'string') return false;
    if (value.length > 32 * 1024 * 1024) return false; // 32 MB cap
    fs.writeFileSync(resolved, value, 'utf8');
    return true;
  } catch { return false; }
});

ipcMain.handle('cache-get', (_, key) => {
  try {
    if (!isValidCacheKey(key)) return null;
    const cacheDir = path.join(app.getPath('userData'), 'cache');
    const filePath = path.join(cacheDir, key);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(cacheDir) + path.sep)) return null;
    if (!fs.existsSync(resolved)) return null;
    return fs.readFileSync(resolved, 'utf8');
  } catch { return null; }
});

ipcMain.handle('get-versions', async () => {
  try {
    return await new Promise((resolve) => {
      const req = https.get(
        'https://launchermeta.mojang.com/mc/game/version_manifest.json',
        { headers: { 'User-Agent': USER_AGENT }, timeout: 15000 },
        (res) => {
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            res.resume();
            return resolve({ success: false, versions: [], error: `HTTP ${res.statusCode}` });
          }
          let data = '';
          res.setEncoding('utf8');
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
      req.on('timeout', () => { req.destroy(new Error('timeout')); resolve({ success: false, versions: [] }); });
      req.on('error', (e) => resolve({ success: false, error: e.message, versions: [] }));
    });
  } catch (err) {
    return { success: false, error: err.message, versions: [] };
  }
});
