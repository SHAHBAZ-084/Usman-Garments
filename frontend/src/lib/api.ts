export type User = {
  id: number;
  username: string;
  displayName: string;
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

  listCategories() {
    return request<AccountCategory[]>('/api/accounting/categories');
  },
  createCategory(name: string) {
    return request<AccountCategory>('/api/accounting/categories', {
      method: 'POST',
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
};
