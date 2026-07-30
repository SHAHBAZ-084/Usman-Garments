import { useEffect, useState } from 'react';
import { Banknote, Smartphone } from 'lucide-react';
import { FieldLabel } from './PageShell';
import { api, type BankAccountOption } from '../../lib/api';

const SELECT_CLASS =
  'w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-textPrimary';

/** UI only shows Cash vs E-payment; E-payment maps to BANK_TRANSFER + wallet account. */
export type SimplePayKind = 'CASH' | 'EPAY';

export function toApiPaymentMethod(kind: SimplePayKind): 'CASH' | 'BANK_TRANSFER' {
  return kind === 'CASH' ? 'CASH' : 'BANK_TRANSFER';
}

export function fromApiPaymentMethod(method: string): SimplePayKind {
  return method === 'CASH' ? 'CASH' : 'EPAY';
}

export function PaymentMethodFields({
  kind,
  onKindChange,
  accountId,
  onAccountChange,
  requiredAccount = true,
  label = 'Payment method',
}: {
  kind: SimplePayKind;
  onKindChange: (kind: SimplePayKind) => void;
  accountId: string;
  onAccountChange: (id: string) => void;
  requiredAccount?: boolean;
  label?: string;
}) {
  const [accounts, setAccounts] = useState<BankAccountOption[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (kind !== 'EPAY') {
      onAccountChange('');
      return;
    }
    let cancelled = false;
    api
      .listBankAccounts()
      .then((rows) => {
        if (!cancelled) setAccounts(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load accounts');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  return (
    <div className="space-y-3">
      <div>
        <FieldLabel>{label}</FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onKindChange('CASH')}
            className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${
              kind === 'CASH'
                ? 'border-[#c99618] bg-gradient-to-br from-[#1a1a1a] to-[#111] text-[#e2b93b] shadow-md'
                : 'border-border bg-surface2 text-textSecondary hover:border-[#c99618]/50'
            }`}
          >
            <Banknote className="h-4 w-4 shrink-0" aria-hidden />
            Cash
          </button>
          <button
            type="button"
            onClick={() => onKindChange('EPAY')}
            className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${
              kind === 'EPAY'
                ? 'border-[#c99618] bg-gradient-to-br from-[#c99618] to-[#e2b93b] text-[#111] shadow-md'
                : 'border-border bg-surface2 text-textSecondary hover:border-[#c99618]/50'
            }`}
          >
            <Smartphone className="h-4 w-4 shrink-0" aria-hidden />
            E-payment
          </button>
        </div>
      </div>
      {kind === 'EPAY' ? (
        <div>
          <FieldLabel>E-payment account</FieldLabel>
          <select
            className={SELECT_CLASS}
            value={accountId}
            onChange={(e) => onAccountChange(e.target.value)}
            required={requiredAccount}
          >
            <option value="">Select account (UBL, JazzCash, …)</option>
            {accounts.map((a) => (
              <option key={a.id} value={String(a.id)}>
                {a.name}
              </option>
            ))}
          </select>
          {accounts.length === 0 ? (
            <p className="mt-1 text-xs text-textMuted">
              Add wallets under Accounts → Add E-payment methods.
            </p>
          ) : null}
          {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
