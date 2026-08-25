import { ChevronRight, Map } from 'lucide-react';
import DistrictMap from '../../../components/map/DistrictMap';
import type { DistrictMarker, MapViewport } from '../../../components/map/DistrictMap';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import { DISTRICT_NAME_BY_CODE } from '../utils/filterOptions';

export interface ResultsMapPanelProps {
  isOpen: boolean;
  onOpen: () => void;
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
 * The rail never leaves the flow above 768px: closed, it collapses to a 52px strip
 * carrying the map icon and a vertically-set label. That is what lets the control that
 * hides it live inside it -- a rail that vanished entirely would have nothing left on
 * screen to bring it back. Below 768px it is an off-canvas drawer instead, so the
 * results toolbar keeps its own toggle at that width.
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
  onOpen,
  onClose,
  selected,
  onSelectionChange,
  onViewportChange,
  markers,
  isFiltering,
}: ResultsMapPanelProps) {
  return (
    <aside
      className={cn('results-rail', isOpen ? 'is-open' : 'results-rail--collapsed')}
      aria-label='Map view'
    >
      {isOpen ? (
        <>
          <div className='flex items-start justify-between gap-2'>
            <div className='min-w-0'>
              <h2 className='type-ui-h3 text-strong'>Map view</h2>
              <p className='type-ui-caption mt-0.5'>
                {isFiltering ? 'filtering these results' : 'Pan, zoom or tap a district'}
              </p>
            </div>
            <Button
              variant='outline'
              size='sm'
              className='flex-none rounded-pill'
              onClick={onClose}
            >
              <ChevronRight size={14} />
              Hide map
            </Button>
          </div>

          <DistrictMap
            selected={selected}
            onSelectionChange={onSelectionChange}
            onViewportChange={onViewportChange}
            markers={markers}
            districtNames={DISTRICT_NAME_BY_CODE}
          />
        </>
      ) : (
        <button type='button' className='results-rail__expand' onClick={onOpen}>
          <Map size={19} />
          <span>Show map</span>
        </button>
      )}
    </aside>
  );
}
