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
  initAdmin(uuid);
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

const OPT_VERSIONS = ['1.12.2', '1.16.5', '1.18.2', '1.20.2', '1.21.11'];

const OPT_LOADERS = {
  '1.12.2':  ['forge'],
  '1.16.5':  ['fabric', 'forge'],
  '1.18.2':  ['fabric', 'forge'],
  '1.20.2':  ['fabric', 'forge'],
  '1.21.11': ['fabric', 'neoforge']
};

const OPT_MODS = {
  '1.12.2': {
    forge: ['vanillafix']
  },
  '1.16.5': {
    fabric: ['sodium', 'lithium', 'phosphor', 'ferrite-core', 'entityculling'],
    forge:  ['rubidium', 'ferrite-core']
  },
  '1.18.2': {
    fabric: ['sodium', 'lithium', 'ferrite-core', 'entityculling', 'immediatelyfast'],
    forge:  ['rubidium', 'ferrite-core']
  },
  '1.20.2': {
    fabric: ['sodium', 'lithium', 'ferrite-core', 'entityculling', 'immediatelyfast'],
    forge:  ['rubidium']
  },
  '1.21.11': {
    fabric:   ['sodium', 'lithium', 'ferrite-core', 'entityculling', 'immediatelyfast'],
    neoforge: ['embeddium', 'ferrite-core']
  }
};

