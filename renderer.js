document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`page-${btn.dataset.page}`).classList.add('active');
  });
});

document.getElementById('btn-minimize').addEventListener('click', () => window.launcher.minimize());
document.getElementById('btn-maximize').addEventListener('click', () => window.launcher.maximize());
document.getElementById('btn-close').addEventListener('click', () => window.launcher.close());

function spawnParticles() {
  const container = document.getElementById('particles');
  const colors = ['#5b6af5', '#7c3aed', '#22c55e', '#60a5fa', '#f59e0b'];
  for (let i = 0; i < 25; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = Math.random() * 4 + 2;
    p.style.cssText = `
      left: ${Math.random() * 100}%;
      bottom: -10px;
      width: ${size}px;
      height: ${size}px;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      animation-duration: ${Math.random() * 6 + 5}s;
      animation-delay: ${Math.random() * 8}s;
    `;
    container.appendChild(p);
  }
}
spawnParticles();

let currentUser = null;

async function loadAuth() {
  const token = await window.launcher.storeGet('auth-token');
  const profile = await window.launcher.storeGet('auth-profile');
  if (token) {
    appendConsole('info', 'Найден сохранённый аккаунт, выполняется вход...');
    setLoggedIn(token, profile);
  } else {
    appendConsole('info', 'Аккаунт не найден — требуется авторизация.');
  }
}

function setLoggedIn(token, profile) {
  currentUser = token;
  document.getElementById('state-login').style.display = 'none';
  document.getElementById('state-launch').style.display = 'flex';

  const name = (profile && profile.name) || token.name || 'Player';
  const rawUuid = (profile && profile.id) || token.uuid || '';
  const uuid = rawUuid.replace(/-/g, '');

  document.getElementById('launch-username').textContent = name;
  document.getElementById('profile-name').textContent = name;
  document.getElementById('profile-status').textContent = 'Лицензия активна';

  appendConsole('info', `Вошли как: ${name} (UUID: ${uuid || 'неизвестен'})`);

  const initial = name[0].toUpperCase();
  document.getElementById('launch-avatar').textContent = initial;
  document.getElementById('profile-avatar').textContent = initial;

  loadPlayerSkin(uuid, profile);
  loadVersions();
}

function setLoggedOut() {
  currentUser = null;
  document.getElementById('state-login').style.display = 'flex';
  document.getElementById('state-launch').style.display = 'none';
  document.getElementById('profile-name').textContent = 'Не авторизован';
  document.getElementById('profile-status').textContent = 'Войдите в аккаунт';
  document.getElementById('profile-avatar').innerHTML = '?';
}

document.getElementById('btn-login').addEventListener('click', async () => {
  const btn = document.getElementById('btn-login');
  btn.disabled = true;
  btn.textContent = 'Выполняется вход...';

  const result = await window.launcher.authMicrosoft();
  if (result.success) {
    setLoggedIn(result.token, result.profile);
  } else {
    alert('Ошибка входа: ' + (result.error || 'Неизвестная ошибка'));
  }

  btn.disabled = false;
  btn.innerHTML = `<svg viewBox="0 0 21 21" width="20" height="20"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>Войти через Microsoft`;
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await window.launcher.storeDelete('auth-token');
  await window.launcher.storeDelete('auth-profile');
  setLoggedOut();
});

let allVersions = [];
let activeFilter = 'release';
let isVersionDownloaded = false;

