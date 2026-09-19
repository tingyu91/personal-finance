import { useState } from 'react';
import { Button, CoverageGrid, DropZone, type ReceiptItem } from '../ds';
import { formatSGD, longDate, monthLabel, sgtDate } from '../format';
import { useData, useLoad } from '../data';
import type { ImportResult } from '../api';
import { Page } from './Page';

interface Receipt extends ImportResult {
  /** The dropped files in receipt order, so a locked one can be sent again with its password. */
  files: File[];
}

function rangeLabel(months: string[]): string {
  if (!months.length) return '';
  const first = months[0]!;
  const last = months.at(-1)!;
  if (first === last) return monthLabel(first);
  return first.slice(0, 4) === last.slice(0, 4)
    ? `${monthLabel(first, 'long').split(' ')[0]} to ${monthLabel(last)}`
    : `${monthLabel(first)} to ${monthLabel(last)}`;
}

function PasswordRetry({ item, onSubmit }: { item: ReceiptItem; onSubmit: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="password-retry"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!password) return;
        setBusy(true);
        try {
          await onSubmit(password);
        } finally {
          setBusy(false);
          setPassword('');
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <label className="field">
        <span className="ty-label">Password for {item.name}</span>
        <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} aria-label={`Password for ${item.name}`} />
      </label>
      <Button type="submit" disabled={busy || !password} aria-label={`Open ${item.name} with this password`}>
        Open with this password
      </Button>
      <span className="ty-note">Used once to read the file, never saved.</span>
    </form>
  );
}

const WHERE = [
  ['DBS and POSB', 'digibank online or the digibank app → e-Statements. Download the consolidated statement and each account’s own statement. They open without a password.'],
  ['UOB', 'UOB TMRW or Personal Internet Banking → Statements. UOB names every file eStatement.pdf; Tally reads the contents, so the name does not matter.'],
  ['Citi', 'Citi Mobile or Citibank Online → Statements. Download the card statement for each month.'],
  ['American Express', 'The Amex SG app or the website → Statements. One PDF per card per month.'],
];

