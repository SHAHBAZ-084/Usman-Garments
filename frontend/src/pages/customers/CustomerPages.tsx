import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  api,
  type Customer,
  type CustomerDetail,
  type PurchasePaymentMethod,
} from '../../lib/api';
import { formatDate, formatMoney } from '../../lib/format';
import { printCustomerStatement } from '../../components/customers/CustomerStatementPrint';
import { HandCoins, Pencil, Plus, Printer } from 'lucide-react';
import {
  DangerButton,
  Feedback,
  FieldLabel,
  PageShell,
  Panel,
  PrimaryButton,
  SecondaryButton,
  TextInput,
} from '../../components/ui/PageShell';
import { PaymentBankAccountSelect } from '../../components/ui/PaymentBankAccountSelect';

const PAYMENT_METHODS: { value: PurchasePaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card' },
  { value: 'EASYPAISA', label: 'Easypaisa' },
  { value: 'JAZZCASH', label: 'JazzCash' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
];

function todayInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function CustomersListPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      setCustomers(await api.listCustomers({ search: search.trim() || undefined, activeOnly }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [activeOnly]);

  return (
    <PageShell
      title="Customers"
      subtitle="Who buys on udhaar — balances show what they still owe you"
      actions={
        <Link to="/customers/add">
          <PrimaryButton type="button"><Plus className="mr-1.5 inline h-4 w-4" aria-hidden />Add Customer</PrimaryButton>
        </Link>
      }
    >
      <Panel className="mb-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <FieldLabel>Search</FieldLabel>
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or phone"
            />
          </div>
          <div>
            <FieldLabel>Status</FieldLabel>
            <select
              className="w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
              value={activeOnly ? 'active' : 'all'}
              onChange={(e) => setActiveOnly(e.target.value === 'active')}
            >
              <option value="active">Active only</option>
              <option value="all">Include inactive</option>
            </select>
          </div>
        </div>
        <div className="mt-4">
          <SecondaryButton type="button" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </SecondaryButton>
        </div>
      </Panel>

      {error ? <Feedback variant="error" className="mb-4">{error}</Feedback> : null}

      <Panel>
        <table className="app-data-table min-w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-textSecondary">
              <th className="px-2 py-2 font-medium">Name</th>
              <th className="px-2 py-2 font-medium">Phone</th>
              <th className="px-2 py-2 font-medium text-right">Amount owed</th>
              <th className="px-2 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="border-b border-border/60 hover:bg-surface1">
                <td className="px-2 py-2">
                  <Link className="font-medium text-accent hover:underline" to={`/customers/${c.id}`}>
                    {c.name}
                  </Link>
                </td>
                <td className="px-2 py-2">{c.phone || '—'}</td>
                <td className="px-2 py-2 text-right text-success">Rs {formatMoney(c.receivable)}</td>
                <td className="px-2 py-2">{c.isActive ? 'Active' : 'Inactive'}</td>
              </tr>
            ))}
            {!loading && customers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-2 py-8 text-center text-textSecondary">
                  No customers yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Panel>
    </PageShell>
  );
}

