export type User = {
  id: number;
  username: string;
  displayName: string;
};

export type BusinessSettings = {
  id: number;
  businessName: string;
  tagline: string;
  ownerName: string;
  phone: string;
  whatsapp: string;
  address: string;
  invoiceFooter: string;
  returnPolicy: string;
  invoicePrefix: string;
  currency: string;
  receiptSize: 'THERMAL_58' | 'THERMAL_80' | 'A4';
  a4InvoiceEnabled: boolean;
  printerName: string | null;
  barcodeLabelSize: string;
  lowStockLimit: number;
  backupFolderPath: string;
  themeMode: 'light' | 'dark';
  logoPath: string | null;
  logoUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AccountCategory = {
  id: number;
  name: string;
  isActive: boolean;
};

export type Ledger = { id: number; accountId: number; balance: number };
export type Account = {
  id: number;
  categoryId: number;
  name: string;
  code: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  isActive: boolean;
  category?: AccountCategory | null;
  ledger?: Ledger | null;
};

export type VoucherAccount = { id: number; name: string; code: string };
export type VoucherUser = { id: number; displayName: string; username: string };

export type VoucherLedgerEntry = {
  id: number;
  type: string;
  amount: number | string;
  notes?: string | null;
  ledger?: {
    account?: VoucherAccount | null;
  } | null;
};

export type Voucher = {
  id: number;
  type: string;
  number: number;
  date: string;
  amount: number | string;
  description?: string | null;
  reference?: string | null;
  status: string;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string | null;
  debitAccount?: VoucherAccount | null;
  creditAccount?: VoucherAccount | null;
  ledgerEntries?: VoucherLedgerEntry[];
  createdBy?: VoucherUser | null;
  modifiedBy?: VoucherUser | null;
  deletedBy?: VoucherUser | null;
};

type ApiError = { error: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'include',
  });
  const data = (await response.json().catch(() => ({}))) as T & ApiError;
  if (!response.ok) throw new Error(data.error ?? 'Request failed');
  return data;
}

