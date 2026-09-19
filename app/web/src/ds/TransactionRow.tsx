import { shortDate } from '../format';
import { Amount, kindOf, type AmountKind } from './Amount';
import { CategoryChip, type CategoryChipProps } from './CategoryChip';
import { cx } from './cx';

/** Ported from design-system/components (TransactionRow). Rows sit inside a `.ty-txns` table. */
export type RowFlag = 'review' | 'transfer' | 'duplicate' | 'refund' | 'project';

export const FLAGS: Record<RowFlag, [string, string]> = {
  review: ['ty-pill-watch', 'Review'],
  transfer: ['ty-pill-muted', 'Transfer'],
  duplicate: ['ty-pill-critical', 'Possible duplicate'],
  refund: ['ty-pill-muted', 'Refund pair'],
  project: ['ty-pill-info', 'Home project'],
};

export function Pill({ flag, label }: { flag: RowFlag; label?: string }) {
  const [cls, word] = FLAGS[flag];
  return <span className={cx('ty-pill', cls)}>{label ?? word}</span>;
}

export interface TransactionRowProps {
  date: string;
  payee: string;
  raw?: string;
  account?: string;
  category?: CategoryChipProps;
  cents: number;
  kind?: AmountKind;
  flag?: RowFlag;
  className?: string;
}

export function TransactionRow({ date, payee, raw, account, category, cents, kind, flag, className }: TransactionRowProps) {
  const k = flag === 'transfer' ? 'transfer' : kindOf(cents, kind);
  return (
    <div className={cx('ty-txn', className)} role="row">
      <span className="ty-txn-date" role="cell">
        {shortDate(date)}
      </span>
      <span className="ty-txn-main" role="cell">
        <span className="ty-txn-payee">
          {payee}
          {flag ? <Pill flag={flag} /> : null}
        </span>
        {raw ? (
          <span className="ty-raw" title={raw}>
            {raw}
          </span>
        ) : null}
      </span>
      <span className="ty-txn-meta" role="cell">
        {category ? <CategoryChip {...category} /> : null}
        {account ? <span className="ty-raw">{account}</span> : null}
      </span>
      <span role="cell">
        <Amount cents={cents} kind={k} />
      </span>
    </div>
  );
}
