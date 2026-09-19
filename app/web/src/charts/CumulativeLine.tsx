import { useId, useState } from 'react';
import { formatSGD, monthLabel } from '../format';
import { useWidth } from './useWidth';
import type { MonthPoint } from './MonthColumns';

const H = 160;
const TOP = 24;
const AXIS = 20;
const PAD = 8;

/**
 * A running total over months: one 2px line in accent, 8px markers, the latest value labelled,
 * a baseline at zero, hover or focus on any month for its total, and a screen-reader table.
 */
export function CumulativeLine({ label, points }: { label: string; points: MonthPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>(480);
  const [active, setActive] = useState<number | null>(null);
  const tipId = useId();
  const max = Math.max(1, ...points.map((p) => p.cents));
  const slot = points.length ? (width - PAD * 2) / points.length : width;
  const xOf = (i: number) => PAD + slot * i + slot / 2;
  const yOf = (c: number) => TOP + (1 - Math.max(0, c) / max) * (H - TOP - AXIS);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(p.cents).toFixed(1)}`).join(' ');
  const last = points.length - 1;

  return (
    <figure className="chart cumline">
      <figcaption className="visually-hidden">{label}</figcaption>
      <div className="monthcols-plot" ref={ref}>
        <svg width="100%" height={H} aria-hidden="true" focusable="false">
          <line className="grid-base" x1={0} x2={width} y1={H - AXIS + 0.5} y2={H - AXIS + 0.5} />
          {points.length > 1 ? <path className="line" d={d} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}
          {points.map((p, i) => (
            <circle
              key={p.month}
              className={i === active ? 'dot dot-active' : 'dot'}
              cx={xOf(i)}
              cy={yOf(p.cents)}
              r={4}
              fill={i === last || i === active ? 'var(--accent)' : 'var(--surface-raised)'}
              stroke="var(--accent)"
              strokeWidth={2}
            />
          ))}
          {last >= 0 ? (
            <text className="col-value" x={xOf(last)} y={yOf(points[last]!.cents) - 10} textAnchor={last > 0 ? 'end' : 'middle'}>
              {formatSGD(points[last]!.cents, { round: true })}
            </text>
          ) : null}
          {points.map((p, i) => (
            <text key={p.month} className="col-month" x={xOf(i)} y={H - 4} textAnchor="middle">
              {monthLabel(p.month, 'tiny')}
            </text>
          ))}
        </svg>
        <div className="monthcols-hits" style={{ left: PAD, right: PAD }}>
          {points.map((p, i) => (
            <button
              key={p.month}
              type="button"
              className="monthcols-hit"
              aria-label={`${monthLabel(p.month)}: ${formatSGD(p.cents)} so far`}
              aria-describedby={active === i ? tipId : undefined}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive((a) => (a === i ? null : a))}
              onFocus={() => setActive(i)}
              onBlur={() => setActive((a) => (a === i ? null : a))}
            />
          ))}
        </div>
        {active !== null && points[active] ? (
          <div className="chart-tip monthcols-tip" role="tooltip" id={tipId} style={{ left: xOf(active), top: yOf(points[active]!.cents) - 8 }}>
            <strong>{monthLabel(points[active]!.month)}</strong>
            <span className="tip-figure">{formatSGD(points[active]!.cents)}</span>
            <span>
              {active > 0 ? `${formatSGD(points[active]!.cents - points[active - 1]!.cents)} that month` : 'The first month'}
            </span>
          </div>
        ) : null}
      </div>
      <table className="visually-hidden" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Total so far</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.month}>
              <th scope="row">{monthLabel(p.month)}</th>
              <td>{formatSGD(p.cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
