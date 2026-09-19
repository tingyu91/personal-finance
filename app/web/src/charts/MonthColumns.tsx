import { useId, useState } from 'react';
import { formatSGD, monthLabel } from '../format';
import { useWidth } from './useWidth';

export interface MonthPoint {
  month: string;
  cents: number;
}

const H = 120;
const TOP = 20;
const AXIS = 20;
const COL = 24;
const R = 4;

/**
 * One series over months as thin columns on one axis, the current month in accent and
 * labelled; hover or focus names any other month; a screen-reader table carries every value.
 */
export function MonthColumns({ label, points, current }: { label: string; points: MonthPoint[]; current: string }) {
  const [ref, width] = useWidth<HTMLDivElement>(480);
  const [active, setActive] = useState<string | null>(null);
  const tipId = useId();
  const max = Math.max(1, ...points.map((p) => p.cents));
  const slot = points.length ? width / points.length : width;
  const colW = Math.max(6, Math.min(COL, slot - 8));
  const plot = H - TOP - AXIS;
  const heightOf = (c: number) => (Math.max(0, c) / max) * plot;

  return (
    <figure className="chart monthcols">
      <figcaption className="visually-hidden">{label} by month</figcaption>
      <div className="monthcols-plot" ref={ref}>
        <svg width="100%" height={H} aria-hidden="true" focusable="false">
          <line className="grid-base" x1={0} x2={width} y1={H - AXIS + 0.5} y2={H - AXIS + 0.5} />
          {points.map((p, i) => {
            const h = heightOf(p.cents);
            const cx = slot * i + slot / 2;
            const x = cx - colW / 2;
            const y = H - AXIS - h;
            const isCurrent = p.month === current;
            const fill = isCurrent ? 'var(--accent)' : 'var(--line-strong)';
            return (
              <g key={p.month}>
                {h > 0 ? (
                  <>
                    <rect className="col" x={x} y={y} width={colW} height={h} rx={Math.min(R, h / 2)} fill={fill} />
                    <rect className="col-base" x={x} y={y + Math.min(R, h / 2)} width={colW} height={Math.max(0, h - Math.min(R, h / 2))} fill={fill} />
                  </>
                ) : null}
                {isCurrent ? (
                  // The first and last labels hang inward so they never run past the plot.
                  <text
                    className="col-value"
                    x={i === points.length - 1 && points.length > 1 ? x + colW : i === 0 && points.length > 1 ? x : cx}
                    y={y - 6}
                    textAnchor={i === points.length - 1 && points.length > 1 ? 'end' : i === 0 && points.length > 1 ? 'start' : 'middle'}
                  >
                    {formatSGD(p.cents, { round: true })}
                  </text>
                ) : null}
                <text className={isCurrent ? 'col-month col-month-current' : 'col-month'} x={cx} y={H - 4} textAnchor="middle">
                  {monthLabel(p.month, 'tiny')}
                </text>
              </g>
            );
          })}
        </svg>
        {/* Hit targets wider than the marks, for hover and keyboard focus. */}
        <div className="monthcols-hits">
          {points.map((p) => (
            <button
              key={p.month}
              type="button"
              className="monthcols-hit"
              aria-label={`${monthLabel(p.month)}: ${formatSGD(p.cents)}`}
              aria-describedby={active === p.month ? tipId : undefined}
              onMouseEnter={() => setActive(p.month)}
              onMouseLeave={() => setActive((a) => (a === p.month ? null : a))}
              onFocus={() => setActive(p.month)}
              onBlur={() => setActive((a) => (a === p.month ? null : a))}
            />
          ))}
        </div>
        {active ? (
          <div
            className="chart-tip monthcols-tip"
            role="tooltip"
            id={tipId}
            style={{ left: `${((points.findIndex((p) => p.month === active) + 0.5) / Math.max(1, points.length)) * 100}%` }}
          >
            <strong>{monthLabel(active)}</strong>
            <span className="tip-figure">{formatSGD(points.find((p) => p.month === active)!.cents)}</span>
          </div>
        ) : null}
      </div>
      <table className="visually-hidden" aria-label={`${label} by month`}>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">{label}</th>
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
