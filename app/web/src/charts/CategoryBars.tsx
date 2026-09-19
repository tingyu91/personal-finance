import { useId, useState } from 'react';
import { formatSGD } from '../format';
import { useWidth } from './useWidth';

export interface CategoryBarDatum {
  name: string;
  /** Design-system chart slot, 1–8 for life. 0 is Other. */
  slot: number;
  cents: number;
  medianCents: number | null;
}

/** Slot colour. Other has no slot, so it takes the neutral ink. */
export function slotFill(slot: number): string {
  return slot >= 1 && slot <= 8 ? `var(--chart-${slot})` : 'var(--ink-muted)';
}

/** "About 2.7 times the usual", "About 30% below the usual", or "About the usual". */
export function versusUsual(cents: number, median: number | null): string | null {
  if (median === null || median <= 0) return null;
  const ratio = cents / median;
  if (ratio >= 1.15) return `About ${ratio.toFixed(1)} times the usual`;
  if (ratio <= 0.85) return `About ${Math.round((1 - ratio) * 100)}% below the usual`;
  return 'About the usual';
}

const BAR = 12;
const ROW = 24;
const R = 4;

/**
 * "Where it went": one horizontal bar per category against its six-month median. Bars keep
 * their slot colour whatever the order; every bar carries its name and value in text; a
 * tick marks the median; hover or focus explains a bar; the same numbers come as a table.
 */
export function CategoryBars({ bars, caption = 'Spending by category' }: { bars: CategoryBarDatum[]; caption?: string }) {
  const [asTable, setAsTable] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [trackRef, width] = useWidth<HTMLDivElement>(320);
  const tipId = useId();
  const max = Math.max(1, ...bars.map((b) => Math.max(b.cents, b.medianCents ?? 0)));
  const x = (cents: number) => Math.max(0, (Math.max(0, cents) / max) * (width - 2));

  return (
    <figure className="chart catbars">
      <figcaption className="visually-hidden">{caption}</figcaption>
      {asTable ? (
        <div className="table-wrap">
          <table className="table">
            <caption className="visually-hidden">{caption}</caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col" className="num">
                  This month
                </th>
                <th scope="col" className="num">
                  Six-month median
                </th>
              </tr>
            </thead>
            <tbody>
              {bars.map((b) => (
                <tr key={b.name}>
                  <th scope="row">{b.name}</th>
                  <td className="num">{formatSGD(b.cents)}</td>
                  <td className="num">{b.medianCents === null ? 'No history yet' : formatSGD(b.medianCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="catbars-list">
          {bars.map((b, i) => {
            const w = x(b.cents);
            const m = b.medianCents === null ? null : x(b.medianCents);
            const open = active === b.name;
            return (
              <li
                key={b.name}
                className="catbar"
                role="listitem"
                aria-label={`${b.name}, ${formatSGD(b.cents)}`}
                aria-describedby={open ? tipId : undefined}
                tabIndex={0}
                onMouseEnter={() => setActive(b.name)}
                onMouseLeave={() => setActive((a) => (a === b.name ? null : a))}
                onFocus={() => setActive(b.name)}
                onBlur={() => setActive((a) => (a === b.name ? null : a))}
              >
                <span className="catbar-name">
                  <span className="ty-dot" style={{ background: slotFill(b.slot) }} aria-hidden="true" />
                  {b.name}
                </span>
                <span className="catbar-value">{formatSGD(b.cents)}</span>
                <div className="catbar-track" ref={i === 0 ? trackRef : undefined}>
                  <svg width="100%" height={ROW} aria-hidden="true" focusable="false">
                    <line className="grid-base" x1={0.5} x2={0.5} y1={0} y2={ROW} />
                    {w > 0 ? (
                      <>
                        <rect className="bar" x={1} y={(ROW - BAR) / 2} width={w} height={BAR} rx={Math.min(R, w / 2)} fill={slotFill(b.slot)} />
                        {/* Square at the baseline: cover the left corners. */}
                        <rect className="bar-base" x={1} y={(ROW - BAR) / 2} width={Math.max(0, w - R)} height={BAR} fill={slotFill(b.slot)} />
                      </>
                    ) : null}
                    {m !== null ? <line className="median" x1={m + 1} x2={m + 1} y1={2} y2={ROW - 2} /> : null}
                  </svg>
                </div>
                {open ? (
                  <div className="chart-tip" role="tooltip" id={tipId}>
                    <strong>{b.name}</strong>
                    <span className="tip-figure">{formatSGD(b.cents)}</span>
                    <span>{b.medianCents === null ? 'No six-month history yet' : `Six-month median ${formatSGD(b.medianCents)}`}</span>
                    {versusUsual(b.cents, b.medianCents) ? <span>{versusUsual(b.cents, b.medianCents)}</span> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <div className="chart-foot">
        {asTable ? null : (
          <span className="ty-note legend-median">
            <svg width="10" height="14" aria-hidden="true" focusable="false">
              <line className="median" x1={5} x2={5} y1={1} y2={13} />
            </svg>
            Six-month median
          </span>
        )}
        <button type="button" className="ty-link" onClick={() => setAsTable((t) => !t)}>
          {asTable ? 'Show as chart' : 'Show as table'}
        </button>
      </div>
    </figure>
  );
}
