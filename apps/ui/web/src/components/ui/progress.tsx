import { cn } from '../../lib/utils';

export interface ProgressProps {
  /** Fill amount, 0-100 (clamped). */
  value: number;
  /** Fill colour. Data-driven (e.g. a unit identity colour), so set via inline style. Defaults to the cyan accent. */
  color?: string;
  /** Track (background) colour. */
  track?: string;
  /** Bar height in pixels. */
  height?: number;
  className?: string;
}

/**
 * Progress — a rounded 0-100% bar. The fill width and colours are data-driven
 * (unit identity colour is the sanctioned inline-style exception). Used by the
 * Dashboard, Course, and Lesson views.
 */
export function Progress({
  value,
  color = 'var(--cyan)',
  track = 'var(--panel-2)',
  height = 8,
  className,
}: ProgressProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn('w-full overflow-hidden rounded-full border border-line', className)}
      style={{ height, background: track }}
    >
      <div
        className='h-full rounded-full transition-[width] duration-300 ease-[var(--ease-out)] motion-reduce:transition-none'
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}