export function CustomerFormPage({ mode }: { mode: 'add' | 'edit' }) {
  const navigate = useNavigate();
  const params = useParams();
  const id = mode === 'edit' ? Number(params.id) : null;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode !== 'edit' || !id) return;
    api
      .getCustomer(id)
      .then((d) => {
        setName(d.customer.name);
        setPhone(d.customer.phone);
        setAddress(d.customer.address ?? '');
        setNotes(d.customer.notes ?? '');
        setIsActive(d.customer.isActive);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'));
  }, [mode, id]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'add') {
        const created = await api.createCustomer({
          name,
          phone,
          address: address.trim() || null,
          notes: notes.trim() || null,
        });
        navigate(`/customers/${created.id}`);
      } else if (id) {
        await api.updateCustomer(id, {
          name,
          phone,
          address: address.trim() || null,
          notes: notes.trim() || null,
          isActive,
        });
        setMessage('Customer updated.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell
      title={mode === 'add' ? 'Add Customer' : 'Edit Customer'}
      subtitle={mode === 'add' ? 'For udhaar sales and payment tracking' : 'Update customer details'}
      actions={
        <Link to="/customers">
          <SecondaryButton type="button">Back to list</SecondaryButton>
        </Link>
      }
    >
      <Panel className="max-w-lg">
        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <FieldLabel>Name</FieldLabel>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <FieldLabel>Phone</FieldLabel>
            <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <FieldLabel>Address (optional)</FieldLabel>
            <TextInput value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div>
            <FieldLabel>Notes (optional)</FieldLabel>
            <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {mode === 'edit' ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Active
            </label>
          ) : null}
          {message ? <Feedback variant="success">{message}</Feedback> : null}
          {error ? <Feedback variant="error">{error}</Feedback> : null}
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? 'Saving…' : mode === 'add' ? 'Create Customer' : 'Save Changes'}
          </PrimaryButton>
        </form>
      </Panel>
    </PageShell>
  );
}

