const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  storeGet: (key) => ipcRenderer.invoke('store-get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store-set', key, value),
  storeDelete: (key) => ipcRenderer.invoke('store-delete', key),

  authMicrosoft: () => ipcRenderer.invoke('auth-microsoft'),
  authStatus: () => ipcRenderer.invoke('auth-status'),

  launch: (options) => ipcRenderer.invoke('launch-minecraft', options),
  getVersions: () => ipcRenderer.invoke('get-versions'),
  checkVersion: (gameDir, version) => ipcRenderer.invoke('check-version', gameDir, version),
  getDefaultGameDir: () => ipcRenderer.invoke('get-default-gamedir'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  getSkinData: (uuidOrUrl) => ipcRenderer.invoke('get-skin-data', uuidOrUrl),

  checkJava: (mcVersion, gameDir, versionsManifest) => ipcRenderer.invoke('check-java', mcVersion, gameDir, versionsManifest),
  downloadJava: (javaVer, gameDir) => ipcRenderer.invoke('download-java', javaVer, gameDir),

  checkUpdate: () => ipcRenderer.invoke('check-update'),
  // URL + hash are held in the main process (from version.json); the renderer
  // only triggers the download, it cannot choose what gets installed.
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: (installerPath) => ipcRenderer.invoke('install-update', installerPath),

  cacheSet: (key, value) => ipcRenderer.invoke('cache-set', key, value),
  cacheGet: (key) => ipcRenderer.invoke('cache-get', key),

  checkAdmin: (uuid) => ipcRenderer.invoke('check-admin', uuid),
  getServers: () => ipcRenderer.invoke('get-servers'),

  adminHasToken: () => ipcRenderer.invoke('admin-has-token'),
  adminSetToken: (token) => ipcRenderer.invoke('admin-set-token', token),
  adminClearToken: () => ipcRenderer.invoke('admin-clear-token'),
  adminPublishServers: (list) => ipcRenderer.invoke('admin-publish-servers', list),

  ensureVanilla: (mcVersion, gameDir) => ipcRenderer.invoke('ensure-vanilla', mcVersion, gameDir),
  checkLoader: (loader, mcVersion, gameDir) => ipcRenderer.invoke('check-loader', loader, mcVersion, gameDir),
  installFabric: (mcVersion, gameDir) => ipcRenderer.invoke('install-fabric', mcVersion, gameDir),
  installForge: (mcVersion, gameDir) => ipcRenderer.invoke('install-forge', mcVersion, gameDir),
  installNeoforge: (mcVersion, gameDir) => ipcRenderer.invoke('install-neoforge', mcVersion, gameDir),
  downloadMod: (modId, mcVersion, loader, gameDir) => ipcRenderer.invoke('download-mod-modrinth', modId, mcVersion, loader, gameDir),
  readCrashLog: (gameDir, launchTime) => ipcRenderer.invoke('read-crash-log', gameDir, launchTime),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  killGame: () => ipcRenderer.invoke('kill-game'),

  modProfilesList: () => ipcRenderer.invoke('mod-profiles-list'),
  modProfileSave: (profile) => ipcRenderer.invoke('mod-profile-save', profile),
  modProfileDelete: (profileId) => ipcRenderer.invoke('mod-profile-delete', profileId),
  modProfileGamedir: (profileId) => ipcRenderer.invoke('mod-profile-gamedir', profileId),

  modrinthSearch: (query, mcVersion, loader, offset) => ipcRenderer.invoke('modrinth-search', query, mcVersion, loader, offset),
  modrinthInstallMod: (profileId, projectId) => ipcRenderer.invoke('modrinth-install-mod', profileId, projectId),
  modrinthInstalledIds: (profileId) => ipcRenderer.invoke('modrinth-installed-ids', profileId),

  modListInstalled: (profileId) => ipcRenderer.invoke('mod-list-installed', profileId),
  modToggle: (profileId, filename) => ipcRenderer.invoke('mod-toggle', profileId, filename),
  modDeleteFile: (profileId, filename) => ipcRenderer.invoke('mod-delete-file', profileId, filename),

  on: (channel, callback) => {
    const allowed = ['auth-update', 'launch-log', 'launch-progress', 'launch-close', 'java-status', 'java-progress', 'update-progress', 'mod-status', 'mod-progress', 'mod-dl-progress'];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => callback(...args));
    }
  },
  off: (channel) => ipcRenderer.removeAllListeners(channel)
});
