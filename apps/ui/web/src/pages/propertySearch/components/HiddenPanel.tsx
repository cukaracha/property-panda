import { Card } from '../../../components/ui/card';
import HiddenEntityList from '../../../components/property/HiddenEntityList';
import type { HiddenEntityRow } from '../../../components/property/HiddenEntityList';
import type { HiddenEntity } from '../../../types/listings';

export interface HiddenPanelProps {
  hidden: HiddenEntity[];
  alwaysHidden: HiddenEntity[];
  error: string;
  onUnhide: (entity: HiddenEntity) => void;
  onUnhideAlways: (entity: HiddenEntity) => void;
}

/**
 * What is hidden from this search, with a way back. Hiding filters at render time
 * rather than deleting, so an unhide restores the card or row on the next render
 * without re-running the search. The caller passes only what these results contain, so
 * a property the search no longer turns up is not listed as though it were on screen.
 *
 * The app-wide list is in the same table rather than beside it: those items are not
 * tied to this search, and the `Hidden in` column is what says so. Properties and units
 * share it too, since what they have in common is that they are off screen.
 */
export default function HiddenPanel({
  hidden,
  alwaysHidden,
  error,
  onUnhide,
  onUnhideAlways,
}: HiddenPanelProps) {
  const rows: HiddenEntityRow[] = [
    ...hidden.map(entity => ({
      entity,
      scopeLabel: 'This search',
      onUnhide: () => onUnhide(entity),
    })),
    ...alwaysHidden.map(entity => ({
      entity,
      scopeLabel: 'Every search',
      onUnhide: () => onUnhideAlways(entity),
    })),
  ];

  return (
    <Card className='p-5'>
      <h2 className='type-ui-h3 text-strong'>Hidden items</h2>

      {error && <p className='mt-2 text-sm text-danger'>{error}</p>}

      <div className='mt-4'>
        <HiddenEntityList rows={rows} emptyMessage='Nothing from these results is hidden.' />
      </div>
    </Card>
  );
}
