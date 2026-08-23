import type { PropertyInfo } from '../types/listings';
import { formatNumber, formatText, formatYear } from '../utils/format';

export interface PropertyInfoTabProps {
  info: PropertyInfo;
}

/**
 * The property info tab: the project level facts scraped alongside the
 * listings. Enrichment can fail, in which case every field is null and the tab
 * says so instead of rendering blanks.
 */
export default function PropertyInfoTab({ info }: PropertyInfoTabProps) {
  const rows = [
    { label: 'TOP year', value: formatYear(info.topYear) },
    { label: 'Total units', value: formatNumber(info.totalUnits) },
    { label: 'Tenure', value: formatText(info.tenure) },
    { label: 'Developer', value: formatText(info.developer) },
    {
      label: 'District',
      value: info.district
        ? `${info.district}${info.districtName ? `, ${info.districtName}` : ''}`
        : formatText(info.district),
    },
    { label: 'Floors', value: formatNumber(info.floors) },
    { label: 'Price range', value: formatText(info.psfRange) },
  ];

  return (
    <div className='space-y-4'>
      {info.enrichment === 'unavailable' && (
        <p className='type-ui-sm text-ink-3'>
          Project details could not be loaded for this property. Only the listings below are
          available.
        </p>
      )}
      <dl className='grid gap-x-6 gap-y-3 sm:grid-cols-2'>
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
