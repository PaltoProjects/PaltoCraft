const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  storeGet: (key) => ipcRenderer.invoke('store-get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store-set', key, value),
  storeDelete: (key) => ipcRenderer.invoke('store-delete', key),

  authMicrosoft: () => ipcRenderer.invoke('auth-microsoft'),

  launch: (options) => ipcRenderer.invoke('launch-minecraft', options),
  getVersions: () => ipcRenderer.invoke('get-versions'),
  checkVersion: (gameDir, version) => ipcRenderer.invoke('check-version', gameDir, version),
  getDefaultGameDir: () => ipcRenderer.invoke('get-default-gamedir'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  getSkinData: (uuidOrUrl) => ipcRenderer.invoke('get-skin-data', uuidOrUrl),

  checkJava: (mcVersion, gameDir, versionsManifest) => ipcRenderer.invoke('check-java', mcVersion, gameDir, versionsManifest),
  downloadJava: (javaVer, gameDir) => ipcRenderer.invoke('download-java', javaVer, gameDir),

  checkUpdate: () => ipcRenderer.invoke('check-update'),
  downloadUpdate: (url) => ipcRenderer.invoke('download-update', url),
  installUpdate: (installerPath) => ipcRenderer.invoke('install-update', installerPath),

  cacheSet: (key, value) => ipcRenderer.invoke('cache-set', key, value),
  cacheGet: (key) => ipcRenderer.invoke('cache-get', key),

  checkAdmin: (uuid) => ipcRenderer.invoke('check-admin', uuid),
  getServers: () => ipcRenderer.invoke('get-servers'),

  checkLoader: (loader, mcVersion, gameDir) => ipcRenderer.invoke('check-loader', loader, mcVersion, gameDir),
  installFabric: (mcVersion, gameDir) => ipcRenderer.invoke('install-fabric', mcVersion, gameDir),
  installForge: (mcVersion, gameDir) => ipcRenderer.invoke('install-forge', mcVersion, gameDir),
  installNeoforge: (mcVersion, gameDir) => ipcRenderer.invoke('install-neoforge', mcVersion, gameDir),
  downloadMod: (modId, mcVersion, loader, gameDir) => ipcRenderer.invoke('download-mod-modrinth', modId, mcVersion, loader, gameDir),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  killGame: () => ipcRenderer.invoke('kill-game'),

  on: (channel, callback) => {
    const allowed = ['auth-update', 'launch-log', 'launch-progress', 'launch-close', 'java-status', 'java-progress', 'update-progress', 'mod-status', 'mod-progress'];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => callback(...args));
    }
  },
  off: (channel) => ipcRenderer.removeAllListeners(channel)
});
