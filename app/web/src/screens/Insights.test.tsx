// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DataProvider } from '../data';
import { Insights } from './Insights';
import { Overview } from './Overview';
import { Transactions } from './Transactions';
import { insightItems, stubApi } from '../test/stubApi';
import type { Api } from '../api';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

function show(ui: React.ReactElement, over = {}) {
  const api = stubApi(over);
  render(<DataProvider api={api as Api}>{ui}</DataProvider>);
  return api;
}

describe('Insights screen', () => {
  it('groups insights by level, with the level word always shown', async () => {
    show(<Insights />);
    const act = await screen.findByRole('region', { name: /^Act/ });
    expect(within(act).getByText('Act', { selector: '.ty-pill' })).toBeTruthy();
    expect(act.textContent).toContain('went to cards and wallets Tally cannot see into');
    expect(screen.getByRole('region', { name: /^Watch/ }).textContent).toContain('Two payments of S$120.00');
    expect(screen.getByRole('region', { name: /^Info/ }).textContent).toContain('regular monthly charges');
  });

  it('links an insight to its rows and dismisses or snoozes it', async () => {
    const api = show(<Insights />);
    const info = await screen.findByRole('region', { name: /^Info/ });
    expect(within(info).getByRole('link', { name: 'See the row: 2 regular monthly charges, about S$21.96 a month' }).getAttribute('href')).toBe('#/transactions?insight=subs%3Ax');
    fireEvent.click(within(info).getByRole('button', { name: /^Snooze 30 days/ }));
    await waitFor(() => expect(api.dismissInsight).toHaveBeenCalledWith('subs:x', 30));
    fireEvent.click(within(info).getByRole('button', { name: /^Dismiss/ }));
    await waitFor(() => expect(api.dismissInsight).toHaveBeenCalledWith('subs:x', undefined));
  });

  it('writes the month’s review as the one primary action', async () => {
    const api = show(<Insights />);
    const button = await screen.findByRole('button', { name: 'Write the Aug 2026 review' });
    expect(button.className).toContain('ty-btn-primary');
    fireEvent.click(button);
    await waitFor(() => expect(api.writeReview).toHaveBeenCalledWith('2026-08'));
    expect((await screen.findByRole('status')).textContent).toContain('Wrote outputs/reviews/review-2026-08.md.');
  });

  it('offers to bring back what you dismissed, and says when there is nothing', async () => {
    const api = show(<Insights />, { insights: vi.fn(async () => ({ insights: [], hidden: 2, coverage: { months: ['2026-08'], incomplete: ['2026-08'] } })) });
    expect(await screen.findByRole('heading', { name: 'Nothing to flag right now' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bring them back' }));
    await waitFor(() => expect(api.restoreInsights).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Coverage' })).toBeNull();
  });

  it('says so when bringing insights back fails', async () => {
    show(<Insights />, {
      insights: vi.fn(async () => ({ insights: [], hidden: 1, coverage: { months: ['2026-08'], incomplete: [] } })),
      restoreInsights: vi.fn(async () => {
        throw new Error('Tally’s local server is not answering. Start it with npm start.');
      }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Bring it back' }));
    expect((await screen.findByRole('alert')).textContent).toContain('not answering');
  });

  it('carries the coverage banner when some months are incomplete', async () => {
    show(<Insights />);
    const banner = await screen.findByRole('region', { name: 'Coverage' });
    expect(banner.textContent).toContain('1 of 2 months here has a statement missing or money sent to cards and wallets Tally cannot see');
    expect(within(banner).getByRole('link', { name: 'See what is missing on Statements' }).getAttribute('href')).toBe('#/statements');
  });

  it('gives each insight a heading under its group, and actions that go somewhere as links', async () => {
    show(<Insights />);
    const act = await screen.findByRole('region', { name: /^Act/ });
    expect(within(act).getByRole('heading', { level: 3 }).textContent).toBe('S$1,318.27 went to cards and wallets Tally cannot see into');
    expect(within(act).getByRole('link', { name: 'See where to get the statements' }).getAttribute('href')).toBe('#/statements');
  });
});

describe('insights elsewhere', () => {
  it('shows the top three on Overview with a link to all', async () => {
    const overview = vi.fn(async () => ({
      month: '2026-08',
      months: ['2026-08'],
      spentCents: 100_00,
      homeProjectCents: 0,
      taxCents: 0,
      feesCents: 0,
      incomeCents: 0,
      netCents: -100_00,
      savingsRate: null,
      investedCents: 0,
      partnerCents: 0,
      cashOnHandCents: 0,
      cashStale: [],
      cashTrend: [{ month: '2026-08', cents: 0 }],
      categories: [],
      notSorted: { count: 0, outCents: 0, inCents: 0 },
      coverage: { complete: true, missing: [], partial: [], unseenCents: 0, held: [] },
    }));
    const four = [...insightItems(), { ...insightItems()[2]!, key: 'x4', title: 'A fourth one' }];
    show(<Overview />, { overview, insights: vi.fn(async () => ({ insights: four, hidden: 0, coverage: { months: ['2026-08'], incomplete: [] } })) });
    const top = await screen.findByRole('region', { name: 'Worth a look' });
    expect(top.querySelectorAll('.ty-insight')).toHaveLength(3);
    expect(within(top).getByRole('link', { name: 'See all 4 insights' }).getAttribute('href')).toBe('#/insights');
    expect(top.textContent).not.toContain('A fourth one');
  });

  it('shows only an insight’s rows on Transactions, with a way back', async () => {
    window.location.hash = '#/transactions?insight=dup%3Aa%7Cb';
    const transactions = vi.fn(async () => ({ rows: [], total: 0, outCents: 0, inCents: 0, notCounted: 0, insight: { key: 'dup:a|b', title: 'Two payments of S$120.00 to Example Shop, 8 days apart' } }));
    show(<Transactions />, { transactions });
    await waitFor(() => expect(transactions).toHaveBeenCalledWith(expect.objectContaining({ insight: 'dup:a|b' })));
    const status = await screen.findByText(/Showing the rows behind/);
    expect(status.textContent).toContain('“Two payments of S$120.00 to Example Shop, 8 days apart”');
    expect(screen.getByRole('link', { name: 'Show all transactions' }).getAttribute('href')).toBe('#/transactions');
  });
});
