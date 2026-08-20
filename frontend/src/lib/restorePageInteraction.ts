/** Electron native confirm/alert can leave the page unable to receive clicks or typing. */
export function restorePageInteraction() {
  document.body.style.pointerEvents = '';
  document.documentElement.style.pointerEvents = '';
  if (!document.querySelector('[data-page-modal="open"]')) {
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  }
  try {
    window.focus();
  } catch {
    /* jsdom / some Electron shells throw */
  }
  void window.usmanGarments?.restoreWindowInput?.();
}
