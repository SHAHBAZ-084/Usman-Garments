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

export const TOP_NAV: NavGroup[] = [
  {
    label: 'Products',
    children: [
      { kind: 'link', label: 'Product List', to: '/products' },
      { kind: 'link', label: 'Add Product', to: '/products/add' },
    ],
  },
  {
    label: 'Suppliers',
    children: [
      { kind: 'link', label: 'Supplier List', to: '/suppliers' },
      { kind: 'link', label: 'Add Supplier', to: '/suppliers/add' },
      { kind: 'link', label: 'New Purchase', to: '/purchases/new' },
      { kind: 'link', label: 'Purchases', to: '/purchases' },
      { kind: 'link', label: 'Pay Supplier', to: '/purchases/pay' },
    ],
  },
  {
    label: 'Accounts',
    children: [
      {
        kind: 'submenu',
        label: 'Category',
        children: [
          { label: 'Add Category', to: '/accounts/categories/add' },
          { label: 'Edit Category', to: '/accounts/categories/edit' },
          { label: 'Remove Category', to: '/accounts/categories/remove' },
        ],
      },
      {
        kind: 'submenu',
        label: 'Account',
        children: [
          { label: 'Add Account', to: '/accounts/manage/add' },
          { label: 'Edit Account', to: '/accounts/manage/edit' },
          { label: 'Remove Account', to: '/accounts/manage/remove' },
        ],
      },
    ],
  },
  {
    label: 'Voucher',
    children: [
      { kind: 'link', label: 'Payment Voucher', to: '/vouchers/payment' },
      { kind: 'link', label: 'Journal Voucher', to: '/vouchers/journal' },
      { kind: 'link', label: 'Receipt Voucher', to: '/vouchers/receipt' },
      { kind: 'link', label: 'View Voucher', to: '/vouchers/view' },
    ],
  },
  {
    label: 'Reports',
    children: [
      {
        kind: 'submenu',
        label: 'Account Reports',
        children: [
          { label: 'Account Ledger', to: '/reports/accounts' },
          { label: 'Account Balance', to: '/reports/account-balance' },
          { label: 'Vouchers', to: '/reports/vouchers' },
        ],
      },
      { kind: 'link', label: 'Detail Trial Balance', to: '/reports/trial-balance' },
    ],
  },
  {
    label: 'System',
    children: [{ kind: 'link', label: 'Settings', to: '/system/settings' }],
  },
  {
    label: 'User',
    to: '/user',
  },
];
