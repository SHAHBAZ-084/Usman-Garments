import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useGlobalBarcodeScanner } from '../../hooks/useGlobalBarcodeScanner';

export function AppShell() {
  useGlobalBarcodeScanner();

  return (
    <div className="flex min-h-screen bg-surface3">
      <Sidebar />
      <main className="app-main relative z-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-surface3">
        <Outlet />
      </main>
    </div>
  );
}
