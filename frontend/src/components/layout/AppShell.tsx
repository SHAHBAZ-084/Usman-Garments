import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useGlobalBarcodeScanner } from '../../hooks/useGlobalBarcodeScanner';
import { restorePageInteraction } from '../../lib/restorePageInteraction';

export function AppShell() {
  useGlobalBarcodeScanner();
  const location = useLocation();

  useEffect(() => {
    restorePageInteraction();
    const onFocus = () => restorePageInteraction();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen bg-surface3">
      <Sidebar />
      <main className="app-main relative z-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-surface3">
        <Outlet />
      </main>
    </div>
  );
}
