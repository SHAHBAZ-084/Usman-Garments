export type NavLink = {
  label: string;
  to: string;
  description?: string;
};

export type NavItem =
  | ({ kind: 'link' } & NavLink)
  | { kind: 'submenu'; label: string; children: NavLink[] };

export type NavGroup = {
  label: string;
  children?: NavItem[];
  to?: string;
};

/** Flat sidebar: each group opens its hub page (no accordion mesh). */
export const TOP_NAV: NavGroup[] = [
  { label: 'Sales', to: '/sales' },
  { label: 'Customers', to: '/customers' },
  { label: 'Products', to: '/products' },
  { label: 'Suppliers', to: '/suppliers' },
  { label: 'Finance', to: '/finance' },
  { label: 'Accounts', to: '/accounts' },
  { label: 'Reports', to: '/reports' },
  { label: 'System', to: '/system' },
  { label: 'User', to: '/user' },
];
