import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AccountManagePage } from './pages/accounts/AccountManagePage';
import { AccountsFinancePage } from './pages/accounts/AccountsFinancePage';
import { AddEPaymentPage } from './pages/accounts/AddEPaymentPage';
import { CategoryManagePage } from './pages/accounts/CategoryManagePage';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { AccountReportsPage, AccountBalancePage, TrialBalancePage, VouchersReportPage } from './pages/reports/ReportPages';
import {
  CategoryProfitReportPage,
  CurrentStockReportPage,
  CustomerBalancesReportPage,
  CustomerPaymentsReportPage,
  CustomerPurchasesReportPage,
  DailySalesReportPage,
  DamagedStockReportPage,
  ExpensesByCategoryReportPage,
  ExpensesDailyReportPage,
  ExpensesRangeReportPage,
  InvoiceProfitReportPage,
  LowStockReportPage,
  OtherIncomeReportPage,
  OutOfStockReportPage,
  PaymentMethodReportPage,
  ProductProfitReportPage,
  PurchaseReturnsReportPage,
  PurchasesReportPage,
  ReturnsExchangesReportPage,
  SalesRangeReportPage,
  StockMovementsReportPage,
  StockValuationReportPage,
  SupplierOutstandingReportPage,
  SupplierPaymentsReportPage,
  SupplierPurchasesReportPage,
  UdhaarSalesReportPage,
} from './pages/reports/ShopReportPages';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SettingsPage } from './pages/system/SettingsPage';
import { SystemHealthPage } from './pages/system/SystemHealthPage';
import { UserInfoPage } from './pages/user/UserInfoPage';
import { ProductFormPage, ProductsListPage } from './pages/products/ProductPages';
import {
  PurchaseDetailPage,
  PurchaseEntryPage,
  PurchasesListPage,
  SupplierPaymentPage,
} from './pages/purchases/PurchasePages';
import { InvoicesListPage, InvoiceDetailPage, NewSalePage } from './pages/sales/SalePages';
import { ReturnExchangePage } from './pages/sales/ReturnExchangePage';
import {
  ExpenseEntryPage,
  ExpensesListPage,
  OtherIncomeEntryPage,
  OtherIncomeListPage,
} from './pages/finance/FinancePages';
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
import {
  AccountsHubPage,
  CustomersHubPage,
  FinanceHubPage,
  ProductsHubPage,
  ReportsHubPage,
  SalesHubPage,
  SuppliersHubPage,
  SystemHubPage,
} from './pages/hubs/HubPages';

