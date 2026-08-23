import type { ReactNode } from 'react';
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
}

/**
 * One labelled row of multi choice toggle chips, used for every code list in the
 * search filters. Chips rather than a select because the whole selection stays visible
 * at a glance instead of hidden inside a closed list.
 */
export default function FilterChipGroup<T extends string | number>({
  label,
  options,
  selected,
  onToggle,
  action,
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
          return (
            <button
              key={option.value}
              type='button'
              title={option.title}
              aria-pressed={isSelected}
              className={cn(
                'rounded-control border px-3 py-1.5 text-sm transition-colors',
                isSelected
                  ? 'border-accent-line bg-accent-soft text-cyan'
                  : 'border-line text-ink-3 hover:text-ink'
              )}
              onClick={() => onToggle(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