let activeOptLoader = null;
let optVersionId = null;
let _launching = false;

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

  if (activeFilter === 'optimized') {
    if (!activeOptLoader) {
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><polygon points="5 3 19 12 5 21 5 3"/></svg> Выберите загрузчик`;
      return;
    }
    const settings = await getSettings();
    const gameDir = settings.gameDir || await window.launcher.getDefaultGameDir();
    const loaderCheck = await window.launcher.checkLoader(activeOptLoader, version, gameDir);
    if (loaderCheck.installed) {
      optVersionId = loaderCheck.versionId;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><polygon points="5 3 19 12 5 21 5 3"/></svg> Играть`;
    } else {
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Установить`;
    }
    const hint = document.getElementById('java-hint');
    if (hint) hint.textContent = '';
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
    await window.launcher.cacheSet('versions.json', JSON.stringify(result.versions));
    appendConsole('info', `Загружено ${result.versions.length} версий за ${elapsed}с.`);
    renderVersions();
  } else {
    const cached = await window.launcher.cacheGet('versions.json');
    if (cached) {
      try {
        allVersions = JSON.parse(cached);
        appendConsole('warn', `Нет интернета — используется кэш (${allVersions.length} версий).`);
        renderVersions();
        return;
      } catch {}
    }
    appendConsole('warn', `Не удалось загрузить версии (${elapsed}с): ${result.error || 'нет ответа от сервера'}. Используется список по умолчанию.`);
    select.innerHTML = '<option value="1.21.4">1.21.4</option><option value="1.20.4">1.20.4</option>';
    checkAndUpdateLaunchButton();
  }
}

function renderVersions() {
  const select = document.getElementById('version-select');

  if (activeFilter === 'optimized') {
    select.innerHTML = OPT_VERSIONS.map(v => `<option value="${v}">${v}</option>`).join('');
    updateLoaderButtons(OPT_VERSIONS[0]);
    checkAndUpdateLaunchButton();
    return;
  }

  document.getElementById('loader-row').style.display = 'none';
  activeOptLoader = null;
  optVersionId = null;

  const filtered = activeFilter === 'all'
    ? allVersions
    : allVersions.filter(v => v.type === activeFilter);

  const labels = { release: 'Релиз', snapshot: 'Снапшот', old_beta: 'Beta', old_alpha: 'Alpha' };
  select.innerHTML = filtered.map(v =>
    `<option value="${v.id}">${v.id}${v.type !== 'release' ? ` (${labels[v.type] || v.type})` : ''}</option>`
  ).join('');
  checkAndUpdateLaunchButton();
}

function updateLoaderButtons(version) {
  const row = document.getElementById('loader-row');
  if (!row || activeFilter !== 'optimized') { if (row) row.style.display = 'none'; return; }
  const loaders = OPT_LOADERS[version] || [];
  if (!loaders.length) { row.style.display = 'none'; return; }
  if (!activeOptLoader || !loaders.includes(activeOptLoader)) activeOptLoader = loaders[0];
  row.style.display = 'flex';
  row.innerHTML = loaders.map(l =>
    `<button class="loader-btn${activeOptLoader === l ? ' active' : ''}" data-loader="${l}">${l.charAt(0).toUpperCase() + l.slice(1)}</button>`
  ).join('');
  row.querySelectorAll('.loader-btn').forEach(btn => {
    btn.onclick = () => {
      if (activeOptLoader === btn.dataset.loader) return;
      activeOptLoader = btn.dataset.loader;
      optVersionId = null;
      updateLoaderButtons(document.getElementById('version-select').value);
      checkAndUpdateLaunchButton();
    };
  });
}

document.getElementById('version-select').addEventListener('change', () => {
  optVersionId = null;
  if (activeFilter === 'optimized') updateLoaderButtons(document.getElementById('version-select').value);
  checkAndUpdateLaunchButton();
});

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderVersions();
  });
});

document.getElementById('btn-launch-arrow').addEventListener('click', (e) => {
  e.stopPropagation();
  const dd = document.getElementById('launch-dropdown');
  const arrow = document.getElementById('btn-launch-arrow');
  const open = dd.style.display === 'flex';
  dd.style.display = open ? 'none' : 'flex';
  dd.style.flexDirection = 'column';
  arrow.classList.toggle('open', !open);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#launch-dropdown') && !e.target.closest('#btn-launch-arrow')) {
    const dd = document.getElementById('launch-dropdown');
    if (dd) dd.style.display = 'none';
    const arrow = document.getElementById('btn-launch-arrow');
    if (arrow) arrow.classList.remove('open');
  }
});

document.getElementById('btn-open-gamedir').addEventListener('click', async () => {
  document.getElementById('launch-dropdown').style.display = 'none';
  document.getElementById('btn-launch-arrow').classList.remove('open');
  const settings = await getSettings();
  const gameDir = settings.gameDir || await window.launcher.getDefaultGameDir();
  const r = await window.launcher.openPath(gameDir);
  if (!r || !r.success) appendConsole('warn', 'Не удалось открыть папку: ' + gameDir);
});

document.getElementById('btn-open-modsdir').addEventListener('click', async () => {
  document.getElementById('launch-dropdown').style.display = 'none';
  document.getElementById('btn-launch-arrow').classList.remove('open');
  const settings = await getSettings();
  const gameDir = settings.gameDir || await window.launcher.getDefaultGameDir();
  const modsDir = gameDir + '/mods';
  const r = await window.launcher.openPath(modsDir);
  if (!r || !r.success) appendConsole('error', 'Вы ещё не установили ни одной версии.');
});

function resetLaunchUI() {
  _launching = false;
  const btn = document.getElementById('btn-launch');
  const wrap = document.getElementById('progress-wrap');
  if (btn) { btn.disabled = false; }
  if (wrap) wrap.style.display = 'none';
  document.getElementById('progress-fill').style.width = '0%';
  checkAndUpdateLaunchButton();
}

document.getElementById('btn-stop').addEventListener('click', async () => {
  appendConsole('warn', 'Остановка...');
  await window.launcher.killGame().catch(() => {});
  resetLaunchUI();
  appendConsole('warn', 'Запуск остановлен.');
});

async function ensureJava(version, gameDir, settings) {
  let javaPath = settings.javaPath || null;
  if (javaPath) return javaPath;
  const jc = await window.launcher.checkJava(version, gameDir, allVersions);
  if (jc.downloaded) return jc.javaExe;
  appendConsole('info', `Java ${jc.javaVer} не найдена — загружаем...`);
  document.getElementById('progress-label').textContent = `Загрузка Java ${jc.javaVer}...`;
  window.launcher.off('java-status');
  window.launcher.off('java-progress');
  window.launcher.on('java-status', ({ stage, javaVer }) => {
    const labels = { 'fetch-url': `Получение ссылки Java ${javaVer}...`, 'downloading': `Загрузка Java ${javaVer}...`, 'extracting': `Распаковка Java ${javaVer}...`, 'done': `Java ${javaVer} установлена` };
    document.getElementById('progress-label').textContent = labels[stage] || stage;
  });
  window.launcher.on('java-progress', ({ received, total }) => {
    const pct = total ? Math.round((received / total) * 100) : 0;
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('progress-label').textContent = `Загрузка Java ${jc.javaVer} — ${pct}%`;
  });
  const res = await window.launcher.downloadJava(jc.javaVer, gameDir);
  if (!res.success) throw new Error('Ошибка загрузки Java: ' + res.error);
  return res.javaExe;
}

document.getElementById('btn-launch').addEventListener('click', async () => {
  const btn = document.getElementById('btn-launch');
  const version = document.getElementById('version-select').value;
  if (!version || btn.disabled) return;

  if (activeFilter === 'optimized') {
    await handleOptLaunch(btn, version);
    return;
  }

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
    resetLaunchUI();
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
    resetLaunchUI();
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

    if (!skinDataUrl) {
      appendConsole('warn', `Скин не загружен (${elapsed}с) — сервер недоступен. Загружаю из кэша...`);
      await loadSkinFromCache();
      return;
    }
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

    await window.launcher.cacheSet('skin.dat', skinDataUrl);

    try {
      const headUrl = await renderSkinFace(skinDataUrl, 38);
      const headSmUrl = await renderSkinFace(skinDataUrl, 34);
      const launchAv = document.getElementById('launch-avatar');
      const profileAv = document.getElementById('profile-avatar');
      if (launchAv && headUrl)    { launchAv.innerHTML  = `<img src="${headUrl}"   alt="" style="width:100%;height:100%;border-radius:4px;image-rendering:pixelated">`; await window.launcher.cacheSet('avatar-lg.dat', headUrl); }
      if (profileAv && headSmUrl) { profileAv.innerHTML = `<img src="${headSmUrl}" alt="" style="width:100%;height:100%;border-radius:4px;image-rendering:pixelated">`; await window.launcher.cacheSet('avatar-sm.dat', headSmUrl); }
    } catch {}

    appendConsole('info', 'Скин успешно загружен и отрисован в 3D.');
  } catch (e) {
    appendConsole('error', 'Ошибка загрузки скина: ' + e.message);
    await loadSkinFromCache();
  }
}

async function loadSkinFromCache() {
  try {
    const skinDataUrl = await window.launcher.cacheGet('skin.dat');
    const headUrl     = await window.launcher.cacheGet('avatar-lg.dat');
    const headSmUrl   = await window.launcher.cacheGet('avatar-sm.dat');

    if (skinDataUrl) {
      const canvas = document.getElementById('skin-viewer-canvas');
      if (canvas) {
        if (skinViewer) { skinViewer.dispose(); skinViewer = null; }
        skinViewer = new skinview3d.SkinViewer({ canvas, width: 380, height: 760, skin: skinDataUrl });
        skinViewer.renderer.setClearColor(0x000000, 0);
        skinViewer.controls.enableZoom = false;
        skinViewer.controls.enablePan = false;
        skinViewer.controls.rotateSpeed = 0.9;
        const anim = skinViewer.animation = new skinview3d.WalkingAnimation();
        anim.speed = 0.6;
      }
    }

    const launchAv  = document.getElementById('launch-avatar');
    const profileAv = document.getElementById('profile-avatar');
    if (launchAv  && headUrl)   launchAv.innerHTML  = `<img src="${headUrl}"   alt="" style="width:100%;height:100%;border-radius:4px;image-rendering:pixelated">`;
    if (profileAv && headSmUrl) profileAv.innerHTML = `<img src="${headSmUrl}" alt="" style="width:100%;height:100%;border-radius:4px;image-rendering:pixelated">`;

    if (skinDataUrl) appendConsole('info', 'Скин загружен из кэша (нет интернета).');
  } catch {}
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
    document.getElementById('update-overlay').style.display = 'flex';
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

async function handleOptLaunch(btn, mcVersion) {
  if (!activeOptLoader || _launching) return;
  _launching = true;
  btn.disabled = true;
  document.getElementById('progress-wrap').style.display = 'flex';
  document.getElementById('progress-fill').style.width = '0%';

  const settings = await getSettings();
  const gameDir = settings.gameDir || await window.launcher.getDefaultGameDir();

  const setProgress = (text, pct) => {
    document.getElementById('progress-label').textContent = text;
    if (pct !== undefined) document.getElementById('progress-fill').style.width = pct + '%';
  };

  try {
    let versionId = optVersionId;

    if (!versionId) {
      const loaderCheck = await window.launcher.checkLoader(activeOptLoader, mcVersion, gameDir);
      versionId = loaderCheck.versionId;

      if (!loaderCheck.installed) {
        if (activeOptLoader === 'fabric') {
          setProgress('Установка Fabric Loader...', 10);
          window.launcher.on('mod-status', ({ stage }) => {
            if (stage === 'fetch-loader') setProgress('Получение версии Fabric...', 20);
            if (stage === 'fetch-profile') setProgress('Загрузка профиля Fabric...', 40);
            if (stage === 'done') setProgress('Fabric установлен!', 60);
          });
          const r = await window.launcher.installFabric(mcVersion, gameDir);
          window.launcher.off('mod-status');
          if (!r.success) throw new Error('Ошибка установки Fabric: ' + r.error);
          versionId = r.versionId;
          appendConsole('info', 'Fabric установлен: ' + versionId);
        } else if (activeOptLoader === 'forge') {
          setProgress('Загрузка Forge...', 10);
          window.launcher.on('mod-progress', ({ received, total }) => {
            const pct = total ? Math.round((received / total) * 50) + 10 : 30;
            setProgress(`Загрузка Forge... ${(received/1024/1024).toFixed(1)} МБ`, pct);
          });
          const r = await window.launcher.installForge(mcVersion, gameDir);
          window.launcher.off('mod-progress');
          window.launcher.off('mod-status');
          if (!r.success) throw new Error('Ошибка установки Forge: ' + r.error);
          versionId = r.versionId;
          appendConsole('info', 'Forge установлен: ' + versionId);
        } else if (activeOptLoader === 'neoforge') {
          setProgress('Загрузка NeoForge...', 10);
          window.launcher.on('mod-progress', ({ received, total }) => {
            const pct = total ? Math.round((received / total) * 50) + 10 : 30;
            setProgress(`Загрузка NeoForge... ${(received/1024/1024).toFixed(1)} МБ`, pct);
          });
          const r = await window.launcher.installNeoforge(mcVersion, gameDir);
          window.launcher.off('mod-progress');
          window.launcher.off('mod-status');
          if (!r.success) throw new Error('Ошибка установки NeoForge: ' + r.error);
          versionId = r.versionId;
          appendConsole('info', 'NeoForge установлен: ' + versionId);
        }
      }
      optVersionId = versionId;
    }

    const mods = (OPT_MODS[mcVersion] || {})[activeOptLoader] || [];
    if (mods.length) {
      appendConsole('info', `Проверка ${mods.length} модов...`);
      for (let i = 0; i < mods.length; i++) {
        const modId = mods[i];
        setProgress(`Мод ${i + 1}/${mods.length}: ${modId}`, 60 + Math.round((i / mods.length) * 25));
        const r = await window.launcher.downloadMod(modId, mcVersion, activeOptLoader, gameDir);
        if (r.success && !r.skipped) appendConsole('info', `${modId} — скачан`);
        else if (r.skipped) appendConsole('info', `${modId} — уже есть`);
        else appendConsole('warn', `${modId} — не найден для ${mcVersion}/${activeOptLoader}`);
      }
    }

    // Убедиться что ванильный jar скачан (нужен MCLC для inheritsFrom)
    const vanillaJarExists = await window.launcher.checkVersion(gameDir, mcVersion);
    if (!vanillaJarExists) {
      appendConsole('info', `Ванилла ${mcVersion} не найдена — скачиваем...`);
      setProgress(`Скачиваем Minecraft ${mcVersion}...`, 62);
      window.launcher.off('mod-status');
      window.launcher.off('mod-progress');
      window.launcher.on('mod-status', ({ stage }) => {
        if (stage === 'fetch-vanilla-manifest') setProgress('Получение манифеста Mojang...', 64);
        if (stage === 'fetch-vanilla-json')     setProgress(`Загрузка ${mcVersion}.json...`, 66);
        if (stage === 'downloading-vanilla')    setProgress(`Скачиваем ${mcVersion}.jar...`, 68);
      });
      window.launcher.on('mod-progress', ({ received, total }) => {
        const pct = total ? Math.round((received / total) * 15) + 68 : 72;
        setProgress(`Скачиваем ${mcVersion}.jar — ${(received/1024/1024).toFixed(1)} МБ`, pct);
      });
      const vr = await window.launcher.ensureVanilla(mcVersion, gameDir);
      window.launcher.off('mod-status');
      window.launcher.off('mod-progress');
      if (!vr.success) throw new Error('Ошибка загрузки ванильной версии: ' + vr.error);
      appendConsole('info', `Minecraft ${mcVersion} скачан успешно.`);
    }

    setProgress('Подготовка Java...', 85);
    const javaPath = await ensureJava(mcVersion, gameDir, settings);

    setProgress('Запуск...', 95);
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Запуск...`;

    window.launcher.off('launch-progress');
    window.launcher.off('launch-log');
    window.launcher.off('launch-close');

    window.launcher.on('launch-progress', (e) => {
      const pct = e.total ? Math.round((e.task / e.total) * 100) : 0;
      document.getElementById('progress-fill').style.width = pct + '%';
      document.getElementById('progress-label').textContent = `${e.type || 'Загрузка'} — ${pct}%`;
    });
    window.launcher.on('launch-log', (data) => appendConsole(data.type, data.msg));
    window.launcher.on('launch-close', async (code) => {
      appendConsole('info', `Игра завершена с кодом ${code}`);
      resetLaunchUI();
    });

    const result = await window.launcher.launch({
      version: mcVersion,        // базовая ванильная версия (для downloads.client)
      customVersion: versionId,  // fabric/forge/neoforge версия (custom в MCLC)
      versionType: 'release',
      gameDir,
      maxRam: settings.maxRam || 4,
      minRam: settings.minRam || 2,
      javaPath: javaPath || 'java',
      jvmArgs: settings.jvmArgs || '',
      winWidth: settings.winWidth || 854,
      winHeight: settings.winHeight || 480,
      fullscreen: settings.fullscreen || false,
      hideLauncher: settings.hideLauncher !== false,
      closeLauncher: settings.closeLauncher || false
    });

    if (!result.success) throw new Error(result.error);
    if (settings.closeLauncher) return;
    if (settings.hideLauncher) { /* window hidden */ }

  } catch (e) {
    appendConsole('error', 'Ошибка: ' + e.message);
    resetLaunchUI();
  }
}

