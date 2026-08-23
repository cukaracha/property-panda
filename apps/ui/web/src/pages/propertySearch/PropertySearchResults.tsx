import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import PropertyCard from './components/PropertyCard';
import HiddenPanel from './components/HiddenPanel';
import HideConfirmModal from './components/HideConfirmModal';
import { useHiddenEntities } from './hooks/useHiddenEntities';
import { useResultsPageContext } from './PageContext';
import {
  usePropertySearchResultsStore,
  usePropertySearchStore,
} from '../../store/usePropertySearchStore';
import type { ListingRow, PendingHide, Property } from './types/listings';
import { describeFilters } from './utils/filterOptions';
import { formatCurrency } from './utils/format';
import { toListingRows } from './utils/rows';

/**
 * Search results - the properties the last scrape returned, one card each.
 *
 * The result set comes from the store rather than a request, because the poll
 * that finished the job already carried it, and it is persisted so a refresh
 * lands back on the same results. Hidden properties and units stay in that set
 * and are filtered at render time, which is what makes a hide reversible.
 */
export default function PropertySearchResults() {
  const navigate = useNavigate();
  const results = usePropertySearchResultsStore(state => state.results);
  const fromThisLoad = usePropertySearchResultsStore(state => state.fromThisLoad);
  const form = usePropertySearchStore(state => state.form);
  const [showHidden, setShowHidden] = useState(false);
  const [pendingHide, setPendingHide] = useState<PendingHide | null>(null);

  const {
    hidden,
    hiddenPropertyIds,
    hiddenUnitIds,
    isLoading: isLoadingHidden,
    error: hiddenError,
    hide,
    unhide,
  } = useHiddenEntities();

  const allProperties = results?.properties ?? [];
  const visibleProperties = allProperties.filter(
    property => !hiddenPropertyIds.has(property.propertyId)
  );
  const expired = Boolean(results?.expired);

  const commitHideProperty = (property: Property) =>
    hide('property', property.propertyId, property.name);

  const commitHideUnit = (property: Property, row: ListingRow) =>
    hide(
      'unit',
      String(row.listingId),
      `${property.name}, ${row.unitTypeLabel}, ${formatCurrency(row.price)}`
    );

  const confirmHide = async () => {
    if (!pendingHide) return;
    if (pendingHide.scope === 'property') {
      await commitHideProperty(pendingHide.property);
      return;
    }
    await commitHideUnit(pendingHide.property, pendingHide.row);
  };

  const hidePropertyById = (propertyId: string) => {
    const property = allProperties.find(item => item.propertyId === propertyId);
    if (property) commitHideProperty(property);
  };

  const hideUnitById = (listingId: string) => {
    for (const property of allProperties) {
      const row = toListingRows(property).find(item => String(item.listingId) === listingId);
      if (row) {
        commitHideUnit(property, row);
        return;
      }
    }
  };

  const backToSearch = () => navigate('/properties');

  useResultsPageContext(
    {
      // Only when the search that produced these results ran in this page load. A
      // refresh restores the results but not the form, so describing what is in the
      // form then would name filters that had nothing to do with what is on screen.
      filterSummary: fromThisLoad ? describeFilters(form) : '',
      properties: visibleProperties,
      hiddenUnitIds,
      hidden,
      showHidden,
      expired,
      propertyCount: results?.propertyCount ?? 0,
      unitCount: results?.unitCount ?? 0,
    },
    {
      onHideProperty: hidePropertyById,
      onHideUnit: hideUnitById,
      onUnhide: unhide,
      onBackToSearch: backToSearch,
    }
  );

  // Only when storage had nothing to restore either: no search has run in this tab
  // yet, or the last one was too large to persist. There is no result set to render
  // and no job to poll for one, so the filters are where the user has to start.
  if (!results) return <Navigate to='/properties' replace />;

  // The modal is outside the column for the same reason the progress overlay is: it
  // is fixed with inset 0, and a stacked sibling's margin would push its scrim down.
  return (
    <>
      <div className='mx-auto max-w-5xl space-y-5 p-6'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <Button variant='ghost' size='sm' onClick={backToSearch}>
              <ArrowLeft size={16} />
              Back to search
            </Button>
            <h1 className='type-ui-h2 mt-2 text-ink'>Search results</h1>
          </div>
          <Button variant='outline' size='sm' onClick={() => setShowHidden(current => !current)}>
            {showHidden ? <EyeOff size={16} /> : <Eye size={16} />}
            {showHidden ? 'Hide the hidden items' : `Show hidden (${hidden.length})`}
          </Button>
        </div>

        {showHidden && (
          <HiddenPanel
            hidden={hidden}
            isLoading={isLoadingHidden}
            error={hiddenError}
            onUnhide={unhide}
          />
        )}

        {expired ? (
          <Card className='p-10 text-center'>
            <p className='type-ui-title text-ink'>These results are no longer available</p>
            <p className='type-ui-sm mt-1 text-ink-3'>
              The scrape they came from has been cleared out. Go back to the search and run it
              again.
            </p>
          </Card>
        ) : (
          <div className='space-y-4'>
            <p className='type-ui-caption'>
              {results.propertyCount} properties and {results.unitCount} units found.{' '}
              {visibleProperties.length} of {allProperties.length} properties shown.
            </p>

            {results.truncated && (
              <p className='type-ui-sm text-ink-3'>
                These results are partial. The scan covered {results.pagesScanned ?? 0} of{' '}
                {results.totalPages ?? 0} result pages, so raise pages to scan or narrow your
                filters to see the rest.
              </p>
            )}

            {allProperties.length === 0 ? (
              <Card className='p-10 text-center'>
                <p className='type-ui-title text-ink'>No properties matched</p>
                <p className='type-ui-sm mt-1 text-ink-3'>
                  Try widening the price range, adding districts, or scanning more pages.
                </p>
              </Card>
            ) : visibleProperties.length === 0 ? (
              <Card className='p-10 text-center'>
                <p className='type-ui-title text-ink'>Every result is hidden</p>
                <p className='type-ui-sm mt-1 text-ink-3'>
                  Open the hidden items panel to bring a property back.
                </p>
              </Card>
            ) : (
              visibleProperties.map(property => (
                <PropertyCard
                  key={`${results.jobId}-${property.propertyId}`}
                  property={property}
                  hiddenUnitIds={hiddenUnitIds}
                  onHideProperty={property => setPendingHide({ scope: 'property', property })}
                  onHideUnit={(property, row) => setPendingHide({ scope: 'unit', property, row })}
                />
              ))
            )}
          </div>
        )}
      </div>

      <HideConfirmModal
        pending={pendingHide}
        onClose={() => setPendingHide(null)}
        onConfirm={confirmHide}
      />
    </>
  );
}
