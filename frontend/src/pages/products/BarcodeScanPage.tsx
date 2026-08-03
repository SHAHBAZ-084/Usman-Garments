import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type BarcodeLookupResult } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { FieldLabel, PageShell, Panel, PrimaryButton, SecondaryButton, TextInput } from '../../components/ui/PageShell';

/**
 * USB barcode scanners type characters quickly and send Enter.
 * This field is the Phase 7 POS cart-scan primitive — keep Enter → by-barcode lookup.
 */
export function BarcodeScanField({
  onMatch,
  autoFocus = true,
  onReadyFocus,
}: {
  onMatch?: (result: BarcodeLookupResult) => void;
  autoFocus?: boolean;
  /** Expose focus() so parent can return focus after cart updates. */
  onReadyFocus?: (focus: () => void) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<BarcodeLookupResult | null>(null);
  const lastSubmitRef = useRef<{ barcode: string; at: number } | null>(null);

  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    onReadyFocus?.(focus);
  }, [onReadyFocus]);

  async function lookup(raw: string) {
    // Match printed CODE128 value; scanners may append CR/LF or spaces.
    const barcode = raw.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, '').trim();
    if (!barcode) return;

    const now = Date.now();
    const last = lastSubmitRef.current;
    // One physical scan must not fire twice (Enter + duplicate submit).
    if (last && last.barcode === barcode && now - last.at < 400) {
      setValue('');
      inputRef.current?.focus();
      return;
    }
    lastSubmitRef.current = { barcode, at: now };

    setBusy(true);
    setError('');
    setResult(null);
    try {
      const match = await api.getProductByBarcode(barcode);
      setResult(match);
      onMatch?.(match);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lookup failed';
      setError(/not found|no product/i.test(message) ? 'Not found — no product matches this barcode.' : message);
    } finally {
      setBusy(false);
      setValue('');
      // Keep scanning fast: always return focus to the input.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void lookup(value);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <FieldLabel>Scan barcode</FieldLabel>
          <TextInput
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Click here, then scan (or type + Enter)"
            autoFocus={autoFocus}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        </div>
        <PrimaryButton type="submit" disabled={busy || !value.trim()}>
          {busy ? 'Looking up…' : 'Look up'}
        </PrimaryButton>
      </form>

      {error ? <p className="rounded-lg border border-danger/40 bg-bgDanger px-3 py-2 text-sm text-danger">{error}</p> : null}

      {result ? (
        <div className="rounded-lg border border-border bg-surface1 p-4">
          <p className="text-xs uppercase tracking-wide text-textSecondary">
            Matched {result.matchType === 'variant' ? 'variant' : 'product'}
          </p>
          <p className="mt-1 text-lg font-semibold text-textPrimary">{result.product.name}</p>
          {result.variant ? (
            <p className="mt-1 text-sm text-textSecondary">
              {[result.variant.size, result.variant.colour].filter(Boolean).join(' / ') || 'Variant'}
              {' · '}Rs {formatMoney(result.variant.salePrice ?? result.product.salePrice)}
              {' · '}Stock {result.variant.currentStock}
            </p>
          ) : (
            <p className="mt-1 text-sm text-textSecondary">
              Rs {formatMoney(result.product.salePrice)} · Stock {result.product.currentStock}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function BarcodeScanPage() {
  return (
    <PageShell title="Scan barcode" subtitle="Look up a product by scanning its barcode">
      <Panel>
        <BarcodeScanField />
        <p className="mt-4 text-sm text-textSecondary">
          Prefer scanning from <Link className="text-accent underline" to="/sales/new">New Sale</Link> to add items to
          the cart.
        </p>
        <div className="mt-4">
          <Link to="/products/list">
            <SecondaryButton type="button">Back to products</SecondaryButton>
          </Link>
        </div>
      </Panel>
    </PageShell>
  );
}
