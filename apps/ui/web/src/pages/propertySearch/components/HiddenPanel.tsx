import { Card } from '../../../components/ui/card';
import HiddenEntityList from '../../../components/property/HiddenEntityList';
import type { HiddenEntity } from '../../../types/listings';

export interface HiddenPanelProps {
  hidden: HiddenEntity[];
  alwaysHidden: HiddenEntity[];
  error: string;
  onUnhide: (entityKey: string) => void;
  onUnhideAlways: (entityKey: string) => void;
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
 *
 * The always hidden group is here too, listed on its own rather than mixed into the two
 * above: those items are not tied to this search, so an unhide there brings them back
 * everywhere. Properties and units share the group, since what they have in common is
 * the list they are on rather than the kind of thing they are.
 */
export default function HiddenPanel({
  hidden,
  alwaysHidden,
  error,
  onUnhide,
  onUnhideAlways,
}: HiddenPanelProps) {
  return (
    <Card className='p-5'>
      <h2 className='type-ui-h3 text-ink'>Hidden items</h2>

      {error && <p className='mt-2 text-sm text-rose'>{error}</p>}

      <div className='mt-4 space-y-5'>
        {GROUPS.map(group => (
          <div key={group.scope}>
            <p className='type-ui-eyebrow mb-2'>{group.title}</p>
            <HiddenEntityList
              entities={hidden.filter(entity => entity.scope === group.scope)}
              onUnhide={onUnhide}
              emptyMessage={group.empty}
            />
          </div>
        ))}

        <div>
          <p className='type-ui-eyebrow mb-2'>Always hidden</p>
          <p className='type-ui-sm mb-2 text-ink-3'>
            Hidden in every search. Unhiding one here brings it back everywhere.
          </p>
          <HiddenEntityList
            entities={alwaysHidden}
            onUnhide={onUnhideAlways}
            emptyMessage='Nothing from these results is always hidden.'
          />
        </div>
      </div>
    </Card>
  );
}
