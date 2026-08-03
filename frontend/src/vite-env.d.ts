/// <reference types="vite/client" />

export {};

declare global {
  interface Window {
    usmanGarments?: {
      platform: NodeJS.Platform;
      restartApp?: () => Promise<void>;
      getUserDataPath?: () => Promise<string>;
      onUpdateAvailable?: (callback: () => void) => () => void;
      onUpdateReady?: (callback: () => void) => () => void;
      installUpdate?: () => Promise<void>;
      printHtml?: (request: {
        html: string;
        deviceName?: string | null;
        silent?: boolean;
        printBackground?: boolean;
        scaleFactor?: number;
        preferCSSPageSize?: boolean;
        pageSize?: string | { width: number; height: number };
        jobType?: string;
        copies?: number;
      }) => Promise<{
        ok: boolean;
        failureReason?: string;
        printer?: string | null;
        copies?: number;
        pageSize?: string | { width: number; height: number };
        jobType?: string;
      }>;
      listPrinters?: () => Promise<
        Array<{
          name: string;
          displayName: string;
          description: string;
          isDefault: boolean;
          status: number;
        }>
      >;
    };
  }
}
