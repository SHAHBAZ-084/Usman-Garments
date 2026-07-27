import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('usmanGarments', {
  platform: process.platform,
});
