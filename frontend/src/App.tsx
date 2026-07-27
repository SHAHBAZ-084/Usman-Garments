import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AccountManagePage } from './pages/accounts/AccountManagePage';
import { CategoryManagePage } from './pages/accounts/CategoryManagePage';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { AccountReportsPage, AccountBalancePage, TrialBalancePage, VouchersReportPage } from './pages/reports/ReportPages';
import { SettingsPage } from './pages/system/SettingsPage';
import { UserInfoPage } from './pages/user/UserInfoPage';
import { ProductFormPage, ProductsListPage } from './pages/products/ProductPages';
import { BarcodeScanPage } from './pages/products/BarcodeScanPage';
import {
  PurchaseDetailPage,
  PurchaseEntryPage,
  PurchasesListPage,
  SupplierPaymentPage,
} from './pages/purchases/PurchasePages';
import { InvoicesListPage, InvoiceDetailPage, NewSalePage } from './pages/sales/SalePages';
import {
  CustomerDetailPage,
  CustomerFormPage,
  CustomerPaymentPage,
  CustomersListPage,
} from './pages/customers/CustomerPages';
import {
  SupplierDetailPage,
  SupplierFormPage,
  SuppliersListPage,
} from './pages/suppliers/SupplierPages';
import { VoucherFormPage, VoucherListPage } from './pages/vouchers/VoucherPages';

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<DashboardPage />} />

              <Route path="/products" element={<ProductsListPage />} />
              <Route path="/products/add" element={<ProductFormPage mode="add" />} />
              <Route path="/products/scan" element={<BarcodeScanPage />} />
              <Route path="/products/:id" element={<ProductFormPage mode="edit" />} />

              <Route path="/suppliers" element={<SuppliersListPage />} />
              <Route path="/suppliers/add" element={<SupplierFormPage mode="add" />} />
              <Route path="/suppliers/:id/edit" element={<SupplierFormPage mode="edit" />} />
              <Route path="/suppliers/:id" element={<SupplierDetailPage />} />

              <Route path="/purchases" element={<PurchasesListPage />} />
              <Route path="/purchases/new" element={<PurchaseEntryPage />} />
              <Route path="/purchases/pay" element={<SupplierPaymentPage />} />
              <Route path="/purchases/:id" element={<PurchaseDetailPage />} />

              <Route path="/sales" element={<InvoicesListPage />} />
              <Route path="/sales/new" element={<NewSalePage />} />
              <Route path="/sales/:id" element={<InvoiceDetailPage />} />

              <Route path="/customers" element={<CustomersListPage />} />
              <Route path="/customers/add" element={<CustomerFormPage mode="add" />} />
              <Route path="/customers/pay" element={<CustomerPaymentPage />} />
              <Route path="/customers/:id/edit" element={<CustomerFormPage mode="edit" />} />
              <Route path="/customers/:id" element={<CustomerDetailPage />} />

              <Route path="/accounts/categories/add" element={<CategoryManagePage mode="add" />} />
              <Route path="/accounts/categories/edit" element={<CategoryManagePage mode="edit" />} />
              <Route path="/accounts/categories/remove" element={<CategoryManagePage mode="remove" />} />
              <Route path="/accounts/manage/add" element={<AccountManagePage mode="add" />} />
              <Route path="/accounts/manage/edit" element={<AccountManagePage mode="edit" />} />
              <Route path="/accounts/manage/remove" element={<AccountManagePage mode="remove" />} />

              <Route path="/vouchers/payment" element={<VoucherFormPage kind="payment" />} />
              <Route path="/vouchers/journal" element={<VoucherFormPage kind="journal" />} />
              <Route path="/vouchers/receipt" element={<VoucherFormPage kind="receipt" />} />
              <Route path="/vouchers/view" element={<VoucherListPage />} />

              <Route path="/reports/accounts" element={<AccountReportsPage />} />
              <Route path="/reports/account-balance" element={<AccountBalancePage />} />
              <Route path="/reports/vouchers" element={<VouchersReportPage />} />
              <Route path="/reports/trial-balance" element={<TrialBalancePage />} />

              <Route path="/system/settings" element={<SettingsPage />} />
              <Route path="/system/preferences" element={<Navigate to="/system/settings" replace />} />
              <Route path="/user" element={<UserInfoPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
