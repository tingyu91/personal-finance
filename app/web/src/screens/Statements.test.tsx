// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DataProvider } from '../data';
import { Statements } from './Statements';
import { stubApi } from '../test/stubApi';

afterEach(cleanup);

function setup(over = {}) {
  const api = stubApi(over);
  const utils = render(
    <DataProvider api={api}>
      <Statements />
    </DataProvider>,
  );
  return { api, ...utils };
}

describe('Statements screen', () => {
  it('imports dropped files and shows the receipt, with a password field for a locked PDF', async () => {
    const importFiles = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          { name: 'a.pdf', status: 'imported', detail: 'DBS Savings Account ·9876, Aug 2026, 8 rows' },
          { name: 'b.pdf', status: 'locked', detail: 'This PDF needs its password' },
        ],
        summary: '1 statement imported. 1 needs a password.',
      })
      .mockResolvedValueOnce({ items: [{ name: 'b.pdf', status: 'imported', detail: 'Opened' }], summary: '1 statement imported.' });
    const { container, api } = setup({ importFiles });
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    const a = new File(['a'], 'a.pdf', { type: 'application/pdf' });
    const b = new File(['b'], 'b.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [a, b] } });
    expect(await screen.findByRole('heading', { name: '1 statement imported. 1 needs a password.' })).toBeTruthy();
    expect(screen.getByText('Needs password')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Password for b.pdf'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open b.pdf with this password' }));
    await waitFor(() => expect(api.importFiles).toHaveBeenLastCalledWith([b], 'secret'));
    expect(await screen.findByText('Opened')).toBeTruthy();
  });

  it('shows coverage, with cards Tally only sees as repayment targets missing every month', async () => {
    setup();
    expect((await screen.findAllByText('Card ·5566')).length).toBe(2); // grid row and the unseen-money list
    expect(screen.getAllByLabelText('Missing')).toHaveLength(2);
    expect(screen.getByText(/S\$1,318\.27 went to it/)).toBeTruthy();
  });

  it('lists statements that do not reconcile with the failing check and the ways to resolve them', async () => {
    const files = vi.fn(async () => ({
      files: [
        {
          id: 7,
          name: 'eStatement.pdf',
          month: '2026-07',
          importedAt: '2026-09-19T00:00:00.000Z',
          adapter: 'uob-deposit',
          statements: [
            {
              id: 3,
              account: 'UOB One Account ·5555',
              accountId: 1,
              month: '2026-07',
              periodStart: '2026-07-01',
              periodEnd: '2026-07-31',
              rows: 6,
              reconciled: false,
              accepted: false,
              failure: 'Withdrawals match the printed total: statement says S$1.00, rows add up to S$0.90',
            },
          ],
        },
      ],
    }));
    const { api } = setup({ files });
    expect(await screen.findByText(/statement says S\$1\.00, rows add up to S\$0\.90/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept these totals for UOB One Account ·5555, July 2026' }));
    await waitFor(() => expect(api.acceptStatement).toHaveBeenCalledWith(3));
  });
});