export default function App() {
  return (
    <ErrorBoundary>
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<DashboardPage />} />

              <Route path="/products" element={<ProductsHubPage />} />
              <Route path="/products/list" element={<ProductsListPage />} />
              <Route path="/products/add" element={<ProductFormPage mode="add" />} />
              <Route path="/products/:id" element={<ProductFormPage mode="edit" />} />

              <Route path="/suppliers" element={<SuppliersHubPage />} />
              <Route path="/suppliers/list" element={<SuppliersListPage />} />
              <Route path="/suppliers/add" element={<SupplierFormPage mode="add" />} />
              <Route path="/suppliers/:id/edit" element={<SupplierFormPage mode="edit" />} />
              <Route path="/suppliers/:id" element={<SupplierDetailPage />} />

              <Route path="/purchases" element={<PurchasesListPage />} />
              <Route path="/purchases/new" element={<PurchaseEntryPage />} />
              <Route path="/purchases/pay" element={<SupplierPaymentPage />} />
              <Route path="/purchases/:id" element={<PurchaseDetailPage />} />

              <Route path="/sales" element={<SalesHubPage />} />
              <Route path="/sales/list" element={<InvoicesListPage />} />
              <Route path="/sales/new" element={<NewSalePage />} />
              <Route path="/sales/return" element={<ReturnExchangePage />} />
              <Route path="/sales/:id" element={<InvoiceDetailPage />} />

              <Route path="/finance" element={<FinanceHubPage />} />
              <Route path="/finance/expenses" element={<ExpensesListPage />} />
              <Route path="/finance/expenses/new" element={<ExpenseEntryPage />} />
              <Route path="/finance/other-income" element={<OtherIncomeListPage />} />
              <Route path="/finance/other-income/new" element={<OtherIncomeEntryPage />} />

              <Route path="/customers" element={<CustomersHubPage />} />
              <Route path="/customers/list" element={<CustomersListPage />} />
              <Route path="/customers/add" element={<CustomerFormPage mode="add" />} />
              <Route path="/customers/pay" element={<CustomerPaymentPage />} />
              <Route path="/customers/:id/edit" element={<CustomerFormPage mode="edit" />} />
              <Route path="/customers/:id" element={<CustomerDetailPage />} />

              <Route path="/accounts" element={<AccountsHubPage />} />
              <Route path="/accounts/overview" element={<AccountsFinancePage />} />
              <Route path="/accounts/e-payment" element={<AddEPaymentPage />} />
              <Route path="/accounts/chart" element={<Navigate to="/accounts/overview" replace />} />

              <Route path="/reports" element={<ReportsHubPage />} />
              <Route path="/system" element={<SystemHubPage />} />
              <Route path="/accounts/categories/add" element={<CategoryManagePage mode="add" />} />
              <Route path="/accounts/categories/edit" element={<CategoryManagePage mode="edit" />} />
              <Route path="/accounts/categories/remove" element={<CategoryManagePage mode="remove" />} />
              <Route path="/accounts/manage/add" element={<AccountManagePage mode="add" />} />
              <Route path="/accounts/manage/edit" element={<AccountManagePage mode="edit" />} />
              <Route path="/accounts/manage/remove" element={<AccountManagePage mode="remove" />} />

              {/* Voucher routes kept unlinked from nav for debug / direct URL access */}
              <Route path="/vouchers/payment" element={<VoucherFormPage kind="payment" />} />
              <Route path="/vouchers/journal" element={<VoucherFormPage kind="journal" />} />
              <Route path="/vouchers/receipt" element={<VoucherFormPage kind="receipt" />} />
              <Route path="/vouchers/view" element={<VoucherListPage />} />

              <Route path="/reports/accounts" element={<AccountReportsPage />} />
              <Route path="/reports/account-balance" element={<AccountBalancePage />} />
              <Route path="/reports/vouchers" element={<VouchersReportPage />} />
              <Route path="/reports/trial-balance" element={<TrialBalancePage />} />

              <Route path="/reports/sales/daily" element={<DailySalesReportPage />} />
              <Route path="/reports/sales/range" element={<SalesRangeReportPage />} />
              <Route path="/reports/sales/product-profit" element={<ProductProfitReportPage />} />
              <Route path="/reports/sales/category-profit" element={<CategoryProfitReportPage />} />
              <Route path="/reports/sales/invoice-profit" element={<InvoiceProfitReportPage />} />
              <Route path="/reports/sales/udhaar" element={<UdhaarSalesReportPage />} />
              <Route path="/reports/sales/payment-methods" element={<PaymentMethodReportPage />} />
              <Route path="/reports/sales/returns-exchanges" element={<ReturnsExchangesReportPage />} />

              <Route path="/reports/stock/current" element={<CurrentStockReportPage />} />
              <Route path="/reports/stock/low" element={<LowStockReportPage />} />
              <Route path="/reports/stock/out" element={<OutOfStockReportPage />} />
              <Route path="/reports/stock/damaged" element={<DamagedStockReportPage />} />
              <Route path="/reports/stock/movements" element={<StockMovementsReportPage />} />
              <Route path="/reports/stock/valuation" element={<StockValuationReportPage />} />

              <Route path="/reports/purchases" element={<PurchasesReportPage />} />
              <Route path="/reports/purchases/returns" element={<PurchaseReturnsReportPage />} />
              <Route path="/reports/suppliers/purchases" element={<SupplierPurchasesReportPage />} />
              <Route path="/reports/suppliers/outstanding" element={<SupplierOutstandingReportPage />} />
              <Route path="/reports/suppliers/payments" element={<SupplierPaymentsReportPage />} />

              <Route path="/reports/customers/balances" element={<CustomerBalancesReportPage />} />
              <Route path="/reports/customers/payments" element={<CustomerPaymentsReportPage />} />
              <Route path="/reports/customers/purchases" element={<CustomerPurchasesReportPage />} />

              <Route path="/reports/expenses/daily" element={<ExpensesDailyReportPage />} />
              <Route path="/reports/expenses/range" element={<ExpensesRangeReportPage />} />
              <Route path="/reports/expenses/by-category" element={<ExpensesByCategoryReportPage />} />
              <Route path="/reports/other-income" element={<OtherIncomeReportPage />} />

              <Route path="/system/settings" element={<SettingsPage />} />
              <Route path="/system/health" element={<SystemHealthPage />} />
              <Route path="/system/preferences" element={<Navigate to="/system/settings" replace />} />
              <Route path="/user" element={<UserInfoPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
    </ErrorBoundary>
  );
}
