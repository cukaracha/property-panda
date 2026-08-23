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
}: FilterChipGroupProps<T>) {
  return (
    <div>
      <p className='type-ui-eyebrow mb-1.5'>{label}</p>
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
