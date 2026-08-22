import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export type BadgeTone = 'positive' | 'brand' | 'neutral' | 'warning';

// Complete-class lookup (cn() has no tailwind-merge) — one entry per tone,
// mapped onto the ported .badge classes: completed = cyan outline, current =
// solid cyan, locked/later = neutral, due/urgent = rose (the risk colour).
const toneClasses: Record<BadgeTone, string> = {
  positive: 'is-accent',
  brand: 'is-solid',
  neutral: '',
  warning: 'is-rose',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

/** Small status pill — Completed (positive) · In progress (brand) · Locked/Upcoming (neutral) · Due (warning). */
export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return <span className={cn('badge', toneClasses[tone], className)} {...props} />;
}
