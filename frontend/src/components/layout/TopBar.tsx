import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import { TOP_NAV, NavItem } from '../../config/navigation';
import { NAV_GROUP_ICONS, navLinkIcon } from '../../config/navIcons';
import { api } from '../../lib/api';
import { voucherTypeColorClass } from '../../lib/format';
import { UpdateBanner } from '../UpdateBanner';

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

function NavSubmenu({ label, children }: { label: string; children: { label: string; to: string; description?: string }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="app-dropdown-item flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center">
          <NavIcon label={label} />
          {label}
        </span>
        <span className="ml-2 text-textMuted">›</span>
      </button>
      {open ? (
        <div className="app-dropdown left-full top-0">
          {children.map((item) => (
            <Link key={item.to} to={item.to} className="app-dropdown-item flex items-center">
              <NavIcon label={item.label} />
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NavDropdown({ label, children }: { label: string; children: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const GroupIcon = NAV_GROUP_ICONS[label];

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`app-topnav-link gap-1.5 ${open ? 'is-open' : ''}`}
      >
        {GroupIcon ? <GroupIcon className="h-4 w-4 shrink-0" aria-hidden /> : null}
        {label}
      </button>
      {open ? (
        <div className="app-dropdown left-0 top-full mt-1">
          {children.map((item) =>
            item.kind === 'submenu' ? (
              <NavSubmenu key={item.label} label={item.label} children={item.children} />
            ) : (
              <Link
                key={item.to}
                to={item.to}
                className={`app-dropdown-item flex items-center ${voucherNavLabelClass(item.label)}`}
              >
                <NavIcon label={item.label} />
                {item.label}
              </Link>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

export function TopBar() {
  const location = useLocation();
  const [businessName, setBusinessName] = useState('Usman Mall');

  useEffect(() => {
    let cancelled = false;
    function loadName() {
      api
        .getSettings()
        .then((settings) => {
          if (!cancelled && settings.businessName?.trim()) {
            setBusinessName(settings.businessName.trim());
          }
        })
        .catch(() => {
          /* keep fallback */
        });
    }
    loadName();
    window.addEventListener('usman-mall-settings-updated', loadName);
    return () => {
      cancelled = true;
      window.removeEventListener('usman-mall-settings-updated', loadName);
    };
  }, []);

  return (
    <header className="app-topnav sticky top-0 isolate shadow-md">
      <div className="flex min-h-12 items-center gap-1 px-4">
        <Link to="/" className="app-topnav-brand mr-2 flex shrink-0 items-center gap-2 pr-2 text-sm">
          <LayoutDashboard className="h-4 w-4 text-accent" aria-hidden />
          {businessName}
        </Link>
        <nav className="flex flex-1 flex-wrap items-center gap-1">
          {TOP_NAV.map((group) =>
            group.children ? (
              <NavDropdown key={group.label} label={group.label} children={group.children} />
            ) : (
              <Link
                key={group.label}
                to={group.to!}
                className={`app-topnav-link gap-1.5 ${location.pathname === group.to ? 'is-active' : ''}`}
              >
                {NAV_GROUP_ICONS[group.label] ? (
                  (() => {
                    const Icon = NAV_GROUP_ICONS[group.label];
                    return <Icon className="h-4 w-4 shrink-0" aria-hidden />;
                  })()
                ) : null}
                {group.label}
              </Link>
            ),
          )}
        </nav>
        <div className="ml-auto shrink-0 pl-2">
          <UpdateBanner />
        </div>
      </div>
    </header>
  );
}
