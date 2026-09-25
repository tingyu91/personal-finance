import { Amount } from './Amount';
import { cx } from './cx';

/** Ported from design-system/components (Insight): a level, a plain-sentence title, evidence, worth, one action. */
export type InsightLevel = 'act' | 'watch' | 'info';

const LEVEL: Record<InsightLevel, [string, string]> = {
  act: ['ty-pill-act', 'Act'],
  watch: ['ty-pill-watch', 'Watch'],
  info: ['ty-pill-info', 'Info'],
};

export interface InsightProps {
  level: InsightLevel;
  title: string;
  detail?: string;
  worth?: number;
  worthLabel?: string;
  per?: string;
  action?: string;
  onAction?: () => void;
  /** When the action goes somewhere, a link rather than a button. */
  actionHref?: string;
  className?: string;
  children?: React.ReactNode;
}

export function Insight({ level, title, detail, worth, worthLabel, per, action, onAction, actionHref, className, children }: InsightProps) {
  const [cls, word] = LEVEL[level] ?? LEVEL.info;
  return (
    <div className={cx('ty-insight', className)}>
      <div style={{ display: 'grid', gap: '4px', minWidth: 0 }}>
        <div className="ty-insight-head">
          <span className={cx('ty-pill', cls)}>{word}</span>
          <h3>{title}</h3>
        </div>
        {detail ? <p>{detail}</p> : null}
        {children}
        {action ? (
          <div>
            {actionHref ? (
              <a className="ty-link" href={actionHref}>
                {action}
              </a>
            ) : (
              <button type="button" className="ty-link" onClick={onAction}>
                {action}
              </button>
            )}
          </div>
        ) : null}
      </div>
      {worth !== undefined ? (
        <div className="ty-insight-worth">
          <span className="ty-label">{worthLabel ?? 'Worth about'}</span>
          <Amount cents={worth} kind="inflow" signed={false} round />
          <span className="ty-note">{per ?? 'a year'}</span>
        </div>
      ) : null}
    </div>
  );
}
