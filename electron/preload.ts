import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('usmanGarments', {
  platform: process.platform,
  restartApp: () => ipcRenderer.invoke('restart-app'),
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path') as Promise<string>,
});

declare global {
  interface Window {
    usmanGarments?: {
      platform: string;
      restartApp: () => Promise<void>;
      getUserDataPath: () => Promise<string>;
    };
  }
}
