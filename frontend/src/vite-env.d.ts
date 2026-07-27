/// <reference types="vite/client" />

export {};

declare global {
  interface Window {
    usmanGarments?: {
      platform: NodeJS.Platform;
      restartApp?: () => Promise<void>;
      getUserDataPath?: () => Promise<string>;
    };
  }
}
