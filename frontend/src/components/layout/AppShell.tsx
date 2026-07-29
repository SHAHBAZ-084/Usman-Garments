import { Outlet } from 'react-router-dom';
import { UpdateBanner } from '../UpdateBanner';
import { Sidebar } from './Sidebar';

export function AppShell() {
  return (
    <div className="flex min-h-screen bg-surface3">
      <Sidebar />
      <main className="app-main relative z-0 min-w-0 flex-1 overflow-auto bg-surface3">
        <div className="pointer-events-none sticky top-0 z-20 flex justify-end p-3">
          <div className="pointer-events-auto">
            <UpdateBanner />
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