export const api = {
  login(username: string, password: string) {
    return request<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },
  logout() {
    return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
  },
  me() {
    return request<{ user: User }>('/api/auth/me');
  },

  getSettings() {
    return request<BusinessSettings>('/api/settings');
  },
  updateSettings(data: Partial<BusinessSettings> & { themeMode?: 'light' | 'dark' }) {
    return request<BusinessSettings>('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },
  uploadLogo(file: File) {
    const body = new FormData();
    body.append('logo', file);
    return fetch('/api/settings/logo', {
      method: 'POST',
      body,
      credentials: 'include',
    }).then(async (response) => {
      const data = (await response.json().catch(() => ({}))) as BusinessSettings & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Logo upload failed');
      return data as BusinessSettings;
    });
  },

  listCategories() {
    return request<AccountCategory[]>('/api/accounting/categories');
  },
  createCategory(name: string) {
    return request<AccountCategory>('/api/accounting/categories', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },
  updateCategory(id: number, name: string) {
    return request<AccountCategory>(`/api/accounting/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
  },
  deleteCategory(id: number) {
    return request<AccountCategory>(`/api/accounting/categories/${id}`, { method: 'DELETE' });
  },

  listVouchers(params?: { fromDate?: string; toDate?: string; type?: string }) {
    const query = new URLSearchParams();
    if (params?.fromDate) query.set('fromDate', params.fromDate);
    if (params?.toDate) query.set('toDate', params.toDate);
    if (params?.type) query.set('type', params.type);
    const suffix = query.toString() ? `?${query}` : '';
    return request<Voucher[]>(`/api/accounting/vouchers${suffix}`);
  },

  getDashboardSummary() {
    return request<{
      cashBalance: number;
      receivables: number;
      payables: number;
      vouchersToday: number;
      recentVouchers: {
        id: number;
        number: number;
        type: string;
        amount: number;
        date: string;
        status: string;
        accountLabel: string;
      }[];
    }>('/api/accounting/dashboard-summary');
  },
  getNextVoucherNumber() {
    return request<{ number: number; financialYearId: number }>('/api/accounting/vouchers/next-number');
  },
  createVoucher(data: {
    type: string;
    debitAccountId: number;
    creditAccountId: number;
    amount: number;
    date: string;
    description?: string;
    reference: string;
  }) {
    return request<Voucher>('/api/accounting/vouchers', { method: 'POST', body: JSON.stringify(data) });
  },
  updateVoucherAmount(voucherId: number, amount: number) {
    return request<Voucher>(`/api/accounting/vouchers/${voucherId}`, {
      method: 'PATCH',
      body: JSON.stringify({ amount }),
    });
  },
  cancelVoucher(voucherId: number) {
    return request<Voucher>(`/api/accounting/vouchers/${voucherId}`, { method: 'DELETE' });
  },

  listAccounts() {
    return request<Account[]>('/api/accounting/accounts');
  },
  createAccount(data: {
    categoryId: number;
    name: string;
    code?: string;
    type?: Account['type'];
    openingBalance?: number;
    openingBalanceSide?: 'DR' | 'CR';
  }) {
    return request<Account>('/api/accounting/accounts', { method: 'POST', body: JSON.stringify(data) });
  },
  updateAccount(id: number, data: { name?: string; code?: string; isActive?: boolean }) {
    return request<Account>(`/api/accounting/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  removeAccount(id: number) {
    return request<Account>(`/api/accounting/accounts/${id}`, { method: 'DELETE' });
  },

  getLedger(accountId: number, params?: { fromDate?: string; toDate?: string }) {
    const query = params?.fromDate || params?.toDate
      ? `?${new URLSearchParams({ ...(params.fromDate ? { fromDate: params.fromDate } : {}), ...(params.toDate ? { toDate: params.toDate } : {}) })}`
      : '';
    return request<{
      account: { id: number; name: string; code: string; type: string };
      balance: number;
      rows: {
        date: string;
        voucherNo: string;
        ref: string | null;
        type: string;
        description: string;
        debit: number;
        credit: number;
        balance: number;
        isOpeningRow?: boolean;
      }[];
      summary: { periodOpening: number; totalDebit: number; totalCredit: number; closingBalance: number };
    }>(`/api/accounting/ledger/${accountId}${query}`);
  },

  getTrialBalance() {
    return request<{
      accounts: { accountName: string; debit: number; credit: number }[];
      totalDebit: number;
      totalCredit: number;
      isBalanced: boolean;
    }>('/api/accounting/trial-balance');
  },

  getAccountBalanceReport(params: { date: string; categoryId?: number; side?: 'debit' | 'credit' | 'both' }) {
    const query = new URLSearchParams({ date: params.date, side: params.side ?? 'both' });
    if (params.categoryId != null) query.set('categoryId', String(params.categoryId));
    return request<{
      date: string;
      side: 'debit' | 'credit' | 'both';
      categoryId: number | null;
      accounts: {
        accountId: number;
        accountCode: string;
        accountName: string;
        categoryId: number;
        categoryName: string;
        balance: number;
        debit: number;
        credit: number;
      }[];
      groups: {
        categoryId: number;
        categoryName: string;
        accounts: {
          accountId: number;
          accountCode: string;
          accountName: string;
          categoryId: number;
          categoryName: string;
          balance: number;
          debit: number;
          credit: number;
        }[];
      }[];
      totalDebit: number;
      totalCredit: number;
    }>(`/api/accounting/reports/account-balance?${query.toString()}`);
  },

  listProductCategories() {
    return request<ProductCategory[]>('/api/products/categories');
  },
  createProductCategory(name: string) {
    return request<ProductCategory>('/api/products/categories', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },
  listProducts(params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    categoryId?: number;
    activeOnly?: boolean;
  }) {
    const query = new URLSearchParams();
    if (params?.page != null) query.set('page', String(params.page));
    if (params?.pageSize != null) query.set('pageSize', String(params.pageSize));
    if (params?.search) query.set('search', params.search);
    if (params?.categoryId != null) query.set('categoryId', String(params.categoryId));
    if (params?.activeOnly === false) query.set('activeOnly', 'false');
    const suffix = query.toString() ? `?${query}` : '';
    return request<ProductListResult>(`/api/products${suffix}`);
  },
  getProduct(id: number) {
    return request<Product>(`/api/products/${id}`);
  },
  getProductByBarcode(barcode: string) {
    return request<BarcodeLookupResult>(`/api/products/by-barcode/${encodeURIComponent(barcode)}`);
  },
  createProduct(data: CreateProductInput) {
    return request<Product>('/api/products', { method: 'POST', body: JSON.stringify(data) });
  },
  updateProduct(id: number, data: Partial<CreateProductInput>) {
    return request<Product>(`/api/products/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  deactivateProduct(id: number) {
    return request<{ id: number; isActive: boolean }>(`/api/products/${id}`, { method: 'DELETE' });
  },
  createProductVariant(productId: number, data: ProductVariantInput) {
    return request<ProductVariant>(`/api/products/${productId}/variants`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  updateProductVariant(productId: number, variantId: number, data: Partial<ProductVariantInput>) {
    return request<ProductVariant>(`/api/products/${productId}/variants/${variantId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },
  adjustProductStock(
    productId: number,
    data: { variantId?: number; quantity: number; direction: 'add' | 'reduce'; note?: string },
  ) {
    return request<{ movement: StockMovement; newStock: number }>(
      `/api/products/${productId}/stock-adjust`,
      { method: 'POST', body: JSON.stringify(data) },
    );
  },
  listStockMovements(
    productId: number,
    params?: { variantId?: number; page?: number; pageSize?: number },
  ) {
    const query = new URLSearchParams();
    if (params?.variantId != null) query.set('variantId', String(params.variantId));
    if (params?.page != null) query.set('page', String(params.page));
    if (params?.pageSize != null) query.set('pageSize', String(params.pageSize));
    const suffix = query.toString() ? `?${query}` : '';
    return request<StockMovementListResult>(`/api/products/${productId}/stock-movements${suffix}`);
  },

  downloadProductImportTemplate() {
    return fetch('/api/products/import/template', { credentials: 'include' }).then(async (res) => {
      if (!res.ok) throw new Error('Failed to download template');
      return res.blob();
    });
  },
  previewProductImport(file: File) {
    const body = new FormData();
    body.append('file', file);
    return fetch('/api/products/import/preview', {
      method: 'POST',
      body,
      credentials: 'include',
    }).then(async (response) => {
      const data = (await response.json().catch(() => ({}))) as ProductImportPreview & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Import preview failed');
      return data;
    });
  },
  commitProductImport(products: ProductImportPreview['commitPayload']) {
    return request<{ createdCount: number; products: Product[] }>('/api/products/import/commit', {
      method: 'POST',
      body: JSON.stringify({ products }),
    });
  },

  listSuppliers(params?: { activeOnly?: boolean; search?: string }) {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.activeOnly === false) query.set('activeOnly', 'false');
    const suffix = query.toString() ? `?${query}` : '';
    return request<Supplier[]>(`/api/suppliers${suffix}`);
  },
  getSupplier(id: number) {
    return request<SupplierDetail>(`/api/suppliers/${id}`);
  },
  createSupplier(data: {
    name: string;
    phone?: string;
    address?: string | null;
    openingBalance?: number;
    notes?: string | null;
  }) {
    return request<Supplier>('/api/suppliers', { method: 'POST', body: JSON.stringify(data) });
  },
  updateSupplier(
    id: number,
    data: {
      name?: string;
      phone?: string;
      address?: string | null;
      notes?: string | null;
      isActive?: boolean;
    },
  ) {
    return request<Supplier>(`/api/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  deactivateSupplier(id: number) {
    return request<Supplier>(`/api/suppliers/${id}`, { method: 'DELETE' });
  },

  listPurchases(params?: { supplierId?: number; page?: number; pageSize?: number }) {
    const query = new URLSearchParams();
    if (params?.supplierId != null) query.set('supplierId', String(params.supplierId));
    if (params?.page != null) query.set('page', String(params.page));
    if (params?.pageSize != null) query.set('pageSize', String(params.pageSize));
    const suffix = query.toString() ? `?${query}` : '';
    return request<PurchaseListResult>(`/api/purchases${suffix}`);
  },
  getPurchase(id: number) {
    return request<Purchase>(`/api/purchases/${id}`);
  },
  createPurchase(data: CreatePurchaseInput) {
    return request<Purchase>('/api/purchases', { method: 'POST', body: JSON.stringify(data) });
  },
  createSupplierPayment(data: {
    supplierId: number;
    amount: number;
    paymentMethod: PurchasePaymentMethod;
    date: string;
    note?: string | null;
  }) {
    return request<SupplierPaymentResult>('/api/purchases/payments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  createPurchaseReturn(data: {
    purchaseId: number;
    items: { purchaseItemId: number; quantity: number }[];
    note?: string | null;
    refundToCash?: boolean;
  }) {
    return request<{
      id: number;
      purchaseId: number;
      totalAmount: number;
      confirmation: { message: string };
    }>('/api/purchases/returns', { method: 'POST', body: JSON.stringify(data) });
  },

  listCustomers(params?: { search?: string; activeOnly?: boolean }) {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.activeOnly === false) query.set('activeOnly', 'false');
    const suffix = query.toString() ? `?${query}` : '';
    return request<Customer[]>(`/api/customers${suffix}`);
  },
  getCustomer(id: number) {
    return request<CustomerDetail>(`/api/customers/${id}`);
  },
  createCustomer(data: {
    name: string;
    phone?: string;
    address?: string | null;
    notes?: string | null;
  }) {
    return request<Customer>('/api/customers', { method: 'POST', body: JSON.stringify(data) });
  },
  updateCustomer(
    id: number,
    data: {
      name?: string;
      phone?: string;
      address?: string | null;
      notes?: string | null;
      isActive?: boolean;
    },
  ) {
    return request<Customer>(`/api/customers/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  deactivateCustomer(id: number) {
    return request<Customer>(`/api/customers/${id}`, { method: 'DELETE' });
  },
  createCustomerPayment(data: {
    customerId: number;
    amount: number;
    paymentMethod: PurchasePaymentMethod;
    date: string;
    note?: string | null;
  }) {
    return request<CustomerPaymentResult>('/api/customers/payments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  getCustomerStatement(id: number) {
    return request<CustomerStatement>(`/api/customers/${id}/statement`);
  },

  listInvoices(params?: { page?: number; pageSize?: number; status?: 'ACTIVE' | 'CANCELLED' }) {
    const query = new URLSearchParams();
    if (params?.page != null) query.set('page', String(params.page));
    if (params?.pageSize != null) query.set('pageSize', String(params.pageSize));
    if (params?.status) query.set('status', params.status);
    const suffix = query.toString() ? `?${query}` : '';
    return request<InvoiceListResult>(`/api/sales${suffix}`);
  },
  getInvoice(id: number) {
    return request<Invoice>(`/api/sales/${id}`);
  },
  createSale(data: CreateSaleInput) {
    return request<Invoice>('/api/sales', { method: 'POST', body: JSON.stringify(data) });
  },
  cancelSale(id: number) {
    return request<Invoice>(`/api/sales/${id}/cancel`, { method: 'POST' });
  },
};

export type ProductCategory = {
  id: number;
  name: string;
  code: string;
  isActive: boolean;
};

export type ProductVariant = {
  id: number;
  size: string | null;
  colour: string | null;
  productCode: string;
  barcode: string | null;
  purchasePrice: number | null;
  salePrice: number | null;
  currentStock: number;
};

export type Product = {
  id: number;
  name: string;
  productCode: string;
  barcode: string | null;
  categoryId: number | null;
  brand: string | null;
  purchasePrice: number;
  salePrice: number;
  costNotSet: boolean;
  currentStock: number;
  lowStockLimit: number | null;
  effectiveLowStockLimit: number;
  isLowStock: boolean;
  supplierId: number | null;
  imagePath: string | null;
  notes: string | null;
  isActive: boolean;
  category?: ProductCategory | null;
  variants?: ProductVariant[];
};

export type ProductListResult = {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  defaultLowStockLimit: number;
};

export type ProductVariantInput = {
  size?: string | null;
  colour?: string | null;
  purchasePrice?: number | null;
  salePrice?: number | null;
  currentStock?: number;
  openingStock?: number;
};

export type CreateProductInput = {
  name: string;
  categoryId?: number | null;
  brand?: string | null;
  purchasePrice?: number;
  salePrice: number;
  lowStockLimit?: number | null;
  supplierId?: number | null;
  imagePath?: string | null;
  notes?: string | null;
  variants?: ProductVariantInput[];
  openingStock?: number;
};

export type StockMovement = {
  id: number;
  productId: number;
  variantId: number | null;
  type: string;
  quantity: number;
  note: string | null;
  sourceType: string | null;
  sourceRef: string | null;
  createdAt: string;
  variant?: { id: number; size: string | null; colour: string | null; productCode: string } | null;
};

export type BarcodeLookupResult = {
  matchType: 'product' | 'variant';
  product: Product;
  variant: ProductVariant | null;
};

export type StockMovementListResult = {
  items: StockMovement[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type ProductImportPreview = {
  validCount: number;
  errorCount: number;
  productsToCreate: number;
  errors: Array<{ rowNumber: number; message: string }>;
  products: Array<{
    name: string;
    category: string;
    salePrice: number;
    purchasePrice: number;
    totalStock: number;
    variants: Array<{ size: string | null; colour: string | null; stock: number }>;
  }>;
  commitPayload: Array<{
    name: string;
    category: string;
    salePrice: number;
    purchasePrice: number;
    totalStock: number;
    variants: Array<{ size: string | null; colour: string | null; stock: number }>;
  }>;
};

export type PurchasePaymentMethod = 'CASH' | 'CARD' | 'EASYPAISA' | 'JAZZCASH' | 'BANK_TRANSFER';

export type Supplier = {
  id: number;
  name: string;
  phone: string;
  address: string | null;
  openingBalance: number;
  notes: string | null;
  isActive: boolean;
  accountId: number | null;
  payable: number;
  createdAt: string;
  updatedAt: string;
};

export type SupplierDetail = {
  supplier: Supplier;
  purchases: Array<{
    id: number;
    date: string;
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
    paymentMethod: PurchasePaymentMethod;
    status: string;
  }>;
  payments: Array<{
    id: number;
    amount: number;
    paymentMethod: PurchasePaymentMethod;
    date: string;
    note: string | null;
  }>;
};

export type CreatePurchaseInput = {
  supplierId: number;
  date: string;
  supplierInvoiceNumber?: string | null;
  items: Array<{
    productId: number;
    variantId?: number | null;
    quantity: number;
    purchasePrice: number;
    discount?: number;
  }>;
  paidAmount: number;
  paymentMethod: PurchasePaymentMethod;
  notes?: string | null;
};

export type Purchase = {
  id: number;
  supplierId: number;
  supplier: { id: number; name: string; phone?: string };
  date: string;
  supplierInvoiceNumber: string | null;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  paymentMethod: PurchasePaymentMethod;
  notes: string | null;
  status: string;
  createdAt: string;
  items: Array<{
    id: number;
    productId: number;
    variantId: number | null;
    quantity: number;
    purchasePrice: number;
    discount: number;
    lineTotal: number;
    product: { id: number; name: string; productCode: string };
    variant: { id: number; size: string | null; colour: string | null; productCode: string } | null;
  }>;
  confirmation?: {
    stockUpdated: boolean;
    totalAmount: number;
    paidAmount: number;
    addedToSupplierBalance: number;
    message: string;
  };
};

export type PurchaseListResult = {
  items: Array<{
    id: number;
    supplierId: number;
    supplier: { id: number; name: string };
    date: string;
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
    paymentMethod: PurchasePaymentMethod;
    status: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type SupplierPaymentResult = {
  id: number;
  supplierId: number;
  amount: number;
  paymentMethod: PurchasePaymentMethod;
  date: string;
  note: string | null;
  confirmation: { message: string; remainingPayable: number };
};

export type SalePaymentMethod =
  | 'CASH'
  | 'CARD'
  | 'EASYPAISA'
  | 'JAZZCASH'
  | 'BANK_TRANSFER'
  | 'UDHAAR';

export type Customer = {
  id: number;
  name: string;
  phone: string;
  address: string | null;
  notes: string | null;
  currentBalance: number;
  receivable: number;
  isActive: boolean;
  accountId: number | null;
  accountName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CustomerDetail = {
  customer: Customer;
  invoices: Array<{
    id: number;
    invoiceNumber: string;
    date: string;
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
    paymentMethod: SalePaymentMethod;
    status: string;
  }>;
  payments: Array<{
    id: number;
    amount: number;
    paymentMethod: PurchasePaymentMethod;
    date: string;
    note: string | null;
  }>;
  returns: Array<{ id: number; date: string; amount: number; note: string | null }>;
};

export type CustomerPaymentResult = {
  id: number;
  customerId: number;
  customer: { id: number; name: string };
  amount: number;
  paymentMethod: PurchasePaymentMethod;
  date: string;
  note: string | null;
  confirmation: { message: string; remainingReceivable: number };
};

export type CustomerStatement = {
  customer: Customer;
  lines: Array<{
    date: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
    kind: 'INVOICE' | 'PAYMENT';
    refId: number;
  }>;
  closingBalance: number;
};

export type InvoiceItem = {
  id: number;
  productId: number;
  variantId: number | null;
  quantity: number;
  rate: number;
  discount: number;
  total: number;
  costAtSale: number;
  product: { id: number; name: string; productCode: string };
  variant: { id: number; size: string | null; colour: string | null; productCode: string } | null;
};

export type Invoice = {
  id: number;
  invoiceNumber: string;
  customerId: number | null;
  customer: { id: number; name: string; phone: string } | null;
  date: string;
  subtotal: number;
  discount: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  paymentMethod: SalePaymentMethod;
  status: 'ACTIVE' | 'CANCELLED';
  notes: string | null;
  createdAt: string;
  items: InvoiceItem[];
};

export type InvoiceListResult = {
  items: Invoice[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type CreateSaleInput = {
  items: Array<{
    productId: number;
    variantId?: number | null;
    quantity: number;
    rate?: number;
    discount?: number;
  }>;
  paymentMethod: SalePaymentMethod;
  paidAmount: number;
  customerId?: number | null;
  discount?: number;
  date?: string;
  notes?: string | null;
};

