import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, BookmarkPlus, Eye, EyeOff, Pencil } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import Toast, { type ToastItem } from '../../components/ui/toast';
import PropertyCard from '../../components/property/PropertyCard';
import HiddenPanel from './components/HiddenPanel';
import HideConfirmModal from './components/HideConfirmModal';
import SaveSearchModal from './components/SaveSearchModal';
import EditSearchModal from './components/EditSearchModal';
import ScrapeProgress from './components/ScrapeProgress';
import SearchErrorPanel from './components/SearchErrorPanel';
import { useHiddenEntities } from './hooks/useHiddenEntities';
import { useShortlist } from '../../hooks/useShortlist';
import { useSearchProgress } from './hooks/useSearchProgress';
import { useStartSearch } from './hooks/useStartSearch';
import { useResultsPageContext } from './PageContext';
import { createSavedSearch, updateSavedSearch } from '../../services/listingsService';
import { usePropertySearchResultsStore } from '../../store/usePropertySearchStore';
import type {
  FilterFormState,
  HiddenEntity,
  ListingRow,
  PendingHide,
  Property,
} from '../../types/listings';
import { buildSearchRequest, describeFilters } from './utils/filterOptions';
import { formatCurrency } from '../../lib/listingsFormat';
import { resultEntityKeys, toListingRows } from '../../lib/listingRows';

/**
 * Search results - the scrape while it runs, then the properties it returned.
 *
 * This screen owns the poll, so a search is watched where its results will land
 * rather than behind an overlay on the filters. Both the job id and the finished
 * result set are persisted, so a reload either picks the running scrape back up
 * or lands straight back on the results.
 *
 * Hidden properties and units stay in the result set and are filtered at render
 * time, which is what makes a hide reversible. What is hidden belongs to the search
 * rather than to the app: while the search is unsaved it is held with the results,
 * and once it is saved every hide and unhide writes through to the stored search.
 *
 * The filters behind the results are persisted with them, so this screen can save
 * the search it is showing even after a reload has emptied the filter panel.
 */
