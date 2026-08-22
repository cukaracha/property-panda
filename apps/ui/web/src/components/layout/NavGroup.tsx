import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface NavGroupProps {
  icon: LucideIcon;
  label: string;
  /** True when a child route is active — highlights the trigger and opens the group. */
  isActive?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * A collapsible sidebar nav group: a trigger row (icon + label + chevron) that
 * expands a nested list via the shared .cb-collapse accordion. Starts open (or
 * when a child route is active) while still allowing manual toggling. In the
 * collapsed icon rail the label and chevron hide and the nested items show as
 * centered icons.
 */
export function NavGroup({
  icon: Icon,
  label,
  isActive,
  defaultOpen = true,
  children,
}: NavGroupProps) {
  const [open, setOpen] = useState(defaultOpen || Boolean(isActive));

  return (
    <div className='nav-group'>
      <button
        type='button'
        className={cn('nav-item', 'nav-group__trigger', isActive && 'is-active')}
        aria-expanded={open}
        onClick={() => setOpen(prev => !prev)}
      >
        <span className='ni-icon'>
          <Icon size={18} />
        </span>
        <span className='ni-label'>{label}</span>
        <span className={cn('nav-group__chev', open && 'is-open')} aria-hidden='true'>
          <ChevronDown size={16} />
        </span>
      </button>
      <div className={cn('cb-collapse', open && 'open')}>
        <div className='nav-group__items'>{children}</div>
      </div>
    </div>
  );
}
