import { useState } from 'react';
import { Bookmark, Building2, EyeOff, ExternalLink, MapPin } from 'lucide-react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import PropertyInfo from './PropertyInfo';
import PropertyMapModal from './PropertyMapModal';
import PropertyPhotosModal from './PropertyPhotosModal';
import UnitsTable from './UnitsTable';
import type { ListingRow, Property } from '../../types/listings';
import { cn } from '../../lib/utils';
import { formatText } from '../../lib/listingsFormat';
import { toListingRows } from '../../lib/listingRows';
import { canOpenMap } from '../../lib/propertyLocation';

export interface PropertyCardProps {
  property: Property;
  shortlistedIds: Set<string>;
  onToggleShortlist: (property: Property, row: ListingRow) => void;
  /** Both absent on the shortlist screen, which has no result set to hide anything from. */
  hiddenUnitIds?: Set<string>;
  /**
   * Units the results filter took off this card, kept apart from the hidden ones because
   * they are left out for a different reason and come back a different way.
   */
  filteredUnitIds?: Set<string>;
  onHideProperty?: (property: Property) => void;
  onHideUnit?: (property: Property, row: ListingRow) => void;
  /** Also absent there, since a bookmark pins a card to the top of a result set. */
  isBookmarked?: boolean;
  onToggleBookmark?: (property: Property) => void;
  /** A line under the header, for whatever the screen needs to say about this card. */
  caption?: string;
  /**
   * When the search behind this card last ran. Listings posted since it sort to the top
   * of the table and carry a badge. The card itself is not reordered or marked, so the
   * results keep the order the screen put them in.
   */
  newSince?: number | null;
  emptyMessage?: string;
}

/**
 * Why the table is shorter than the property is, in one line.
 *
 * Both counts land on the same line when both apply, rather than stacking two
 * sentences under a table that is already short: they answer the same question.
 */
function unitFootnote(hiddenCount: number, filteredCount: number): string {
  if (hiddenCount > 0 && filteredCount > 0) {
    return `${hiddenCount} ${hiddenCount === 1 ? 'unit is' : 'units are'} hidden and ${filteredCount} ${filteredCount === 1 ? 'does' : 'do'} not match the filters.`;
  }
  if (hiddenCount > 0) {
    return `${hiddenCount} hidden ${hiddenCount === 1 ? 'unit is' : 'units are'} not shown.`;
  }
  if (filteredCount > 0) {
    return `${filteredCount} ${filteredCount === 1 ? 'unit does' : 'units do'} not match the filters.`;
  }
  return '';
}

/**
 * One property: the project identity, the project level facts, and every listing
 * in it as one table. Nothing is behind a tab, so a card can be read top to
 * bottom and the assistant is never told about a table the user cannot see.
 *
 * Hidden units drop out at render time and are counted under the table, because
 * a table that is short only because rows are hidden otherwise reads as a
 * property with few units for sale. Units the results filter left out are counted
 * the same way and for the same reason, on the same line.
 *
 * The hide and bookmark affordances are dropped rather than disabled when the screen
 * passes no handler, which is how the shortlist renders the same card without a flag
 * saying which screen it is on.
 *
 * The thumbnail is the project's own hero image, straight from the source CDN. A good
 * number of properties carry no image at all and any of the rest can fail to load, so
 * the fallback tile is a normal state of the card rather than an error case.
 *
 * It opens the development's photo gallery, which is a different set from the photos of
 * any unit in the table below. One rule decides whether it is clickable at all: a hero
 * that is showing, and a gallery to show. That leaves the fallback tile inert, which is
 * the point -- a generic building icon is no invitation to look at photos, and since the
 * hero *is* the gallery's first photo, a property with no hero has no gallery either. A
 * hero that failed to load takes the carousel with it for the same reason, rather than
 * leaving a tile that is sometimes clickable for reasons the user cannot see.
 *
 * The address opens the property on a map, by the same rule: a line with an address
 * to show becomes a button, a line reading "Not available" stays the text it is.
 *
 * The gallery and the map are held here rather than lifted, as UnitsTable holds its
 * own modals: neither one touches a store.
 *
 * The name and its property type badge sit on one nowrap row, the name free to
 * shrink and wrap inside itself. Letting the row wrap instead dropped the badge
 * onto its own line at the widths where names are longest, which is exactly where
 * the type is worth reading.
 */
