import { EyeOff, ExternalLink, MapPin } from 'lucide-react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import PropertyInfo from './PropertyInfo';
import UnitsTable from './UnitsTable';
import type { ListingRow, Property } from '../types/listings';
import { formatText } from '../utils/format';
import { toListingRows } from '../utils/rows';

export interface PropertyCardProps {
  property: Property;
  hiddenUnitIds: Set<string>;
  onHideProperty: (property: Property) => void;
  onHideUnit: (property: Property, row: ListingRow) => void;
}

/**
 * One property: the project identity, the project level facts, and every listing
 * in it as one table. Nothing is behind a tab, so a card can be read top to
 * bottom and the assistant is never told about a table the user cannot see.
 *
 * Hidden units drop out at render time and are counted under the table, because
 * a table that is short only because rows are hidden otherwise reads as a
 * property with few units for sale.
 */
export default function PropertyCard({
  property,
  hiddenUnitIds,
  onHideProperty,
  onHideUnit,
}: PropertyCardProps) {
  const rows = toListingRows(property);
  const visibleRows = rows.filter(row => !hiddenUnitIds.has(String(row.listingId)));
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
          <Button variant='outline' size='sm' onClick={() => onHideProperty(property)}>
            <EyeOff size={16} />
            Hide property
          </Button>
        </div>
      </div>

      <div className='mt-4'>
        <PropertyInfo info={property.info} />
      </div>

      <div className='mt-4'>
        <UnitsTable rows={visibleRows} onHideUnit={row => onHideUnit(property, row)} />
      </div>

      {hiddenCount > 0 && (
        <p className='type-ui-caption mt-2'>
          {hiddenCount} hidden {hiddenCount === 1 ? 'unit is' : 'units are'} not shown.
        </p>
      )}
    </Card>
  );
}
