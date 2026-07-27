import { describe, expect, it } from 'vitest';
import {
  sumCustomerReceivables,
  sumSupplierPayables,
} from './accounting.service';

describe('dashboard receivables and payables', () => {
  it('returns 0 when Customers and Suppliers categories are absent', () => {
    const accounts = [
      { categoryName: 'Cash', balance: 1000 },
      { categoryName: 'Bank', balance: 5000 },
    ];
    expect(sumCustomerReceivables(accounts)).toBe(0);
    expect(sumSupplierPayables(accounts)).toBe(0);
  });

  it('sums positive customer (receivable) balances and ignores negatives', () => {
    const accounts = [
      { categoryName: 'Customers', balance: 15000 },
      { categoryName: 'Customers', balance: 5000 },
      { categoryName: 'Customers', balance: -2000 },
      { categoryName: 'Cash', balance: 1000 },
    ];
    expect(sumCustomerReceivables(accounts)).toBe(20000);
  });

  it('sums absolute negative supplier (payable) balances and ignores positives', () => {
    const accounts = [
      { categoryName: 'Suppliers', balance: -8000 },
      { categoryName: 'Suppliers', balance: -2000 },
      { categoryName: 'Suppliers', balance: 500 },
      { categoryName: 'Bank', balance: 1000 },
    ];
    expect(sumSupplierPayables(accounts)).toBe(10000);
  });
});