export default function PropertySearchResults() {
  const navigate = useNavigate();
  const jobId = usePropertySearchResultsStore(state => state.jobId);
  const results = usePropertySearchResultsStore(state => state.results);
  const searchForm = usePropertySearchResultsStore(state => state.searchForm);
  const savedSearchId = usePropertySearchResultsStore(state => state.savedSearchId);
  const savedSearchName = usePropertySearchResultsStore(state => state.savedSearchName);
  const setResults = usePropertySearchResultsStore(state => state.setResults);
  const linkSavedSearch = usePropertySearchResultsStore(state => state.linkSavedSearch);
  const setHidden = usePropertySearchResultsStore(state => state.setHidden);
  const startJob = usePropertySearchResultsStore(state => state.startJob);
  const [showHidden, setShowHidden] = useState(false);
  const [pendingHide, setPendingHide] = useState<PendingHide | null>(null);
  const [isNamingSearch, setIsNamingSearch] = useState(false);
  const [isEditingSearch, setIsEditingSearch] = useState(false);
  const [isSavingSearch, setIsSavingSearch] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((type: ToastItem['type'], message: string) => {
    const id = Date.now();
    setToasts(current => [...current, { id, type, message }]);
    setTimeout(() => setToasts(current => current.filter(toast => toast.id !== id)), 5000);
  }, []);

  const { status, error: pollError } = useSearchProgress(jobId);
  const { startSearch } = useStartSearch();

  const {
    hidden,
    hiddenPropertyIds,
    hiddenUnitIds,
    error: hiddenError,
    hide,
    unhide,
  } = useHiddenEntities();

  const {
    shortlistedIds,
    error: shortlistError,
    add: addToShortlist,
    remove: removeFromShortlist,
  } = useShortlist();

  const errorMessage = pollError || status?.error || '';
  // A failed job keeps its id, so the failure survives a reload instead of bouncing
  // the user back to the filters with nothing said.
  const isFailed = Boolean(pollError) || status?.status === 'failed';
  const isRunning = jobId !== null && !isFailed;
  const phase = isRunning ? 'running' : isFailed ? 'failed' : 'ready';

  const allProperties = useMemo(() => results?.properties ?? [], [results]);
  const visibleProperties = allProperties.filter(
    property => !hiddenPropertyIds.has(property.propertyId)
  );
  const expired = Boolean(results?.expired);

  // What the panel and the count show: a search keeps hiding something a later run
  // did not turn up, and listing it here would be listing something not on screen.
  const hiddenInResults = useMemo(() => {
    const keys = resultEntityKeys(allProperties);
    return hidden.filter(entity => keys.has(entity.entityKey));
  }, [hidden, allProperties]);

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

  // The heart is a toggle, so one handler covers both directions. Adding sends the
  // whole listing rather than its id, because a shortlist outlives the search that
  // turned the unit up and there would be nothing left to look the id up against.
  const toggleShortlist = (property: Property, row: ListingRow) => {
    const listingId = String(row.listingId);
    if (shortlistedIds.has(listingId)) {
      removeFromShortlist(listingId);
      return;
    }
    addToShortlist(property, row);
  };

  const shortlistUnitById = (listingId: string) => {
    for (const property of allProperties) {
      const row = toListingRows(property).find(item => String(item.listingId) === listingId);
      if (row) {
        addToShortlist(property, row);
        return;
      }
    }
  };

  const backToSearch = () => navigate('/properties');

  // The request is rebuilt from the snapshot rather than stored alongside it, so a
  // saved search is byte for byte what a search run from these filters would send.
  // What the search hides goes with it, and from here on these results are that
  // saved search, so every later hide writes straight through.
  const saveSearch = async (name: string) => {
    if (!searchForm) return;
    setIsSavingSearch(true);
    try {
      const saved = await createSavedSearch(name, buildSearchRequest(searchForm), hidden);
      linkSavedSearch(saved.searchId, saved.name);
      setIsNamingSearch(false);
      addToast('success', `Saved "${name}" to your searches.`);
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to save the search');
    } finally {
      setIsSavingSearch(false);
    }
  };

  // The write comes first and the scrape only if it succeeded, so a failed save never
  // opens a browser window for results the stored search would not have matched.
  const saveAndRerun = async (
    name: string,
    edited: FilterFormState,
    editedHidden: HiddenEntity[]
  ) => {
    if (!savedSearchId) return;
    setIsSavingSearch(true);
    const request = buildSearchRequest(edited);
    try {
      const saved = await updateSavedSearch(savedSearchId, name, request, editedHidden);
      // The row is stored either way, so the screen takes the new name and hidden
      // list before the scrape, and still matches the file if the scrape never starts.
      linkSavedSearch(saved.searchId, saved.name);
      setHidden(saved.hidden);
      const newJobId = await startSearch(request);
      if (!newJobId) {
        addToast('error', 'Saved, but the search could not be started.');
        return;
      }
      setIsEditingSearch(false);
      startJob(newJobId, edited, {
        searchId: saved.searchId,
        name: saved.name,
        hidden: saved.hidden,
      });
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to update the saved search');
    } finally {
      setIsSavingSearch(false);
    }
  };

  useResultsPageContext(
    {
      phase,
      status: status?.status ?? null,
      errorMessage,
      filterSummary: searchForm ? describeFilters(searchForm) : '',
      savedSearchName,
      properties: visibleProperties,
      hiddenUnitIds,
      hidden: hiddenInResults,
      shortlistedIds,
      showHidden,
      expired,
      propertyCount: results?.propertyCount ?? 0,
      unitCount: results?.unitCount ?? 0,
    },
    {
      onHideProperty: hidePropertyById,
      onHideUnit: hideUnitById,
      onUnhide: unhide,
      onShortlistUnit: shortlistUnitById,
      onRemoveFromShortlist: removeFromShortlist,
      onBackToSearch: backToSearch,
      onSaveSearch: saveSearch,
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
            {savedSearchName && (
              <p className='type-ui-caption mt-1'>Saved search: {savedSearchName}</p>
            )}
          </div>
          {phase === 'ready' && (
            <div className='flex flex-wrap items-center gap-2'>
              {searchForm &&
                (savedSearchId ? (
                  <Button variant='outline' size='sm' onClick={() => setIsEditingSearch(true)}>
                    <Pencil size={16} />
                    Edit search
                  </Button>
                ) : (
                  <Button variant='outline' size='sm' onClick={() => setIsNamingSearch(true)}>
                    <BookmarkPlus size={16} />
                    Save search
                  </Button>
                ))}
              <Button
                variant='outline'
                size='sm'
                onClick={() => setShowHidden(current => !current)}
              >
                {showHidden ? <EyeOff size={16} /> : <Eye size={16} />}
                {showHidden ? 'Hide the hidden items' : `Show hidden (${hiddenInResults.length})`}
              </Button>
            </div>
          )}
        </div>

        {showHidden && phase === 'ready' && (
          <HiddenPanel hidden={hiddenInResults} error={hiddenError} onUnhide={unhide} />
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

            {shortlistError && <p className='text-sm text-rose'>{shortlistError}</p>}

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
                  shortlistedIds={shortlistedIds}
                  onToggleShortlist={toggleShortlist}
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

      {isNamingSearch && searchForm && (
        <SaveSearchModal
          filterSummary={describeFilters(searchForm)}
          isSaving={isSavingSearch}
          onClose={() => setIsNamingSearch(false)}
          onSave={saveSearch}
        />
      )}

      {isEditingSearch && searchForm && savedSearchName && (
        <EditSearchModal
          name={savedSearchName}
          form={searchForm}
          hidden={hidden}
          confirmLabel='Save and rerun'
          isSaving={isSavingSearch}
          onClose={() => setIsEditingSearch(false)}
          onSave={saveAndRerun}
        />
      )}

      {toasts.map((toast, index) => (
        <Toast
          key={toast.id}
          toast={toast}
          index={index}
          onRemove={() => setToasts(current => current.filter(item => item.id !== toast.id))}
        />
      ))}
    </>
  );
}
