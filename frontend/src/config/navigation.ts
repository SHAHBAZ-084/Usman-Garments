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
    label: 'Sales',
    children: [
      { kind: 'link', label: 'New Sale', to: '/sales/new' },
      { kind: 'link', label: 'Recent Invoices', to: '/sales' },
      { kind: 'link', label: 'Return / Exchange', to: '/sales/return' },
    ],
  },
  {
    label: 'Customers',
    children: [
      { kind: 'link', label: 'Customer List', to: '/customers' },
      { kind: 'link', label: 'Add Customer', to: '/customers/add' },
      { kind: 'link', label: 'Receive Payment', to: '/customers/pay' },
    ],
  },
  {
    label: 'Products',
    children: [
      { kind: 'link', label: 'Product List', to: '/products' },
      { kind: 'link', label: 'Add Product', to: '/products/add' },
      { kind: 'link', label: 'Scan barcode', to: '/products/scan' },
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
    label: 'Finance',
    children: [
      { kind: 'link', label: 'Record Expense', to: '/finance/expenses/new' },
      { kind: 'link', label: 'Expense History', to: '/finance/expenses' },
      { kind: 'link', label: 'Record Other Income', to: '/finance/other-income/new' },
      { kind: 'link', label: 'Other Income History', to: '/finance/other-income' },
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
        label: 'Sales',
        children: [
          { label: 'Daily Sales', to: '/reports/sales/daily' },
          { label: 'Sales Range', to: '/reports/sales/range' },
          { label: 'Product Profit', to: '/reports/sales/product-profit' },
          { label: 'Category Profit', to: '/reports/sales/category-profit' },
          { label: 'Invoice Profit', to: '/reports/sales/invoice-profit' },
          { label: 'Udhaar Sales', to: '/reports/sales/udhaar' },
          { label: 'Payment Methods', to: '/reports/sales/payment-methods' },
          { label: 'Returns & Exchanges', to: '/reports/sales/returns-exchanges' },
        ],
      },
      {
        kind: 'submenu',
        label: 'Stock',
        children: [
          { label: 'Current Stock', to: '/reports/stock/current' },
          { label: 'Low Stock', to: '/reports/stock/low' },
          { label: 'Out of Stock', to: '/reports/stock/out' },
          { label: 'Damaged Stock', to: '/reports/stock/damaged' },
          { label: 'Stock Movements', to: '/reports/stock/movements' },
          { label: 'Stock Valuation', to: '/reports/stock/valuation' },
        ],
      },
      {
        kind: 'submenu',
        label: 'Purchases',
        children: [
          { label: 'Purchases', to: '/reports/purchases' },
          { label: 'Supplier Purchases', to: '/reports/suppliers/purchases' },
          { label: 'Supplier Outstanding', to: '/reports/suppliers/outstanding' },
          { label: 'Supplier Payments', to: '/reports/suppliers/payments' },
          { label: 'Purchase Returns', to: '/reports/purchases/returns' },
        ],
      },
      {
        kind: 'submenu',
        label: 'Customers',
        children: [
          { label: 'Customer Balances', to: '/reports/customers/balances' },
          { label: 'Customer Payments', to: '/reports/customers/payments' },
          { label: 'Customer Purchases', to: '/reports/customers/purchases' },
        ],
      },
      {
        kind: 'submenu',
        label: 'Expenses',
        children: [
          { label: 'Daily Expenses', to: '/reports/expenses/daily' },
          { label: 'Expense Range', to: '/reports/expenses/range' },
          { label: 'By Category', to: '/reports/expenses/by-category' },
          { label: 'Other Income', to: '/reports/other-income' },
        ],
      },
      {
        kind: 'submenu',
        label: 'Accounting (Advanced)',
        children: [
          { label: 'Account Ledger', to: '/reports/accounts' },
          { label: 'Account Balance', to: '/reports/account-balance' },
          { label: 'Vouchers', to: '/reports/vouchers' },
          { label: 'Detail Trial Balance', to: '/reports/trial-balance' },
        ],
      },
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
