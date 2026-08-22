import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize;
  /** Use on cyan fills so the ring reads against the accent surface. */
  onBrand?: boolean;
}

/**
 * Spinner — loading affordance. Pairs with Button `loading`.
 * Renders the `.lms-spinner*` classes from styles/app.css.
 */
export function Spinner({ size = 'md', onBrand = false, className, ...rest }: SpinnerProps) {
  return (
    <span
      role='status'
      aria-label='Loading'
      className={cn(
        'lms-spinner',
        size !== 'md' && `lms-spinner--${size}`,
        onBrand && 'lms-spinner--on-brand',
        className
      )}
      {...rest}
    />
  );
}
