import { useState } from 'react';
import { EyeOff, Heart, Ruler, Sparkles } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import DataTable, { type Column } from '../tables/DataTable';
import { isNewSince } from '../../lib/listingRows';
import FloorplanModal from './FloorplanModal';
import type { ListingRow } from '../../types/listings';
import {
  formatCurrency,
  formatNumber,
  formatPsf,
  formatSqft,
  formatText,
} from '../../lib/listingsFormat';

export interface UnitsTableProps {
  rows: ListingRow[];
  shortlistedIds: Set<string>;
  onToggleShortlist: (row: ListingRow) => void;
  /** Absent on the shortlist screen, where there is no result set to hide a row from. */
  onHideUnit?: (row: ListingRow) => void;
  /**
   * When the search behind these rows last ran. A row posted after it is badged new.
   * Absent wherever there is no run to measure against, which badges nothing.
   */
  newSince?: number | null;
  emptyMessage?: string;
}

/**
 * Dense listings table for one property: every unit it has, across every bedroom
 * count, in one place. Square corners rather than a card radius, since this is
 * data UI. The row itself opens the listing in a new tab, so the actions cell
 * carries the buttons that must not do that. Hiding a row is reversible: it drops
 * out of the render, but the result set keeps it.
 *
 * The seven tracks below plus the cell padding come to exactly 720px, which is
 * the width the wrapper starts scrolling sideways at. Each one is sized for its
 * longest real value, the "Not available" fallback and a four figure psf
 * included, so nothing is measured on the header alone.
 *
 * Hiding is dropped rather than disabled when the caller passes no handler, which
 * is how the shortlist reuses this table without a flag saying which screen it is on.
 *
 * The floorplan viewer is held here rather than lifted, because looking at one
 * touches no store and needs nothing the row does not already carry.
 */
export default function UnitsTable({
  rows,
  shortlistedIds,
  onToggleShortlist,
  onHideUnit,
  newSince,
  emptyMessage = 'No units to show. They may all be hidden.',
}: UnitsTableProps) {
  const [floorplanRow, setFloorplanRow] = useState<ListingRow | null>(null);

  const openListing = (row: ListingRow) => {
    if (!row.url) return;
    window.open(row.url, '_blank', 'noopener,noreferrer');
  };

  const columns: Column<ListingRow>[] = [
    {
      key: 'bedrooms',
      header: 'Bedrooms',
      width: '98px',
      render: row =>
        isNewSince(row, newSince) ? (
          <span className='flex flex-wrap items-center gap-2'>
            {row.unitTypeLabel}
            <Badge tone='new'>
              <Sparkles size={11} />
              New
            </Badge>
          </span>
        ) : (
          row.unitTypeLabel
        ),
    },
    {
      key: 'bathrooms',
      header: 'Baths',
      width: '60px',
      render: row => formatNumber(row.bathrooms),
    },
    {
      key: 'price',
      header: 'Price',
      width: '108px',
      render: row => <span className='type-price'>{formatCurrency(row.price)}</span>,
    },
    {
      key: 'floorAreaSqft',
      header: 'Floor area',
      width: '108px',
      render: row => formatSqft(row.floorAreaSqft),
    },
    {
      key: 'psf',
      header: 'Price per sqft',
      width: '110px',
      render: row => formatPsf(row.psf),
    },
    {
      key: 'listedLabel',
      header: 'Listed on',
      width: '108px',
      render: row => <span className='type-data'>{formatText(row.listedLabel)}</span>,
    },
  ];

  return (
    <div className='border border-line'>
      <DataTable
        columns={columns}
        data={rows}
        keyExtractor={row => String(row.listingId)}
        emptyMessage={emptyMessage}
        onRowClick={openListing}
        minWidth='720px'
        actionsWidth='128px'
        rowLabel={row =>
          isNewSince(row, newSince)
            ? `Open listing ${row.listingId}, new since the last run`
            : `Open listing ${row.listingId}`
        }
        actions={row => {
          const isShortlisted = shortlistedIds.has(String(row.listingId));
          return (
            <>
              {(row.floorplans?.length ?? 0) > 0 && (
                <Button
                  variant='ghost'
                  size='icon'
                  className='btn-sm hover:bg-brand-subtle hover:text-brand'
                  title='View floorplan'
                  aria-label={`View floorplan for unit ${row.listingId}`}
                  onClick={() => setFloorplanRow(row)}
                >
                  <Ruler size={16} />
                </Button>
              )}
              <Button
                variant='ghost'
                size='icon'
                className={cn(
                  'btn-sm hover:bg-accent-subtle hover:text-accent',
                  isShortlisted && 'text-accent'
                )}
                title={isShortlisted ? 'Remove from the shortlist' : 'Shortlist this unit'}
                aria-label={
                  isShortlisted
                    ? `Remove unit ${row.listingId} from the shortlist`
                    : `Shortlist unit ${row.listingId}`
                }
                aria-pressed={isShortlisted}
                onClick={() => onToggleShortlist(row)}
              >
                <Heart size={16} fill={isShortlisted ? 'currentColor' : 'none'} />
              </Button>
              {onHideUnit && (
                <Button
                  variant='ghost'
                  size='icon'
                  className='btn-sm hover:bg-danger-subtle hover:text-danger'
                  title='Hide this unit'
                  aria-label={`Hide unit ${row.listingId}`}
                  onClick={() => onHideUnit(row)}
                >
                  <EyeOff size={16} />
                </Button>
              )}
            </>
          );
        }}
      />
      <FloorplanModal row={floorplanRow} onClose={() => setFloorplanRow(null)} />
    </div>
  );
}
