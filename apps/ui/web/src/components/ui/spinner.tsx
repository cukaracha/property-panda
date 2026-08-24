import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize;
  /** Use on brand fills so the ring reads against the action surface. */
  onBrand?: boolean;
}

/**
 * Spinner — loading affordance. Pairs with Button `loading`.
 * Renders the `.spinner*` classes from styles/app.css.
 */
export function Spinner({ size = 'md', onBrand = false, className, ...rest }: SpinnerProps) {
  return (
    <span
      role='status'
      aria-label='Loading'
      className={cn(
        'spinner',
        size !== 'md' && `spinner--${size}`,
        onBrand && 'spinner--on-brand',
        className
      )}
      {...rest}
    />
  );
}
