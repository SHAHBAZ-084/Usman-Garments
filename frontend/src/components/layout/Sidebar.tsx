import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut } from 'lucide-react';
import { TOP_NAV, type NavItem } from '../../config/navigation';
import { NAV_GROUP_ICONS, navLinkIcon } from '../../config/navIcons';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import { voucherTypeColorClass } from '../../lib/format';

function voucherNavLabelClass(label: string) {
  if (label.startsWith('Payment')) return voucherTypeColorClass('PAYMENT');
  if (label.startsWith('Receipt')) return voucherTypeColorClass('RECEIPT');
  if (label.startsWith('Journal')) return voucherTypeColorClass('JOURNAL');
  return '';
}

function NavIcon({ label }: { label: string }) {
  const Icon = navLinkIcon(label);
  if (!Icon) return null;
  return <Icon className="mr-2 h-4 w-4 shrink-0 opacity-80" aria-hidden />;
}

function SidebarLink({
  to,
  label,
  active,
  className = '',
}: {
  to: string;
  label: string;
  active: boolean;
  className?: string;
}) {
  return (
    <Link to={to} className={`app-sidebar-link ${active ? 'is-active' : ''} ${className}`}>
      <NavIcon label={label} />
      {label}
    </Link>
  );
}

function SidebarGroup({
  label,
  children,
  pathname,
}: {
  label: string;
  children: NavItem[];
  pathname: string;
}) {
  const childPaths = children.flatMap((item) =>
    item.kind === 'submenu' ? item.children.map((c) => c.to) : [item.to],
  );
  const isActive = childPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const [open, setOpen] = useState(isActive);
  const GroupIcon = NAV_GROUP_ICONS[label];

  useEffect(() => {
    if (isActive) setOpen(true);
  }, [isActive]);

  return (
    <div className="app-sidebar-group">
      <button
        type="button"
        className={`app-sidebar-group-toggle ${isActive ? 'is-active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {GroupIcon ? <GroupIcon className="h-4 w-4 shrink-0" aria-hidden /> : null}
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open ? (
        <div className="app-sidebar-subnav">
          {children.map((item) =>
            item.kind === 'submenu' ? (
              <div key={item.label} className="app-sidebar-submenu">
                <p className="app-sidebar-submenu-label">{item.label}</p>
                {item.children.map((child) => (
                  <SidebarLink
                    key={child.to}
                    to={child.to}
                    label={child.label}
                    active={pathname === child.to || pathname.startsWith(`${child.to}/`)}
                  />
                ))}
              </div>
            ) : (
              <SidebarLink
                key={item.to}
                to={item.to}
                label={item.label}
                active={pathname === item.to || pathname.startsWith(`${item.to}/`)}
                className={voucherNavLabelClass(item.label)}
              />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
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
          group.children ? (
            <SidebarGroup
              key={group.label}
              label={group.label}
              children={group.children}
              pathname={location.pathname}
            />
          ) : group.to ? (
            <SidebarLink
              key={group.label}
              to={group.to}
              label={group.label}
              active={location.pathname === group.to}
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
