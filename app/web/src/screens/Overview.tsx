import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Amount, Stat } from '../ds';
import { CategoryBars } from '../charts/CategoryBars';
import { MonthColumns } from '../charts/MonthColumns';
import { useLoad } from '../data';
import { formatSGD, longDate, monthLabel, percent } from '../format';
import { href, useRoute } from '../router';
import type { OverviewData } from '../api';
import { Empty, Page } from './Page';

function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function go(month: string) {
  window.location.hash = href('overview', { month });
}

function MonthPicker({ month, months }: { month: string; months: string[] }) {
  const i = months.indexOf(month);
  const prev = i > 0 ? months[i - 1] : undefined;
  const next = i >= 0 && i < months.length - 1 ? months[i + 1] : undefined;
  return (
    <div className="month-picker">
      <button type="button" className="ty-btn ty-btn-icon" disabled={!prev} onClick={() => prev && go(prev)} aria-label={prev ? `Previous month, ${monthLabel(prev)}` : 'No earlier month'}>
        <ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <label className="visually-hidden" htmlFor="overview-month">
        Month
      </label>
      <select id="overview-month" className="select" value={month} onChange={(e) => go(e.target.value)}>
        {[...months].reverse().map((m) => (
          <option key={m} value={m}>
            {monthLabel(m)}
          </option>
        ))}
      </select>
      <button type="button" className="ty-btn ty-btn-icon" disabled={!next} onClick={() => next && go(next)} aria-label={next ? `Next month, ${monthLabel(next)}` : 'No later month'}>
        <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Coverage first (PRD §4.7): any month with a missing statement or unseen spending says so. */
function CoverageBanner({ o }: { o: OverviewData }) {
  const { missing, partial, unseenCents, held } = o.coverage;
  const byDate = new Map<string, string[]>();
  for (const p of partial) byDate.set(p.through, [...(byDate.get(p.through) ?? []), p.account]);
  if (o.coverage.complete) return null;
  const name = monthLabel(o.month).split(' ')[0];
  return (
    <section className="notice notice-watch banner" aria-label="Coverage">
      <span className="ty-pill ty-pill-watch">Not complete</span>
      <div className="banner-body">
        {unseenCents > 0 ? (
          <p>
            <strong>{formatSGD(unseenCents)}</strong> went to cards and wallets with no statements here, so {name}’s spending is probably higher than shown.
          </p>
        ) : null}
        {missing.length ? (
          <p>
            No statement here for {list(missing)} in {name}.
          </p>
        ) : null}
        {[...byDate].map(([through, accounts]) => (
          <p key={through}>
            Statements here for {list(accounts)} run only to {longDate(through)}, so later {name} rows are not counted yet.
          </p>
        ))}
        {held.length ? <p>{list(held)} did not add up, so its rows are left out until you look at it.</p> : null}
        <p>
          <a className="ty-link" href={href('statements')}>
            See what is missing on Statements
          </a>
        </p>
      </div>
    </section>
  );
}

export function Overview() {
  const route = useRoute();
  const asked = route.params.get('month') ?? undefined;
  const res = useLoad((api) => api.overview(asked), [asked]);
  const meta = useLoad((api) => api.meta(), []);

  if (res.error && !res.data) {
    return (
      <Page title="Overview">
        <p className="notice notice-critical" role="alert">
          Could not load the overview: {res.error}
        </p>
      </Page>
    );
  }
  if (!res.data) return <Page title="Overview" />;
  if ('empty' in res.data) {
    return (
      <Page title="Overview">
        <Empty heading="No statements yet">
          <p>Import your bank and card PDFs to see where the money went each month.</p>
          <p>
            <a className="ty-link" href={href('statements')}>
              Go to Statements
            </a>
          </p>
        </Empty>
      </Page>
    );
  }

  const o = res.data;
  const partner = meta.data?.partnerName ?? 'your partner';
  const name = monthLabel(o.month).split(' ')[0];
  const uncategorised = o.taxCents + o.feesCents;
  const bars = o.categories.filter((c) => c.cents > 0 || (c.medianCents ?? 0) > 0);
  const leftOut = [
    ...(o.taxCents > 0 ? [`${formatSGD(o.taxCents)} of tax`] : []),
    ...(o.feesCents > 0 ? [`${formatSGD(o.feesCents)} of bank and card fees`] : []),
  ];

  return (
    <Page title="Overview" actions={<MonthPicker month={o.month} months={o.months} />}>
      <CoverageBanner o={o} />

      <section className="ty-card hero" aria-labelledby="spent-label">
        <span className="ty-label" id="spent-label">
          Spent in {monthLabel(o.month)}
        </span>
        <Amount cents={-o.spentCents} kind="outflow" size="display" round />
        <p className="hero-line">Everyday spending, with tax and fees. The home project is counted on its own.</p>
        <ul className="hero-more">
          {o.homeProjectCents > 0 ? (
            <li>
              Plus <strong>{formatSGD(o.homeProjectCents)}</strong> on the home project.{' '}
              <a className="ty-link" href={href('home-project')}>
                See the home project
              </a>
            </li>
          ) : null}
          {o.notSorted.count > 0 ? (
            <li>
              {o.notSorted.count} {o.notSorted.count === 1 ? 'payment is' : 'payments are'} not yet sorted
              {o.notSorted.outCents ? (
                <>
                  : <strong>{formatSGD(o.notSorted.outCents)}</strong> out
                </>
              ) : null}
              {o.notSorted.inCents ? (
                <>
                  {o.notSorted.outCents ? ',' : ':'} <strong>{formatSGD(o.notSorted.inCents)}</strong> in
                </>
              ) : null}
              . They count as nothing until you sort them.{' '}
              <a className="ty-link" href={href('transactions', { month: o.month, kind: 'unclassified' })}>
                Sort them
              </a>
            </li>
          ) : null}
        </ul>
      </section>

      <div className="stats">
        <Stat
          label="Income"
          cents={o.incomeCents}
          kind="inflow"
          note={o.partnerCents > 0 ? `Plus ${formatSGD(o.partnerCents, { round: true })} from ${partner} into the joint account, not counted as income` : 'Salary, interest and other income'}
        />
        <Stat
          label="Net savings"
          value={<Amount cents={o.netCents} kind={o.netCents < 0 ? 'outflow' : 'inflow'} size="lg" signed />}
          note={o.savingsRate === null ? 'No income this month' : o.netCents < 0 ? 'More went out than came in' : `${percent(o.savingsRate)} of income kept, home project included`}
        />
        <Stat label="Moved to investments" cents={Math.abs(o.investedCents)} note={o.investedCents < 0 ? 'Net, more came back than went in' : 'Neither spending nor income'} />
        <Stat
          label="Cash on hand"
          cents={o.cashOnHandCents}
          note={o.cashStale.length ? `Uses an older balance for ${list(o.cashStale)}` : `Bank balances at the end of ${name}`}
        />
      </div>

      <div className="overview-charts">
        <section className="ty-card section" aria-labelledby="where-heading">
          <div className="section-head">
            <h2 className="heading" id="where-heading">
              Where it went
            </h2>
            <span className="ty-note">Against the median of the six months before</span>
          </div>
          {bars.length ? (
            <CategoryBars bars={bars} caption={`Spending by category, ${monthLabel(o.month)}`} />
          ) : (
            <p className="ty-note">No everyday spending recorded in {name}.</p>
          )}
          {uncategorised > 0 ? <p className="ty-note">The bars leave out {list(leftOut)}, which {leftOut.length > 1 ? 'have' : 'has'} no category.</p> : null}
        </section>

        <section className="ty-card section" aria-labelledby="cash-heading">
          <div className="section-head">
            <h2 className="heading" id="cash-heading">
              Cash on hand
            </h2>
            <span className="ty-note">Month-end bank balances</span>
          </div>
          <MonthColumns label="Cash on hand" points={o.cashTrend.slice(-12)} current={o.month} />
        </section>
      </div>
    </Page>
  );
}
