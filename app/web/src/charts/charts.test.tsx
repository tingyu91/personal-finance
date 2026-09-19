// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CategoryBars } from './CategoryBars';
import { MonthColumns } from './MonthColumns';

afterEach(cleanup);

const bars = [
  { name: 'Transport', slot: 2, cents: 400_00, medianCents: 150_00 },
  { name: 'Food & groceries', slot: 1, cents: 300_00, medianCents: 320_00 },
  { name: 'Other', slot: 0, cents: 50_00, medianCents: null },
];

describe('CategoryBars', () => {
  it('keeps each category in its own slot colour, whatever the order', () => {
    const { container } = render(<CategoryBars bars={bars} />);
    const fills = Array.from(container.querySelectorAll<SVGRectElement>('rect.bar')).map((r) => r.getAttribute('fill'));
    expect(fills).toEqual(['var(--chart-2)', 'var(--chart-1)', 'var(--ink-muted)']);
  });

  it('labels every bar with its category and value in text, never colour alone', () => {
    render(<CategoryBars bars={bars} />);
    for (const name of ['Transport', 'Food & groceries', 'Other']) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.getByText('S$400.00')).toBeTruthy();
    expect(screen.getByText('S$50.00')).toBeTruthy();
  });

  it('explains a bar on hover and focus, including the six-month median', () => {
    render(<CategoryBars bars={bars} />);
    fireEvent.focus(screen.getByRole('listitem', { name: /Transport/ }));
    const tip = screen.getByRole('tooltip');
    expect(within(tip).getByText('S$400.00')).toBeTruthy();
    expect(tip.textContent).toContain('Six-month median S$150.00');
    expect(tip.textContent).toContain('About 2.7 times the usual');
  });

  it('offers the same numbers as a table', () => {
    render(<CategoryBars bars={bars} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('S$320.00')).toBeTruthy();
    expect(within(table).getByText('No history yet')).toBeTruthy();
  });
});

describe('MonthColumns', () => {
  it('draws one column per month, highlights the current one, and has a readable table', () => {
    const { container } = render(
      <MonthColumns
        label="Cash on hand"
        points={[
          { month: '2026-06', cents: 10_000_00 },
          { month: '2026-07', cents: 12_500_00 },
          { month: '2026-08', cents: 11_000_00 },
        ]}
        current="2026-08"
      />,
    );
    const cols = container.querySelectorAll('rect.col');
    expect(cols).toHaveLength(3);
    expect(cols[2]!.getAttribute('fill')).toBe('var(--accent)');
    expect(screen.getByText('S$11,000')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Cash on hand by month' }).textContent).toContain('S$12,500.00');
  });
});
