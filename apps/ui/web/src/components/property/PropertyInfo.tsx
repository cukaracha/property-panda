import type { PropertyInfo } from '../../types/listings';
import { formatNumber, formatText, formatYear } from '../../lib/listingsFormat';

export interface PropertyInfoProps {
  info: PropertyInfo;
}

/**
 * The project level facts scraped alongside a property's listings, shown above
 * its table rather than behind a tab. Enrichment can fail, in which case every
 * field is null and the block says so instead of rendering three blanks.
 */
export default function PropertyInfo({ info }: PropertyInfoProps) {
  const rows = [
    { label: 'TOP year', value: formatYear(info.topYear) },
    { label: 'Tenure', value: formatText(info.tenure) },
    { label: 'Total units', value: formatNumber(info.totalUnits) },
  ];

  return (
    <div className='space-y-4'>
      {info.enrichment === 'unavailable' && (
        <p className='type-ui-sm text-ink-3'>
          Project details could not be loaded for this property. Only the listings below are
          available.
        </p>
      )}
      <dl className='grid gap-x-6 gap-y-3 sm:grid-cols-3'>
        {rows.map(row => (
          <div key={row.label}>
            <dt className='type-ui-eyebrow'>{row.label}</dt>
            <dd className='type-ui-sm text-ink-2'>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
