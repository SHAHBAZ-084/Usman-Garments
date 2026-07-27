import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Supplier, type SupplierDetail } from '../../lib/api';
import { formatDate, formatMoney } from '../../lib/format';
import {
  DangerButton,
  FieldLabel,
  PageShell,
  Panel,
  PrimaryButton,
  SecondaryButton,
  TextInput,
} from '../../components/ui/PageShell';

export function SuppliersListPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      setSuppliers(await api.listSuppliers({ search: search.trim() || undefined, activeOnly }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load suppliers');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [activeOnly]);

  return (
    <PageShell
      title="Suppliers"
      subtitle="Who you buy from — balances show what you still owe"
      actions={
        <Link to="/suppliers/add">
          <PrimaryButton type="button">Add Supplier</PrimaryButton>
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

      {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}

      <Panel>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-textSecondary">
              <th className="px-2 py-2 font-medium">Name</th>
              <th className="px-2 py-2 font-medium">Phone</th>
              <th className="px-2 py-2 font-medium text-right">Amount owed</th>
              <th className="px-2 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id} className="border-b border-border/60 hover:bg-surface1">
                <td className="px-2 py-2">
                  <Link className="font-medium text-accent hover:underline" to={`/suppliers/${s.id}`}>
                    {s.name}
                  </Link>
                </td>
                <td className="px-2 py-2">{s.phone || '—'}</td>
                <td className="px-2 py-2 text-right">Rs {formatMoney(s.payable)}</td>
                <td className="px-2 py-2">{s.isActive ? 'Active' : 'Inactive'}</td>
              </tr>
            ))}
            {!loading && suppliers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-2 py-8 text-center text-textSecondary">
                  No suppliers yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Panel>
    </PageShell>
  );
}

export function SupplierFormPage({ mode }: { mode: 'add' | 'edit' }) {
  const navigate = useNavigate();
  const params = useParams();
  const id = mode === 'edit' ? Number(params.id) : null;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode !== 'edit' || !id) return;
    api
      .getSupplier(id)
      .then((d) => {
        setName(d.supplier.name);
        setPhone(d.supplier.phone);
        setAddress(d.supplier.address ?? '');
        setNotes(d.supplier.notes ?? '');
        setIsActive(d.supplier.isActive);
        setOpeningBalance(String(d.supplier.openingBalance));
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
        const created = await api.createSupplier({
          name,
          phone,
          address: address.trim() || null,
          openingBalance: openingBalance.trim() ? Number(openingBalance) : 0,
          notes: notes.trim() || null,
        });
        navigate(`/suppliers/${created.id}`);
      } else if (id) {
        await api.updateSupplier(id, {
          name,
          phone,
          address: address.trim() || null,
          notes: notes.trim() || null,
          isActive,
        });
        setMessage('Supplier updated.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell
      title={mode === 'add' ? 'Add Supplier' : 'Edit Supplier'}
      subtitle={mode === 'add' ? 'Opening balance is what you already owed them' : 'Update supplier details'}
      actions={
        <Link to="/suppliers">
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
          {mode === 'add' ? (
            <div>
              <FieldLabel>Opening balance owed (optional)</FieldLabel>
              <TextInput
                type="number"
                min="0"
                step="0.01"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                placeholder="0"
              />
            </div>
          ) : (
            <div>
              <FieldLabel>Opening balance (set at create)</FieldLabel>
              <TextInput value={openingBalance} readOnly className="bg-surface1" />
            </div>
          )}
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
          {message ? <p className="text-sm text-accent">{message}</p> : null}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? 'Saving…' : mode === 'add' ? 'Create Supplier' : 'Save Changes'}
          </PrimaryButton>
        </form>
      </Panel>
    </PageShell>
  );
}

export function SupplierDetailPage() {
  const params = useParams();
  const id = Number(params.id);
  const [detail, setDetail] = useState<SupplierDetail | null>(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      setDetail(await api.getSupplier(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function onDeactivate() {
    if (!window.confirm('Deactivate this supplier?')) return;
    try {
      await api.deactivateSupplier(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  if (!detail && !error) {
    return (
      <PageShell title="Supplier">
        <p className="text-sm text-textSecondary">Loading…</p>
      </PageShell>
    );
  }

  if (!detail) {
    return (
      <PageShell title="Supplier">
        <p className="text-sm text-danger">{error}</p>
      </PageShell>
    );
  }

  const { supplier, purchases, payments } = detail;

  return (
    <PageShell
      title={supplier.name}
      subtitle={supplier.phone || 'No phone'}
      actions={
        <div className="flex flex-wrap gap-2">
          <Link to="/suppliers">
            <SecondaryButton type="button">Back</SecondaryButton>
          </Link>
          <Link to={`/suppliers/${id}/edit`}>
            <SecondaryButton type="button">Edit</SecondaryButton>
          </Link>
          <Link to={`/purchases/new?supplierId=${id}`}>
            <PrimaryButton type="button">New Purchase</PrimaryButton>
          </Link>
          <Link to={`/purchases/pay?supplierId=${id}`}>
            <SecondaryButton type="button">Record Payment</SecondaryButton>
          </Link>
          {supplier.isActive ? (
            <DangerButton type="button" onClick={() => void onDeactivate()}>
              Deactivate
            </DangerButton>
          ) : null}
        </div>
      }
    >
      {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Panel>
          <p className="text-xs text-textSecondary">Amount you owe</p>
          <p className="mt-1 text-2xl font-semibold text-textPrimary">Rs {formatMoney(supplier.payable)}</p>
        </Panel>
        <Panel>
          <p className="text-xs text-textSecondary">Opening balance</p>
          <p className="mt-1 text-lg font-medium">Rs {formatMoney(supplier.openingBalance)}</p>
        </Panel>
        <Panel>
          <p className="text-xs text-textSecondary">Address</p>
          <p className="mt-1 text-sm">{supplier.address || '—'}</p>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <h2 className="mb-3 text-lg font-semibold">Purchase history</h2>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-textSecondary">
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2 text-right">Total</th>
                <th className="px-2 py-2 text-right">Still owed</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id} className="border-b border-border/60">
                  <td className="px-2 py-2">
                    <Link className="text-accent hover:underline" to={`/purchases/${p.id}`}>
                      {formatDate(p.date)}
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-right">{formatMoney(p.totalAmount)}</td>
                  <td className="px-2 py-2 text-right">{formatMoney(p.remainingAmount)}</td>
                </tr>
              ))}
              {purchases.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-2 py-6 text-center text-textSecondary">
                    No purchases yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Panel>

        <Panel>
          <h2 className="mb-3 text-lg font-semibold">Payment history</h2>
          <table className="min-w-full text-sm">
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
    </PageShell>
  );
}
