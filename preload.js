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

  on: (channel, callback) => {
    const allowed = ['auth-update', 'launch-log', 'launch-progress', 'launch-close', 'java-status', 'java-progress', 'update-progress'];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => callback(...args));
    }
  },
  off: (channel) => ipcRenderer.removeAllListeners(channel)
});
