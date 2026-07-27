import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, type User } from '../lib/api';
import { useTheme } from './ThemeContext';

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { refreshThemeFromServer } = useTheme();

  useEffect(() => {
    api
      .me()
      .then(async ({ user: currentUser }) => {
        setUser(currentUser);
        await refreshThemeFromServer();
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [refreshThemeFromServer]);

  const login = useCallback(
    async (username: string, password: string) => {
      const { user: loggedInUser } = await api.login(username, password);
      setUser(loggedInUser);
      await refreshThemeFromServer();
    },
    [refreshThemeFromServer],
  );

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout }),
    [user, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}