export function CustomerDetailPage() {
  const params = useParams();
  const id = Number(params.id);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(false);

  async function load() {
    try {
      setDetail(await api.getCustomer(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function onDeactivate() {
    if (!window.confirm('Deactivate this customer?')) return;
    try {
      await api.deactivateCustomer(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  async function onPrintStatement() {
    setPrinting(true);
    try {
      const [statement, settings] = await Promise.all([
        api.getCustomerStatement(id),
        api.getSettings(),
      ]);
      printCustomerStatement(statement, settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to print statement');
    } finally {
      setPrinting(false);
    }
  }

  if (!detail && !error) {
    return (
      <PageShell title="Customer">
        <p className="text-sm text-textSecondary">Loading…</p>
      </PageShell>
    );
  }

  if (!detail) {
    return (
      <PageShell title="Customer">
        <Feedback variant="error">{error}</Feedback>
      </PageShell>
    );
  }

  const { customer, invoices, payments, returns } = detail;

  return (
    <PageShell
      title={customer.name}
      subtitle={customer.phone || 'No phone'}
      actions={
        <div className="flex flex-wrap gap-2">
          <Link to="/customers">
            <SecondaryButton type="button">Back</SecondaryButton>
          </Link>
          <Link to={`/customers/${id}/edit`}>
            <SecondaryButton type="button"><Pencil className="mr-1.5 inline h-4 w-4" aria-hidden />Edit</SecondaryButton>
          </Link>
          <Link to={`/customers/pay?customerId=${id}`}>
            <PrimaryButton type="button"><HandCoins className="mr-1.5 inline h-4 w-4" aria-hidden />Record Payment</PrimaryButton>
          </Link>
          <SecondaryButton type="button" onClick={() => void onPrintStatement()} disabled={printing}>
            <Printer className="mr-1.5 inline h-4 w-4" aria-hidden />
            {printing ? 'Preparing…' : 'Print Statement'}
          </SecondaryButton>
          {customer.isActive ? (
            <DangerButton type="button" onClick={() => void onDeactivate()}>
              Deactivate
            </DangerButton>
          ) : null}
        </div>
      }
    >
      {error ? <Feedback variant="error" className="mb-4">{error}</Feedback> : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Panel>
          <p className="text-xs text-textSecondary">Customer owes</p>
          <p className="mt-1 text-2xl font-semibold text-success">Rs {formatMoney(customer.receivable)}</p>
        </Panel>
        <Panel>
          <p className="text-xs text-textSecondary">Address</p>
          <p className="mt-1 text-sm">{customer.address || '—'}</p>
        </Panel>
        <Panel>
          <p className="text-xs text-textSecondary">Notes</p>
          <p className="mt-1 text-sm">{customer.notes || '—'}</p>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <h2 className="mb-3 text-lg font-semibold">Purchase history</h2>
          <table className="app-data-table min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-textSecondary">
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2 text-right">Total</th>
                <th className="px-2 py-2 text-right">Still owed</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-border/60">
                  <td className="px-2 py-2">
                    <Link className="text-accent hover:underline" to={`/sales/${inv.id}`}>
                      {inv.invoiceNumber} · {formatDate(inv.date)}
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-right">{formatMoney(inv.totalAmount)}</td>
                  <td className="px-2 py-2 text-right">{formatMoney(inv.remainingAmount)}</td>
                </tr>
              ))}
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-2 py-6 text-center text-textSecondary">
                    No invoices yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Panel>

        <Panel>
          <h2 className="mb-3 text-lg font-semibold">Payment history</h2>
          <table className="app-data-table min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-textSecondary">
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">Method</th>
                <th className="px-2 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-border/60">
                  <td className="px-2 py-2">{formatDate(p.date)}</td>
                  <td className="px-2 py-2">{p.paymentMethod.replace('_', ' ')}</td>
                  <td className="px-2 py-2 text-right">{formatMoney(p.amount)}</td>
                </tr>
              ))}
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-2 py-6 text-center text-textSecondary">
                    No payments yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">Return history</h2>
        <table className="app-data-table min-w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-textSecondary">
              <th className="px-2 py-2">Date / Invoice</th>
              <th className="px-2 py-2 text-right">Amount</th>
              <th className="px-2 py-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {returns.map((r) => (
              <tr key={r.id} className="border-b border-border/60">
                <td className="px-2 py-2">
                  {formatDate(r.date)} · {r.invoiceNumber}
                </td>
                <td className="px-2 py-2 text-right">{formatMoney(r.amount)}</td>
                <td className="px-2 py-2">{r.note || '—'}</td>
              </tr>
            ))}
            {returns.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-2 py-6 text-center text-textSecondary">
                  No returns yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Panel>
    </PageShell>
  );
}

export function CustomerPaymentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<number | ''>(
    searchParams.get('customerId') ? Number(searchParams.get('customerId')) : '',
  );
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PurchasePaymentMethod>('CASH');
  const [paymentAccountId, setPaymentAccountId] = useState('');
  const [date, setDate] = useState(todayInput());
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.listCustomers().then(setCustomers).catch(() => setCustomers([]));
  }, []);

  const selected = customers.find((c) => c.id === customerId);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!customerId) {
      setError('Select a customer');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await api.createCustomerPayment({
        customerId: Number(customerId),
        amount: Number(amount),
        paymentMethod,
        date,
        note: note.trim() || null,
        paymentAccountId: paymentAccountId ? Number(paymentAccountId) : undefined,
      });
      setMessage(result.confirmation.message);
      setAmount('');
      setCustomers(await api.listCustomers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell
      title="Receive Customer Payment"
      subtitle="Reduce udhaar balance — recorded against the customer account"
      actions={
        <SecondaryButton type="button" onClick={() => navigate(-1)}>Back</SecondaryButton>
      }
    >
      <Panel className="max-w-lg">
        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <FieldLabel>Customer</FieldLabel>
            <select
              className="w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : '')}
              required
            >
              <option value="">Select customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — owes Rs {formatMoney(c.receivable)}
                </option>
              ))}
            </select>
          </div>
          {selected ? (
            <p className="text-sm text-textSecondary">
              Customer owes: <strong>Rs {formatMoney(selected.receivable)}</strong>
            </p>
          ) : null}
          <div>
            <FieldLabel>Amount</FieldLabel>
            <TextInput
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div>
            <FieldLabel>Payment method</FieldLabel>
            <select
              className="w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PurchasePaymentMethod)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <PaymentBankAccountSelect
            paymentMethod={paymentMethod}
            value={paymentAccountId}
            onChange={setPaymentAccountId}
          />
          <div>
            <FieldLabel>Date</FieldLabel>
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <FieldLabel>Note (optional)</FieldLabel>
            <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {message ? <Feedback variant="success">{message}</Feedback> : null}
          {error ? <Feedback variant="error">{error}</Feedback> : null}
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Record Payment'}
          </PrimaryButton>
        </form>
      </Panel>
    </PageShell>
  );
}