async function checkAndUpdateLaunchButton() {
  const version = document.getElementById('version-select').value;
  const btn = document.getElementById('btn-launch');
  if (!version) {
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><polygon points="5 3 19 12 5 21 5 3"/></svg> Играть`;
    isVersionDownloaded = false;
    return;
  }
  const settings = await getSettings();
  const gameDir = settings.gameDir || await window.launcher.getDefaultGameDir();
  isVersionDownloaded = await window.launcher.checkVersion(gameDir, version);
  window.launcher.checkJava(version, gameDir, allVersions).then(jc => {
    const hint = document.getElementById('java-hint');
    if (hint) hint.textContent = `Java ${jc.javaVer} ${jc.downloaded ? '✓' : '(будет скачана)'}`;
  });
  if (isVersionDownloaded) {
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><polygon points="5 3 19 12 5 21 5 3"/></svg> Играть`;
  } else {
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Скачать`;
  }
}

async function loadVersions() {
  const select = document.getElementById('version-select');
  select.innerHTML = '<option value="">Загрузка...</option>';
  appendConsole('info', 'Запрос списка версий с серверов Mojang...');
  const t0 = Date.now();
  const result = await window.launcher.getVersions();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (result.success && result.versions.length) {
    allVersions = result.versions;
    appendConsole('info', `Загружено ${result.versions.length} версий за ${elapsed}с.`);
    renderVersions();
  } else {
    appendConsole('warn', `Не удалось загрузить версии (${elapsed}с): ${result.error || 'нет ответа от сервера'}. Используется список по умолчанию.`);
    select.innerHTML = '<option value="1.21.4">1.21.4</option><option value="1.20.4">1.20.4</option>';
    checkAndUpdateLaunchButton();
  }
}

function renderVersions() {
  const select = document.getElementById('version-select');
  const filtered = activeFilter === 'all'
    ? allVersions
    : allVersions.filter(v => v.type === activeFilter);

  const labels = { release: 'Релиз', snapshot: 'Снапшот', old_beta: 'Beta', old_alpha: 'Alpha' };
  select.innerHTML = filtered.map(v =>
    `<option value="${v.id}">${v.id}${v.type !== 'release' ? ` (${labels[v.type] || v.type})` : ''}</option>`
  ).join('');
  checkAndUpdateLaunchButton();
}

document.getElementById('version-select').addEventListener('change', checkAndUpdateLaunchButton);

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderVersions();
  });
});

document.getElementById('btn-launch').addEventListener('click', async () => {
  const btn = document.getElementById('btn-launch');
  const version = document.getElementById('version-select').value;
  if (!version || btn.disabled) return;

  const isDownload = !isVersionDownloaded;
  btn.disabled = true;

  const settings = await getSettings();
  const gameDir = settings.gameDir || await window.launcher.getDefaultGameDir();

  if (isDownload) {
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Скачивание...`;
  } else {
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Запуск...`;
  }

  document.getElementById('progress-wrap').style.display = 'flex';
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('progress-label').textContent = isDownload ? 'Подготовка...' : 'Запуск...';

  window.launcher.off('launch-progress');
  window.launcher.off('launch-log');
  window.launcher.off('launch-close');
  window.launcher.off('java-status');
  window.launcher.off('java-progress');

  const javaCheck = await window.launcher.checkJava(version, gameDir, allVersions);
  let resolvedJavaPath = settings.javaPath || null;

  if (!resolvedJavaPath) {
    if (javaCheck.downloaded) {
      resolvedJavaPath = javaCheck.javaExe;
      appendConsole('info', `Java ${javaCheck.javaVer} уже установлена: ${javaCheck.javaExe}`);
    } else {
      appendConsole('info', `Java ${javaCheck.javaVer} не найдена — начинаем загрузку...`);
      document.getElementById('progress-label').textContent = `Загрузка Java ${javaCheck.javaVer}...`;
      document.getElementById('progress-fill').style.width = '0%';

      window.launcher.on('java-status', ({ stage, javaVer }) => {
        const labels = {
          'fetch-url':   `Получение ссылки Java ${javaVer}...`,
          'downloading': `Загрузка Java ${javaVer}...`,
          'extracting':  `Распаковка Java ${javaVer}...`,
          'done':        `Java ${javaVer} установлена`
        };
        document.getElementById('progress-label').textContent = labels[stage] || stage;
        appendConsole('info', labels[stage] || stage);
      });

      window.launcher.on('java-progress', ({ received, total }) => {
        const pct = total ? Math.round((received / total) * 100) : 0;
        document.getElementById('progress-fill').style.width = pct + '%';
        document.getElementById('progress-label').textContent = `Загрузка Java ${javaCheck.javaVer} — ${pct}% (${(received/1024/1024).toFixed(1)} / ${(total/1024/1024).toFixed(1)} MB)`;
      });

      const javaResult = await window.launcher.downloadJava(javaCheck.javaVer, gameDir);
      if (!javaResult.success) {
        appendConsole('error', 'Ошибка загрузки Java: ' + javaResult.error);
        btn.disabled = false;
        document.getElementById('progress-wrap').style.display = 'none';
        await checkAndUpdateLaunchButton();
        return;
      }
      resolvedJavaPath = javaResult.javaExe;
    }
  }

  window.launcher.on('launch-progress', (e) => {
    const pct = e.total ? Math.round((e.task / e.total) * 100) : 0;
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('progress-label').textContent = `${e.type || 'Загрузка'} — ${pct}%`;
  });

  window.launcher.on('launch-log', (data) => {
    appendConsole(data.type, data.msg);
  });

  window.launcher.on('launch-close', async (code) => {
    appendConsole('info', `Игра завершена с кодом ${code}`);
    btn.disabled = false;
    document.getElementById('progress-wrap').style.display = 'none';
    await checkAndUpdateLaunchButton();
  });

  document.getElementById('progress-label').textContent = isDownload ? 'Загрузка Minecraft...' : 'Запуск...';
  document.getElementById('progress-fill').style.width = '0%';

  const versionMeta = allVersions.find(v => v.id === version);
  const versionType = versionMeta ? versionMeta.type : 'release';

  const result = await window.launcher.launch({
    version,
    versionType,
    gameDir,
    maxRam: settings.maxRam || 4,
    minRam: settings.minRam || 2,
    javaPath: resolvedJavaPath || 'java',
    jvmArgs: settings.jvmArgs || '',
    winWidth: settings.winWidth || 854,
    winHeight: settings.winHeight || 480,
    fullscreen: settings.fullscreen || false,
    hideLauncher: settings.hideLauncher !== false,
    closeLauncher: settings.closeLauncher || false
  });

  if (!result.success) {
    appendConsole('error', 'Ошибка запуска: ' + result.error);
    btn.disabled = false;
    document.getElementById('progress-wrap').style.display = 'none';
    await checkAndUpdateLaunchButton();
  }
});

const DEFAULTS = { minRam: 2, maxRam: 4, gameDir: '', javaPath: '', jvmArgs: '', winWidth: 854, winHeight: 480, fullscreen: false, hideLauncher: true, closeLauncher: false };

async function getSettings() {
  const keys = Object.keys(DEFAULTS);
  const result = {};
  for (const key of keys) {
    const val = await window.launcher.storeGet(key);
    result[key] = val !== undefined ? val : DEFAULTS[key];
  }
  return result;
}

async function loadSettings() {
  const s = await getSettings();
  document.getElementById('set-min-ram').value = s.minRam;
  document.getElementById('set-max-ram').value = s.maxRam;
  document.getElementById('set-game-dir').value = s.gameDir;
  document.getElementById('set-java-path').value = s.javaPath;
  document.getElementById('set-jvm-args').value = s.jvmArgs;
  document.getElementById('set-win-width').value = s.winWidth;
  document.getElementById('set-win-height').value = s.winHeight;
  document.getElementById('set-fullscreen').checked = s.fullscreen;
  document.getElementById('set-hide-launcher').checked = s.hideLauncher;
  document.getElementById('set-close-launcher').checked = s.closeLauncher;
}

document.getElementById('btn-pick-dir').addEventListener('click', async () => {
  const folder = await window.launcher.pickFolder();
  if (folder) document.getElementById('set-game-dir').value = folder;
});

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  const fields = {
    minRam: parseInt(document.getElementById('set-min-ram').value),
    maxRam: parseInt(document.getElementById('set-max-ram').value),
    gameDir: document.getElementById('set-game-dir').value,
    javaPath: document.getElementById('set-java-path').value,
    jvmArgs: document.getElementById('set-jvm-args').value,
    winWidth: parseInt(document.getElementById('set-win-width').value),
    winHeight: parseInt(document.getElementById('set-win-height').value),
    fullscreen: document.getElementById('set-fullscreen').checked,
    hideLauncher: document.getElementById('set-hide-launcher').checked,
    closeLauncher: document.getElementById('set-close-launcher').checked
  };
  for (const [k, v] of Object.entries(fields)) {
    await window.launcher.storeSet(k, v);
  }
  const msg = document.getElementById('save-msg');
  msg.textContent = 'Сохранено!';
  setTimeout(() => msg.textContent = '', 2500);
});

document.getElementById('btn-reset-settings').addEventListener('click', async () => {
  if (!confirm('Сбросить все настройки?')) return;
  for (const key of Object.keys(DEFAULTS)) {
    await window.launcher.storeSet(key, DEFAULTS[key]);
  }
  loadSettings();
  const msg = document.getElementById('save-msg');
  msg.textContent = 'Сброшено!';
  setTimeout(() => msg.textContent = '', 2500);
});

function appendConsole(type, msg) {
  const el = document.getElementById('console-output');
  const line = document.createElement('div');
  line.className = `log-${type}`;
  const time = new Date().toLocaleTimeString();
  line.textContent = `[${time}] ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

document.getElementById('btn-clear-console').addEventListener('click', () => {
  document.getElementById('console-output').innerHTML = '';
});

document.getElementById('btn-copy-console').addEventListener('click', () => {
  const text = document.getElementById('console-output').innerText;
  navigator.clipboard.writeText(text);
});

let skinViewer = null;

async function loadPlayerSkin(uuid, profile) {
  try {
    if (!uuid) { appendConsole('warn', 'UUID не найден — скин недоступен.'); return; }
    const directUrl = profile?.skins?.[0]?.url;
    if (directUrl) appendConsole('debug', `Скин: URL из профиля → ${directUrl}`);
    else           appendConsole('info',  `Скин: запрос к sessionserver.mojang.com (UUID: ${uuid})...`);

    const t0 = Date.now();
    const skinDataUrl = directUrl
      ? await window.launcher.getSkinData(directUrl)
      : await window.launcher.getSkinData(uuid);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    if (!skinDataUrl) { appendConsole('warn', `Скин не загружен (${elapsed}с) — сервер недоступен.`); return; }
    appendConsole('info', `Скин получен за ${elapsed}с, рендеринг 3D...`);

    const canvas = document.getElementById('skin-viewer-canvas');
    const col = document.getElementById('skin-col');
    if (!canvas || !col) return;

    if (skinViewer) {
      skinViewer.dispose();
      skinViewer = null;
    }

    skinViewer = new skinview3d.SkinViewer({
      canvas,
      width: 380,
      height: 760,
      skin: skinDataUrl,
    });

    skinViewer.renderer.setClearColor(0x000000, 0);
    skinViewer.controls.enableZoom = false;
    skinViewer.controls.enablePan = false;
    skinViewer.controls.rotateSpeed = 0.9;

    const anim = skinViewer.animation = new skinview3d.WalkingAnimation();
    anim.speed = 0.6;

    try {
      const headUrl = await renderSkinFace(skinDataUrl, 38);
      const headSmUrl = await renderSkinFace(skinDataUrl, 34);
      const launchAv = document.getElementById('launch-avatar');
      const profileAv = document.getElementById('profile-avatar');
      if (launchAv && headUrl)    launchAv.innerHTML  = `<img src="${headUrl}"   alt="" style="width:100%;height:100%;border-radius:4px;image-rendering:pixelated">`;
      if (profileAv && headSmUrl) profileAv.innerHTML = `<img src="${headSmUrl}" alt="" style="width:100%;height:100%;border-radius:4px;image-rendering:pixelated">`;
    } catch {}

    appendConsole('info', 'Скин успешно загружен и отрисован в 3D.');
  } catch (e) {
    appendConsole('error', 'Ошибка загрузки скина: ' + e.message);
  }
}

function renderSkinFace(dataUrl, displaySize) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const s = displaySize * 2;
      const canvas = document.createElement('canvas');
      canvas.width = s; canvas.height = s;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 8, 8, 8, 8, 0, 0, s, s);
      ctx.drawImage(img, 40, 8, 8, 8, 0, 0, s, s);
      resolve(canvas.toDataURL());
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}


