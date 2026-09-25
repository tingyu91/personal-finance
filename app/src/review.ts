import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from './config';
import type { Db } from './db/open';
import { formatSGD } from './core/money';
import { monthLabel, sgtDate } from './core/dates';
import { listInsights } from './insights';
import { overview } from './reports/overview';
import { homeProject } from './reports/home';
import { loadBenchmarks } from './benchmarks';
import { loadSettings } from './settings';

const LEVEL: Record<string, string> = { act: 'Act', watch: 'Watch', info: 'Info' };

/**
 * The monthly review (PRD §5): a plain markdown summary of one month for reading later, or for
 * Claude to read when you want a narrative. It holds figures, so it stays in outputs/, never git.
 */
export function monthlyReview(db: Db, paths: Paths, month: string, today = sgtDate(new Date().toISOString())): string {
  const o = overview(db, month);
  const { insights } = listInsights(db, paths, today);
  const settings = loadSettings(paths);
  const home = homeProject(db, settings, { largeUnsortedCents: loadBenchmarks(paths).thresholds.largeUnsortedCents });
  const name = monthLabel(month);
  const lines: string[] = [];
  const out = (s = '') => lines.push(s);

  out(`# Tally review: ${name}`);
  out();
  out(`Written ${today} from the statements imported so far. Figures are SGD.`);
  out();
  out('## Coverage');
  out();
  if (o.coverage.complete) out(`Every account has a statement covering ${name}, and nothing went to cards Tally cannot see.`);
  else {
    if (o.coverage.unseenCents) out(`- ${formatSGD(o.coverage.unseenCents)} went to cards and wallets with no statements here, so spending is probably higher than shown.`);
    if (o.coverage.missing.length) out(`- No statement for: ${o.coverage.missing.join(', ')}.`);
    for (const p of o.coverage.partial) out(`- ${p.account}: statements run only to ${p.through}.`);
    if (o.coverage.held.length) out(`- Held until checked (totals do not add up): ${o.coverage.held.join(', ')}.`);
  }
  out();
  out('## The month');
  out();
  out(`| | ${name} |`);
  out('|---|---:|');
  out(`| Everyday spending (tax and fees included) | ${formatSGD(o.spentCents)} |`);
  out(`| Home project | ${formatSGD(o.homeProjectCents)} |`);
  out(`| Income | ${formatSGD(o.incomeCents)} |`);
  out(`| Net savings | ${formatSGD(o.netCents)} |`);
  out(`| Savings rate | ${o.savingsRate === null ? 'no income' : `${Math.round(o.savingsRate * 100)}%`} |`);
  out(`| Moved to investments | ${formatSGD(o.investedCents)} |`);
  out(`| From ${settings.partner.name} into the joint account (not income) | ${formatSGD(o.partnerCents)} |`);
  out(`| Cash on hand at month end | ${formatSGD(o.cashOnHandCents)} |`);
  out();
  if (o.notSorted.count) {
    out(`${o.notSorted.count} payments are not yet sorted (${formatSGD(o.notSorted.outCents)} out, ${formatSGD(o.notSorted.inCents)} in). They count as nothing until sorted.`);
    out();
  }
  out('## Where it went');
  out();
  out('| Category | This month | Six-month median |');
  out('|---|---:|---:|');
  for (const c of o.categories) out(`| ${c.name} | ${formatSGD(c.cents)} | ${c.medianCents === null ? 'no history' : formatSGD(c.medianCents)} |`);
  if (o.taxCents || o.feesCents) out(`| Tax and fees (no category) | ${formatSGD(o.taxCents + o.feesCents)} | |`);
  out();
  out('## Home project');
  out();
  out(`${formatSGD(home.totalCents)} since ${monthLabel(home.project.startMonth)}, from ${home.rows.length} payments Tally can see.`);
  for (const b of home.buckets) out(`- ${b.bucket ?? 'needs a bucket'}: ${formatSGD(b.cents)} (${b.count})`);
  if (home.unseen.cents) out(`- About ${formatSGD(home.unseen.cents)} more may be missing: it went to cards and wallets with no statements here.`);
  out();
  // Insights look across every statement, not only this month, so say when they were worked out.
  out(`## Insights on ${today}`);
  out();
  out('Across all the statements imported so far, not only this month. Dismissed and snoozed insights are left out.');
  out();
  if (!insights.length) out('Nothing to flag.');
  for (const i of insights) {
    out(`- **${LEVEL[i.level]}: ${i.title}.** ${i.detail}${i.worthCents ? ` Worth about ${formatSGD(i.worthCents)}${i.per ? ` ${i.per}` : ''}.` : ''}`);
  }
  out();
  return lines.join('\n');
}

/** Writes outputs/reviews/review-YYYY-MM.md and returns its path. */
export function writeMonthlyReview(db: Db, paths: Paths, month: string, today?: string): string {
  fs.mkdirSync(paths.reviewsDir, { recursive: true });
  const file = path.join(paths.reviewsDir, `review-${month}.md`);
  fs.writeFileSync(file, monthlyReview(db, paths, month, today), 'utf8');
  return file;
}
