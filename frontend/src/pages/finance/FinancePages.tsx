import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFormShortcuts } from '../../hooks/useFormShortcuts';
import {
  api,
  type ExpenseCategory,
  type ExpenseRecord,
  type OtherIncomeCategory,
  type OtherIncomeRecord,
  type PurchasePaymentMethod,
} from '../../lib/api';
import { formatDate, formatMoney } from '../../lib/format';
import { shortcutLabel } from '../../lib/shortcuts';
import {
  Feedback,
  FieldLabel,
  PageShell,
  Panel,
  PrimaryButton,
  SecondaryButton,
  TextInput,
} from '../../components/ui/PageShell';
import { PaymentMethodFields, toApiPaymentMethod, type SimplePayKind } from '../../components/ui/PaymentMethodFields';

const SELECT_CLASS = 'w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm';

function todayInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function firstOfMonthInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

type CategoryQuickAddProps = {
  categories: { id: number; name: string }[];
  onAdded: (categories: { id: number; name: string }[]) => void;
  onCreate: (name: string) => Promise<{ id: number; name: string }>;
};

function CategoryQuickAdd({ categories, onAdded, onCreate }: CategoryQuickAddProps) {
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  async function onAdd() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try {
      await onCreate(name);
      setNewName('');
      onAdded(categories);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flex gap-2">
      <TextInput
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        placeholder="New category name"
        className="flex-1"
      />
      <SecondaryButton type="button" disabled={adding || !newName.trim()} onClick={() => void onAdd()}>
        {adding ? '…' : 'Add'}
      </SecondaryButton>
    </div>
  );
}

export function ExpenseEntryPage() {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [date, setDate] = useState(todayInput());
  const [amount, setAmount] = useState('');
  const [paymentKind, setPaymentKind] = useState<SimplePayKind>('CASH');
  const [paymentAccountId, setPaymentAccountId] = useState('');
  const [description, setDescription] = useState('');
  const [paidTo, setPaidTo] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const expenseFormRef = useRef<HTMLFormElement>(null);

  async function loadCategories() {
    setCategories(await api.listExpenseCategories());
  }

  useEffect(() => {
    void loadCategories();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!categoryId) {
      setError('Select a category');
      return;
    }
    if (paymentKind === 'EPAY' && !paymentAccountId) {
      setError('Select an e-payment account');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await api.createExpense({
        categoryId: Number(categoryId),
        date,
        amount: Number(amount),
        paymentMethod: toApiPaymentMethod(paymentKind) as PurchasePaymentMethod,
        description,
        paidTo: paidTo.trim() || null,
        note: note.trim() || null,
        paymentAccountId: paymentAccountId ? Number(paymentAccountId) : undefined,
      });
      setMessage(result.confirmation.message);
      setAmount('');
      setDescription('');
      setPaidTo('');
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  function clearExpenseForm() {
    setAmount('');
    setDescription('');
    setPaidTo('');
    setNote('');
    setError('');
    setMessage('');
  }

  useFormShortcuts({
    onSave: () => expenseFormRef.current?.requestSubmit(),
    onClear: clearExpenseForm,
    saveEnabled: !saving && Boolean(categoryId) && Boolean(amount),
  });

  return (
    <PageShell
      title="Record Expense"
      subtitle="Shop running costs — posted automatically, no voucher details needed"
      actions={
        <Link to="/finance/expenses">
          <SecondaryButton type="button">Expense history</SecondaryButton>
        </Link>
      }
    >
      <Panel className="max-w-lg">
        <form ref={expenseFormRef} className="space-y-4" onSubmit={onSubmit}>
          <div>
            <FieldLabel>Category</FieldLabel>
            <select
              className={SELECT_CLASS}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}
              required
            >
              <option value="">Select category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <CategoryQuickAdd
            categories={categories}
            onAdded={() => void loadCategories()}
            onCreate={async (name) => {
              const c = await api.createExpenseCategory(name);
              await loadCategories();
              setCategoryId(c.id);
              return c;
            }}
          />
          <div>
            <FieldLabel>Date</FieldLabel>
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <FieldLabel>Amount (Rs)</FieldLabel>
            <TextInput type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <PaymentMethodFields
            kind={paymentKind}
            onKindChange={setPaymentKind}
            accountId={paymentAccountId}
            onAccountChange={setPaymentAccountId}
          />
          <div>
            <FieldLabel>Description (optional)</FieldLabel>
            <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <FieldLabel>Paid to (optional)</FieldLabel>
            <TextInput value={paidTo} onChange={(e) => setPaidTo(e.target.value)} />
          </div>
          <div>
            <FieldLabel>Note (optional)</FieldLabel>
            <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {message ? <Feedback variant="success">{message}</Feedback> : null}
          {error ? <Feedback variant="error">{error}</Feedback> : null}
          <PrimaryButton type="submit" disabled={saving}>{saving ? 'Saving…' : shortcutLabel('Save expense', 'F9')}</PrimaryButton>
        </form>
      </Panel>
    </PageShell>
  );
}

export function ExpensesListPage() {
  const [items, setItems] = useState<ExpenseRecord[]>([]);
  const [fromDate, setFromDate] = useState(firstOfMonthInput());
  const [toDate, setToDate] = useState(todayInput());
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setItems(await api.listExpenses({ fromDate, toDate }));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const total = items.reduce((s, i) => s + i.amount, 0);

  return (
    <PageShell
      title="Expense History"
      actions={
        <Link to="/finance/expenses/new">
          <PrimaryButton type="button">Record expense</PrimaryButton>
        </Link>
      }
    >
      <Panel className="mb-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <FieldLabel>From</FieldLabel>
            <TextInput type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <FieldLabel>To</FieldLabel>
            <TextInput type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="flex items-end">
            <SecondaryButton type="button" onClick={() => void load()} disabled={loading}>
              {loading ? 'Loading…' : 'Apply filter'}
            </SecondaryButton>
          </div>
        </div>
      </Panel>
      <Panel>
        <p className="mb-3 text-sm text-textSecondary">Total: Rs {formatMoney(total)}</p>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-textSecondary">
              <th className="px-2 py-2">Date</th>
              <th className="px-2 py-2">Category</th>
              <th className="px-2 py-2">Description</th>
              <th className="px-2 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className="border-b border-border/60">
                <td className="px-2 py-2">{formatDate(row.date)}</td>
                <td className="px-2 py-2">{row.category.name}</td>
                <td className="px-2 py-2">{row.description}{row.paidTo ? ` · ${row.paidTo}` : ''}</td>
                <td className="px-2 py-2 text-right">{formatMoney(row.amount)}</td>
              </tr>
            ))}
            {!loading && items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-2 py-8 text-center text-textSecondary">No expenses in this period.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Panel>
    </PageShell>
  );
}

