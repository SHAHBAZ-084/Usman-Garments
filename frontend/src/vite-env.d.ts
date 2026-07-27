/// <reference types="vite/client" />

export {};

declare global {
  interface Window {
    usmanGarments?: {
      platform: NodeJS.Platform;
    };
  }
}
