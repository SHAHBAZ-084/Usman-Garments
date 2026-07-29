import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('usmanGarments', {
  platform: process.platform,
  restartApp: () => ipcRenderer.invoke('restart-app'),
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path') as Promise<string>,
  onUpdateAvailable: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('update-available', listener);
    return () => ipcRenderer.removeListener('update-available', listener);
  },
  onUpdateReady: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('update-ready', listener);
    return () => ipcRenderer.removeListener('update-ready', listener);
  },
  installUpdate: () => ipcRenderer.invoke('install-update') as Promise<void>,
});

declare global {
  interface Window {
    usmanGarments?: {
      platform: string;
      restartApp: () => Promise<void>;
      getUserDataPath: () => Promise<string>;
      onUpdateAvailable: (callback: () => void) => () => void;
      onUpdateReady: (callback: () => void) => () => void;
      installUpdate: () => Promise<void>;
    };
  }
}
