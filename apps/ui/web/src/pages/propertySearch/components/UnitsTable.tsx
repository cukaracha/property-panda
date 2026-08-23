import { EyeOff, ExternalLink } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import DataTable, { type Column } from '../../../components/tables/DataTable';
import type { Unit } from '../types/listings';
import { formatCurrency, formatNumber, formatPsf, formatSqft, formatText } from '../utils/format';

export interface UnitsTableProps {
  units: Unit[];
  onHideUnit: (unit: Unit) => void;
}

/**
 * Dense listings table for one unit type. Square corners rather than a card
 * radius, since this is data UI. Hiding a row is reversible: it drops out of
 * the render, but the result set keeps it.
 */
export default function UnitsTable({ units, onHideUnit }: UnitsTableProps) {
  const columns: Column<Unit>[] = [
    { key: 'price', header: 'Price', render: unit => formatCurrency(unit.price) },
    { key: 'floorAreaSqft', header: 'Floor area', render: unit => formatSqft(unit.floorAreaSqft) },
    { key: 'psf', header: 'Price per sqft', render: unit => formatPsf(unit.psf) },
    { key: 'bathrooms', header: 'Baths', render: unit => formatNumber(unit.bathrooms) },
    { key: 'listedLabel', header: 'Listed', render: unit => formatText(unit.listedLabel) },
    {
      key: 'agentName',
      header: 'Agent',
      render: unit => (
        <span className='block'>
          <span className='block text-ink-2'>{formatText(unit.agentName)}</span>
          <span className='type-ui-caption block'>{formatText(unit.agencyName)}</span>
        </span>
      ),
    },
  ];

  return (
    <div className='border border-line'>
      <DataTable
        columns={columns}
        data={units}
        keyExtractor={unit => String(unit.listingId)}
        emptyMessage='No units to show. They may all be hidden.'
        actions={unit => (
          <>
            <a
              href={unit.url}
              target='_blank'
              rel='noreferrer'
              className='btn btn-ghost btn-icon btn-sm'
              title='Open the listing'
              aria-label={`Open listing ${unit.listingId}`}
            >
              <ExternalLink size={16} />
            </a>
            <Button
              variant='ghost'
              size='icon'
              className='btn-sm'
              title='Hide this unit'
              aria-label={`Hide unit ${unit.listingId}`}
              onClick={() => onHideUnit(unit)}
            >
              <EyeOff size={16} />
            </Button>
          </>
        )}
      />
    </div>
  );
}
