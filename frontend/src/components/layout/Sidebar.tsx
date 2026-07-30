import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { TOP_NAV } from '../../config/navigation';
import { navLinkIcon } from '../../config/navIcons';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';

function NavIcon({ label }: { label: string }) {
  const Icon = navLinkIcon(label);
  if (!Icon) return null;
  return <Icon className="mr-2 h-4 w-4 shrink-0 opacity-80" aria-hidden />;
}

function SidebarLink({
  to,
  label,
  active,
}: {
  to: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link to={to} className={`app-sidebar-link ${active ? 'is-active' : ''}`}>
      <NavIcon label={label} />
      {label}
    </Link>
  );
}

function isNavActive(pathname: string, to: string) {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [businessName, setBusinessName] = useState('Usman Mall');
  const [tagline, setTagline] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    function loadSettings() {
      api
        .getSettings()
        .then((settings) => {
          if (cancelled) return;
          if (settings.businessName?.trim()) setBusinessName(settings.businessName.trim());
          setTagline(settings.tagline?.trim() ?? '');
          setLogoUrl(settings.logoUrl);
        })
        .catch(() => undefined);
    }
    loadSettings();
    window.addEventListener('usman-mall-settings-updated', loadSettings);
    return () => {
      cancelled = true;
      window.removeEventListener('usman-mall-settings-updated', loadSettings);
    };
  }, []);

  async function onSignOut() {
    await logout();
    navigate('/login');
  }

  return (
    <aside className="app-sidebar">
      <Link to="/" className="app-sidebar-brand">
        <div className="app-sidebar-logo-badge">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="app-sidebar-logo" />
          ) : (
            <span className="app-sidebar-logo-fallback" aria-hidden>
              {(businessName.trim().charAt(0) || 'U').toUpperCase()}
            </span>
          )}
        </div>
        <div className="app-sidebar-brand-text">
          <span className="app-sidebar-brand-name">{businessName}</span>
          {tagline ? <span className="app-sidebar-brand-tagline">{tagline}</span> : null}
        </div>
      </Link>

      <nav className="app-sidebar-nav">
        <SidebarLink to="/" label="Dashboard" active={location.pathname === '/'} />
        {TOP_NAV.map((group) =>
          group.to ? (
            <SidebarLink
              key={group.label}
              to={group.to}
              label={group.label}
              active={isNavActive(location.pathname, group.to)}
            />
          ) : null,
        )}
      </nav>

      <div className="app-sidebar-footer">
        {user ? (
          <Link to="/user" className="app-sidebar-user block hover:border-[rgba(201,150,24,0.35)]">
            <p className="app-sidebar-user-name truncate">{user.displayName || user.username}</p>
            <p className="app-sidebar-user-role truncate">{user.role || 'Owner'}</p>
            <p className="app-sidebar-user-username truncate">@{user.username}</p>
          </Link>
        ) : null}
        <button type="button" className="app-sidebar-signout" onClick={() => void onSignOut()}>
          <LogOut className="h-4 w-4 shrink-0" aria-hidden />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
