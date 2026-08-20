/** Shared print bridge types (mirrored from electron/preload — keep in sync). */

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

/** Microns: 1 mm = 1000 microns. Electron pageSize uses microns. */
export const LABEL_58X40_MICRONS = { width: 58000, height: 40000 } as const;
export const RECEIPT_78MM_WIDTH_MICRONS = 78000;
/** Tall fallback height for roll paper; CSS @page auto + preferCSSPageSize drives real length. */
export const RECEIPT_78MM_FALLBACK_HEIGHT_MICRONS = 300000;

function clientLog(message: string, meta?: Record<string, unknown>) {
  if (meta) console.info(`[print-client] ${message}`, meta);
  else console.info(`[print-client] ${message}`);
}

export function isElectronPrintAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.usmanGarments?.printHtml === 'function';
}

export async function resolveLogoDataUrl(logoUrl: string | null | undefined): Promise<string | null> {
  if (!logoUrl?.trim()) return null;
  const raw = logoUrl.trim();
  if (raw.startsWith('data:')) return raw;

  const candidates: string[] = [];
  if (raw.startsWith('blob:') || /^https?:\/\//i.test(raw)) {
    candidates.push(raw);
  } else {
    const rel = raw.startsWith('/') ? raw : `/${raw}`;
    if (typeof window !== 'undefined' && window.location?.origin && !window.location.origin.startsWith('file:')) {
      candidates.push(new URL(rel, window.location.origin).href);
    }
    candidates.push(`http://127.0.0.1:3847${rel}`);
    candidates.push(`http://localhost:3847${rel}`);
  }

  // Deduplicate candidates while keeping order
  const uniqueCandidates = Array.from(new Set(candidates));

  for (const candidate of uniqueCandidates) {
    try {
      const response = await fetch(candidate);
      if (!response.ok) {
        clientLog('logo-fetch-failed', { candidate, status: response.status });
        continue;
      }
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('logo read failed'));
        reader.readAsDataURL(blob);
      });
      clientLog('logo-resolve-success', { candidate, length: dataUrl.length });
      return dataUrl;
    } catch (err) {
      clientLog('logo-fetch-error', { candidate, error: err instanceof Error ? err.message : String(err) });
    }
  }

  clientLog('logo-resolve-all-failed', { raw, candidates: uniqueCandidates });
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  const fallbackRel = raw.startsWith('/') ? raw : `/${raw}`;
  return `http://127.0.0.1:3847${fallbackRel}`;
}

/**
 * Print via Electron silent/named printer when available; otherwise open a print window
 * (dev browser / fallback). Preview always opens a window.
 */
export async function printHtmlDocument(
  html: string,
  options: {
    deviceName?: string | null;
    pageSize?: ElectronPrintPageSize;
    jobType: string;
    copies?: number;
    preview?: boolean;
    contentWidthMm?: number;
  },
): Promise<ElectronPrintResult> {
  const copies = options.copies ?? 1;
  clientLog('request', {
    jobType: options.jobType,
    printer: options.deviceName || '(default)',
    copies,
    pageSize: options.pageSize ?? null,
    contentWidthMm: options.contentWidthMm ?? null,
    preview: Boolean(options.preview),
    electron: isElectronPrintAvailable(),
  });

  if (options.preview || !isElectronPrintAvailable()) {
    const win = window.open(
      '',
      '_blank',
      options.jobType.includes('barcode') ? 'width=420,height=520' : 'width=420,height=900',
    );
    if (!win) {
      return {
        ok: false,
        failureReason: 'Popup blocked — allow popups to print',
        copies,
        jobType: options.jobType,
      };
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    if (!options.preview) {
      const trigger = () => {
        setTimeout(() => {
          try {
            win.focus();
            win.print();
          } catch {
            /* ignore */
          }
        }, 200);
      };
      if (win.document.readyState === 'complete') trigger();
      else win.onload = trigger;
    }
    return {
      ok: true,
      printer: options.deviceName ?? null,
      copies,
      pageSize: options.pageSize,
      jobType: options.jobType,
    };
  }

  try {
    const result = await window.usmanGarments!.printHtml!({
      html,
      deviceName: options.deviceName,
      silent: Boolean(options.deviceName?.trim()),
      printBackground: true,
      scaleFactor: 100,
      preferCSSPageSize: true,
      pageSize: options.pageSize,
      jobType: options.jobType,
      copies,
    });
    clientLog(result.ok ? 'result-ok' : 'result-fail', {
      jobType: options.jobType,
      printer: result.printer,
      reason: result.failureReason,
    });
    return result;
  } catch (err) {
    const failureReason = err instanceof Error ? err.message : 'Print failed';
    clientLog('result-fail', { jobType: options.jobType, reason: failureReason });
    return { ok: false, failureReason, copies, jobType: options.jobType, pageSize: options.pageSize };
  } finally {
    void window.usmanGarments?.restoreWindowInput?.();
  }
}

export async function listPrinters() {
  if (!isElectronPrintAvailable() || !window.usmanGarments?.listPrinters) return [];
  try {
    return await window.usmanGarments.listPrinters();
  } catch {
    return [];
  }
}
