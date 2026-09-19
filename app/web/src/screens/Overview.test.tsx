// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { DataProvider } from '../data';
import { Overview } from './Overview';
import { stubApi } from '../test/stubApi';
import type { OverviewData } from '../api';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

/** Invented figures only. */
function data(over: Partial<OverviewData> = {}): OverviewData {
  return {
    month: '2026-08',
    months: ['2026-06', '2026-07', '2026-08'],
    spentCents: 4_118_40,
    homeProjectCents: 2_500_00,
    taxCents: 90_00,
    feesCents: 0,
    incomeCents: 8_401_37,
    netCents: 1_782_97,
    savingsRate: 1_782_97 / 8_401_37,
    investedCents: 1_000_00,
    partnerCents: 1_650_00,
    cashOnHandCents: 31_282_19,
    cashStale: [],
    cashTrend: [
      { month: '2026-06', cents: 28_000_00 },
      { month: '2026-07', cents: 30_500_00 },
      { month: '2026-08', cents: 31_282_19 },
    ],
    categories: [
      { name: 'Food & groceries', slot: 1, cents: 1_200_00, medianCents: 1_100_00 },
      { name: 'Transport', slot: 2, cents: 300_00, medianCents: null },
    ],
    notSorted: { count: 3, outCents: 412_00, inCents: 0 },
    coverage: { complete: false, missing: ['Card ·5566'], partial: [{ account: 'UOB One Card ·4444', through: '2026-08-20' }], unseenCents: 1_318_27, held: [] },
    ...over,
  };
}

function setup(o: OverviewData | { empty: true; months: string[] }) {
  const api = stubApi({ overview: vi.fn(async () => o) });
  render(
    <DataProvider api={api}>
      <Overview />
    </DataProvider>,
  );
  return api;
}

describe('Overview screen', () => {
  it('leads with what was spent, then the home project and what is not yet sorted', async () => {
    setup(data());
    const hero = await screen.findByRole('region', { name: 'Spent in August 2026' });
    expect(within(hero).getByText('S$4,118')).toBeTruthy();
    expect(hero.textContent).toContain('Plus S$2,500.00 on the home project.');
    expect(hero.textContent).toContain('3 payments are not yet sorted: S$412.00 out.');
    expect(within(hero).getByRole('link', { name: 'Sort them' }).getAttribute('href')).toBe('#/transactions?month=2026-08&kind=unclassified');
  });

  it('carries the coverage banner when the month is incomplete', async () => {
    setup(data());
    const banner = await screen.findByRole('region', { name: 'Coverage' });
    expect(banner.textContent).toContain('S$1,318.27 went to cards and wallets with no statements here');
    expect(banner.textContent).toContain('No statement here for Card ·5566 in August.');
    expect(banner.textContent).toContain('Statements here for UOB One Card ·4444 run only to 20 Aug 2026, so later August rows are not counted yet.');
  });

  it('has no banner for a complete month', async () => {
    setup(data({ coverage: { complete: true, missing: [], partial: [], unseenCents: 0, held: [] } }));
    await screen.findByRole('region', { name: 'Spent in August 2026' });
    expect(screen.queryByRole('region', { name: 'Coverage' })).toBeNull();
  });

  it('keeps partner money out of income and says so', async () => {
    setup(data());
    const income = (await screen.findByText('Income')).closest('.ty-stat')!;
    expect(income.textContent).toContain('S$8,401.37');
    expect(income.textContent).toContain('Plus S$1,650 from Sam into the joint account, not counted as income');
  });

  it('shows where it went, with the tax that has no category noted', async () => {
    setup(data());
    expect(await screen.findByRole('listitem', { name: /Food & groceries/ })).toBeTruthy();
    expect(screen.getByText('The bars leave out S$90.00 of tax, which has no category.')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Cash on hand by month' })).toBeTruthy();
  });

  it('asks for statements when there are none', async () => {
    setup({ empty: true, months: [] });
    expect(await screen.findByRole('heading', { name: 'No statements yet' })).toBeTruthy();
  });

  it('loads the month in the link', async () => {
    window.location.hash = '#/overview?month=2026-07';
    const api = setup(data({ month: '2026-07' }));
    await screen.findByRole('region', { name: 'Spent in July 2026' });
    expect(api.overview).toHaveBeenCalledWith('2026-07');
  });
});
