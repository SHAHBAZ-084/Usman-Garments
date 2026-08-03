import { contextBridge, ipcRenderer } from 'electron';

export type ElectronPrintPageSize =
  | string
  | {
      width: number;
      height: number;
    };

export type ElectronPrintRequest = {
  html: string;
  deviceName?: string | null;
  silent?: boolean;
  printBackground?: boolean;
  scaleFactor?: number;
  preferCSSPageSize?: boolean;
  pageSize?: ElectronPrintPageSize;
  jobType?: string;
  copies?: number;
};

export type ElectronPrintResult = {
  ok: boolean;
  failureReason?: string;
  printer?: string | null;
  copies?: number;
  pageSize?: ElectronPrintPageSize;
  jobType?: string;
};

export type ElectronPrinterInfo = {
  name: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  status: number;
};

contextBridge.exposeInMainWorld('usmanGarments', {
  platform: process.platform,
  restartApp: () => ipcRenderer.invoke('restart-app'),
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path') as Promise<string>,
  printHtml: (request: ElectronPrintRequest) =>
    ipcRenderer.invoke('print-html', request) as Promise<ElectronPrintResult>,
  listPrinters: () => ipcRenderer.invoke('list-printers') as Promise<ElectronPrinterInfo[]>,
});

declare global {
  interface Window {
    usmanGarments?: {
      platform: string;
      restartApp: () => Promise<void>;
      getUserDataPath: () => Promise<string>;
      printHtml: (request: ElectronPrintRequest) => Promise<ElectronPrintResult>;
      listPrinters: () => Promise<ElectronPrinterInfo[]>;
    };
  }
}
