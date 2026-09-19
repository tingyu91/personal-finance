import { useEffect, useMemo, useState } from 'react';
import { Amount, Button, CategoryChip, Pill, type AmountKind } from '../ds';
import { formatSGD, monthLabel, sgtToday, shortDate } from '../format';
import { useData, useLoad } from '../data';
import type { DecisionPatch, Meta, TransactionView } from '../api';
import { href, useRoute } from '../router';
import { Page } from './Page';

const MUTED_KINDS = new Set(['transfer', 'card-repayment', 'investment', 'wallet-topup', 'partner-contribution', 'refund']);

export function kindLabel(kind: string, partner = 'your partner'): string {
  return (
    {
      spend: 'Spending',
      income: 'Income',
      transfer: 'Transfer between your accounts',
      'card-repayment': 'Card repayment',
      investment: 'Moved to investments',
      'wallet-topup': 'Wallet top-up',
      refund: 'Refund pair',
      fee: 'Fee',
      tax: 'Tax',
      'partner-contribution': `From ${partner}`,
      unclassified: 'Not sorted yet',
    } as Record<string, string>
  )[kind] ?? kind;
}

const BUCKET_LABEL: Record<string, string> = { purchase: 'Purchase', renovation: 'Renovation', furnishing: 'Furnishing', running: 'Running costs' };

function amountKind(t: TransactionView): AmountKind {
  if (MUTED_KINDS.has(t.kind)) return 'transfer';
  return t.amountCents < 0 ? 'outflow' : 'inflow';
}

/** "1,234.56" or "1234.5" → cents; null if it is not an amount. */
export function parseCents(s: string): number | null {
  const m = /^\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?\s*$/.exec(s.replace(/^S\$/, ''));
  if (!m) return null;
  return Number(m[1]!.replace(/,/g, '')) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
}

