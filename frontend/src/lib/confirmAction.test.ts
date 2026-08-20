import { describe, expect, it, vi } from 'vitest';
import { confirmAction, notifyAction } from './confirmAction';

async function waitForDialog() {
  await vi.waitFor(() => {
    expect(document.querySelector('[data-testid="confirm-dialog"]')).toBeTruthy();
  });
}

describe('confirmAction', () => {
  it('resolves true when Confirm is clicked and removes the overlay', async () => {
    const pending = confirmAction('Delete this product?', { confirmLabel: 'Delete' });
    await waitForDialog();
    const ok = document.querySelector('[data-testid="confirm-ok"]') as HTMLButtonElement;
    ok.click();
    await expect(pending).resolves.toBe(true);
    expect(document.querySelector('[data-testid="confirm-dialog"]')).toBeNull();
    expect(document.body.style.pointerEvents).toBe('');
  });

  it('resolves false when Cancel is clicked', async () => {
    const pending = confirmAction('Cancel this sale?');
    await waitForDialog();
    const cancel = document.querySelector('[data-testid="confirm-cancel"]') as HTMLButtonElement;
    cancel.click();
    await expect(pending).resolves.toBe(false);
    expect(document.querySelector('[data-testid="confirm-dialog"]')).toBeNull();
  });
});

describe('notifyAction', () => {
  it('closes on OK without a cancel button', async () => {
    const pending = notifyAction('Saved.');
    await waitForDialog();
    expect(document.querySelector('[data-testid="confirm-cancel"]')).toBeNull();
    const ok = document.querySelector('[data-testid="confirm-ok"]') as HTMLButtonElement;
    ok.click();
    await pending;
    expect(document.querySelector('[data-testid="confirm-dialog"]')).toBeNull();
  });
});
