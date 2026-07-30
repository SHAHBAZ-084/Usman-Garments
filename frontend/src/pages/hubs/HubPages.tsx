import { ModuleHubPage } from './ModuleHubPage';

export function SalesHubPage() {
  return (
    <ModuleHubPage
      title="Sales"
      subtitle="Create sales, review invoices, and process returns"
      actions={[
        { label: 'New Sale', to: '/sales/new', description: 'Start a POS sale', primary: true, tone: 'gold' },
        { label: 'Recent Invoices', to: '/sales/list', description: 'View and reprint invoices', tone: 'teal' },
        { label: 'Return / Exchange', to: '/sales/return', description: 'Scan invoice and process returns', tone: 'rose' },
      ]}
    />
  );
}

export function CustomersHubPage() {
  return (
    <ModuleHubPage
      title="Customers"
      subtitle="Manage customers and udhaar payments"
      actions={[
        { label: 'Customer List', to: '/customers/list', description: 'Search and open customers', primary: true, tone: 'teal' },
        { label: 'Add Customer', to: '/customers/add', description: 'New customer with optional opening balance', tone: 'green' },
        { label: 'Receive Payment', to: '/customers/pay', description: 'Record customer payment', tone: 'gold' },
      ]}
    />
  );
}

export function ProductsHubPage() {
  return (
    <ModuleHubPage
      title="Products"
      subtitle="Inventory, barcodes, and stock"
      actions={[
        { label: 'Product List', to: '/products/list', description: 'Search, edit, print labels', primary: true, tone: 'gold' },
        { label: 'Add Product', to: '/products/add', description: 'Create product with or without variants', tone: 'green' },
      ]}
    />
  );
}

export function SuppliersHubPage() {
  return (
    <ModuleHubPage
      title="Suppliers"
      subtitle="Suppliers, purchases, and payables"
      actions={[
        { label: 'Supplier List', to: '/suppliers/list', description: 'All suppliers', primary: true, tone: 'teal' },
        { label: 'Add Supplier', to: '/suppliers/add', tone: 'green' },
        { label: 'New Purchase', to: '/purchases/new', description: 'Buy stock from a supplier', tone: 'gold' },
        { label: 'Purchases', to: '/purchases', description: 'Purchase history', tone: 'amber' },
        { label: 'Pay Supplier', to: '/purchases/pay', tone: 'rose' },
      ]}
    />
  );
}

export function FinanceHubPage() {
  return (
    <ModuleHubPage
      title="Finance"
      subtitle="Shop expenses and other income"
      actions={[
        { label: 'Add Expense', to: '/finance/expenses/new', primary: true, tone: 'rose' },
        { label: 'Expense List', to: '/finance/expenses', description: 'Expense history', tone: 'amber' },
        { label: 'Add Other Income', to: '/finance/other-income/new', tone: 'green' },
        { label: 'Other Income History', to: '/finance/other-income', tone: 'teal' },
      ]}
    />
  );
}

export function AccountsHubPage() {
  return (
    <ModuleHubPage
      title="Accounts"
      subtitle="Cash, banks, and e-payment wallets"
      actions={[
        { label: 'Finance Overview', to: '/accounts/overview', primary: true, tone: 'gold' },
        { label: 'Add E-payment methods', to: '/accounts/e-payment', description: 'Bank, JazzCash, Easypaisa, and more', tone: 'green' },
      ]}
    />
  );
}

export function ReportsHubPage() {
  return (
    <ModuleHubPage
      title="Reports"
      subtitle="Simple reports for everyday shop decisions"
      actions={[
        {
          label: 'Daily Sales',
          to: '/reports/sales/daily',
          description: 'Day, week, month, year, or custom — with cash vs e-payment detail',
          primary: true,
          tone: 'gold',
        },
        { label: 'Current Stock', to: '/reports/stock/current', description: 'What you have on hand', tone: 'teal' },
        { label: 'Low Stock', to: '/reports/stock/low', description: 'Items that need restocking', tone: 'rose' },
        { label: 'Purchases', to: '/reports/purchases', description: 'Stock you bought from suppliers', tone: 'amber' },
        {
          label: 'Trial Balance',
          to: '/reports/trial-balance',
          description: 'Simple check that books balance (left = right)',
          tone: 'indigo',
        },
      ]}
    />
  );
}

export function SystemHubPage() {
  return (
    <ModuleHubPage
      title="System"
      subtitle="Settings and health"
      actions={[
        { label: 'Settings', to: '/system/settings', primary: true, tone: 'gold' },
        { label: 'System Health', to: '/system/health', description: 'Backups, integrity, stock alerts', tone: 'teal' },
      ]}
    />
  );
}
