import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../../lib/utils';

export interface ChipOption<T extends string | number> {
  value: T;
  label: string;
  /** Hover text, for a chip whose label is a code rather than a name. */
  title?: string;
}

export interface FilterChipGroupProps<T extends string | number> {
  label: string;
  options: ChipOption<T>[];
  selected: T[];
  onToggle: (value: T) => void;
  /** Optional control rendered on the label row, for a second way into the same filter. */
  action?: ReactNode;
  /**
   * Values there is nothing to choose. Set only where the choices are bounded by data
   * already on screen, as on the results filter: a chip that would match nothing is
   * shown greyed rather than dropped, so the row still reads as the whole range of the
   * filter and the absence is itself the answer.
   */
  unavailable?: T[];
}

/**
 * One labelled row of multi choice toggle chips, used for every code list in the
 * search filters. Chips rather than a select because the whole selection stays visible
 * at a glance instead of hidden inside a closed list.
 *
 * A selected chip carries a check glyph as well as a fill, so the selection is never
 * signalled by colour alone. Chips size to their content rather than to a grid, which
 * is what gives the check somewhere to go.
 */
export default function FilterChipGroup<T extends string | number>({
  label,
  options,
  selected,
  onToggle,
  action,
  unavailable,
}: FilterChipGroupProps<T>) {
  return (
    <div>
      <div className='mb-1.5 flex items-center justify-between gap-2'>
        <p className='type-ui-eyebrow'>{label}</p>
        {action}
      </div>
      <div className='flex flex-wrap gap-2'>
        {options.map(option => {
          const isSelected = selected.includes(option.value);
          const isUnavailable = unavailable?.includes(option.value) ?? false;
          return (
            <button
              key={option.value}
              type='button'
              disabled={isUnavailable}
              title={
                isUnavailable
                  ? `${option.title ?? option.label} (not in these results)`
                  : option.title
              }
              aria-pressed={isSelected}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-sm font-medium transition-colors',
                isUnavailable
                  ? 'cursor-not-allowed border-line-2 text-subtle opacity-60'
                  : isSelected
                    ? 'border-line-brand bg-brand-subtle text-brand'
                    : 'border-line text-muted hover:bg-sunken hover:text-strong'
              )}
              onClick={() => onToggle(option.value)}
            >
              {isSelected && <Check size={13} aria-hidden />}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
