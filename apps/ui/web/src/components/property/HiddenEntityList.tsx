import { Eye } from 'lucide-react';
import { Button } from '../ui/button';
import type { HiddenEntity } from '../../types/listings';

export interface HiddenEntityListProps {
  entities: HiddenEntity[];
  onUnhide: (entityKey: string) => void;
  emptyMessage: string;
}

/**
 * A hidden list as labelled rows with a way back.
 *
 * Rows rather than cards, because a hidden entry stores only what it takes to name the
 * thing and recognise it later. Shared, because both the results screen's panel and the
 * always hidden page show the same list in the same shape.
 */
export default function HiddenEntityList({
  entities,
  onUnhide,
  emptyMessage,
}: HiddenEntityListProps) {
  if (entities.length === 0) {
    return <p className='type-ui-sm text-ink-3'>{emptyMessage}</p>;
  }

  return (
    <ul className='divide-y divide-line-2 border-y border-line'>
      {entities.map(entity => (
        <li key={entity.entityKey} className='flex items-center justify-between gap-3 py-2'>
          <span className='min-w-0 truncate text-sm text-ink-2'>{entity.label}</span>
          <Button variant='ghost' size='sm' onClick={() => onUnhide(entity.entityKey)}>
            <Eye size={16} />
            Unhide
          </Button>
        </li>
      ))}
    </ul>
  );
}
