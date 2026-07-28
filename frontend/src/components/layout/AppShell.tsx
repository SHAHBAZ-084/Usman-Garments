import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function AppShell() {
  return (
    <div className="flex min-h-screen bg-surface3">
      <Sidebar />
      <main className="app-main relative z-0 min-w-0 flex-1 overflow-auto bg-surface3">
        <Outlet />
      </main>
    </div>
  );
}
