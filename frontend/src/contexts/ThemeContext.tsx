import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'usman-mall-theme';
const LEGACY_STORAGE_KEY = 'usman-garments-theme';

type ThemeContextValue = {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  refreshThemeFromServer: () => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* ignore */
  }
  return 'light';
}

function writeStoredTheme(theme: ThemeMode) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(readStoredTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    writeStoredTheme(theme);
  }, [theme]);

  const persistTheme = useCallback(async (next: ThemeMode) => {
    setThemeState(next);
    writeStoredTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      await api.updateSettings({ themeMode: next });
    } catch {
      /* not logged in or offline — localStorage remains source until next sync */
    }
  }, []);

  const refreshThemeFromServer = useCallback(async () => {
    try {
      const settings = await api.getSettings();
      if (settings.themeMode === 'light' || settings.themeMode === 'dark') {
        setThemeState(settings.themeMode);
      }
    } catch {
      /* ignore when unauthenticated */
    }
  }, []);

  const setTheme = (next: ThemeMode) => {
    void persistTheme(next);
  };
  const toggleTheme = () => {
    void persistTheme(theme === 'light' ? 'dark' : 'light');
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, refreshThemeFromServer }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
