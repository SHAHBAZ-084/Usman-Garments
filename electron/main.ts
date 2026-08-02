import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import fs from 'fs';
import Module from 'module';
import path from 'path';

const isDev = process.env.NODE_ENV === 'development';
const BACKEND_PORT = process.env.PORT ?? '3847';

let mainWindow: BrowserWindow | null = null;

function logError(message: string, meta?: Record<string, unknown>) {
  console.error(message, meta ?? '');
}

/** Ensure backend can resolve hoisted production deps from app root node_modules. */
function configureBackendModulePaths(): void {
  const appRoot = path.join(__dirname, '..');
  const nodeModules = path.join(appRoot, 'node_modules');
  process.env.NODE_PATH = [nodeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  (Module as typeof Module & { Module: { _initPaths(): void } }).Module._initPaths();
}

async function startBackend(): Promise<void> {
  if (isDev) {
    return;
  }

  process.env.PORT = BACKEND_PORT;
  process.env.NODE_ENV = 'production';
  process.env.USMAN_USER_DATA = app.getPath('userData');

  configureBackendModulePaths();

  const backendEntry = path.join(__dirname, '../backend/dist/index.js');
  await import(backendEntry);
}

async function backendIsHealthy(): Promise<boolean> {
  const url = `http://127.0.0.1:${BACKEND_PORT}/api/health`;
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

function getAppIconPath(): string {
  const candidates = [
    // Packaged: copied via extraResources (real filesystem path for Windows shell)
    path.join(process.resourcesPath, 'icon.ico'),
    // Packaged / asar-relative fallback
    path.join(__dirname, '../build/icon.ico'),
    // Dev: project build folder
    path.join(__dirname, '../../build/icon.ico'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[1];
}

function createWindow(): void {
  const iconPath = getAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'Usman Mall',
    icon: iconPath,
    show: false,
    backgroundColor: '#F7F7F7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('Window failed to load:', errorCode, errorDescription);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer crashed:', details.reason);
  });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173');
    mainWindow.once('ready-to-show', () => {
      mainWindow?.show();
      mainWindow?.focus();
    });
    if (process.env.ELECTRON_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    mainWindow.loadURL(`http://127.0.0.1:${BACKEND_PORT}`);
    mainWindow.once('ready-to-show', () => {
      mainWindow?.show();
      mainWindow?.focus();
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupAutoUpdater(): void {
  if (isDev) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', () => {
    mainWindow?.webContents.send('update-available');
  });

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update-ready');
  });

  autoUpdater.on('error', (err: Error) => {
    logError('Auto-update failed', { error: err.message });
  });

  void autoUpdater.checkForUpdates().catch((err: unknown) => {
    logError('Auto-update check failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

ipcMain.handle('restart-app', () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('get-user-data-path', () => app.getPath('userData'));

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall();
});

app.whenReady().then(async () => {
  if (!isDev) {
    // Prevent EADDRINUSE crashes when multiple instances are launched:
    // if another instance already started the backend on the same port,
    // just reuse it instead of trying to bind again.
    const running = await backendIsHealthy();
    if (!running) {
      try {
        await startBackend();
      } catch (err) {
        logError('Backend start failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        dialog.showErrorBox(
          'Database update failed',
          'Update failed to apply database changes. If a pre-migration backup was created, your previous data is safe there. Please contact support — do not keep using the app until this is resolved.',
        );
        app.quit();
        return;
      }
    }

    try {
      await waitForBackend();
    } catch (err) {
      logError('Backend health check failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      dialog.showErrorBox(
        'Startup failed',
        'The application server did not start. Please contact support.',
      );
      app.quit();
      return;
    }
  } else {
    await startBackend();
  }

  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

async function waitForBackend(maxAttempts = 30): Promise<void> {
  const url = `http://127.0.0.1:${BACKEND_PORT}/api/health`;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server not ready yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error('Backend failed to start');
}
