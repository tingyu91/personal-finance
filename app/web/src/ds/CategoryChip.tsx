import { cx } from './cx';

/** Ported from design-system/components (CategoryChip). The slot is the category's for life. */
export interface CategoryChipProps {
  name: string;
  /** 1–8: the category's fixed chart slot; 0 = Other. */
  slot?: number;
  className?: string;
}

export function CategoryChip({ name, slot = 0, className }: CategoryChipProps) {
  const background = slot ? `var(--chart-${slot})` : 'var(--ink-muted)';
  return (
    <span className={cx('ty-chip', className)}>
      <span className="ty-dot" style={{ background }} aria-hidden="true" />
      {name}
    </span>
  );
}
