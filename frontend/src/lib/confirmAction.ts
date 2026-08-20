import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { restorePageInteraction } from './restorePageInteraction';

export type ConfirmActionOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

function mountDialog(props: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger: boolean;
  hideCancel: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let settled = false;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      root.unmount();
      host.remove();
      restorePageInteraction();
      resolve(ok);
    };

    root.render(
      createElement(ConfirmDialog, {
        title: props.title,
        message: props.message,
        confirmLabel: props.confirmLabel,
        cancelLabel: props.cancelLabel,
        danger: props.danger,
        hideCancel: props.hideCancel,
        onConfirm: () => finish(true),
        onCancel: () => finish(false),
      }),
    );
  });
}

/** In-app confirm. Never use window.confirm in Electron — it freezes clicks and typing. */
export function confirmAction(message: string, options: ConfirmActionOptions = {}): Promise<boolean> {
  return mountDialog({
    title: options.title ?? 'Please confirm',
    message,
    confirmLabel: options.confirmLabel ?? 'Confirm',
    cancelLabel: options.cancelLabel ?? 'Cancel',
    danger: options.danger ?? true,
    hideCancel: false,
  });
}

export function notifyAction(message: string, title = 'Notice'): Promise<void> {
  return mountDialog({
    title,
    message,
    confirmLabel: 'OK',
    danger: false,
    hideCancel: true,
  }).then(() => undefined);
}
