import { useState } from 'react';
import { ChevronDown, ChevronUp, Map } from 'lucide-react';
import { Card } from '../../../components/ui/card';
import DistrictMap from '../../../components/map/DistrictMap';
import type { DistrictMarker, MapViewport } from '../../../components/map/DistrictMap';
import { DISTRICT_NAME_BY_CODE } from '../utils/filterOptions';

export interface ResultsMapPanelProps {
  selected: string[];
  onSelectionChange: (codes: string[]) => void;
  onViewportChange: (viewport: MapViewport | null) => void;
  markers: DistrictMarker[];
  /** Properties the map cannot place, which stay in the list whatever the map says. */
  unpositionedCount: number;
  isFiltering: boolean;
  approximateCount: number;
}

/**
 * The district map over the result cards, filtering what is already on screen.
 *
 * This is a view filter and nothing more. It never re-runs the scrape and never touches
 * the search form, so a saved search always stores the filters that actually ran rather
 * than wherever the map happened to be pointing. Changing the districts a saved search
 * covers is the Edit search button's job, which re-runs the scrape as it should.
 */
export default function ResultsMapPanel({
  selected,
  onSelectionChange,
  onViewportChange,
  markers,
  unpositionedCount,
  isFiltering,
  approximateCount,
}: ResultsMapPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <Card className='p-5'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex items-center gap-2'>
          <Map size={16} className='text-cyan' />
          <h2 className='type-ui-h3 text-ink'>Map</h2>
          {isFiltering && <span className='type-ui-caption'>filtering these results</span>}
        </div>
        <button
          type='button'
          className='btn btn-sm btn-ghost'
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded(current => !current)}
        >
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          {isExpanded ? 'Hide map' : 'Show map'}
        </button>
      </div>

      {isExpanded && (
        <div className='mt-4'>
          <DistrictMap
            selected={selected}
            onSelectionChange={onSelectionChange}
            onViewportChange={onViewportChange}
            markers={markers}
            districtNames={DISTRICT_NAME_BY_CODE}
          />

          {(approximateCount > 0 || (isFiltering && unpositionedCount > 0)) && (
            <div className='type-ui-caption mt-2 space-y-0.5'>
              {isFiltering && unpositionedCount > 0 && (
                <p>
                  {unpositionedCount} propert{unpositionedCount === 1 ? 'y has' : 'ies have'} no
                  location and {unpositionedCount === 1 ? 'is' : 'are'} always shown.
                </p>
              )}
              {approximateCount > 0 && (
                <p>
                  {approximateCount} pin{approximateCount === 1 ? '' : 's'} sit at the centre of
                  {approximateCount === 1 ? ' its' : ' their'} district rather than the exact
                  address.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
