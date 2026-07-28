import { app, BrowserWindow, ipcMain } from 'electron';
import Module from 'module';
import path from 'path';

const isDev = process.env.NODE_ENV === 'development';
const BACKEND_PORT = process.env.PORT ?? '3847';

let mainWindow: BrowserWindow | null = null;

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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'Usman Mall',
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

ipcMain.handle('restart-app', () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('get-user-data-path', () => app.getPath('userData'));

app.whenReady().then(async () => {
  await startBackend();

  if (!isDev) {
    await waitForBackend();
  }

  createWindow();

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
