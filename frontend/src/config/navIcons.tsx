import {
  BarChart3,
  Boxes,
  CircleUser,
  ClipboardList,
  CreditCard,
  FileText,
  HandCoins,
  Package,
  Receipt,
  RotateCcw,
  ScanBarcode,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/** Top-level nav group icons (gold/black sidebar identity preserved in top bar). */
export const NAV_GROUP_ICONS: Record<string, LucideIcon> = {
  Sales: ShoppingCart,
  Customers: CircleUser,
  Products: Package,
  Suppliers: Truck,
  Finance: Wallet,
  Accounts: CreditCard,
  Voucher: Receipt,
  Reports: BarChart3,
  System: Settings,
  User: CircleUser,
};

/** Common nav link icons by label. */
export const NAV_LINK_ICONS: Record<string, LucideIcon> = {
  'New Sale': ShoppingCart,
  'Recent Invoices': FileText,
  'Return / Exchange': RotateCcw,
  'Customer List': CircleUser,
  'Add Customer': CircleUser,
  'Receive Payment': HandCoins,
  'Product List': Package,
  'Add Product': Package,
  'Scan barcode': ScanBarcode,
  'Supplier List': Truck,
  'Add Supplier': Truck,
  'New Purchase': ClipboardList,
  Purchases: ClipboardList,
  'Pay Supplier': Wallet,
  'Record Expense': Wallet,
  'Expense History': FileText,
  'Record Other Income': HandCoins,
  'Other Income History': FileText,
  Settings: Settings,
  'System Health': ShieldCheck,
  'Daily Sales': BarChart3,
  'Sales Range': BarChart3,
  'Low Stock': Boxes,
  'Out of Stock': Boxes,
  'Current Stock': Boxes,
  'Customer Balances': HandCoins,
};

export function navLinkIcon(label: string): LucideIcon | null {
  return NAV_LINK_ICONS[label] ?? null;
}
