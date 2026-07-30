import { ModuleHubPage } from './ModuleHubPage';

export function SalesHubPage() {
  return (
    <ModuleHubPage
      title="Sales"
      subtitle="Create sales, review invoices, and process returns"
      actions={[
        { label: 'New Sale', to: '/sales/new', description: 'Start a POS sale', primary: true },
        { label: 'Recent Invoices', to: '/sales/list', description: 'View and reprint invoices' },
        { label: 'Return / Exchange', to: '/sales/return', description: 'Scan invoice and process returns' },
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
        { label: 'Customer List', to: '/customers/list', description: 'Search and open customers', primary: true },
        { label: 'Add Customer', to: '/customers/add', description: 'New customer with optional opening balance' },
        { label: 'Receive Payment', to: '/customers/pay', description: 'Record customer payment' },
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
        { label: 'Product List', to: '/products/list', description: 'Search, edit, print labels', primary: true },
        { label: 'Add Product', to: '/products/add', description: 'Create product with or without variants' },
        { label: 'Scan barcode', to: '/products/scan', description: 'Lookup up by barcode' },
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
        { label: 'Supplier List', to: '/suppliers/list', description: 'All suppliers', primary: true },
        { label: 'Add Supplier', to: '/suppliers/add' },
        { label: 'New Purchase', to: '/purchases/new', description: 'Buy stock from a supplier' },
        { label: 'Purchases', to: '/purchases', description: 'Purchase history' },
        { label: 'Pay Supplier', to: '/purchases/pay' },
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
        { label: 'Add Expense', to: '/finance/expenses/new', primary: true },
        { label: 'Expense List', to: '/finance/expenses', description: 'Expense history' },
        { label: 'Add Other Income', to: '/finance/other-income/new' },
        { label: 'Other Income History', to: '/finance/other-income' },
      ]}
    />
  );
}

export function AccountsHubPage() {
  return (
    <ModuleHubPage
      title="Accounts"
      subtitle="Ledger and bank accounts"
      actions={[
        { label: 'Finance Overview', to: '/accounts/overview', primary: true },
        { label: 'Chart of Accounts', to: '/accounts/chart' },
        { label: 'Add Bank Account', to: '/accounts/manage/add?bank=1' },
      ]}
    />
  );
}

export function ReportsHubPage() {
  return (
    <ModuleHubPage
      title="Reports"
      subtitle="Sales, stock, purchases, customers, and accounting"
      actions={[
        { label: 'Daily Sales', to: '/reports/sales/daily', primary: true },
        { label: 'Sales Range', to: '/reports/sales/range' },
        { label: 'Current Stock', to: '/reports/stock/current' },
        { label: 'Low Stock', to: '/reports/stock/low' },
        { label: 'Purchases', to: '/reports/purchases' },
        { label: 'Customer Balances', to: '/reports/customers/balances' },
        { label: 'Daily Expenses', to: '/reports/expenses/daily' },
        { label: 'Trial Balance', to: '/reports/trial-balance' },
        { label: 'Account Ledger', to: '/reports/accounts' },
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
        { label: 'Settings', to: '/system/settings', primary: true },
        { label: 'System Health', to: '/system/health', description: 'Backups, integrity, stock alerts' },
      ]}
    />
  );
}
