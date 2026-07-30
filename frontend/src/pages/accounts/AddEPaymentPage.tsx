import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FieldLabel,
  Feedback,
  PageShell,
  Panel,
  PrimaryButton,
  SecondaryButton,
  TextInput,
} from '../../components/ui/PageShell';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/format';

const EPAY_TYPES = [
  { id: 'bank', label: 'Bank' },
  { id: 'jazzcash', label: 'JazzCash' },
  { id: 'easypaisa', label: 'Easypaisa' },
  { id: 'upaisa', label: 'Upaisa' },
  { id: 'card', label: 'Card' },
] as const;

const BANKS = [
  'UBL',
  'HBL',
  'MCB',
  'Allied Bank',
  'Meezan Bank',
  'Bank Alfalah',
  'Askari Bank',
  'Standard Chartered',
  'Faysal Bank',
  'JS Bank',
  'Habib Metro',
  'Other',
] as const;

type EpayType = (typeof EPAY_TYPES)[number]['id'];

function buildDisplayName(type: EpayType, bank: string, holderName: string): string {
  const holder = holderName.trim();
  if (!holder) return '';
  if (type === 'bank') {
    const bankLabel = bank === 'Other' || !bank ? 'Bank' : bank;
    return `${bankLabel} ${holder}`.replace(/\s+/g, ' ').trim();
  }
  if (type === 'jazzcash') return `JazzCash ${holder}`;
  if (type === 'easypaisa') return `Easypaisa ${holder}`;
  if (type === 'upaisa') return `Upaisa ${holder}`;
  return `Card ${holder}`;
}

export function AddEPaymentPage() {
  const [type, setType] = useState<EpayType>('bank');
  const [bank, setBank] = useState<string>('UBL');
  const [holderName, setHolderName] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [bankCategoryId, setBankCategoryId] = useState<number | null>(null);

  const displayName = useMemo(
    () => buildDisplayName(type, bank, holderName),
    [type, bank, holderName],
  );

  useEffect(() => {
    api
      .listCategories()
      .then((cats) => {
        const bankCat = cats.find((c) => c.name.trim().toLowerCase() === 'bank' && c.isActive);
        setBankCategoryId(bankCat?.id ?? null);
      })
      .catch(() => setBankCategoryId(null));
  }, []);

  function clearForm() {
    setType('bank');
    setBank('UBL');
    setHolderName('');
    setOpeningBalance('');
    setError('');
    setMessage('');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!displayName) {
      setError('Enter an account name (e.g. Ali)');
      return;
    }
    if (!bankCategoryId) {
      setError('Bank category is missing. Open System Health or Settings, then try again.');
      return;
    }
    const opening = openingBalance.trim() ? Number(openingBalance) : 0;
    if (openingBalance.trim() && (Number.isNaN(opening) || opening < 0)) {
      setError('Opening balance must be zero or greater');
      return;
    }
    setSaving(true);
    try {
      await api.createAccount({
        categoryId: bankCategoryId,
        name: displayName,
        ...(opening > 0 ? { openingBalance: opening, openingBalanceSide: 'DR' as const } : {}),
      });
      setMessage(`Saved “${displayName}”. It will appear in payment account lists.`);
      setHolderName('');
      setOpeningBalance('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save account');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell
      title="Add E-payment methods"
      subtitle="Create bank and wallet accounts used on sales and purchases"
      actions={
        <Link to="/accounts">
          <SecondaryButton type="button">Accounts hub</SecondaryButton>
        </Link>
      }
    >
      <Panel className="max-w-xl">
        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <FieldLabel>Category</FieldLabel>
            <select
              className="w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value as EpayType)}
            >
              {EPAY_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {type === 'bank' ? (
            <div>
              <FieldLabel>Bank</FieldLabel>
              <select
                className="w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
                value={bank}
                onChange={(e) => setBank(e.target.value)}
              >
                {BANKS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div>
            <FieldLabel>Account name</FieldLabel>
            <TextInput
              value={holderName}
              onChange={(e) => setHolderName(e.target.value)}
              placeholder="e.g. Ali"
              required
            />
            {displayName ? (
              <p className="mt-1.5 text-sm text-textSecondary">
                Will save as <span className="font-semibold text-textPrimary">{displayName}</span>
              </p>
            ) : null}
          </div>

          <div>
            <FieldLabel>Opening balance (optional)</FieldLabel>
            <TextInput
              type="number"
              min="0"
              step="0.01"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              placeholder="0"
            />
            {openingBalance.trim() && Number(openingBalance) > 0 ? (
              <p className="mt-1 text-xs text-textMuted">
                Starting balance: Rs {formatMoney(Number(openingBalance) || 0)}
              </p>
            ) : null}
          </div>

          {message ? <Feedback variant="success">{message}</Feedback> : null}
          {error ? <Feedback variant="error">{error}</Feedback> : null}

          <div className="flex flex-wrap gap-2">
            <PrimaryButton type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </PrimaryButton>
            <SecondaryButton type="button" onClick={clearForm}>
              Clear
            </SecondaryButton>
          </div>
        </form>
      </Panel>
    </PageShell>
  );
}
