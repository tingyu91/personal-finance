import { useState } from 'react';
import { Button, Insight } from '../ds';
import { useData, useLoad } from '../data';
import { monthLabel } from '../format';
import { href } from '../router';
import type { InsightItem } from '../api';
import { Empty, Page } from './Page';

const GROUPS: { level: InsightItem['level']; heading: string; lead: string }[] = [
  { level: 'act', heading: 'Act', lead: 'Money is being lost or cannot be seen, and there is a clear next step.' },
  { level: 'watch', heading: 'Watch', lead: 'Worth a look.' },
  { level: 'info', heading: 'Info', lead: 'Useful to know.' },
];

/** One insight with its evidence link, and dismiss and snooze. */
export function InsightCard({ item, onChanged, compact = false }: { item: InsightItem; onChanged?: () => void; compact?: boolean }) {
  const { api } = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hide = async (days?: number) => {
    setBusy(true);
    setError(null);
    try {
      await api.dismissInsight(item.key, days);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const rowsHref = item.fingerprints.length ? href('transactions', { insight: item.key }) : null;
  return (
    <Insight
      level={item.level}
      title={item.title}
      detail={item.detail}
      worth={item.worthCents}
      worthLabel={item.worthLabel}
      per={item.per}
      action={item.action?.label}
      onAction={item.action ? () => (window.location.hash = item.action!.href.replace(/^#/, '')) : undefined}
    >
      <div className="insight-controls">
        {rowsHref && item.action?.href !== rowsHref ? (
          <a className="ty-link" href={rowsHref}>
            See the {item.fingerprints.length === 1 ? 'row' : `${item.fingerprints.length} rows`}
          </a>
        ) : null}
        {compact ? null : (
          <>
            <button type="button" className="ty-link quiet-link" disabled={busy} onClick={() => void hide(30)} aria-label={`Snooze for 30 days: ${item.title}`}>
              Snooze 30 days
            </button>
            <button type="button" className="ty-link quiet-link" disabled={busy} onClick={() => void hide()} aria-label={`Dismiss: ${item.title}`}>
              Dismiss
            </button>
          </>
        )}
      </div>
      {error ? (
        <p className="notice notice-critical" role="alert">
          {error}
        </p>
      ) : null}
    </Insight>
  );
}

export function Insights() {
  const { api, changed } = useData();
  const res = useLoad((a) => a.insights(), []);
  const meta = useLoad((a) => a.meta(), []);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const month = meta.data?.months.at(-1);

  const writeReview = async () => {
    if (!month) return;
    setNote(null);
    try {
      const { file } = await api.writeReview(month);
      setNote({ ok: true, text: `Wrote ${file}. It stays on this computer; ask Claude to read it when you want the story of the month.` });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  const actions = month ? (
    <Button variant="primary" onClick={() => void writeReview()}>
      Write the {monthLabel(month, 'short')} review
    </Button>
  ) : null;

  if (res.error && !res.data) {
    return (
      <Page title="Insights">
        <p className="notice notice-critical" role="alert">
          Could not work out the insights: {res.error}
        </p>
      </Page>
    );
  }
  if (!res.data) return <Page title="Insights" />;
  const { insights, hidden } = res.data;

  return (
    <Page title="Insights" actions={actions}>
      {note ? (
        <p className={`notice ${note.ok ? 'notice-watch' : 'notice-critical'}`} role="status">
          {note.text}
        </p>
      ) : null}
      {!insights.length ? (
        <Empty heading="Nothing to flag right now">
          <p>Tally checks fees, bank conditions, duplicates, subscriptions, unseen money and gaps in your statements each time you look.</p>
        </Empty>
      ) : (
        GROUPS.map((g) => {
          const items = insights.filter((i) => i.level === g.level);
          if (!items.length) return null;
          return (
            <section key={g.level} className="ty-card insight-group" aria-labelledby={`insights-${g.level}`}>
              <div className="section-head insight-group-head">
                <h2 className="heading" id={`insights-${g.level}`}>
                  {g.heading} <span className="ty-note">· {items.length}</span>
                </h2>
                <span className="ty-note">{g.lead}</span>
              </div>
              {items.map((i) => (
                <InsightCard key={i.key} item={i} onChanged={changed} />
              ))}
            </section>
          );
        })
      )}
      {hidden ? (
        <p className="ty-note">
          {hidden} {hidden === 1 ? 'insight is' : 'insights are'} dismissed or snoozed.{' '}
          <button
            type="button"
            className="ty-link"
            onClick={async () => {
              await api.restoreInsights();
              changed();
            }}
          >
            Bring {hidden === 1 ? 'it' : 'them'} back
          </button>
        </p>
      ) : null}
      <p className="ty-note">
        Rates and thresholds come from data/rules/benchmarks.json, each with the date it was checked. Nothing here is advice to buy or sell anything.
      </p>
    </Page>
  );
}
