// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DataProvider } from '../data';
import { HomeProject, parseCents } from './HomeProject';
import { CumulativeLine } from '../charts/CumulativeLine';
import { homeData, stubApi } from '../test/stubApi';

afterEach(cleanup);

function setup(over = {}) {
  const api = stubApi(over);
  render(
    <DataProvider api={api}>
      <HomeProject />
    </DataProvider>,
  );
  return api;
}

describe('Home project screen', () => {
  it('leads with the total, the budget and what may be missing', async () => {
    setup();
    const hero = await screen.findByRole('region', { name: 'Spent on the home' });
    expect(within(hero).getByText('S$4,580')).toBeTruthy();
    expect(hero.textContent).toContain('46% of the S$10,000 budget, S$5,420.00 left.');
    expect(hero.textContent).toContain('About S$2,400.00 more may be missing');
    expect(hero.textContent).toContain('2 large payments are not yet sorted (S$3,100.00).');
    expect(screen.getByRole('meter', { name: 'Budget used' })).toBeTruthy();
  });

  it('breaks the total down by bucket, with a link for rows that need one', async () => {
    setup();
    const buckets = await screen.findByRole('region', { name: 'By bucket' });
    expect(buckets.textContent).toContain('Renovation');
    expect(buckets.textContent).toContain('Needs a bucket');
    expect(within(buckets).getByRole('link', { name: 'Give them one' }).getAttribute('href')).toBe('#/transactions?category=Home+project');
  });

  it('shows vendors with contract, paid and balance, and adds one', async () => {
    const api = setup();
    const vendors = await screen.findByRole('region', { name: 'Vendors' });
    const reno = within(vendors).getByRole('row', { name: /Example Reno/ });
    expect(reno.textContent).toContain('S$5,000.00');
    expect(reno.textContent).toContain('S$1,000.00');
    fireEvent.click(within(vendors).getByRole('button', { name: 'Add vendor' }));
    const form = screen.getByRole('form', { name: 'Add a vendor' });
    fireEvent.change(within(form).getByLabelText('Vendor'), { target: { value: 'Lumen Lighting' } });
    fireEvent.change(within(form).getByLabelText('Contract sum (S$)'), { target: { value: '1,250.50' } });
    fireEvent.submit(form);
    await waitFor(() => expect(api.addVendor).toHaveBeenCalledWith({ name: 'Lumen Lighting', match: 'Lumen Lighting', contractCents: 1_250_50 }));
  });

  it('says who paid, and what the partner put in with the vendor it looks like', async () => {
    setup();
    const who = await screen.findByRole('region', { name: 'Who paid' });
    expect(who.textContent).toContain('Sam’s cards');
    expect(who.textContent).toContain('looks like it is for Example Reno');
    expect(who.textContent).not.toContain('Sam Grab');
    expect(who.textContent).toContain('S$1,500.00 of the S$1,540.00 Sam put into the joint account during the project names something for the home.');
  });

  it('exports CSV as the one primary action, and says where the copy went', async () => {
    const create = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    const api = setup();
    const button = await screen.findByRole('button', { name: 'Export CSV' });
    expect(button.className).toContain('ty-btn-primary');
    fireEvent.click(button);
    await waitFor(() => expect(api.exportHome).toHaveBeenCalled());
    expect((await screen.findByRole('status')).textContent).toBe('Downloaded home-project-2026-09-19.csv. A copy is in outputs/exports.');
    expect(create).toHaveBeenCalled();
  });

  it('asks you to tag payments when nothing belongs to the home yet', async () => {
    setup({ home: vi.fn(async () => homeData({ rows: [], totalCents: 0, buckets: [], vendors: [], payers: [], unseen: { cents: 0, accounts: [] }, unsortedLarge: { count: 0, cents: 0 } })) });
    expect(await screen.findByRole('heading', { name: 'Nothing tagged to the home yet' })).toBeTruthy();
  });
});

describe('parseCents', () => {
  it('reads amounts as people type them', () => {
    expect(parseCents('1,250.5')).toBe(1_250_50);
    expect(parseCents('S$ 60,000')).toBe(60_000_00);
    expect(parseCents('')).toBeNull();
    expect(parseCents('12.345')).toBeNaN();
    expect(parseCents('1,2,3')).toBeNaN();
    expect(parseCents('S$1,234.56')).toBe(1_234_56);
  });
});

describe('CumulativeLine', () => {
  it('draws one marker per month, labels the latest total, and has a table', () => {
    const { container } = render(
      <CumulativeLine
        label="Home spending so far"
        points={[
          { month: '2026-02', cents: 0 },
          { month: '2026-03', cents: 4_080_00 },
          { month: '2026-04', cents: 4_580_00 },
        ]}
      />,
    );
    expect(container.querySelectorAll('circle.dot')).toHaveLength(3);
    expect(container.querySelector('path.line')).toBeTruthy();
    expect(screen.getByText('S$4,580')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Home spending so far' }).textContent).toContain('S$4,080.00');
    fireEvent.focus(screen.getByRole('button', { name: 'March 2026: S$4,080.00 so far' }));
    expect(screen.getByRole('tooltip').textContent).toContain('S$4,080.00 that month');
  });
});
