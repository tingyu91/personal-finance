import { Fragment, useState } from 'react';
import { Amount, Button } from '../ds';
import { CumulativeLine } from '../charts/CumulativeLine';
import { useData, useLoad } from '../data';
import { formatSGD, longDate, monthLabel, percent } from '../format';
import { href } from '../router';
import type { HomeData } from '../api';
import { Empty, Page } from './Page';

export const BUCKET_LABEL: Record<string, string> = { purchase: 'Purchase', renovation: 'Renovation', furnishing: 'Furnishing', running: 'Running costs' };

/** "S$1,250.00" → 125000; blank → null; anything else (1,2,3 or 12.345) → NaN. */
export function parseCents(s: string): number | null {
  const t = s.trim().replace(/^S\$\s*/i, '');
  if (!t) return null;
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(t)) return NaN;
  const [whole, frac = ''] = t.replace(/,/g, '').split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

function period(p: HomeData['project']): string {
  const from = p.startSet ? monthLabel(p.startMonth) : `${monthLabel(p.startMonth)} (your first statement)`;
  return p.endMonth ? `from ${from} to ${monthLabel(p.endMonth)}` : `from ${from}, with no end set`;
}

function ProjectForm({ project, onDone }: { project: HomeData['project']; onDone: () => void }) {
  const { api, changed } = useData();
  const [start, setStart] = useState(project.startMonth);
  const [end, setEnd] = useState(project.endMonth ?? '');
  const [budget, setBudget] = useState(project.budgetCents ? (project.budgetCents / 100).toFixed(2) : '');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="row-editor project-form"
      aria-label="Project period and budget"
      onSubmit={async (e) => {
        e.preventDefault();
        const cents = parseCents(budget);
        if (Number.isNaN(cents)) return setError('Give the budget as an amount, like 60,000.');
        try {
          await api.updateHome({ startMonth: start, endMonth: end || null, budgetCents: cents });
          changed();
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }}
    >
      <div className="field-row">
        <label className="field">
          <span className="ty-label">Starts</span>
          <input type="month" value={start} onChange={(e) => setStart(e.target.value)} required />
        </label>
        <label className="field">
          <span className="ty-label">Ends</span>
          <input type="month" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="field">
          <span className="ty-label">Budget (S$)</span>
          <input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Optional" />
        </label>
      </div>
      {error ? (
        <p className="notice notice-critical" role="alert">
          {error}
        </p>
      ) : null}
      <div className="row-actions">
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}

function VendorForm({ vendor, onDone }: { vendor?: HomeData['vendors'][number]; onDone: () => void }) {
  const { api, changed } = useData();
  const [name, setName] = useState(vendor?.name ?? '');
  const [match, setMatch] = useState(vendor?.match ?? '');
  const [contract, setContract] = useState(vendor?.contractCents ? (vendor.contractCents / 100).toFixed(2) : '');
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  return (
    <form
      className="row-editor"
      aria-label={vendor?.id ? `Edit ${vendor.name}` : 'Add a vendor'}
      onSubmit={async (e) => {
        e.preventDefault();
        const cents = parseCents(contract);
        if (Number.isNaN(cents)) return setError('Give the contract sum as an amount, like 20,000.');
        const body = { name, match: match || name, contractCents: cents };
        try {
          if (vendor?.id) await api.updateVendor(vendor.id, body);
          else await api.addVendor(body);
          changed();
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }}
    >
      <div className="field-row">
        <label className="field field-grow">
          <span className="ty-label">Vendor</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="field field-grow">
          <span className="ty-label">Text on the statement</span>
          <input value={match} onChange={(e) => setMatch(e.target.value)} placeholder="Same as the name" />
        </label>
        <label className="field">
          <span className="ty-label">Contract sum (S$)</span>
          <input inputMode="decimal" value={contract} onChange={(e) => setContract(e.target.value)} placeholder="Optional" />
        </label>
      </div>
      {error ? (
        <p className="notice notice-critical" role="alert">
          {error}
        </p>
      ) : null}
      <div className="row-actions">
        {vendor?.id ? (
          confirmRemove ? (
            <Button
              onClick={async () => {
                try {
                  await api.deleteVendor(vendor.id!);
                  changed();
                  onDone();
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
            >
              Remove {vendor.name}; its payments stay
            </Button>
          ) : (
            <Button onClick={() => setConfirmRemove(true)}>Remove vendor</Button>
          )
        ) : null}
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit">{vendor?.id ? 'Save' : 'Add vendor'}</Button>
      </div>
    </form>
  );
}

export function HomeProject() {
  const { api } = useData();
  const res = useLoad((a) => a.home(), []);
  const [editingProject, setEditingProject] = useState(false);
  const [vendorForm, setVendorForm] = useState<string | null>(null);
  const [exported, setExported] = useState<{ ok: boolean; text: string } | null>(null);

  async function exportCsv() {
    setExported(null);
    try {
      const { blob, name, saved } = await api.exportHome();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExported({
        ok: saved,
        text: saved
          ? `Downloaded ${name}. A copy is in outputs/exports.`
          : `Downloaded ${name}. The copy in outputs/exports could not be saved; if it is open in Excel, close it and export again.`,
      });
    } catch (err) {
      setExported({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  }

  if (res.error && !res.data) {
    return (
      <Page title="Home project">
        <p className="notice notice-critical" role="alert">
          Could not load the home project: {res.error}
        </p>
      </Page>
    );
  }
  if (!res.data) return <Page title="Home project" />;
  const h = res.data;
  const exportButton = (
    <Button variant="primary" onClick={() => void exportCsv()}>
      Export CSV
    </Button>
  );

  if (!h.rows.length && !h.unsortedLarge.count && !h.unseen.cents) {
    return (
      <Page title="Home project">
        <Empty heading="Nothing tagged to the home yet">
          <p>Tag payments on Transactions with a home project bucket (purchase, renovation, furnishing or running costs), and they add up here.</p>
          <p>
            <a className="ty-link" href={href('transactions')}>
              Go to Transactions
            </a>
          </p>
        </Empty>
      </Page>
    );
  }

  const budget = h.project.budgetCents;
  const needsBucket = h.buckets.find((b) => b.bucket === null);

  return (
    <Page title="Home project" actions={exportButton}>
      {exported ? (
        <p className={`notice ${exported.ok ? 'notice-watch' : 'notice-critical'}`} role="status">
          {exported.text}
        </p>
      ) : null}
      <section className="ty-card hero" aria-labelledby="home-label">
        <span className="ty-label" id="home-label">
          Spent on the home
        </span>
        <Amount cents={-h.totalCents} kind="outflow" size="display" round />
        <p className="hero-line">
          From {h.rows.length} home {h.rows.length === 1 ? 'payment' : 'payments'} Tally can see. The project runs {period(h.project)}.{' '}
          <button type="button" className="ty-link" onClick={() => setEditingProject((v) => !v)}>
            Change the period or budget
          </button>
        </p>
        {budget ? (
          <div className="budget">
            <div
              className="meter"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={budget}
              aria-valuenow={Math.min(budget, Math.max(0, h.totalCents))}
              aria-valuetext={`${percent(h.totalCents / budget)} of the budget`}
              aria-label="Budget used"
            >
              <span className="meter-fill" style={{ width: `${Math.min(100, Math.max(0, (h.totalCents / budget) * 100))}%` }} />
            </div>
            <p className="ty-note">
              {percent(h.totalCents / budget)} of the {formatSGD(budget, { round: true })} budget
              {h.totalCents > budget ? `, ${formatSGD(h.totalCents - budget)} over` : `, ${formatSGD(budget - h.totalCents)} left`}.
            </p>
          </div>
        ) : null}
        {editingProject ? <ProjectForm project={h.project} onDone={() => setEditingProject(false)} /> : null}
        <ul className="hero-more">
          {h.unseen.cents > 0 ? (
            <li>
              About <strong>{formatSGD(h.unseen.cents)}</strong> more may be missing: it went to cards and wallets with no statements here during the project.
            </li>
          ) : null}
          {h.unsortedLarge.count > 0 ? (
            <li>
              {h.unsortedLarge.count} large {h.unsortedLarge.count === 1 ? 'payment is' : 'payments are'} not yet sorted ({formatSGD(h.unsortedLarge.cents)}). Some may be for
              the home.{' '}
              <a className="ty-link" href={href('transactions', { review: '1' })}>
                Sort them
              </a>
            </li>
          ) : null}
        </ul>
      </section>

      <div className="home-grid">
        <section className="ty-card section" aria-labelledby="bucket-heading">
          <h2 className="heading" id="bucket-heading">
            By bucket
          </h2>
          <ul className="split-list">
            {h.buckets.map((b) => (
              <li key={b.bucket ?? 'none'}>
                <span>
                  {b.bucket ? BUCKET_LABEL[b.bucket] ?? b.bucket : 'Needs a bucket'}
                  <span className="ty-note"> · {b.count} {b.count === 1 ? 'payment' : 'payments'}</span>
                </span>
                <Amount cents={-b.cents} kind="outflow" signed={false} />
              </li>
            ))}
          </ul>
          {needsBucket ? (
            <p className="ty-note">
              {needsBucket.count} home {needsBucket.count === 1 ? 'payment has' : 'payments have'} no bucket yet.{' '}
              <a className="ty-link" href={href('transactions', { category: 'Home project' })}>
                Give them one
              </a>
            </p>
          ) : null}
        </section>

        <section className="ty-card section" aria-labelledby="payer-heading">
          <h2 className="heading" id="payer-heading">
            Who paid
          </h2>
          <ul className="split-list">
            {h.payers.map((p) => (
              <li key={p.payer}>
                <span>{p.label}</span>
                <Amount cents={-p.cents} kind="outflow" signed={false} />
              </li>
            ))}
          </ul>
          {h.contributions.some((c) => c.homeLike) ? (
            <>
              <h3 className="subheading">From {h.partnerName} into the joint account, for the home</h3>
              <ul className="split-list">
                {h.contributions.filter((c) => c.homeLike).map((c) => (
                  <li key={c.fingerprint}>
                    <span>
                      {c.purpose}
                      <span className="ty-note">
                        {' '}
                        · {longDate(c.date)}
                        {c.suggestedVendor ? ` · looks like it is for ${c.suggestedVendor}` : ''}
                      </span>
                    </span>
                    <Amount cents={c.cents} kind="transfer" signed={false} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {h.contributions.length ? (
            <p className="ty-note">
              {h.homeLikeContributionsCents
                ? `${formatSGD(h.homeLikeContributionsCents)} of the ${formatSGD(h.contributionsCents)} ${h.partnerName} put into the joint account during the project names something for the home.`
                : `${h.partnerName} put ${formatSGD(h.contributionsCents)} into the joint account during the project; none of it names something for the home.`}{' '}
              It helped pay for joint-account payments, so it is not counted again.
            </p>
          ) : null}
        </section>
      </div>

      <section className="ty-card section" aria-labelledby="vendor-heading">
        <div className="section-head">
          <h2 className="heading" id="vendor-heading">
            Vendors
          </h2>
          <button type="button" className="ty-link" onClick={() => setVendorForm('new')}>
            Add vendor
          </button>
        </div>
        {vendorForm === 'new' ? <VendorForm onDone={() => setVendorForm(null)} /> : null}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Vendor</th>
                <th scope="col" className="num">
                  Contract
                </th>
                <th scope="col" className="num">
                  Paid
                </th>
                <th scope="col" className="num">
                  Balance
                </th>
                <th scope="col">Last payment</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {h.vendors.map((v) => {
                const key = v.id ? `id:${v.id}` : `name:${v.name}`;
                return (
                  <Fragment key={key}>
                    <tr>
                      <th scope="row">{v.name}</th>
                      <td className="num">{v.contractCents === null ? '—' : formatSGD(v.contractCents)}</td>
                      <td className="num">{formatSGD(v.paidCents)}</td>
                      <td className="num">{v.balanceCents === null ? '—' : formatSGD(v.balanceCents)}</td>
                      <td>{v.lastPaid ? longDate(v.lastPaid) : 'Not yet'}</td>
                      <td className="cell-actions">
                        <button type="button" className="ty-link" onClick={() => setVendorForm(vendorForm === key ? null : key)} aria-label={`Edit ${v.name}`}>
                          {v.id ? 'Edit' : 'Add details'}
                        </button>
                      </td>
                    </tr>
                    {vendorForm === key ? (
                      <tr>
                        <td colSpan={6}>
                          <VendorForm vendor={v.id ? v : { ...v, match: v.name }} onDone={() => setVendorForm(null)} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="ty-card section" aria-labelledby="line-heading">
        <div className="section-head">
          <h2 className="heading" id="line-heading">
            Over time
          </h2>
          <span className="ty-note">Running total at each month end</span>
        </div>
        <CumulativeLine label="Home spending so far, by month" points={h.cumulative} />
      </section>

      {h.unseen.accounts.length ? (
        <section className="ty-card section" aria-labelledby="unseen-heading">
          <h2 className="heading" id="unseen-heading">
            Unseen during the project
          </h2>
          <p className="section-lead">
            Money went to these cards and wallets while the project ran, but their statements are not here, so Tally cannot tell what it bought. Some of it is
            probably for the home.
          </p>
          <ul className="split-list">
            {h.unseen.accounts.map((a) => (
              <li key={a.account}>
                <span>{a.account}</span>
                <Amount cents={-a.cents} kind="outflow" signed={false} />
              </li>
            ))}
          </ul>
          <p>
            <a className="ty-link" href={href('statements')}>
              Add their statements on Statements
            </a>
          </p>
        </section>
      ) : null}

      <section className="ty-card section" aria-labelledby="rows-heading">
        <h2 className="heading" id="rows-heading">
          Every home payment
        </h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Payee</th>
                <th scope="col">Bucket</th>
                <th scope="col">Paid by</th>
                <th scope="col" className="num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {h.rows.map((r) => (
                <tr key={r.fingerprint}>
                  <td>{longDate(r.date)}</td>
                  <td>
                    {r.vendor}
                    {r.vendor !== r.payee ? <span className="ty-note"> · {r.payee}</span> : null}
                  </td>
                  <td>{r.bucket ? BUCKET_LABEL[r.bucket] ?? r.bucket : 'Needs a bucket'}</td>
                  <td>{h.payerLabels[r.payer]}</td>
                  <td className="num">
                    <Amount cents={-r.cents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Page>
  );
}
