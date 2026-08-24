import { Eye } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import type { HiddenEntity } from '../../types/listings';

/**
 * One hidden item as the table renders it: what it is, what it is called, and which
 * scope is holding it down. The scope label is the caller's, since only the caller
 * knows whether a row came off this search's list or the app-wide one.
 */
export interface HiddenEntityRow {
  entity: HiddenEntity;
  /** `This search` or `Every search`. */
  scopeLabel: string;
  onUnhide: () => void;
}

export interface HiddenEntityListProps {
  rows: HiddenEntityRow[];
  emptyMessage: string;
}

const KIND_LABEL: Record<HiddenEntity['scope'], string> = {
  property: 'Property',
  unit: 'Unit',
};

/**
 * Every hidden item as one table: `Type`, `Item`, `Hidden in`, and the way back.
 *
 * One table rather than a group per kind and a third for the app-wide list, because
 * the scope badge on each row carries the distinction the groups used to carry, and a
 * reader scanning for one name should not have to know which list it landed on first.
 * Shared, so the results panel and the always hidden page show the same shape.
 *
 * Rows rather than cards, because a hidden entry stores only what it takes to name the
 * thing and recognise it later.
 */
export default function HiddenEntityList({ rows, emptyMessage }: HiddenEntityListProps) {
  if (rows.length === 0) {
    return <p className='type-ui-sm text-muted'>{emptyMessage}</p>;
  }

  return (
    <div className='overflow-x-auto'>
      <ul className='min-w-[400px] divide-y divide-line border-y border-line-2'>
        <li className='hidden-row type-ui-eyebrow py-2'>
          <span>Type</span>
          <span>Item</span>
          <span>Hidden in</span>
          <span />
        </li>
        {rows.map(({ entity, scopeLabel, onUnhide }) => (
          <li key={entity.entityKey} className='hidden-row py-2'>
            <span>
              <Badge>{KIND_LABEL[entity.scope]}</Badge>
            </span>
            <span className='min-w-0 truncate text-sm text-body'>{entity.label}</span>
            <span className='type-ui-caption'>{scopeLabel}</span>
            <Button
              variant='ghost'
              size='sm'
              className='justify-self-end hover:bg-brand-subtle hover:text-brand'
              aria-label={`Unhide ${entity.label}`}
              onClick={onUnhide}
            >
              <Eye size={16} />
              Unhide
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
