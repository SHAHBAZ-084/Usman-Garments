import { useEffect, useState } from 'react';
import { FieldLabel } from './PageShell';
import { api, type BankAccountOption } from '../lib/api';

const SELECT_CLASS =
  'w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-textPrimary';

/** True when Card or Bank Transfer requires picking a Bank GL account. */
export function needsBankAccount(method: string) {
  return method === 'CARD' || method === 'BANK_TRANSFER';
}

export function PaymentBankAccountSelect({
  paymentMethod,
  value,
  onChange,
  required = true,
}: {
  paymentMethod: string;
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
}) {
  const [accounts, setAccounts] = useState<BankAccountOption[]>([]);
  const [error, setError] = useState('');
  const show = needsBankAccount(paymentMethod);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    api
      .listBankAccounts()
      .then((rows) => {
        if (!cancelled) setAccounts(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load bank accounts');
      });
    return () => {
      cancelled = true;
    };
  }, [show]);

  useEffect(() => {
    if (!show) {
      onChange('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset when method toggles picker visibility
  }, [show]);

  if (!show) return null;

  return (
    <div>
      <FieldLabel>Bank account</FieldLabel>
      <select
        className={SELECT_CLASS}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      >
        <option value="">Select bank account</option>
        {accounts.map((a) => (
          <option key={a.id} value={String(a.id)}>
            {a.name}
          </option>
        ))}
      </select>
      {accounts.length === 0 ? (
        <p className="mt-1 text-xs text-textMuted">
          No bank accounts yet. Add one under Accounts → Add Bank Account.
        </p>
      ) : null}
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
    </div>
  );
}
