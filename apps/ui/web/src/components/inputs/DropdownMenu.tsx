import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export type DropdownMenuProps = SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Native <select> styled by the ported .input class (styles/app.css) with the
 * OS chevron suppressed (`appearance-none`) and a lucide chevron overlaid, so it
 * matches the design-system inputs and flips with the theme. The wrapper is a
 * block element — constrain its width from the caller (e.g. wrap in `w-40`).
 */
export function DropdownMenu({ className, children, ...props }: DropdownMenuProps) {
  return (
    <div className='relative'>
      <select
        className={cn('input w-full cursor-pointer appearance-none pr-9', className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        size={16}
        className='pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3'
      />
    </div>
  );
}