export function Statements() {
  const { api, changed } = useData();
  const cov = useLoad((a) => a.coverage(), []);
  const files = useLoad((a) => a.files(), []);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  async function run(task: () => Promise<ImportResult>, dropped: File[] = []) {
    setBusy(true);
    setError(null);
    try {
      const res = await task();
      setReceipt({ ...res, files: dropped });
      changed();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Receipt items come back in the order the files were sent, so the position finds the file
  // (UOB names every statement eStatement.pdf, so the name cannot).
  /** Accept and Remove wait for any import in progress, and say so if they fail. */
  async function act(task: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await task();
      changed();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function retry(index: number, password: string) {
    const file = receipt?.files[index];
    if (!file || !receipt) return;
    const res = await api.importFiles([file], password);
    const updated = res.items[0];
    setReceipt({
      ...receipt,
      items: receipt.items.map((it, i) => (i === index && updated ? updated : it)),
      summary: res.summary,
    });
    changed();
  }

  const failed = (files.data?.files ?? []).flatMap((f) => f.statements.filter((s) => !s.reconciled && !s.accepted).map((s) => ({ file: f, s })));
  const seenOnly = (cov.data?.rows ?? []).filter((r) => r.seenOnly && r.unseenCents.some((c) => c > 0));
  const unknownIssuers = (cov.data?.rows ?? []).filter((r) => r.seenOnly && r.kind === 'card' && r.account.startsWith('Card '));
  const months = cov.data?.months ?? [];

  return (
    <Page
      title="Statements"
      actions={
        <>
          <Button onClick={() => run(() => api.scanInbox())} disabled={busy}>
            Scan inbox
          </Button>
          <Button
            onClick={() => {
              if (window.confirm('Re-read every statement in the vault? Your decisions and manual entries stay.')) void run(() => api.rebuild());
            }}
            disabled={busy}
          >
            Rebuild from vault
          </Button>
        </>
      }
    >
      <DropZone
        busy={busy}
        state={receipt ? 'done' : undefined}
        summary={receipt?.summary}
        items={receipt?.items}
        onFiles={(list) => run(() => api.importFiles(list), list)}
        renderItemExtra={(item, i) => (item.status === 'locked' && receipt?.files[i] ? <PasswordRetry item={item} onSubmit={(pw) => retry(i, pw)} /> : null)}
      />
      {error ? (
        <p className="notice notice-critical" role="alert">
          {error}
        </p>
      ) : null}

      {failed.length ? (
        <section className="ty-card section">
          <h2 className="heading">Needs a look</h2>
          <p className="section-lead">
            These statements’ rows do not add up to their own printed totals, so they are left out of every total until you decide.
          </p>
          <ul className="attention">
            {failed.map(({ file, s }) => (
              <li key={s.id}>
                <div>
                  <span className="ty-pill ty-pill-critical">Totals don’t match</span>
                  <strong>
                    {s.account}, {monthLabel(s.month)}
                  </strong>
                  <p className="ty-note">{s.failure}</p>
                </div>
                <div className="row-actions">
                  <a className="ty-link" href={`/api/files/${file.id}/pdf`} target="_blank" rel="noreferrer">
                    Open PDF
                  </a>
                  <Button
                    aria-label={`Accept these totals for ${s.account}, ${monthLabel(s.month)}`}
                    disabled={busy}
                    onClick={() => void act(() => api.acceptStatement(s.id))}
                  >
                    Accept these totals
                  </Button>
                  {confirming === file.id ? (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await api.removeFile(file.id);
                          setConfirming(null);
                        })
                      }
                    >
                      {file.statements.length === 1
                        ? 'Remove the file and its rows'
                        : `Remove the file and all ${file.statements.length} statements in it`}
                    </Button>
                  ) : (
                    <Button disabled={busy} onClick={() => setConfirming(file.id)} aria-label={`Remove ${file.name}`}>
                      Remove
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="ty-card section">
        <div className="section-head">
          <h2 className="heading">Coverage{months.length ? `, ${rangeLabel(months)}` : ''}</h2>
          <span className="ty-note">✓ imported · ! missing · – not open yet</span>
        </div>
        {cov.data && cov.data.rows.length ? (
          <>
            <CoverageGrid months={months.map((m) => monthLabel(m, 'tiny'))} current={months.length - 1} rows={cov.data.rows.map((r) => ({ account: r.account, cells: r.cells }))} />
            {seenOnly.length ? (
              <div className="unseen">
                <h3 className="subheading">Money Tally cannot see into</h3>
                <ul>
                  {seenOnly.map((r) => {
                    const total = r.unseenCents.reduce((a, b) => a + b, 0);
                    const active = months.filter((_, i) => r.unseenCents[i]! > 0);
                    return (
                      <li key={r.account}>
                        <strong>{r.account}</strong>
                        <span>
                          {formatSGD(total)} went to it{active.length ? ` (${rangeLabel(active)})` : ''}.{' '}
                          {r.kind === 'wallet' ? 'What it paid for never shows on a bank statement.' : 'Add its statements to see what it bought.'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </>
        ) : (
          <p className="section-lead">No statements yet. Drop the PDFs above, or put them in the inbox and scan it.</p>
        )}
      </section>

      <section className="ty-card section">
        <h2 className="heading">Imported</h2>
        {files.data?.files.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">Accounts</th>
                  <th scope="col">Month</th>
                  <th scope="col">Imported</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {files.data.files.map((f) => (
                  <tr key={f.id}>
                    <td className="ty-raw cell-file" title={f.name}>
                      {f.name}
                    </td>
                    <td>
                      {f.statements.map((s) => (
                        <div key={s.id} className="cell-stmt">
                          {s.account}
                          {!s.reconciled ? <span className={`ty-pill ${s.accepted ? 'ty-pill-muted' : 'ty-pill-critical'}`}>{s.accepted ? 'Accepted' : 'Held'}</span> : null}
                        </div>
                      ))}
                    </td>
                    <td>{monthLabel(f.month, 'short')}</td>
                    <td className="ty-note">{longDate(sgtDate(f.importedAt))}</td>
                    <td className="cell-actions">
                      <a className="ty-link" href={`/api/files/${f.id}/pdf`} target="_blank" rel="noreferrer">
                        Open PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="section-lead">Nothing imported yet.</p>
        )}
      </section>

      <section className="ty-card section">
        <h2 className="heading">Where to get statements</h2>
        <dl className="where">
          {WHERE.map(([bank, how]) => (
            <div key={bank}>
              <dt>{bank}</dt>
              <dd>{how}</dd>
            </div>
          ))}
        </dl>
        {unknownIssuers.length ? (
          <p className="section-lead">
            {unknownIssuers.map((r) => r.account.replace('Card ', '')).join(' and ')}{' '}
            {unknownIssuers.length === 1 ? 'is a card' : 'are cards'} Tally knows only by the last four digits. Check which bank issues{' '}
            {unknownIssuers.length === 1 ? 'it' : 'them'}, then download from there.
          </p>
        ) : null}
      </section>
    </Page>
  );
}
