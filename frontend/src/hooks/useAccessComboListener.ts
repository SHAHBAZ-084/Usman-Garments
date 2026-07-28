import { useEffect, useRef } from 'react';

type ComboListenerOptions = {
  onMatch: () => void;
  enabled?: boolean;
};

/** Listens for a fixed modifier key combination on the current page. */
export function useAccessComboListener({ onMatch, enabled = true }: ComboListenerOptions) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const held = {
      ctrl: false,
      alt: false,
      shift: false,
      a: false,
      s: false,
    };

    function comboReady() {
      return held.ctrl && held.alt && held.shift && held.a && held.s;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.code === 'ControlLeft' || event.code === 'ControlRight') held.ctrl = true;
      if (event.code === 'AltLeft' || event.code === 'AltRight') held.alt = true;
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') held.shift = true;
      if (event.code === 'KeyA') held.a = true;
      if (event.code === 'KeyS') held.s = true;

      if (comboReady() && !firedRef.current) {
        firedRef.current = true;
        event.preventDefault();
        onMatch();
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.code === 'ControlLeft' || event.code === 'ControlRight') held.ctrl = false;
      if (event.code === 'AltLeft' || event.code === 'AltRight') held.alt = false;
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') held.shift = false;
      if (event.code === 'KeyA') held.a = false;
      if (event.code === 'KeyS') held.s = false;
      if (!comboReady()) firedRef.current = false;
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [enabled, onMatch]);
}
