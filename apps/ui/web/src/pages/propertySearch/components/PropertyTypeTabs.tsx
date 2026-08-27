import { Check, Plus } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { PropertyTypeGroup, SearchFormState } from '../../../types/listings';
import {
  isLastGroupOn,
  PROPERTY_TYPE_GROUP_LABELS,
  PROPERTY_TYPE_GROUPS,
  toggleGroup,
} from '../utils/filterOptions';

export interface PropertyTypeTabsProps {
  form: SearchFormState;
  onChange: (form: SearchFormState) => void;
  /** Which tab's filters are on screen below the strip. */
  active: PropertyTypeGroup;
  onActiveChange: (group: PropertyTypeGroup) => void;
  /**
   * The property types worth offering at all. Set only by the results filter, where the
   * types are bounded by what the results contain. Absent here means all three, which is
   * the search form: any type can be searched for whether or not the last search found
   * one.
   */
  available?: PropertyTypeGroup[];
}

/**
 * The property type strip: which types a search covers, and which one's filters are being
 * edited.
 *
 * Each type carries a complete filter set of its own, because a search for a flat and a
 * search for a landed home are not the same search with a different label on it. The
 * strip is one control doing both jobs: pressing a tab shows its filters, and the check
 * on it says whether it is part of the search. Pressing a tab that is off turns it on, so
 * the common case is one press, and the check itself takes it back off.
 *
 * The last type on cannot be turned off. A search covering nothing is not a narrower
 * search, it is a request the server refuses.
 */
export default function PropertyTypeTabs({
  form,
  onChange,
  active,
  onActiveChange,
  available,
}: PropertyTypeTabsProps) {
  const groups = available ?? PROPERTY_TYPE_GROUPS;

  const select = (group: PropertyTypeGroup) => {
    onActiveChange(group);
    if (!form.groups.includes(group)) onChange(toggleGroup(form, group, groups));
  };

  return (
    <div className='flex flex-wrap items-center gap-2' role='tablist'>
      {groups.map(group => {
        const isOn = form.groups.includes(group);
        const isActive = group === active;
        const isLastOn = isLastGroupOn(form, group, groups);
        return (
          <span
            key={group}
            className={cn(
              'inline-flex items-center rounded-pill border transition-colors',
              isActive ? 'border-line-brand bg-brand-subtle' : 'border-line'
            )}
          >
            <button
              type='button'
              role='tab'
              aria-selected={isActive}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-l-pill py-1.5 pl-3 pr-2 text-sm font-medium transition-colors',
                isActive ? 'text-brand' : isOn ? 'text-strong' : 'text-muted hover:text-strong'
              )}
              onClick={() => select(group)}
            >
              {PROPERTY_TYPE_GROUP_LABELS[group]}
            </button>
            <button
              type='button'
              disabled={isLastOn}
              aria-pressed={isOn}
              aria-label={
                isOn
                  ? `Stop searching ${PROPERTY_TYPE_GROUP_LABELS[group]}`
                  : `Also search ${PROPERTY_TYPE_GROUP_LABELS[group]}`
              }
              title={
                isLastOn
                  ? 'A search has to cover at least one property type'
                  : isOn
                    ? 'Leave this property type out'
                    : 'Add this property type to the search'
              }
              className={cn(
                'inline-flex items-center rounded-r-pill py-1.5 pl-1 pr-2.5 transition-colors',
                isLastOn
                  ? 'cursor-not-allowed text-brand opacity-60'
                  : isOn
                    ? 'text-brand hover:bg-sunken'
                    : 'text-subtle hover:bg-sunken hover:text-strong'
              )}
              onClick={() => onChange(toggleGroup(form, group, groups))}
            >
              {isOn ? <Check size={14} aria-hidden /> : <Plus size={14} aria-hidden />}
            </button>
          </span>
        );
      })}
    </div>
  );
}