function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let _srv = [];

async function loadServers() {
  try {
    const data = await window.launcher.getServers();
    if (Array.isArray(data)) _srv = data;
    renderServers();
  } catch {}
}

function renderServers() {
  const bar = document.getElementById('servers-bar');
  const list = document.getElementById('servers-list');
  if (!bar || !list) return;
  if (!_srv.length) { bar.style.display = 'none'; return; }

  list.innerHTML = _srv.map((s) =>
    `<div class="server-card" data-ip="${_esc(s.ip)}">
      <span class="server-dot"></span>
      <span class="server-name">${_esc(s.name)}</span>
      <span class="server-sep">|</span>
      <span class="server-ip">${_esc(s.ip)}</span>
      <span class="server-sep">|</span>
      <span class="server-ver">${_esc(s.version)}</span>
      <button class="server-copy-btn" title="Скопировать IP">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
    </div>`
  ).join('');

  list.querySelectorAll('.server-copy-btn').forEach(btn => {
    btn.onclick = () => navigator.clipboard.writeText(btn.closest('.server-card').dataset.ip);
  });

  bar.style.display = 'flex';
}

async function initAdmin(uuid) {
  try {
    const ok = await window.launcher.checkAdmin(uuid);
    if (!ok) return;
    const wrap = document.querySelector('#page-console .page-header > div');
    if (wrap) {
      const b = document.createElement('button');
      b.className = 'btn-admin';
      b.textContent = 'Админ-Панель';
      b.onclick = () => { const m = document.getElementById('__ap'); if (m) { m.style.display = 'flex'; _renderAdminRows(); } };
      wrap.insertBefore(b, wrap.firstChild);
    }
    _buildAdminPanel();
  } catch {}
}

