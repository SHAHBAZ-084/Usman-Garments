import { useEffect, useState } from 'react';

type UpdateState = 'idle' | 'available' | 'ready';

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
  const label = ready ? 'Restart to Update' : 'Update Available';

  return (
    <button
      type="button"
      disabled={!ready}
      onClick={() => {
        if (!ready) return;
        void window.usmanGarments?.installUpdate?.();
      }}
      className={`rounded-md px-3 py-1.5 text-xs font-semibold shadow-sm transition ${
        ready
          ? 'bg-accent text-onAccent hover:opacity-90'
          : 'cursor-default bg-surface2 text-textSecondary ring-1 ring-border'
      }`}
      title={ready ? 'Install the downloaded update and restart' : 'Downloading update…'}
    >
      {label}
    </button>
  );
}