function RowEditor({ t, meta, onDone }: { t: TransactionView; meta: Meta; onDone: () => void }) {
  const { api, changed } = useData();
  const [kind, setKind] = useState(t.kind === 'unclassified' ? (t.amountCents < 0 ? 'spend' : 'income') : t.kind);
  const [category, setCategory] = useState(t.category ?? '');
  const [bucket, setBucket] = useState(t.bucket ?? '');
  const [note, setNote] = useState(t.note ?? '');
  const [always, setAlways] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Only spending takes a home project bucket (the server refuses one on fees, tax and the rest).
  const spending = kind === 'spend';
  const categories = kind === 'income' ? meta.incomeCategories : meta.categories.map((c) => c.name);

  async function act(task: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    try {
      await task();
      changed();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="row-editor"
      aria-label={`Sort ${t.payee}`}
      onSubmit={(e) => {
        e.preventDefault();
        const patch: DecisionPatch = {
          kind,
          category: kind === 'spend' || kind === 'income' ? category || null : null,
          // Hidden fields never travel: a bucket only goes with spending.
          bucket: spending ? bucket || null : null,
          note: note.trim() || null,
        };
        void act(() => api.decide(t.fingerprint, patch, always));
      }}
    >
      <div className="field-row">
        <label className="field">
          <span className="ty-label">Kind</span>
          <select
            aria-label="Kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setCategory('');
            }}
          >
            {meta.kinds.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k, meta.partnerName)}
              </option>
            ))}
          </select>
        </label>
        {kind === 'spend' || kind === 'income' ? (
          <label className="field">
            <span className="ty-label">Category</span>
            <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {spending ? (
          <label className="field">
            <span className="ty-label">Home project</span>
            <select aria-label="Home project" value={bucket} onChange={(e) => setBucket(e.target.value)}>
              <option value="">Not the home project</option>
              {meta.buckets.map((b) => (
                <option key={b} value={b}>
                  {BUCKET_LABEL[b] ?? b}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="field field-grow">
          <span className="ty-label">Note</span>
          <input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </label>
      </div>
      <div className="editor-foot">
        {!t.manual ? (
          <label className="check">
            <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} aria-label={`Always do this for ${t.payee}`} />
            Always do this for {t.payee}
          </label>
        ) : (
          <span />
        )}
        <div className="row-actions">
          {t.decided && !t.manual ? (
            <Button disabled={saving} onClick={() => void act(() => api.undo(t.fingerprint))}>
              Undo my decision
            </Button>
          ) : null}
          {t.manual ? (
            <Button disabled={saving} onClick={() => void act(() => api.deleteManual(t.fingerprint))}>
              Delete entry
            </Button>
          ) : null}
          <Button disabled={saving} onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            Save
          </Button>
        </div>
      </div>
      {error ? (
        <p className="notice notice-critical" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function ManualForm({ meta, accounts, onDone }: { meta: Meta; accounts: { id: number; label: string; seenOnly: boolean }[]; onDone: () => void }) {
  const { api, changed } = useData();
  const [date, setDate] = useState(sgtToday());
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [amount, setAmount] = useState('');
  const [payee, setPayee] = useState('');
  const [kind, setKind] = useState('spend');
  const [category, setCategory] = useState('Other');
  const [account, setAccount] = useState('');
  const [bucket, setBucket] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="ty-card section manual"
      aria-label="Add a manual entry"
      onSubmit={async (e) => {
        e.preventDefault();
        const cents = parseCents(amount);
        if (!cents) return setError('Give the amount, like 1,250.00.');
        try {
          await api.addManual({
            date,
            amountCents: direction === 'out' ? -cents : cents,
            payee,
            kind,
            category: kind === 'spend' || kind === 'income' ? category : null,
            accountId: account ? Number(account) : null,
            bucket: bucket || null,
            note: note || null,
          });
          changed();
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }}
    >
      <h2 className="heading">Add a manual entry</h2>
      <p className="section-lead">For cash, cheques, or anything paid outside a statement, such as a renovation deposit.</p>
      <div className="field-row">
        <label className="field">
          <span className="ty-label">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <fieldset className="field segmented">
          <legend className="ty-label">Money</legend>
          <label>
            <input type="radio" name="direction" checked={direction === 'out'} onChange={() => setDirection('out')} /> Out
          </label>
          <label>
            <input type="radio" name="direction" checked={direction === 'in'} onChange={() => setDirection('in')} /> In
          </label>
        </fieldset>
        <label className="field">
          <span className="ty-label">Amount (S$)</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1,250.00" required />
        </label>
        <label className="field field-grow">
          <span className="ty-label">Paid to or from</span>
          <input value={payee} onChange={(e) => setPayee(e.target.value)} required />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span className="ty-label">Kind</span>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setCategory(e.target.value === 'income' ? meta.incomeCategories[0] ?? '' : 'Other');
              if (e.target.value !== 'spend') setBucket('');
            }}
          >
            {meta.kinds
              .filter((k) => k !== 'unclassified')
              .map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k, meta.partnerName)}
                </option>
              ))}
          </select>
        </label>
        {kind === 'spend' || kind === 'income' ? (
          <label className="field">
            <span className="ty-label">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {(kind === 'income' ? meta.incomeCategories : meta.categories.map((c) => c.name)).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="field">
          <span className="ty-label">Account</span>
          <select value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">Cash, or not on a statement</option>
            {accounts
              .filter((a) => !a.seenOnly)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span className="ty-label">Home project</span>
          <select
            value={bucket}
            onChange={(e) => {
              setBucket(e.target.value);
              if (e.target.value && kind === 'spend') setCategory('Home project');
            }}
          >
            <option value="">Not the home project</option>
            {meta.buckets.map((b) => (
              <option key={b} value={b}>
                {BUCKET_LABEL[b] ?? b}
              </option>
            ))}
          </select>
        </label>
        <label className="field field-grow">
          <span className="ty-label">Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </label>
      </div>
      {error ? (
        <p className="notice notice-critical" role="alert">
          {error}
        </p>
      ) : null}
      <div className="row-actions">
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit">Add entry</Button>
      </div>
    </form>
  );
}

const PAGE = 200;

export function Transactions() {
  const route = useRoute();
  const { api, changed } = useData();
  const p = route.params;
  const filters = useMemo(
    () => ({
      month: p.get('month') ?? '',
      account: p.get('account') ?? '',
      category: p.get('category') ?? '',
      kind: p.get('kind') ?? '',
      review: p.get('review') === '1',
      q: p.get('q') ?? '',
    }),
    [p],
  );
  const [limit, setLimit] = useState(PAGE);
  const [search, setSearch] = useState(filters.q);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkBucket, setBulkBucket] = useState('');

  const meta = useLoad((a) => a.meta(), []);
  const accounts = useLoad((a) => a.accounts(), []);
  const key = JSON.stringify(filters);
  const ledger = useLoad((a) => a.transactions({ ...filters, limit }), [key, limit]);

  useEffect(() => {
    setSelected(new Set());
    setLimit(PAGE);
  }, [key]);
  useEffect(() => setSearch(filters.q), [filters.q]);

  const setFilter = (name: string, value: string | boolean) => {
    const next: Record<string, string | undefined> = { ...filters, review: filters.review ? '1' : undefined };
    next[name] = value === true ? '1' : value === false ? undefined : value || undefined;
    window.location.hash = href('transactions', next);
  };

  const [bulkError, setBulkError] = useState<string | null>(null);
  async function bulk(patch: DecisionPatch) {
    setBulkError(null);
    try {
      await api.bulk([...selected], patch);
      setSelected(new Set());
      changed();
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : String(e));
    }
  }

  const rows = ledger.data?.rows ?? [];
  const m = meta.data;

  return (
    <Page
      title="Transactions"
      actions={
        <Button variant="primary" onClick={() => setAdding(true)}>
          Add manual entry
        </Button>
      }
    >
      {m && !m.aliasesSet ? (
        <p className="notice notice-watch">
          Tally does not know your name yet, so it cannot tell a transfer to yourself from a payment to someone else. Add your name as your
          bank prints it to the settings file in your data folder (data/rules/settings.json), then rebuild from the vault.
        </p>
      ) : null}
      {adding && m ? <ManualForm meta={m} accounts={accounts.data?.accounts ?? []} onDone={() => setAdding(false)} /> : null}

      <div className="filters" role="search">
        <label className="field">
          <span className="ty-label">Month</span>
          <select value={filters.month} onChange={(e) => setFilter('month', e.target.value)}>
            <option value="">All months</option>
            {(m?.months ?? []).map((mo) => (
              <option key={mo} value={mo}>
                {monthLabel(mo)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="ty-label">Account</span>
          <select value={filters.account} onChange={(e) => setFilter('account', e.target.value)}>
            <option value="">All accounts</option>
            {(accounts.data?.accounts ?? [])
              .filter((a) => !a.seenOnly)
              .map((a) => (
                <option key={a.id} value={String(a.id)}>
                  {a.label}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span className="ty-label">Category</span>
          <select value={filters.category} onChange={(e) => setFilter('category', e.target.value)}>
            <option value="">All categories</option>
            {[...(m?.categories.map((c) => c.name) ?? []), ...(m?.incomeCategories ?? [])].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="ty-label">Kind</span>
          <select value={filters.kind} onChange={(e) => setFilter('kind', e.target.value)}>
            <option value="">All kinds</option>
            {(m?.kinds ?? []).map((k) => (
              <option key={k} value={k}>
                {kindLabel(k, m?.partnerName)}
              </option>
            ))}
          </select>
        </label>
        <label className="check check-field">
          <input type="checkbox" aria-label="Review only" checked={filters.review} onChange={(e) => setFilter('review', e.target.checked)} />
          Review only
        </label>
        <form
          className="field field-grow"
          onSubmit={(e) => {
            e.preventDefault();
            setFilter('q', search.trim());
          }}
        >
          <label className="field">
            <span className="ty-label">Search</span>
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Payee, statement text or note" />
          </label>
        </form>
      </div>

      <div className="ledger-summary">
        <span>
          {ledger.data ? `${ledger.data.total} ${ledger.data.total === 1 ? 'transaction' : 'transactions'}` : 'Loading…'}
          {ledger.data ? ` · ${formatSGD(ledger.data.outCents)} out · ${formatSGD(ledger.data.inCents)} in` : ''}
          {ledger.data?.notCounted
            ? `. ${ledger.data.notCounted} ${ledger.data.notCounted === 1 ? 'row is' : 'rows are'} left out of these sums: held until its statement adds up, or in another currency.`
            : ''}
        </span>
        {!filters.review ? (
          <a className="ty-link" href={href('transactions', { month: filters.month || undefined, review: '1' })}>
            Show only rows to review
          </a>
        ) : null}
      </div>

      {selected.size ? (
        <div className="bulk-bar" role="toolbar" aria-label="Change selected rows">
          <strong>{selected.size} selected</strong>
          <select aria-label="Category for selected rows" value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)}>
            <option value="">Set category…</option>
            {(m?.categories ?? []).map((c) => (
              <option key={c.name}>{c.name}</option>
            ))}
          </select>
          <Button disabled={!bulkCategory} onClick={() => void bulk({ kind: 'spend', category: bulkCategory })}>
            Apply category
          </Button>
          <Button onClick={() => void bulk({ kind: 'transfer', category: null })}>Mark as transfer</Button>
          <select aria-label="Home project bucket for selected rows" value={bulkBucket} onChange={(e) => setBulkBucket(e.target.value)}>
            <option value="">Home project…</option>
            {(m?.buckets ?? []).map((b) => (
              <option key={b} value={b}>
                {BUCKET_LABEL[b] ?? b}
              </option>
            ))}
          </select>
          <Button disabled={!bulkBucket} onClick={() => void bulk({ kind: 'spend', category: 'Home project', bucket: bulkBucket })}>
            Tag to home project
          </Button>
          <Button onClick={() => setSelected(new Set())}>Clear selection</Button>
        </div>
      ) : null}
      {bulkError ? (
        <p className="notice notice-critical" role="alert">
          {bulkError} Nothing was changed.
        </p>
      ) : null}

      {ledger.error ? (
        <p className="notice notice-critical" role="alert">
          {ledger.error}
        </p>
      ) : null}

      {rows.length ? (
        <div className={`ty-txns ledger${ledger.loading ? ' is-loading' : ''}`} role="list" aria-label="Transactions">
          {rows.map((t) => {
            const open = editing === t.fingerprint;
            const flagPill = t.held ? (
              <span className="ty-pill ty-pill-critical">Held</span>
            ) : t.kind === 'unclassified' || t.needsReview ? (
              <Pill flag="review" />
            ) : t.kind === 'refund' ? (
              <Pill flag="refund" />
            ) : MUTED_KINDS.has(t.kind) ? (
              <Pill flag="transfer" label={kindLabel(t.kind, m?.partnerName)} />
            ) : t.category === 'Home project' || t.bucket ? (
              <Pill flag="project" />
            ) : null;
            const raw = [t.raw, t.fx ? `${t.fx.currency} ${formatSGD(t.fx.amountCents, { currency: '' })}` : null, t.targetAccount ? `to ${t.targetAccount}` : null]
              .filter(Boolean)
              .join(' · ');
            return (
              <div key={t.fingerprint} className={`ledger-item${open ? ' is-open' : ''}`} role="listitem">
                <span className="ledger-check">
                  <input
                    type="checkbox"
                    aria-label={`Select ${t.payee}`}
                    checked={selected.has(t.fingerprint)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(t.fingerprint);
                      else next.delete(t.fingerprint);
                      setSelected(next);
                    }}
                  />
                </span>
                <div
                  className="ty-txn"
                  role="button"
                  tabIndex={0}
                  aria-label={`${shortDate(t.date)}, ${t.payee}, ${formatSGD(t.amountCents)}${t.amountCents < 0 ? ' out' : ' in'}. Open to sort it.`}
                  aria-expanded={open}
                  onClick={() => setEditing(open ? null : t.fingerprint)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setEditing(open ? null : t.fingerprint);
                    }
                  }}
                >
                  <span className="ty-txn-date">
                    {shortDate(t.date)}
                  </span>
                  <span className="ty-txn-main">
                    <span className="ty-txn-payee">
                      {t.payee}
                      {flagPill}
                    </span>
                    <span className="ty-raw" title={raw}>
                      {raw}
                    </span>
                  </span>
                  <span className="ty-txn-meta">
                    {t.category ? <CategoryChip name={t.category} slot={t.slot} /> : null}
                    {t.account ? <span className="ty-raw">{t.cardholder ? `${t.account} · ${t.cardholder}` : t.account}</span> : <span className="ty-raw">Manual</span>}
                  </span>
                  <span>
                    <Amount cents={t.amountCents} kind={amountKind(t)} />
                  </span>
                </div>
                {open && m ? <RowEditor t={t} meta={m} onDone={() => setEditing(null)} /> : null}
              </div>
            );
          })}
        </div>
      ) : ledger.data ? (
        <section className="ty-card empty">
          <h2 className="heading">{filters.review ? 'Nothing to review here' : 'No transactions match'}</h2>
          <p>{filters.review ? 'Every row in this view is sorted.' : 'Try another month or clear the filters.'}</p>
        </section>
      ) : null}

      {ledger.data && rows.length < ledger.data.total ? (
        <div>
          <Button onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, ledger.data.total - rows.length)} more</Button>
        </div>
      ) : null}
    </Page>
  );
}
