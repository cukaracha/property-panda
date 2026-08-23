import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import PropertyCard from './components/PropertyCard';
import HiddenPanel from './components/HiddenPanel';
import HideConfirmModal from './components/HideConfirmModal';
import ScrapeProgress from './components/ScrapeProgress';
import SearchErrorPanel from './components/SearchErrorPanel';
import { useHiddenEntities } from './hooks/useHiddenEntities';
import { useSearchProgress } from './hooks/useSearchProgress';
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
 * Search results - the scrape while it runs, then the properties it returned.
 *
 * This screen owns the poll, so a search is watched where its results will land
 * rather than behind an overlay on the filters. Both the job id and the finished
 * result set are persisted, so a reload either picks the running scrape back up
 * or lands straight back on the results.
 *
 * Hidden properties and units stay in the result set and are filtered at render
 * time, which is what makes a hide reversible.
 */
export default function PropertySearchResults() {
  const navigate = useNavigate();
  const jobId = usePropertySearchResultsStore(state => state.jobId);
  const results = usePropertySearchResultsStore(state => state.results);
  const filtersOnRecord = usePropertySearchResultsStore(state => state.filtersOnRecord);
  const setResults = usePropertySearchResultsStore(state => state.setResults);
  const form = usePropertySearchStore(state => state.form);
  const [showHidden, setShowHidden] = useState(false);
  const [pendingHide, setPendingHide] = useState<PendingHide | null>(null);

  const { status, error: pollError } = useSearchProgress(jobId);

  const {
    hidden,
    hiddenPropertyIds,
    hiddenUnitIds,
    isLoading: isLoadingHidden,
    error: hiddenError,
    hide,
    unhide,
  } = useHiddenEntities();

  const errorMessage = pollError || status?.error || '';
  // A failed job keeps its id, so the failure survives a reload instead of bouncing
  // the user back to the filters with nothing said.
  const isFailed = Boolean(pollError) || status?.status === 'failed';
  const isRunning = jobId !== null && !isFailed;
  const phase = isRunning ? 'running' : isFailed ? 'failed' : 'ready';

  const allProperties = results?.properties ?? [];
  const visibleProperties = allProperties.filter(
    property => !hiddenPropertyIds.has(property.propertyId)
  );
  const expired = Boolean(results?.expired);

  // Handing the finished payload to the store also clears the job id, which stops
  // the poller and swaps the progress card for the cards it produced.
  useEffect(() => {
    if (status?.status !== 'succeeded') return;
    setResults(status);
  }, [status, setResults]);

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
      phase,
      status: status?.status ?? null,
      errorMessage,
      // Only when the search was started in this page load. A reload restores the
      // results but not the form, so describing what is in the form then would name
      // filters that had nothing to do with what is on screen.
      filterSummary: filtersOnRecord ? describeFilters(form) : '',
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

  // Nothing to watch and nothing to show, which is what storage having nothing to
  // restore looks like: no search has run in this tab, or the last result set was
  // too large to persist. The filters are where the user has to start.
  if (!jobId && !results) return <Navigate to='/properties' replace />;

  // The modal is outside the column because it is fixed with inset 0, and a stacked
  // sibling's margin would push its scrim down and leave a strip of page uncovered.
  return (
    <>
      <div className='mx-auto max-w-5xl space-y-5 p-6'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <Button variant='ghost' size='sm' onClick={backToSearch}>
              <ArrowLeft size={16} />
              Back to search
            </Button>
            <h1 className='type-ui-h2 mt-2 text-ink'>
              {isRunning ? 'Searching' : 'Search results'}
            </h1>
          </div>
          {phase === 'ready' && (
            <Button variant='outline' size='sm' onClick={() => setShowHidden(current => !current)}>
              {showHidden ? <EyeOff size={16} /> : <Eye size={16} />}
              {showHidden ? 'Hide the hidden items' : `Show hidden (${hidden.length})`}
            </Button>
          )}
        </div>

        {showHidden && phase === 'ready' && (
          <HiddenPanel
            hidden={hidden}
            isLoading={isLoadingHidden}
            error={hiddenError}
            onUnhide={unhide}
          />
        )}

        {isRunning ? (
          <ScrapeProgress
            status={status?.status ?? 'queued'}
            listingCount={status?.listingCount ?? 0}
            pagesFetched={status?.pagesFetched ?? 0}
            pagesTotal={status?.pagesTotal ?? 0}
            detailsFetched={status?.detailsFetched ?? 0}
            detailsTotal={status?.detailsTotal ?? 0}
            note={status?.note}
          />
        ) : isFailed ? (
          <SearchErrorPanel
            message={errorMessage || 'The scrape failed before it returned any results.'}
            detail={status?.errorDetail}
          />
        ) : expired ? (
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
              {results?.propertyCount ?? 0} properties and {results?.unitCount ?? 0} units found.{' '}
              {visibleProperties.length} of {allProperties.length} properties shown.
            </p>

            {results?.truncated && (
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
                  key={`${results?.jobId}-${property.propertyId}`}
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
