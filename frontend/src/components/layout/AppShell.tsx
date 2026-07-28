import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function AppShell() {
  return (
    <div className="flex min-h-screen bg-surface3">
      <Sidebar />
      <main className="relative z-0 min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
