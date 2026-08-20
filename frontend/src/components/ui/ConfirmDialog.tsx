import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SecondaryButton } from './PageShell';

export type ConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  hideCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  hideCancel = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const confirmClass = danger
    ? 'rounded-lg border border-danger/30 bg-bgDanger px-4 py-2 text-sm font-medium text-danger transition hover:opacity-90'
    : 'btn-primary';

  const modal = (
    <div
      data-page-modal="open"
      data-testid="confirm-dialog"
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !hideCancel) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="w-full max-w-md rounded-xl border border-border bg-surface2 p-5 shadow-2xl"
      >
        <h2 id="confirm-dialog-title" className="text-lg font-semibold text-textPrimary">
          {title}
        </h2>
        <p id="confirm-dialog-message" className="mt-2 whitespace-pre-wrap text-sm text-textSecondary">
          {message}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          {hideCancel ? null : (
            <SecondaryButton type="button" data-testid="confirm-cancel" onClick={onCancel}>
              {cancelLabel}
            </SecondaryButton>
          )}
          <button
            ref={confirmRef}
            type="button"
            data-testid="confirm-ok"
            className={confirmClass}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
