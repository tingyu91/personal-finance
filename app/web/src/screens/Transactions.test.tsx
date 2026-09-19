// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DataProvider } from '../data';
import { Transactions } from './Transactions';
import { stubApi } from '../test/stubApi';
import type { TransactionView } from '../api';

afterEach(cleanup);
beforeEach(() => {
  window.location.hash = '#/transactions?month=2026-08&review=1';
});

const row = (over: Partial<TransactionView>): TransactionView => ({
  fingerprint: 'fp1',
  date: '2026-08-07',
  postDate: null,
  payee: 'John Doe',
  raw: 'Advice FAST Payment / Receipt · PAYNOW TRANSFER 1234567 · TO: JOHN DOE',
  amountCents: -17_00,
  currency: 'SGD',
  fx: null,
  kind: 'unclassified',
  category: null,
  slot: 0,
  bucket: null,
  vendor: null,
  note: null,
  needsReview: true,
  decided: false,
  manual: false,
  accountId: 1,
  account: 'DBS My Account ·9871',
  cardholder: null,
  pairFingerprint: null,
  targetAccount: null,
  held: false,
  ...over,
});

function setup(rows: TransactionView[]) {
  const decide = vi.fn(async (fp: string) => ({ transaction: { ...rows.find((r) => r.fingerprint === fp)! } }));
  const api = stubApi({ transactions: vi.fn(async () => ({ rows, total: rows.length, outCents: -17_00, inCents: 0 })), decide });
  render(
    <DataProvider api={api}>
      <Transactions />
    </DataProvider>,
  );
  return api;
}

describe('Transactions screen', () => {
  it('reads its filters from the address', async () => {
    const api = setup([row({})]);
    await screen.findByText('John Doe');
    expect(api.transactions).toHaveBeenCalledWith(expect.objectContaining({ month: '2026-08', review: true }));
    expect((screen.getByLabelText('Review only') as HTMLInputElement).checked).toBe(true);
  });

  it('sorts a row, and can make it the rule for that payee', async () => {
    const api = setup([row({})]);
    fireEvent.click(await screen.findByText('John Doe'));
    const editor = screen.getByRole('form', { name: 'Sort John Doe' });
    fireEvent.change(within(editor).getByLabelText('Kind'), { target: { value: 'spend' } });
    fireEvent.change(within(editor).getByLabelText('Category'), { target: { value: 'Family & giving' } });
    fireEvent.click(within(editor).getByLabelText('Always do this for John Doe'));
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.decide).toHaveBeenCalledWith('fp1', { kind: 'spend', category: 'Family & giving', bucket: null, note: null }, true),
    );
  });

  it('marks several rows as transfers at once', async () => {
    const api = setup([row({}), row({ fingerprint: 'fp2', payee: 'Mary Lim' })]);
    await screen.findByText('Mary Lim');
    fireEvent.click(screen.getByLabelText('Select John Doe'));
    fireEvent.click(screen.getByLabelText('Select Mary Lim'));
    expect(screen.getByText('2 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as transfer' }));
    await waitFor(() => expect(api.bulk).toHaveBeenCalledWith(['fp1', 'fp2'], { kind: 'transfer', category: null }));
  });

  it('drops the bucket and category when a home row becomes a transfer', async () => {
    const api = setup([row({ kind: 'spend', category: 'Home project', bucket: 'renovation', needsReview: false })]);
    fireEvent.click(await screen.findByText('John Doe'));
    const editor = screen.getByRole('form', { name: 'Sort John Doe' });
    fireEvent.change(within(editor).getByLabelText('Kind'), { target: { value: 'transfer' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.decide).toHaveBeenCalledWith('fp1', { kind: 'transfer', category: null, bucket: null, note: null }, false));
  });

  it('says when a bulk change is refused, and that nothing changed', async () => {
    const api = setup([row({})]);
    (api.bulk as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Only spending can go to the home project.'));
    fireEvent.click(await screen.findByLabelText('Select John Doe'));
    fireEvent.click(screen.getByRole('button', { name: 'Mark as transfer' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Only spending can go to the home project. Nothing was changed.');
  });

  it('shows a held row and a card repayment for what they are', async () => {
    setup([
      row({ fingerprint: 'h', payee: 'Held shop', held: true, needsReview: false, kind: 'spend', category: 'Other' }),
      row({ fingerprint: 'c', payee: 'Card ·1111', kind: 'card-repayment', needsReview: false, targetAccount: 'UOB Preferred Visa ·1111' }),
    ]);
    expect(await screen.findByText('Held')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Transactions' })).getByText('Card repayment')).toBeTruthy();
    expect(screen.getByLabelText('Transfer of S$17.00')).toBeTruthy();
  });
});
