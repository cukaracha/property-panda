import { Eye } from 'lucide-react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import type { HiddenEntity } from '../types/listings';

export interface HiddenPanelProps {
  hidden: HiddenEntity[];
  error: string;
  onUnhide: (entityKey: string) => void;
}

const GROUPS: { scope: HiddenEntity['scope']; title: string; empty: string }[] = [
  { scope: 'property', title: 'Hidden properties', empty: 'No properties are hidden.' },
  { scope: 'unit', title: 'Hidden units', empty: 'No units are hidden.' },
];

/**
 * What this search hides, with a way back. Hiding filters at render time rather
 * than deleting, so an unhide restores the card or row on the next render without
 * re-running the search. The caller passes only what these results contain, so a
 * property the search no longer turns up is not listed as though it were on screen.
 */
export default function HiddenPanel({ hidden, error, onUnhide }: HiddenPanelProps) {
  return (
    <Card className='p-5'>
      <h2 className='type-ui-h3 text-ink'>Hidden items</h2>

      {error && <p className='mt-2 text-sm text-rose'>{error}</p>}

      <div className='mt-4 space-y-5'>
        {GROUPS.map(group => {
          const entries = hidden.filter(entity => entity.scope === group.scope);
          return (
            <div key={group.scope}>
              <p className='type-ui-eyebrow mb-2'>{group.title}</p>
              {entries.length === 0 ? (
                <p className='type-ui-sm text-ink-3'>{group.empty}</p>
              ) : (
                <ul className='divide-y divide-line-2 border-y border-line'>
                  {entries.map(entity => (
                    <li
                      key={entity.entityKey}
                      className='flex items-center justify-between gap-3 py-2'
                    >
                      <span className='min-w-0 truncate text-sm text-ink-2'>{entity.label}</span>
                      <Button variant='ghost' size='sm' onClick={() => onUnhide(entity.entityKey)}>
                        <Eye size={16} />
                        Unhide
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
