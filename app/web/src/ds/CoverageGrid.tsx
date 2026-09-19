import { cx } from './cx';

/** Ported from design-system/components (CoverageGrid): which statement months Tally has, per account. */
export type CoverageCell = 'ok' | 'missing' | 'na';

const CELL: Record<CoverageCell, [string, string, string]> = {
  ok: ['ty-cell-ok', '✓', 'Imported'],
  missing: ['ty-cell-missing', '!', 'Missing'],
  na: ['ty-cell-na', '–', 'Not open'],
};

export interface CoverageGridProps {
  months: string[];
  rows: { account: string; cells: CoverageCell[] }[];
  current?: number;
  className?: string;
}

export function CoverageGrid({ months, rows, current, className }: CoverageGridProps) {
  return (
    <div className={cx('ty-cov', className)}>
      <table>
        <thead>
          <tr>
            <th scope="col">
              <span className="ty-label">Account</span>
            </th>
            {months.map((m, i) => (
              <th key={m + i} scope="col" className={i === current ? 'ty-cur' : undefined}>
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.account}>
              <th scope="row">{r.account}</th>
              {r.cells.map((c, ci) => {
                const [cls, glyph, word] = CELL[c] ?? CELL.na;
                return (
                  <td key={ci} className={cx('ty-cell', cls)} title={`${r.account}, ${months[ci]}: ${word}`} aria-label={word}>
                    {glyph}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
