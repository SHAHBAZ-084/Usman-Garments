import { useEffect, useState } from 'react';

type UpdateState = 'idle' | 'available' | 'ready';

/**
 * Mounted in AppShell (top-right of main content). Hidden when idle.
 * - available: quiet “downloading” chip
 * - ready: high-visibility CTA so a shop owner notices before quitting
 */
export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>('idle');

  useEffect(() => {
    const api = window.usmanGarments;
    if (!api?.onUpdateAvailable || !api?.onUpdateReady) return;

    const offAvailable = api.onUpdateAvailable(() => setState('available'));
    const offReady = api.onUpdateReady(() => setState('ready'));
    return () => {
      offAvailable();
      offReady();
    };
  }, []);

  if (state === 'idle') return null;

  const ready = state === 'ready';

  if (!ready) {
    return (
      <div
        className="rounded-md bg-surface2 px-3 py-1.5 text-xs font-medium text-textSecondary ring-1 ring-border"
        title="Downloading update…"
        role="status"
      >
        Update downloading…
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        void window.usmanGarments?.installUpdate?.();
      }}
      className="update-ready-cta inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-onAccent shadow-lg ring-2 ring-accent/40 transition hover:brightness-110"
      title="Install the downloaded update and restart"
    >
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-onAccent" aria-hidden />
      Restart to Update
    </button>
  );
}