export default function PropertyCard({
  property,
  shortlistedIds,
  onToggleShortlist,
  hiddenUnitIds,
  filteredUnitIds,
  onHideProperty,
  onHideUnit,
  isBookmarked,
  onToggleBookmark,
  caption,
  newSince,
  emptyMessage,
}: PropertyCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const rows = toListingRows(property, newSince);
  const hiddenCount = rows.filter(row => hiddenUnitIds?.has(String(row.listingId))).length;
  const visibleRows = rows.filter(
    row =>
      !hiddenUnitIds?.has(String(row.listingId)) && !filteredUnitIds?.has(String(row.listingId))
  );
  const filteredCount = rows.length - visibleRows.length - hiddenCount;

  const footnote = unitFootnote(hiddenCount, filteredCount);

  const hasImage = Boolean(property.info.imageUrl) && !imageFailed;
  const canOpenPhotos = hasImage && (property.info.photoCount ?? 0) > 0;
  const canShowMap = canOpenMap(property.info);
  const address = formatText(property.info.address);

  const thumbnail = hasImage ? (
    <img
      src={property.info.imageUrl ?? ''}
      alt=''
      loading='lazy'
      onError={() => setImageFailed(true)}
      className='h-16 w-16 rounded-photo border border-line bg-photo object-cover sm:h-24 sm:w-24'
    />
  ) : (
    <div className='flex h-16 w-16 items-center justify-center rounded-photo border border-line bg-sunken sm:h-24 sm:w-24'>
      <Building2 size={24} className='text-subtle' />
    </div>
  );

  return (
    <Card className='p-5 transition-shadow hover:shadow-md'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        {canOpenPhotos ? (
          <button
            type='button'
            className='shrink-0 cursor-pointer rounded-photo transition-opacity hover:opacity-90'
            title='View photos'
            aria-label={`View photos of ${property.name}`}
            onClick={() => setPhotosOpen(true)}
          >
            {thumbnail}
          </button>
        ) : (
          <div className='shrink-0'>{thumbnail}</div>
        )}
        {/* A real flex basis, not flex-1: at flex:1 1 0% the column shrinks to nothing
            against the actions beside it and the name breaks one glyph per line. */}
        <div className='min-w-0 flex-[1_1_240px]'>
          <div className='flex flex-nowrap items-center gap-2'>
            <h2 className='type-ui-title min-w-0 break-words text-strong'>{property.name}</h2>
            {property.info.propertyType && (
              <Badge className='shrink-0'>{property.info.propertyType}</Badge>
            )}
          </div>
          {canShowMap ? (
            <button
              type='button'
              className='type-ui-caption mt-1 flex cursor-pointer items-center gap-1.5 text-left underline-offset-2 transition-colors hover:text-brand hover:underline'
              title='Show on the map'
              aria-label={`Show ${property.name} on the map`}
              onClick={() => setMapOpen(true)}
            >
              <MapPin size={13} className='text-brand' />
              {address}
            </button>
          ) : (
            <p className='type-ui-caption mt-1 flex items-center gap-1.5'>
              <MapPin size={13} className='text-brand' />
              {address}
            </p>
          )}
          {caption && <p className='type-ui-caption mt-1'>{caption}</p>}
        </div>
        <div className='ml-auto flex flex-none flex-wrap items-center justify-end gap-2'>
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
          {onToggleBookmark && (
            <Button
              variant='ghost'
              size='icon'
              className={cn(
                'btn-sm hover:bg-brand-subtle hover:text-brand',
                isBookmarked && 'text-brand'
              )}
              title={isBookmarked ? 'Remove the bookmark' : 'Pin this property to the top'}
              aria-label={isBookmarked ? 'Remove the bookmark' : 'Pin this property to the top'}
              aria-pressed={isBookmarked}
              onClick={() => onToggleBookmark(property)}
            >
              <Bookmark size={16} fill={isBookmarked ? 'currentColor' : 'none'} />
            </Button>
          )}
          {onHideProperty && (
            <Button
              variant='outline'
              size='sm'
              className='hover:bg-danger-subtle hover:text-danger'
              onClick={() => onHideProperty(property)}
            >
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
          newSince={newSince}
          emptyMessage={emptyMessage}
        />
      </div>

      {footnote && <p className='type-ui-caption mt-2'>{footnote}</p>}

      <PropertyPhotosModal
        property={photosOpen ? property : null}
        onClose={() => setPhotosOpen(false)}
      />

      <PropertyMapModal property={mapOpen ? property : null} onClose={() => setMapOpen(false)} />
    </Card>
  );
}
