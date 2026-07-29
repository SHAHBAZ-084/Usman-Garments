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
    };
  }
}