function _buildAdminPanel() {
  const ov = document.createElement('div');
  ov.id = '__ap';
  ov.className = 'admin-modal';
  ov.style.display = 'none';

  const card = document.createElement('div');
  card.className = 'admin-card';
  card.innerHTML = `
    <div class="admin-hdr">
      <h3>Управление</h3>
      <button class="admin-close-btn" id="__ap-x">✕</button>
    </div>
    <div class="admin-body">
      <span class="admin-section-title">Игровые серверы</span>
      <div id="__ap-rows"></div>
      <button class="btn btn-sm" id="__ap-add">+ Добавить сервер</button>
    </div>
    <div class="admin-footer">
      <button class="btn btn-primary" id="__ap-copy">Скопировать JSON</button>
      <span class="admin-hint">Вставь в servers.json на GitHub и запушь</span>
    </div>`;

  ov.appendChild(card);
  document.body.appendChild(ov);

  document.getElementById('__ap-x').onclick = () => { ov.style.display = 'none'; };
  document.getElementById('__ap-add').onclick = () => { _srv.push({ name: '', ip: '', version: '' }); _renderAdminRows(); };
  document.getElementById('__ap-copy').onclick = () => {
    navigator.clipboard.writeText(JSON.stringify(_srv, null, 2));
    const btn = document.getElementById('__ap-copy');
    const orig = btn.textContent;
    btn.textContent = 'Скопировано!';
    setTimeout(() => { btn.textContent = orig; }, 1800);
  };
}

function _renderAdminRows() {
  const c = document.getElementById('__ap-rows');
  if (!c) return;
  c.innerHTML = '';
  _srv.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'admin-server-row';
    row.innerHTML = `
      <input class="input" placeholder="Название" value="${_esc(s.name)}" data-i="${i}" data-f="name">
      <input class="input" placeholder="IP адрес"  value="${_esc(s.ip)}"   data-i="${i}" data-f="ip">
      <input class="input" placeholder="Версия"    value="${_esc(s.version)}" data-i="${i}" data-f="version">
      <button class="admin-del-btn" data-i="${i}">✕</button>`;
    c.appendChild(row);
  });
  c.querySelectorAll('.input[data-i]').forEach(inp => {
    inp.oninput = () => { _srv[+inp.dataset.i][inp.dataset.f] = inp.value; renderServers(); };
  });
  c.querySelectorAll('.admin-del-btn').forEach(btn => {
    btn.onclick = () => { _srv.splice(+btn.dataset.i, 1); _renderAdminRows(); renderServers(); };
  });
}

appendConsole('info', 'PaltoCraft запущен.');
appendConsole('info', `Платформа: ${navigator.platform} | Electron`);
loadAuth();
loadSettings();
checkForUpdates();
loadServers();