export function OtherIncomeEntryPage() {
  const [categories, setCategories] = useState<OtherIncomeCategory[]>([]);
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [date, setDate] = useState(todayInput());
  const [amount, setAmount] = useState('');
  const [paymentKind, setPaymentKind] = useState<SimplePayKind>('CASH');
  const [paymentAccountId, setPaymentAccountId] = useState('');
  const [description, setDescription] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadCategories() {
    setCategories(await api.listOtherIncomeCategories());
  }

  useEffect(() => {
    void loadCategories();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!categoryId) {
      setError('Select a category');
      return;
    }
    if (paymentKind === 'EPAY' && !paymentAccountId) {
      setError('Select an e-payment account');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await api.createOtherIncome({
        categoryId: Number(categoryId),
        date,
        amount: Number(amount),
        paymentMethod: toApiPaymentMethod(paymentKind) as PurchasePaymentMethod,
        description,
        note: note.trim() || null,
        paymentAccountId: paymentAccountId ? Number(paymentAccountId) : undefined,
      });
      setMessage(result.confirmation.message);
      setAmount('');
      setDescription('');
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell
      title="Record Other Income"
      subtitle="Money received outside regular sales"
      actions={
        <Link to="/finance/other-income">
          <SecondaryButton type="button">Income history</SecondaryButton>
        </Link>
      }
    >
      <Panel className="max-w-lg">
        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <FieldLabel>Category</FieldLabel>
            <select
              className={SELECT_CLASS}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}
              required
            >
              <option value="">Select category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <CategoryQuickAdd
            categories={categories}
            onAdded={() => void loadCategories()}
            onCreate={async (name) => {
              const c = await api.createOtherIncomeCategory(name);
              await loadCategories();
              setCategoryId(c.id);
              return c;
            }}
          />
          <div>
            <FieldLabel>Date</FieldLabel>
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <FieldLabel>Amount (Rs)</FieldLabel>
            <TextInput type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <PaymentMethodFields
            kind={paymentKind}
            onKindChange={setPaymentKind}
            accountId={paymentAccountId}
            onAccountChange={setPaymentAccountId}
          />
          <div>
            <FieldLabel>Description (optional)</FieldLabel>
            <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <FieldLabel>Note (optional)</FieldLabel>
            <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {message ? <Feedback variant="success">{message}</Feedback> : null}
          {error ? <Feedback variant="error">{error}</Feedback> : null}
          <PrimaryButton type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save income'}</PrimaryButton>
        </form>
      </Panel>
    </PageShell>
  );
}

export function OtherIncomeListPage() {
  const [items, setItems] = useState<OtherIncomeRecord[]>([]);
  const [fromDate, setFromDate] = useState(firstOfMonthInput());
  const [toDate, setToDate] = useState(todayInput());
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setItems(await api.listOtherIncomes({ fromDate, toDate }));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const total = items.reduce((s, i) => s + i.amount, 0);

  return (
    <PageShell
      title="Other Income History"
      actions={
        <Link to="/finance/other-income/new">
          <PrimaryButton type="button">Record income</PrimaryButton>
        </Link>
      }
    >
      <Panel className="mb-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <FieldLabel>From</FieldLabel>
            <TextInput type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <FieldLabel>To</FieldLabel>
            <TextInput type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="flex items-end">
            <SecondaryButton type="button" onClick={() => void load()} disabled={loading}>
              {loading ? 'Loading…' : 'Apply filter'}
            </SecondaryButton>
          </div>
        </div>
      </Panel>
      <Panel>
        <p className="mb-3 text-sm text-textSecondary">Total: Rs {formatMoney(total)}</p>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-textSecondary">
              <th className="px-2 py-2">Date</th>
              <th className="px-2 py-2">Category</th>
              <th className="px-2 py-2">Description</th>
              <th className="px-2 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className="border-b border-border/60">
                <td className="px-2 py-2">{formatDate(row.date)}</td>
                <td className="px-2 py-2">{row.category.name}</td>
                <td className="px-2 py-2">{row.description}</td>
                <td className="px-2 py-2 text-right">{formatMoney(row.amount)}</td>
              </tr>
            ))}
            {!loading && items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-2 py-8 text-center text-textSecondary">No income in this period.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Panel>
    </PageShell>
  );
}
