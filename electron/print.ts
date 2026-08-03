import { BrowserWindow, ipcMain } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

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

function printLog(message: string, meta?: Record<string, unknown>) {
  const payload = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[print] ${message}${payload}`);
}

function writeTempHtml(html: string): string {
  const file = path.join(
    os.tmpdir(),
    `usman-mall-print-${Date.now()}-${Math.random().toString(36).slice(2)}.html`,
  );
  fs.writeFileSync(file, html, 'utf8');
  return file;
}

function cleanupTemp(file: string | null) {
  if (!file) return;
  try {
    fs.unlinkSync(file);
  } catch {
    /* ignore */
  }
}

/**
 * Print HTML in a hidden BrowserWindow via Chromium's print pipeline.
 * Separate from app UI CSS — callers must embed a self-contained print document.
 */
export function printHtmlInHiddenWindow(request: ElectronPrintRequest): Promise<ElectronPrintResult> {
  const {
    html,
    deviceName,
    silent = Boolean(deviceName),
    printBackground = true,
    scaleFactor = 100,
    preferCSSPageSize = true,
    pageSize,
    jobType = 'print',
    copies = 1,
  } = request;

  const printer = deviceName?.trim() || null;
  printLog('job-start', {
    jobType,
    printer: printer || '(default/dialog)',
    copies,
    pageSize: pageSize ?? null,
    silent,
    scaleFactor,
  });

  return new Promise((resolve) => {
    let tempFile: string | null = null;
    let settled = false;

    const win = new BrowserWindow({
      show: false,
      width: 420,
      height: 640,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const finish = (result: ElectronPrintResult) => {
      if (settled) return;
      settled = true;
      cleanupTemp(tempFile);
      try {
        if (!win.isDestroyed()) win.close();
      } catch {
        /* ignore */
      }
      if (result.ok) {
        printLog('job-ok', {
          jobType,
          printer: result.printer,
          copies: result.copies,
          pageSize: result.pageSize,
        });
      } else {
        printLog('job-fail', {
          jobType,
          printer: result.printer,
          reason: result.failureReason,
          pageSize: result.pageSize,
        });
      }
      resolve(result);
    };

    const runPrint = () => {
      if (win.isDestroyed()) {
        finish({
          ok: false,
          failureReason: 'Print window closed unexpectedly',
          printer,
          copies,
          pageSize,
          jobType,
        });
        return;
      }

      const options = {
        silent: Boolean(silent && printer),
        printBackground,
        deviceName: printer || undefined,
        margins: { marginType: 'none' as const },
        scaleFactor,
        preferCSSPageSize,
        pagesPerSheet: 1,
        copies: 1,
      } as Electron.WebContentsPrintOptions;
      if (pageSize) {
        options.pageSize = pageSize as Electron.WebContentsPrintOptions['pageSize'];
      }

      win.webContents.print(options, (success, failureReason) => {
        if (success) {
          finish({ ok: true, printer, copies, pageSize, jobType });
        } else {
          finish({
            ok: false,
            failureReason: failureReason || 'Print cancelled or failed',
            printer,
            copies,
            pageSize,
            jobType,
          });
        }
      });
    };

    win.webContents.on('did-fail-load', (_e, code, desc) => {
      finish({
        ok: false,
        failureReason: `Failed to load print document (${code}): ${desc}`,
        printer,
        copies,
        pageSize,
        jobType,
      });
    });

    win.webContents.on('did-finish-load', () => {
      void win.webContents
        .executeJavaScript(
          `new Promise((resolve) => {
            const waitImages = () => {
              const imgs = Array.from(document.images || []);
              if (!imgs.length) { resolve(true); return; }
              Promise.all(imgs.map((img) => {
                if (img.complete) return Promise.resolve();
                return new Promise((r) => {
                  img.onload = () => r(null);
                  img.onerror = () => r(null);
                });
              })).then(() => resolve(true));
            };
            if (document.fonts && document.fonts.ready) {
              document.fonts.ready.then(waitImages).catch(waitImages);
            } else {
              waitImages();
            }
          })`,
        )
        .then(() => setTimeout(runPrint, 150))
        .catch((err: unknown) => {
          finish({
            ok: false,
            failureReason: err instanceof Error ? err.message : 'Print prepare failed',
            printer,
            copies,
            pageSize,
            jobType,
          });
        });
    });

    try {
      tempFile = writeTempHtml(html);
      void win.loadFile(tempFile);
    } catch (err) {
      finish({
        ok: false,
        failureReason: err instanceof Error ? err.message : 'Could not write print file',
        printer,
        copies,
        pageSize,
        jobType,
      });
    }
  });
}

export async function listSystemPrinters(): Promise<
  Array<{ name: string; displayName: string; description: string; isDefault: boolean; status: number }>
> {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!win) return [];
  const printers = await win.webContents.getPrintersAsync();
  return printers.map((p) => ({
    name: p.name,
    displayName: p.displayName,
    description: p.description,
    isDefault: p.isDefault,
    status: p.status,
  }));
}

export function registerPrintIpc() {
  ipcMain.handle('print-html', async (_event, request: ElectronPrintRequest) => {
    return printHtmlInHiddenWindow(request);
  });

  ipcMain.handle('list-printers', async () => {
    try {
      return await listSystemPrinters();
    } catch (err) {
      printLog('list-printers-fail', { error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  });
}
