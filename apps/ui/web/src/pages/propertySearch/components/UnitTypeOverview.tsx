import { ExternalLink } from 'lucide-react';
import type { UnitTypeOverviewData } from '../types/listings';
import { formatCurrency, formatNumber, formatPsf, formatRange, formatSqft } from '../utils/format';

export interface UnitTypeOverviewProps {
  overview: UnitTypeOverviewData;
}

/**
 * The summary block above a unit type's listings table: how big these units
 * are, what they are asking, and any floorplans the scraper found.
 */
export default function UnitTypeOverview({ overview }: UnitTypeOverviewProps) {
  const stats = [
    { label: 'Floor area', value: formatRange(overview.sqftMin, overview.sqftMax, formatSqft) },
    { label: 'Typical size', value: formatSqft(overview.typicalSqft) },
    { label: 'Price', value: formatRange(overview.priceMin, overview.priceMax, formatCurrency) },
    { label: 'Price per sqft', value: formatRange(overview.psfMin, overview.psfMax, formatPsf) },
    { label: 'Units listed', value: formatNumber(overview.unitCount) },
  ];

  return (
    <div className='space-y-4'>
      <dl className='grid gap-x-6 gap-y-3 sm:grid-cols-3'>
        {stats.map(stat => (
          <div key={stat.label}>
            <dt className='type-ui-eyebrow'>{stat.label}</dt>
            <dd className='type-ui-sm text-ink-2'>{stat.value}</dd>
          </div>
        ))}
      </dl>

      <div>
        <p className='type-ui-eyebrow'>Floorplans</p>
        {overview.floorplans.length === 0 ? (
          <p className='type-ui-sm text-ink-3'>No floorplans found.</p>
        ) : (
          <ul className='mt-1 flex flex-wrap gap-2'>
            {overview.floorplans.map((floorplan, index) => (
              <li key={`${floorplan.label ?? 'floorplan'}-${index}`}>
                {floorplan.imageUrl ? (
                  <a
                    href={floorplan.imageUrl}
                    target='_blank'
                    rel='noreferrer'
                    className='inline-flex items-center gap-1 rounded-control border border-line px-2 py-1 text-sm text-cyan transition-colors hover:bg-panel-2'
                  >
                    {floorplan.label ?? 'Floorplan'}
                    <ExternalLink size={13} />
                  </a>
                ) : (
                  <span className='inline-flex rounded-control border border-line px-2 py-1 text-sm text-ink-3'>
                    {floorplan.label ?? 'Floorplan'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
