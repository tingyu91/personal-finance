import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx';

/** Ported from design-system/components (Button). One primary per screen; quiet is the default. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'quiet';
}

export function Button({ variant = 'quiet', className, type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button type={type} {...rest} className={cx('ty-btn', `ty-btn-${variant}`, className)}>
      {children}
    </button>
  );
}