let _updateUrl = null;
let _downloadedPath = null;

async function checkForUpdates() {
  try {
    const result = await window.launcher.checkUpdate();
    if (!result.hasUpdate) return;

    _updateUrl = result.url;

    document.getElementById('update-version-label').textContent = `v${result.version}`;
    document.getElementById('update-notes').textContent = result.notes || '';
    document.getElementById('update-banner').style.display = 'flex';
    appendConsole('info', `Доступно обновление v${result.version}: ${result.notes || ''}`);
  } catch (e) {
    appendConsole('warn', 'Ошибка проверки обновлений: ' + e.message);
  }
}

document.getElementById('btn-update').addEventListener('click', async () => {
  const btn = document.getElementById('btn-update');

  if (_downloadedPath) {
    btn.disabled = true;
    btn.textContent = 'Установка...';
    appendConsole('info', 'Запуск установщика...');
    await window.launcher.installUpdate(_downloadedPath);
    return;
  }

  if (!_updateUrl) return;
  btn.disabled = true;
  btn.textContent = 'Загрузка...';

  const progressWrap = document.getElementById('update-progress-wrap');
  const progressFill = document.getElementById('update-progress-fill');
  const progressLabel = document.getElementById('update-progress-label');
  progressWrap.style.display = 'flex';

  window.launcher.off('update-progress');
  window.launcher.on('update-progress', ({ received, total }) => {
    const pct = total ? Math.round((received / total) * 100) : 0;
    const mb = (received / 1024 / 1024).toFixed(1);
    const totalMb = total ? (total / 1024 / 1024).toFixed(1) : '?';
    progressFill.style.width = pct + '%';
    progressLabel.textContent = `${pct}% (${mb} / ${totalMb} MB)`;
  });

  appendConsole('info', `Загрузка обновления: ${_updateUrl}`);
  const result = await window.launcher.downloadUpdate(_updateUrl);

  if (result.success) {
    _downloadedPath = result.path;
    progressFill.style.width = '100%';
    progressLabel.textContent = 'Готово!';
    btn.disabled = false;
    btn.textContent = 'Установить';
    btn.classList.add('ready');
    appendConsole('info', 'Обновление загружено. Нажмите «Установить» для установки.');
  } else {
    progressWrap.style.display = 'none';
    btn.disabled = false;
    btn.textContent = 'Повторить';
    appendConsole('error', 'Ошибка загрузки обновления: ' + result.error);
  }
});

appendConsole('info', 'PaltoCraft запущен.');
appendConsole('info', `Платформа: ${navigator.platform} | Electron`);
loadAuth();
loadSettings();
checkForUpdates();
