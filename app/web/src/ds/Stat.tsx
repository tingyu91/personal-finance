import type { ReactNode } from 'react';
import { Amount, type AmountKind } from './Amount';
import { cx } from './cx';

/** Ported from design-system/components (Stat): an uppercase label, one figure, one line of context. */
export interface StatProps {
  label: string;
  cents?: number;
  value?: ReactNode;
  kind?: AmountKind;
  round?: boolean;
  note?: ReactNode;
  className?: string;
}

export function Stat({ label, cents, value, kind, round, note, className }: StatProps) {
  return (
    <div className={cx('ty-card', 'ty-stat', className)}>
      <span className="ty-label">{label}</span>
      {cents !== undefined ? <Amount cents={cents} kind={kind ?? 'outflow'} size="lg" signed={false} round={round} /> : <span className="ty-amt ty-amt-lg">{value}</span>}
      {note ? <span className="ty-note">{note}</span> : null}
    </div>
  );
}
