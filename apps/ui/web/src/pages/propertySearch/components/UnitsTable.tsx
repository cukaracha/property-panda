import { useState } from 'react';
import { EyeOff, Ruler } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import DataTable, { type Column } from '../../../components/tables/DataTable';
import FloorplanModal from './FloorplanModal';
import type { ListingRow } from '../types/listings';
import { formatCurrency, formatNumber, formatPsf, formatSqft, formatText } from '../utils/format';

export interface UnitsTableProps {
  rows: ListingRow[];
  onHideUnit: (row: ListingRow) => void;
}

/**
 * Dense listings table for one property: every unit it has, across every bedroom
 * count, in one place. Square corners rather than a card radius, since this is
 * data UI. The row itself opens the listing in a new tab, so the actions cell
 * carries the buttons that must not do that. Hiding a row is reversible: it drops
 * out of the render, but the result set keeps it.
 *
 * The floorplan viewer is held here rather than lifted, because looking at one
 * touches no store and needs nothing the row does not already carry.
 */
export default function UnitsTable({ rows, onHideUnit }: UnitsTableProps) {
  const [floorplanRow, setFloorplanRow] = useState<ListingRow | null>(null);

  const openListing = (row: ListingRow) => {
    if (!row.url) return;
    window.open(row.url, '_blank', 'noopener,noreferrer');
  };

  const columns: Column<ListingRow>[] = [
    { key: 'bedrooms', header: 'Bedrooms', render: row => row.unitTypeLabel },
    { key: 'bathrooms', header: 'Baths', render: row => formatNumber(row.bathrooms) },
    { key: 'price', header: 'Price', render: row => formatCurrency(row.price) },
    { key: 'floorAreaSqft', header: 'Floor area', render: row => formatSqft(row.floorAreaSqft) },
    { key: 'psf', header: 'Price per sqft', render: row => formatPsf(row.psf) },
    { key: 'listedLabel', header: 'Listed on', render: row => formatText(row.listedLabel) },
  ];

  return (
    <div className='border border-line'>
      <DataTable
        columns={columns}
        data={rows}
        keyExtractor={row => String(row.listingId)}
        emptyMessage='No units to show. They may all be hidden.'
        onRowClick={openListing}
        rowLabel={row => `Open listing ${row.listingId}`}
        actions={row => (
          <>
            {(row.floorplans?.length ?? 0) > 0 && (
              <Button
                variant='ghost'
                size='icon'
                className='btn-sm'
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
              className='btn-sm'
              title='Hide this unit'
              aria-label={`Hide unit ${row.listingId}`}
              onClick={() => onHideUnit(row)}
            >
              <EyeOff size={16} />
            </Button>
          </>
        )}
      />
      <FloorplanModal row={floorplanRow} onClose={() => setFloorplanRow(null)} />
    </div>
  );
}
