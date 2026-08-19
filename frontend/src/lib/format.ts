const MONEY_FORMAT: Intl.NumberFormatOptions = {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
};

/** Whole rupees as 200, paisa only when needed (200.5). Never 200.00. */
export function formatMoney(amount: number | string) {
  const n = Math.round((Number(amount) || 0) * 100) / 100;
  return n.toLocaleString('en-PK', MONEY_FORMAT);
}

export function formatLedgerAmount(amount: number | string) {
  return formatMoney(amount);
}

/** Running balance: positive = Dr, negative = Cr (never show negative Dr). Zero = no suffix. */
export function formatLedgerBalance(balance: number | string) {
  const n = Math.round((Number(balance) || 0) * 100) / 100;
  const abs = formatMoney(Math.abs(n));
  if (n === 0) return '0';
  return n > 0 ? `${abs} Dr` : `${abs} Cr`;
}

export function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(date: string | Date) {
  return new Date(date).toLocaleString('en-PK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

const VOUCHER_TYPE_LABELS: Record<string, string> = {
  PAYMENT: 'Payment',
  RECEIPT: 'Receipt',
  JOURNAL: 'Journal',
  KACHI: 'Kachi',
  PURCHASE_MAAL: 'Purchase Maal',
  SALE: 'Sale',
  SALE_RETURN: 'Sale Return',
  PURCHASE: 'Purchase',
  PURCHASE_RETURN: 'Purchase Return',
  EXCHANGE: 'Exchange',
  CUSTOMER_PAYMENT: 'Customer Payment',
  SUPPLIER_PAYMENT: 'Supplier Payment',
  EXPENSE: 'Expense',
  OTHER_INCOME: 'Other Income',
  ADJUSTMENT: 'Adjustment',
};

export function formatVoucherTypeLabel(type: string) {
  const key = type.toUpperCase();
  if (key.startsWith('JOURNAL')) return type.includes('(') ? type : VOUCHER_TYPE_LABELS.JOURNAL;
  return VOUCHER_TYPE_LABELS[key] ?? type;
}

export function formatVoucherNumber(number: number | string | null | undefined, type?: string) {
  if (number == null || number === '') return '';
  if (type?.toUpperCase() === 'KACHI') return `K-${number}`;
  if (type?.toUpperCase() === 'PURCHASE_MAAL') return `PM-${number}`;
  return String(number);
}

/** Voucher register number only — type is shown in its own column/label. */
export function formatVoucherLabel(type: string, number: number | string) {
  return formatVoucherNumber(number, type);
}

export function voucherTypeColorClass(type: string) {
  const key = type.toUpperCase();
  if (key === 'PAYMENT') return 'text-voucherPayment';
  if (key === 'RECEIPT') return 'text-voucherReceipt';
  if (key === 'KACHI') return 'text-voucherKachi';
  if (key === 'PURCHASE_MAAL') return 'text-cardPurchaseMaalAccent';
  if (key.includes('JOURNAL')) return 'text-voucherJournal';
  return 'text-textSecondary';
}

const STOCK_MOVEMENT_LABELS: Record<string, string> = {
  OPENING: 'Opening',
  PURCHASE: 'Purchase',
  SALE: 'Sale',
  SALE_RETURN: 'Sale Return',
  PURCHASE_RETURN: 'Purchase Return',
  EXCHANGE: 'Exchange',
  MANUAL_ADD: 'Manual Add',
  MANUAL_REDUCE: 'Manual Reduce',
  DAMAGED: 'Damaged',
  CORRECTION: 'Correction',
  CANCELLATION: 'Cancellation',
};

export function formatStockMovementType(type: string) {
  return STOCK_MOVEMENT_LABELS[type.toUpperCase()] ?? type;
}
