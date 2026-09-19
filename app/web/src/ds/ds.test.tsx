// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Amount, Button, CategoryChip, CoverageGrid, DropZone, Insight, Stat, TransactionRow } from './index';
import { formatSGD, monthLabel, shortDate } from '../format';

afterEach(cleanup);

describe('format', () => {
  it('formats SGD from cents without floating point', () => {
    expect(formatSGD(123456)).toBe('S$1,234.56');
    expect(formatSGD(-5)).toBe('S$0.05');
    expect(formatSGD(123456, { round: true })).toBe('S$1,235');
    expect(formatSGD(1089, { currency: 'USD ' })).toBe('USD 10.89');
    expect(shortDate('2026-08-07')).toBe('07 Aug');
    expect(monthLabel('2026-08')).toBe('August 2026');
    expect(monthLabel('2026-08', 'short')).toBe('Aug 2026');
  });
});

describe('Amount', () => {
  it('writes outflows in ink with a true minus and a spoken label', () => {
    render(<Amount cents={-123456} />);
    const el = screen.getByLabelText('Out S$1,234.56');
    expect(el.textContent).toBe('−S$1,234.56');
    expect(el.className).toContain('ty-amt-outflow');
  });
  it('writes inflows with a plus, and transfers muted and unsigned in intent', () => {
    render(<Amount cents={1000} />);
    expect(screen.getByLabelText('In S$10.00').textContent).toBe('+S$10.00');
    render(<Amount cents={-5000} kind="transfer" />);
    expect(screen.getByLabelText('Transfer of S$50.00').className).toContain('ty-amt-transfer');
  });
  it('drops the sign for the display size', () => {
    render(<Amount cents={-412000} size="display" round />);
    expect(screen.getByLabelText('Out S$4,120.00').textContent).toBe('S$4,120');
  });
});

describe('Button, Stat and CategoryChip', () => {
  it('defaults to a quiet button of type button', () => {
    render(<Button>Mark as transfer</Button>);
    const b = screen.getByRole('button', { name: 'Mark as transfer' });
    expect(b.getAttribute('type')).toBe('button');
    expect(b.className).toContain('ty-btn-quiet');
  });
  it('shows a stat label, figure and note', () => {
    render(<Stat label="Income" cents={500000} note="Not counting S$300.00 from your partner" />);
    expect(screen.getByText('Income')).toBeTruthy();
    expect(screen.getByLabelText('Out S$5,000.00').textContent).toBe('S$5,000.00');
    expect(screen.getByText('Not counting S$300.00 from your partner')).toBeTruthy();
  });
  it('colours a chip by its fixed slot, with ink-muted for Other', () => {
    const { container } = render(
      <>
        <CategoryChip name="Transport" slot={2} />
        <CategoryChip name="Other" slot={0} />
      </>,
    );
    const dots = container.querySelectorAll<HTMLElement>('.ty-dot');
    expect(dots[0]!.style.background).toBe('var(--chart-2)');
    expect(dots[1]!.style.background).toBe('var(--ink-muted)');
    expect(screen.getByText('Transport')).toBeTruthy();
  });
});

describe('TransactionRow', () => {
  it('shows payee over raw text, the flag word and a muted amount for transfers', () => {
    render(
      <div className="ty-txns" role="table">
        <TransactionRow date="2026-08-20" payee="Card ·1111" raw="Advice Bill Payment · CCC - ·1111" account="DBS My Account ·9871" cents={-31245} flag="transfer" />
      </div>,
    );
    expect(screen.getByText('Transfer')).toBeTruthy();
    expect(screen.getByText('20 Aug')).toBeTruthy();
    expect(screen.getByLabelText('Transfer of S$312.45').className).toContain('ty-amt-transfer');
  });
});

describe('DropZone', () => {
  it('lists every receipt item with its word, including the statuses Tally adds', () => {
    render(
      <DropZone
        state="done"
        summary="2 statements imported."
        items={[
          { name: 'a.pdf', status: 'imported', detail: 'DBS Savings Account ·9876, Feb 2026, 8 rows' },
          { name: 'b.pdf', status: 'duplicate' },
          { name: 'c.pdf', status: 'unrecognised' },
          { name: 'd.pdf', status: 'failed' },
          { name: 'e.pdf', status: 'locked' },
          { name: 'f.pdf', status: 'conflict' },
          { name: 'g.pdf', status: 'error' },
        ]}
      />,
    );
    for (const word of ['Imported', 'Already here', 'Not recognised', 'Totals don’t match', 'Needs password', 'Clashes', 'Not imported']) {
      expect(screen.getByText(word)).toBeTruthy();
    }
    expect(screen.getByRole('heading', { name: '2 statements imported.' })).toBeTruthy();
  });

  it('is a labelled region whose button opens the file picker, and hands files over', () => {
    const onFiles = vi.fn();
    const { container } = render(<DropZone onFiles={onFiles} />);
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    expect(screen.getByRole('region', { name: 'Import statements' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose files' }));
    expect(click).toHaveBeenCalled();
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFiles).toHaveBeenCalledWith([file]);
  });
});

describe('CoverageGrid and Insight', () => {
  it('marks each cell with a glyph and a word, never colour alone', () => {
    render(<CoverageGrid months={['Jul', 'Aug']} current={1} rows={[{ account: 'Card ·5566', cells: ['missing', 'ok'] }]} />);
    expect(screen.getByLabelText('Missing').textContent).toBe('!');
    expect(screen.getByLabelText('Imported').textContent).toBe('✓');
  });
  it('always shows the level word', () => {
    render(<Insight level="watch" title="Two payments of the same amount" detail="Check with the seller." />);
    expect(screen.getByText('Watch')).toBeTruthy();
  });
});
