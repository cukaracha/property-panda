import { EyeOff, ExternalLink, MapPin } from 'lucide-react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import PropertyInfo from './PropertyInfo';
import UnitsTable from './UnitsTable';
import type { ListingRow, Property } from '../../types/listings';
import { formatText } from '../../lib/listingsFormat';
import { toListingRows } from '../../lib/listingRows';

export interface PropertyCardProps {
  property: Property;
  shortlistedIds: Set<string>;
  onToggleShortlist: (property: Property, row: ListingRow) => void;
  /** Both absent on the shortlist screen, which has no result set to hide anything from. */
  hiddenUnitIds?: Set<string>;
  onHideProperty?: (property: Property) => void;
  onHideUnit?: (property: Property, row: ListingRow) => void;
  /** A line under the header, for whatever the screen needs to say about this card. */
  caption?: string;
  emptyMessage?: string;
}

/**
 * One property: the project identity, the project level facts, and every listing
 * in it as one table. Nothing is behind a tab, so a card can be read top to
 * bottom and the assistant is never told about a table the user cannot see.
 *
 * Hidden units drop out at render time and are counted under the table, because
 * a table that is short only because rows are hidden otherwise reads as a
 * property with few units for sale.
 *
 * The hide affordances are dropped rather than disabled when the screen passes no
 * handler, which is how the shortlist renders the same card without a flag saying
 * which screen it is on.
 */
export default function PropertyCard({
  property,
  shortlistedIds,
  onToggleShortlist,
  hiddenUnitIds,
  onHideProperty,
  onHideUnit,
  caption,
  emptyMessage,
}: PropertyCardProps) {
  const rows = toListingRows(property);
  const visibleRows = rows.filter(row => !hiddenUnitIds?.has(String(row.listingId)));
  const hiddenCount = rows.length - visibleRows.length;

  return (
    <Card className='p-5'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-2'>
            <h2 className='type-ui-title text-ink'>{property.name}</h2>
            {property.info.propertyType && <Badge>{property.info.propertyType}</Badge>}
          </div>
          <p className='type-ui-caption mt-1 flex items-center gap-1.5'>
            <MapPin size={13} className='text-cyan' />
            {formatText(property.info.address)}
          </p>
          {caption && <p className='type-ui-caption mt-1'>{caption}</p>}
        </div>
        <div className='flex items-center gap-2'>
          {property.info.projectUrl && (
            <a
              href={property.info.projectUrl}
              target='_blank'
              rel='noreferrer'
              className='btn btn-ghost btn-sm'
            >
              <ExternalLink size={16} />
              View project
            </a>
          )}
          {onHideProperty && (
            <Button variant='outline' size='sm' onClick={() => onHideProperty(property)}>
              <EyeOff size={16} />
              Hide property
            </Button>
          )}
        </div>
      </div>

      <div className='mt-4'>
        <PropertyInfo info={property.info} />
      </div>

      <div className='mt-4'>
        <UnitsTable
          rows={visibleRows}
          shortlistedIds={shortlistedIds}
          onToggleShortlist={row => onToggleShortlist(property, row)}
          onHideUnit={onHideUnit && (row => onHideUnit(property, row))}
          emptyMessage={emptyMessage}
        />
      </div>

      {hiddenCount > 0 && (
        <p className='type-ui-caption mt-2'>
          {hiddenCount} hidden {hiddenCount === 1 ? 'unit is' : 'units are'} not shown.
        </p>
      )}
    </Card>
  );
}
