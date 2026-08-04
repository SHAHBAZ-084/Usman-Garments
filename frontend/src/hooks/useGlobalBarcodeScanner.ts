import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, type BusinessSettings } from '../lib/api';

/**
 * Global Barcode Scanner Listener Hook
 * Listens for hardware USB barcode scanner keystrokes when no input element is focused.
 * Automatically routes based on barcode format:
 *   - Product barcode (numeric, e.g. starts with 890 / 12 digits) -> /sales/new
 *   - Invoice barcode (alphanumeric, matches invoicePrefix e.g. UM-000001) -> /sales/return
 */
export function useGlobalBarcodeScanner() {
  const navigate = useNavigate();
  const location = useLocation();
  const [settings, setSettings] = useState<BusinessSettings | null>(null);

  const bufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);

  useEffect(() => {
    let active = true;
    api
      .getSettings()
      .then((s) => {
        if (active) setSettings(s);
      })
      .catch(() => {
        if (active) setSettings(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    // Listen for settings update events (e.g. after changing settings in SettingsPage)
    const handleSettingsUpdated = () => {
      api.getSettings().then(setSettings).catch(() => {});
    };
    window.addEventListener('usman-mall-settings-updated', handleSettingsUpdated);
    return () => {
      window.removeEventListener('usman-mall-settings-updated', handleSettingsUpdated);
    };
  }, []);

  useEffect(() => {
    const currentPath = location.pathname.toLowerCase();
    // Do not activate on login or pages with dedicated scanner inputs
    if (
      currentPath === '/login' ||
      currentPath.startsWith('/sales/new') ||
      currentPath.startsWith('/sales/return')
    ) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. Do not capture when user is typing inside an editable field
      const activeEl = document.activeElement;
      const tag = activeEl?.tagName.toLowerCase();
      const isEditable =
        Boolean((activeEl as HTMLElement)?.isContentEditable) ||
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select';

      if (isEditable) {
        bufferRef.current = '';
        return;
      }

      const now = Date.now();
      const timeSinceLastKey = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      // Hardware scanners type very fast (< 50ms per keypress).
      // Reset buffer if delay between keystrokes exceeds 70ms (human keypress).
      if (timeSinceLastKey > 70) {
        bufferRef.current = '';
      }

      if (e.key === 'Enter') {
        const raw = bufferRef.current
          .replace(/[\u0000-\u001F\u007F]/g, '')
          .replace(/\s+/g, '')
          .trim();
        bufferRef.current = '';

        if (raw.length >= 4) {
          processGlobalScan(raw);
        }
        return;
      }

      // Append single printable characters
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        bufferRef.current += e.key;
      }
    };

    const processGlobalScan = (scannedCode: string) => {
      const configuredPrefix = (settings?.invoicePrefix?.trim() || 'UM')
        .replace(/[-_]/g, '')
        .toUpperCase();

      const upperCode = scannedCode.toUpperCase();
      const cleanCode = upperCode.replace(/[-_]/g, '');

      // Check 1: Invoice Barcode Match
      // Matches configured prefix (e.g. UM-000001 -> UM000001) OR general prefix pattern (e.g. PREFIX-123456)
      const matchesConfiguredPrefix =
        configuredPrefix.length > 0 &&
        cleanCode.startsWith(configuredPrefix) &&
        /\d{3,}$/.test(cleanCode);

      const matchesGeneralInvoicePattern = /^[A-Z]{1,10}-?\d{4,}$/i.test(scannedCode);

      if (matchesConfiguredPrefix || matchesGeneralInvoicePattern) {
        navigate('/sales/return', { state: { invoiceNumber: scannedCode } });
        return;
      }

      // Check 2: Product Barcode Match
      // Numeric-only, starts with 890 or 12 digits or numeric string
      const isNumeric = /^\d+$/.test(scannedCode);
      const isProductBarcode = isNumeric && (scannedCode.startsWith('890') || scannedCode.length >= 6);

      if (isProductBarcode) {
        navigate('/sales/new', { state: { scanBarcode: scannedCode } });
        return;
      }

      // Unrecognized format -> do nothing (ignore garbage input)
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [location.pathname, navigate, settings]);
}
