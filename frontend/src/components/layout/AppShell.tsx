import { Outlet } from 'react-router-dom';
import { UpdateBanner } from '../UpdateBanner';
import { Sidebar } from './Sidebar';

export function AppShell() {
  return (
    <div className="flex min-h-screen bg-surface3">
      <Sidebar />
      <main className="app-main relative z-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-surface3">
        {/* Overlay only — does not reserve a top gap when idle */}
        <div className="pointer-events-none absolute right-3 top-3 z-20">
          <div className="pointer-events-auto">
            <UpdateBanner />
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
