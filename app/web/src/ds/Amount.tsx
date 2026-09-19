import { formatSGD, MINUS } from '../format';
import { cx } from './cx';

/** Ported from design-system/components (Amount): every money value in Tally goes through it. */
export type AmountKind = 'outflow' | 'inflow' | 'transfer';

export interface AmountProps {
  /** Integer cents, SGD. Negative is money out. */
  cents: number;
  kind?: AmountKind;
  size?: 'md' | 'lg' | 'display';
  signed?: boolean;
  round?: boolean;
  className?: string;
}

export function kindOf(cents: number, kind?: AmountKind): AmountKind {
  return kind ?? (cents < 0 ? 'outflow' : 'inflow');
}

export function Amount({ cents, kind, size = 'md', signed, round, className }: AmountProps) {
  const k = kindOf(cents, kind);
  const withSign = signed === undefined ? size !== 'display' : signed;
  const sign = withSign ? (k === 'outflow' ? MINUS : k === 'inflow' ? '+' : '') : '';
  const label = `${k === 'transfer' ? 'Transfer of ' : k === 'inflow' ? 'In ' : 'Out '}${formatSGD(cents)}`;
  return (
    <span className={cx('ty-amt', `ty-amt-${k}`, `ty-amt-${size}`, className)} aria-label={label}>
      {sign}
      {formatSGD(cents, { round })}
    </span>
  );
}
