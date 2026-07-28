import { useEffect, useRef } from 'react';

export type FormShortcutsOptions = {
  onSave?: () => void;
  onPrint?: () => void;
  onClear?: () => void;
  onCancel?: () => void;
  onHold?: () => void;
  saveEnabled?: boolean;
  printEnabled?: boolean;
  clearEnabled?: boolean;
  cancelEnabled?: boolean;
  holdEnabled?: boolean;
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return type !== 'button' && type !== 'submit' && type !== 'checkbox' && type !== 'radio';
}

/** App-wide POS shortcuts: F9 save, F10 print, F5 clear, F6 hold, Esc cancel. */
export function useFormShortcuts(options: FormShortcutsOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const opts = optionsRef.current;

      if (event.key === 'Escape' && opts.onCancel && opts.cancelEnabled !== false) {
        event.preventDefault();
        opts.onCancel();
        return;
      }

      if (isEditableTarget(event.target) && !event.key.startsWith('F')) return;

      switch (event.key) {
        case 'F9':
          if (opts.onSave && opts.saveEnabled !== false) {
            event.preventDefault();
            opts.onSave();
          }
          break;
        case 'F10':
          if (opts.onPrint && opts.printEnabled !== false) {
            event.preventDefault();
            opts.onPrint();
          }
          break;
        case 'F5':
          if (opts.onClear && opts.clearEnabled !== false) {
            event.preventDefault();
            opts.onClear();
          }
          break;
        case 'F6':
          if (opts.onHold && opts.holdEnabled !== false) {
            event.preventDefault();
            opts.onHold();
          }
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
