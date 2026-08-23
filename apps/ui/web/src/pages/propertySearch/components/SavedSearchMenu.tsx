import { useEffect, useRef, useState } from 'react';
import { MoreVertical, Pencil, Trash2 } from 'lucide-react';

export interface SavedSearchMenuProps {
  searchName: string;
  onEdit: () => void;
  onDelete: () => void;
}

/**
 * The per-card menu on a saved search: edit it, or forget it.
 *
 * A popover rather than two buttons on the row, because the row itself is the click
 * target that runs the search and a row of controls next to it invites the wrong one.
 * It swallows its own clicks, so choosing from it never also starts a scrape.
 */
export default function SavedSearchMenu({ searchName, onEdit, onDelete }: SavedSearchMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  const choose = (action: () => void) => {
    setIsOpen(false);
    action();
  };

  return (
    <div
      ref={containerRef}
      className='relative flex-shrink-0'
      onClick={event => event.stopPropagation()}
    >
      <button
        type='button'
        className='btn btn-icon btn-sm btn-ghost'
        aria-label={`Options for ${searchName}`}
        aria-haspopup='menu'
        aria-expanded={isOpen}
        onClick={() => setIsOpen(current => !current)}
      >
        <MoreVertical size={16} />
      </button>

      {isOpen && (
        <div
          role='menu'
          className='absolute right-0 top-full z-20 mt-1 min-w-[10rem] rounded-surface border border-line bg-canvas-2 p-1 shadow-panel'
        >
          <button
            type='button'
            role='menuitem'
            className='btn btn-sm btn-ghost w-full justify-start'
            onClick={() => choose(onEdit)}
          >
            <Pencil size={16} />
            Edit
          </button>
          <button
            type='button'
            role='menuitem'
            className='btn btn-sm btn-ghost w-full justify-start text-rose'
            onClick={() => choose(onDelete)}
          >
            <Trash2 size={16} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
