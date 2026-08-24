import { X } from 'lucide-react';
import DistrictMap from '../../../components/map/DistrictMap';
import type { DistrictMarker, MapViewport } from '../../../components/map/DistrictMap';
import { cn } from '../../../lib/utils';
import { DISTRICT_NAME_BY_CODE } from '../utils/filterOptions';

export interface ResultsMapPanelProps {
  isOpen: boolean;
  onClose: () => void;
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
 * The district map as a rail beside the result cards, filtering what is already on
 * screen.
 *
 * This is a view filter and nothing more. It never re-runs the scrape and never touches
 * the search form, so a saved search always stores the filters that actually ran rather
 * than wherever the map happened to be pointing. Changing the districts a saved search
 * covers is the Edit search button's job, which re-runs the scrape as it should.
 *
 * The two counts the panel used to footnote are still computed by the caller and still
 * govern the filter: a property the map cannot place is never dropped, and a pin at its
 * district's centre is still drawn dimmed. Only the prose is gone.
 */
export default function ResultsMapPanel({
  isOpen,
  onClose,
  selected,
  onSelectionChange,
  onViewportChange,
  markers,
  isFiltering,
}: ResultsMapPanelProps) {
  if (!isOpen) return null;

  return (
    <aside className={cn('results-rail', isOpen && 'is-open')} aria-label='Map view'>
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <h2 className='type-ui-h3 text-strong'>Map view</h2>
          <p className='type-ui-caption mt-0.5'>
            {isFiltering ? 'filtering these results' : 'Pan, zoom or tap a district'}
          </p>
        </div>
        <button
          type='button'
          className='results-rail__close btn btn-icon btn-sm btn-ghost'
          aria-label='Hide map'
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>

      <DistrictMap
        selected={selected}
        onSelectionChange={onSelectionChange}
        onViewportChange={onViewportChange}
        markers={markers}
        districtNames={DISTRICT_NAME_BY_CODE}
      />
    </aside>
  );
}
