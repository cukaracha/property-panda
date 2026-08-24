import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export type BadgeTone = 'positive' | 'brand' | 'neutral' | 'warning' | 'new';

// Complete-class lookup (cn() has no tailwind-merge) — one entry per tone,
// mapped onto the .badge classes: positive = bamboo outline, brand = solid
// bamboo, neutral = stone, warning = rose (the risk colour), new = clay, which
// is an accent and never an action.
const toneClasses: Record<BadgeTone, string> = {
  positive: 'is-accent',
  brand: 'is-solid',
  neutral: '',
  warning: 'is-rose',
  new: 'is-new',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

/** Small status pill — positive · brand · neutral · warning · new. */
export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return <span className={cn('badge', toneClasses[tone], className)} {...props} />;
}
