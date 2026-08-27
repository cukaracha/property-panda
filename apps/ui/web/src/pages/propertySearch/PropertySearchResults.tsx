import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BookmarkPlus,
  Eye,
  EyeOff,
  FilterX,
  ListFilter,
  Map,
  Pencil,
} from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import Toast, { type ToastItem } from '../../components/ui/toast';
import PropertyCard from '../../components/property/PropertyCard';
import UnshortlistConfirmModal from '../../components/property/UnshortlistConfirmModal';
import UnhideConfirmModal from '../../components/property/UnhideConfirmModal';
import HiddenPanel from './components/HiddenPanel';
import HideConfirmModal from './components/HideConfirmModal';
import SaveSearchModal from './components/SaveSearchModal';
import EditSearchModal from './components/EditSearchModal';
import ResultsFilterModal from './components/ResultsFilterModal';
import ResultsMapPanel from './components/ResultsMapPanel';
import ScrapeProgress from './components/ScrapeProgress';
import SearchErrorPanel from './components/SearchErrorPanel';
import { useBookmarkedEntities } from './hooks/useBookmarkedEntities';
import { useHiddenEntities } from './hooks/useHiddenEntities';
import { useShortlist } from '../../hooks/useShortlist';
import { useAlwaysHidden } from '../../hooks/useAlwaysHidden';
import { useSearchProgress } from './hooks/useSearchProgress';
import { useStartSearch } from './hooks/useStartSearch';
import { useResultsPageContext } from './PageContext';
import { createSavedSearch, updateSavedSearch } from '../../services/listingsService';
import { usePropertySearchResultsStore } from '../../store/usePropertySearchStore';
import type {
  BookmarkedEntity,
  HiddenEntity,
  ListingRow,
  PendingHide,
  PendingUnshortlist,
  Property,
  SearchFormState,
} from '../../types/listings';

/** The hidden row waiting on an answer, and which list it would come off. */
type PendingUnhide = { entity: HiddenEntity; isAlways: boolean };
import {
  buildSearchRequest,
  describeSearchForm,
  DISTRICT_NAME_BY_CODE,
} from './utils/filterOptions';
import { countUnpositioned, filterByMap, propertyPoint } from './utils/mapFilter';
import {
  countResultFilters,
  DEFAULT_RESULT_FILTER,
  filterResults,
  resultFacets,
} from './utils/resultsFilter';
import type { MapViewport } from '../../components/map/DistrictMap';
import { formatCurrency } from '../../lib/listingsFormat';
import { cn } from '../../lib/utils';
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
 * time, which is what makes a hide reversible. Bookmarked properties are sorted to
 * the front of the same set, so a bookmark is as reversible as a hide, and hiding
 * still wins: a property that is both stays off screen until it is unhidden.
 *
 * What is hidden and what is bookmarked belong to the search rather than to the app:
 * while the search is unsaved they are held with the results, and once it is saved
 * every toggle writes through to the stored search. Always hidden items are the
 * exception: they belong to the app, so this screen filters on the union of the two
 * lists and the hide confirmation decides which one an item joins.
 *
 * The filters behind the results are persisted with them, so this screen can save
 * the search it is showing even after a reload has emptied the filter panel.
 *
 * The map above the cards is a view filter and only that: it narrows what is on screen
 * and is never written to the search, the server or the saved search, which is why it is
 * held in plain component state and starts over with each result set. Changing the
 * districts a saved search covers is Edit search's job, since that has to re-run the
 * scrape to mean anything.
 *
 * Filter listings is the same kind of thing over the same result set, offering the rest
 * of the filter groups the payload can answer. Districts are the one field the two share,
 * so they share one piece of state rather than each keeping their own: selecting a
 * district in the panel moves the map, and moving the map moves the chips.
 */
export default function PropertySearchResults() {
  const navigate = useNavigate();
  const jobId = usePropertySearchResultsStore(state => state.jobId);
  const results = usePropertySearchResultsStore(state => state.results);
  const searchForm = usePropertySearchResultsStore(state => state.searchForm);
  const savedSearchId = usePropertySearchResultsStore(state => state.savedSearchId);
  const savedSearchName = usePropertySearchResultsStore(state => state.savedSearchName);
  const newSince = usePropertySearchResultsStore(state => state.newSince);
  const setResults = usePropertySearchResultsStore(state => state.setResults);
  const linkSavedSearch = usePropertySearchResultsStore(state => state.linkSavedSearch);
  const setHidden = usePropertySearchResultsStore(state => state.setHidden);
  const setBookmarked = usePropertySearchResultsStore(state => state.setBookmarked);
  const startJob = usePropertySearchResultsStore(state => state.startJob);
  const [showHidden, setShowHidden] = useState(false);
  // The map rail starts open at every non-mobile width, which is what the split view is
  // for. Below 768px the same flag drives the overlay drawer, which starts closed.
  const [showMap, setShowMap] = useState(() => {
    try {
      return !window.matchMedia('(max-width: 767px)').matches;
    } catch {
      return true;
    }
  });
  const [pendingUnhide, setPendingUnhide] = useState<PendingUnhide | null>(null);
  const [pendingHide, setPendingHide] = useState<PendingHide | null>(null);
  const [pendingUnshortlist, setPendingUnshortlist] = useState<PendingUnshortlist | null>(null);
  const [isNamingSearch, setIsNamingSearch] = useState(false);
  const [isEditingSearch, setIsEditingSearch] = useState(false);
  const [isFilteringResults, setIsFilteringResults] = useState(false);
  const [isSavingSearch, setIsSavingSearch] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // Where the map is pointing. Deliberately plain component state: this narrows what is on
  // screen and nothing else. It is never written to searchForm, never sent to the server
  // and never persisted, so zooming cannot alter a saved search -- unlike hiding and
  // bookmarking, which do write through (see useHiddenEntities). Editing the districts a
  // saved search covers goes through Edit search, which re-runs the scrape.
  const [mapSelection, setMapSelection] = useState<string[]>([]);
  const [mapViewport, setMapViewport] = useState<MapViewport | null>(null);
  // The rest of the results filter, on the same terms as the map and for the same
  // reason. Districts are absent from it: they live in mapSelection above, since the two
  // controls edit one field and a second copy of it would only be a way for them to
  // disagree.
  const [resultFilter, setResultFilter] = useState(DEFAULT_RESULT_FILTER);
  const [mappedResults, setMappedResults] = useState(results);
  const allPropertyCount = results?.properties?.length ?? 0;

  // A fresh result set starts with the map wide open. Carrying the old view over would let
  // a search re-run for different districts come back looking empty, with only the count
  // line to explain why. Adjusted during render rather than in an effect, which is the
  // supported way to reset state when an input changes and avoids a second paint.
  if (results !== mappedResults) {
    setMappedResults(results);
    setMapSelection([]);
    setMapViewport(null);
    setResultFilter(DEFAULT_RESULT_FILTER);
    setIsFilteringResults(false);
  }

  // The launcher and the assistant panel are fixed to the viewport's right edge, which
  // is exactly where the rail is, so they are told to step aside for as long as it is
  // open. A class rather than store state: the rail belongs to this route alone.
  useEffect(() => {
    const hasRail = allPropertyCount > 0;
    document.body.classList.toggle('map-rail-open', hasRail && showMap);
    // Closed, the rail is still 52px of column above 768px, so the launcher steps
    // aside by that much rather than returning to the viewport edge.
    document.body.classList.toggle('map-rail-collapsed', hasRail && !showMap);
    return () => {
      document.body.classList.remove('map-rail-open');
      document.body.classList.remove('map-rail-collapsed');
    };
  }, [showMap, allPropertyCount]);

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
    bookmarked,
    bookmarkedPropertyIds,
    error: bookmarkedError,
    bookmark,
    unbookmark,
  } = useBookmarkedEntities();

  const {
    shortlistedIds,
    error: shortlistError,
    add: addToShortlist,
    remove: removeFromShortlist,
  } = useShortlist();

  const {
    alwaysHidden,
    alwaysHiddenPropertyIds,
    alwaysHiddenUnitIds,
    error: alwaysHiddenError,
    hideAlways,
    unhideAlways,
  } = useAlwaysHidden();

  const errorMessage = pollError || status?.error || '';
  // A failed job keeps its id, so the failure survives a reload instead of bouncing
  // the user back to the filters with nothing said.
  const isFailed = Boolean(pollError) || status?.status === 'failed';
  const isRunning = jobId !== null && !isFailed;
  const phase = isRunning ? 'running' : isFailed ? 'failed' : 'ready';

  const allProperties = useMemo(() => results?.properties ?? [], [results]);

  // What the map draws pins for: everything still on the search, before the map narrows
  // it. Pinning only what survives the map would erase the pins the user is zooming
  // towards, so the pins show what is available and the list shows what is selected.
  const mappableProperties = useMemo(
    () =>
      allProperties.filter(
        property =>
          !hiddenPropertyIds.has(property.propertyId) &&
          !alwaysHiddenPropertyIds.has(property.propertyId)
      ),
    [allProperties, hiddenPropertyIds, alwaysHiddenPropertyIds]
  );

  // One set for the cards and for the assistant, since a row is left out for the same
  // reason whichever list holds it and the card only ever counts what it was not shown.
  const combinedHiddenUnitIds = useMemo(
    () => new Set([...hiddenUnitIds, ...alwaysHiddenUnitIds]),
    [hiddenUnitIds, alwaysHiddenUnitIds]
  );

  // What the filter panel is allowed to offer: read off the properties the map draws
  // pins for, before either view filter narrows them. Reading it off the narrowed list
  // would grey out the chip the user just pressed, since choosing a value would leave it
  // as the only one the results still carry.
  const facets = useMemo(() => resultFacets(mappableProperties), [mappableProperties]);

  // The map first, then the rest of the filter, so the two rules about a missing field
  // stay apart: the map keeps a property it cannot place, and the filter drops a record
  // that cannot answer a filter the user set by hand.
  const filtered = useMemo(
    () =>
      filterResults(
        filterByMap(mappableProperties, mapSelection, mapViewport),
        resultFilter,
        combinedHiddenUnitIds
      ),
    [mappableProperties, mapSelection, mapViewport, resultFilter, combinedHiddenUnitIds]
  );

  // Bookmarks sort rather than filter, and they sort after hiding and after both view
  // filters, so a property that is both stays off screen. Each half keeps the order the
  // scrape returned it in, so pinning a card moves it to the front without reshuffling
  // anything around it.
  const visibleProperties = useMemo(
    () => [
      ...filtered.properties.filter(property => bookmarkedPropertyIds.has(property.propertyId)),
      ...filtered.properties.filter(property => !bookmarkedPropertyIds.has(property.propertyId)),
    ],
    [filtered, bookmarkedPropertyIds]
  );

  // The map's districts are counted alongside the per type filters, since the button
  // stands for both of them: a district chosen on the map narrows the same list.
  const activeFilterCount = countResultFilters(resultFilter, mapSelection, facets.groups);

  const clearResultFilter = () => {
    setResultFilter(DEFAULT_RESULT_FILTER);
    setMapSelection([]);
  };

  const mapMarkers = useMemo(
    () =>
      mappableProperties.flatMap(property => {
        const point = propertyPoint(property);
        if (!point) return [];
        return [
          {
            id: property.propertyId,
            x: point.x,
            y: point.y,
            dimmed: point.approximate,
            district: property.info.district ?? undefined,
          },
        ];
      }),
    [mappableProperties]
  );
  const unpositionedCount = useMemo(
    () => countUnpositioned(mappableProperties),
    [mappableProperties]
  );
  const approximateCount = mapMarkers.filter(marker => marker.dimmed).length;
  const isMapFiltering = mapSelection.length > 0 || mapViewport !== null;
  // Prose for the assistant, since it is handed the map-filtered list. Names the districts
  // rather than the viewport rectangle: the numbers of a projected box mean nothing to it.
  const mapFilterSummary = !isMapFiltering
    ? ''
    : [
        mapSelection.length
          ? `districts ${mapSelection
              .map(code =>
                DISTRICT_NAME_BY_CODE[code] ? `${code} ${DISTRICT_NAME_BY_CODE[code]}` : code
              )
              .join(', ')}`
          : '',
        mapViewport ? 'zoomed to part of the island' : '',
      ]
        .filter(Boolean)
        .join(', and ');
  const expired = Boolean(results?.expired);

  // What the panel and the count show: a search keeps hiding something a later run
  // did not turn up, and listing it here would be listing something not on screen.
  const hiddenInResults = useMemo(() => {
    const keys = resultEntityKeys(allProperties);
    return hidden.filter(entity => keys.has(entity.entityKey));
  }, [hidden, allProperties]);

  const alwaysHiddenInResults = useMemo(() => {
    const keys = resultEntityKeys(allProperties);
    return alwaysHidden.filter(entity => keys.has(entity.entityKey));
  }, [alwaysHidden, allProperties]);

  const bookmarkedInResults = useMemo(() => {
    const keys = resultEntityKeys(allProperties);
    return bookmarked.filter(entity => keys.has(entity.entityKey));
  }, [bookmarked, allProperties]);

  // Handing the finished payload to the store also clears the job id, which stops
  // the poller and swaps the progress card for the cards it produced.
  useEffect(() => {
    if (status?.status !== 'succeeded') return;
    setResults(status);
  }, [status, setResults]);

  // The two lists take the same entity and differ only in reach, so one pair of commit
  // helpers builds the label and the toggle picks which list it lands on.
  const commitHideProperty = (property: Property, alwaysHide: boolean) =>
    (alwaysHide ? hideAlways : hide)('property', property.propertyId, property.name);

  const commitHideUnit = (property: Property, row: ListingRow, alwaysHide: boolean) =>
    (alwaysHide ? hideAlways : hide)(
      'unit',
      String(row.listingId),
      `${property.name}, ${row.unitTypeLabel}, ${formatCurrency(row.price)}`
    );

  const confirmHide = async (alwaysHide: boolean) => {
    if (!pendingHide) return;
    if (pendingHide.scope === 'property') {
      await commitHideProperty(pendingHide.property, alwaysHide);
      return;
    }
    await commitHideUnit(pendingHide.property, pendingHide.row, alwaysHide);
  };

  const hidePropertyById = (propertyId: string, alwaysHide = false) => {
    const property = allProperties.find(item => item.propertyId === propertyId);
    if (property) commitHideProperty(property, alwaysHide);
  };

  const hideUnitById = (listingId: string, alwaysHide = false) => {
    for (const property of allProperties) {
      const row = toListingRows(property).find(item => String(item.listingId) === listingId);
      if (row) {
        commitHideUnit(property, row, alwaysHide);
        return;
      }
    }
  };

  // The heart is a toggle, so one handler covers both directions, but they are not
  // symmetrical. Adding sends the whole listing rather than its id, because a shortlist
  // outlives the search that turned the unit up and there would be nothing left to look
  // the id up against. Removing throws that copy away, so it asks first.
  const toggleShortlist = (property: Property, row: ListingRow) => {
    if (shortlistedIds.has(String(row.listingId))) {
      setPendingUnshortlist({ property, row });
      return;
    }
    addToShortlist(property, row);
  };

  const confirmUnshortlist = async () => {
    if (!pendingUnshortlist) return;
    await removeFromShortlist(String(pendingUnshortlist.row.listingId));
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

  // No confirmation either way: a bookmark takes nothing off screen and nothing is
  // thrown away by removing one, so it is a toggle like the heart rather than a hide.
  const toggleBookmark = (property: Property) => {
    if (bookmarkedPropertyIds.has(property.propertyId)) {
      unbookmark(`property#${property.propertyId}`);
      return;
    }
    bookmark(property.propertyId, property.name);
  };

  const bookmarkPropertyById = (propertyId: string) => {
    const property = allProperties.find(item => item.propertyId === propertyId);
    if (property) bookmark(property.propertyId, property.name);
  };

  const removeBookmarkById = (propertyId: string) => unbookmark(`property#${propertyId}`);

  const backToSearch = () => navigate('/search');

  // The request is rebuilt from the snapshot rather than stored alongside it, so a
  // saved search is byte for byte what a search run from these filters would send.
  // What the search hides goes with it, and from here on these results are that
  // saved search, so every later hide writes straight through.
  const saveSearch = async (name: string) => {
    if (!searchForm) return;
    setIsSavingSearch(true);
    try {
      const saved = await createSavedSearch(
        name,
        buildSearchRequest(searchForm),
        hidden,
        bookmarked
      );
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
    edited: SearchFormState,
    editedHidden: HiddenEntity[],
    editedBookmarked: BookmarkedEntity[]
  ) => {
    if (!savedSearchId) return;
    setIsSavingSearch(true);
    const request = buildSearchRequest(edited);
    try {
      const saved = await updateSavedSearch(
        savedSearchId,
        name,
        request,
        editedHidden,
        editedBookmarked
      );
      // The row is stored either way, so the screen takes the new name, hidden list
      // and bookmarks before the scrape, and still matches the file if the scrape
      // never starts.
      linkSavedSearch(saved.searchId, saved.name);
      setHidden(saved.hidden);
      setBookmarked(saved.bookmarked);
      const newJobId = await startSearch(request, saved.searchId);
      if (!newJobId) {
        addToast('error', 'Saved, but the search could not be started.');
        return;
      }
      setIsEditingSearch(false);
      // An edit never moves the last run, so the row that just came back still carries
      // the stamp from the previous scrape, which is the baseline this run measures new
      // listings against.
      startJob(newJobId, edited, {
        searchId: saved.searchId,
        name: saved.name,
        hidden: saved.hidden,
        bookmarked: saved.bookmarked,
        lastRunAt: saved.lastRunAt,
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
      filterSummary: searchForm ? describeSearchForm(searchForm) : '',
      mapFilterSummary,
      // Only the types these results actually contain, so the summary describes the
      // filter that is applied rather than the two tabs that are on but stand for nothing.
      resultFilterSummary:
        activeFilterCount > 0
          ? describeSearchForm({
              groups: facets.groups.filter(group => resultFilter.groups.includes(group)),
              forms: resultFilter.forms,
            })
          : '',
      savedSearchName,
      newSince,
      properties: visibleProperties,
      hiddenUnitIds: combinedHiddenUnitIds,
      hidden: hiddenInResults,
      alwaysHidden: alwaysHiddenInResults,
      bookmarked: bookmarkedInResults,
      bookmarkedPropertyIds,
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
      onAlwaysHideProperty: (propertyId: string) => hidePropertyById(propertyId, true),
      onAlwaysHideUnit: (listingId: string) => hideUnitById(listingId, true),
      onUnhideAlways: unhideAlways,
      onBookmarkProperty: bookmarkPropertyById,
      onRemoveBookmark: removeBookmarkById,
      onShortlistUnit: shortlistUnitById,
      onRemoveFromShortlist: removeFromShortlist,
      onBackToSearch: backToSearch,
      onSaveSearch: saveSearch,
    }
  );

  // Nothing to watch and nothing to show, which is what storage having nothing to
  // restore looks like: no search has run in this tab, or the last result set was
  // too large to persist. The filters are where the user has to start.
  if (!jobId && !results) return <Navigate to='/search' replace />;

  // The modal is outside the column because it is fixed with inset 0, and a stacked
  // sibling's margin would push its scrim down and leave a strip of page uncovered.
  return (
    <>
      <div className='results-split'>
        <div className='results-col'>
          <div className='mx-auto w-full max-w-[1080px] space-y-5 px-6 pb-24 pt-7'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <div>
                <Button variant='ghost' size='sm' onClick={backToSearch}>
                  <ArrowLeft size={16} />
                  Back to search
                </Button>
                <h1 className='type-ui-h1 mt-2 text-strong'>
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
                  {allProperties.length > 0 && (
                    <Button variant='outline' size='sm' onClick={() => setIsFilteringResults(true)}>
                      <ListFilter size={16} />
                      Filter listings
                      {activeFilterCount > 0 && <Badge tone='positive'>{activeFilterCount}</Badge>}
                    </Button>
                  )}
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => setShowHidden(current => !current)}
                  >
                    {showHidden ? <EyeOff size={16} /> : <Eye size={16} />}
                    {showHidden
                      ? 'Hide the hidden items'
                      : `Show hidden (${hiddenInResults.length + alwaysHiddenInResults.length})`}
                  </Button>
                  {/* Below 768px the rail is off canvas with no strip left behind, so
                  this is the only thing that can bring it back. Above that the rail
                  carries its own control and this one would be a second copy. */}
                  {allProperties.length > 0 && (
                    <Button
                      variant='outline'
                      size='sm'
                      className='md:hidden'
                      aria-expanded={showMap}
                      onClick={() => setShowMap(current => !current)}
                    >
                      <Map size={16} />
                      {showMap ? 'Hide map' : 'Show map'}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {showHidden && phase === 'ready' && (
              <HiddenPanel
                hidden={hiddenInResults}
                alwaysHidden={alwaysHiddenInResults}
                error={hiddenError || alwaysHiddenError}
                onUnhide={entity => setPendingUnhide({ entity, isAlways: false })}
                onUnhideAlways={entity => setPendingUnhide({ entity, isAlways: true })}
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
              <Card className='px-6 py-16 text-center'>
                <p className='type-ui-title text-strong'>These results are no longer available</p>
                <p className='type-ui-sm mt-1 text-muted'>
                  The scrape they came from has been cleared out. Go back to the search and run it
                  again.
                </p>
              </Card>
            ) : (
              <div className='space-y-4'>
                <div className='flex flex-wrap items-center gap-2'>
                  <p className='type-ui-caption'>
                    {results?.propertyCount ?? 0} properties and {results?.unitCount ?? 0} units
                    found. {visibleProperties.length} of {allProperties.length} properties shown.
                  </p>
                  {activeFilterCount > 0 && (
                    <Button variant='ghost' size='sm' onClick={clearResultFilter}>
                      <FilterX size={15} />
                      Clear filters
                    </Button>
                  )}
                </div>

                {shortlistError && <p className='text-sm text-danger'>{shortlistError}</p>}
                {bookmarkedError && <p className='text-sm text-danger'>{bookmarkedError}</p>}
                {alwaysHiddenError && <p className='text-sm text-danger'>{alwaysHiddenError}</p>}

                {results?.truncated && (
                  <p className='type-ui-sm text-muted'>
                    These results are partial. The scan covered {results.pagesScanned ?? 0} of{' '}
                    {results.totalPages ?? 0} result pages, so raise pages to scan or narrow your
                    filters to see the rest.
                  </p>
                )}

                {allProperties.length === 0 ? (
                  <Card className='px-6 py-16 text-center'>
                    <p className='type-ui-title text-strong'>No properties matched</p>
                    <p className='type-ui-sm mt-1 text-muted'>
                      Try widening the price range, adding districts, or scanning more pages.
                    </p>
                  </Card>
                ) : visibleProperties.length === 0 && activeFilterCount > 0 ? (
                  <Card className='px-6 py-16 text-center'>
                    <p className='type-ui-title text-strong'>No results match these filters</p>
                    <p className='type-ui-sm mt-1 text-muted'>
                      Nothing the search returned answers all of them. Clearing the filters brings
                      every result back.
                    </p>
                    <div className='mt-4 flex justify-center'>
                      <Button variant='outline' size='sm' onClick={clearResultFilter}>
                        <FilterX size={16} />
                        Clear filters
                      </Button>
                    </div>
                  </Card>
                ) : visibleProperties.length === 0 ? (
                  <Card className='px-6 py-16 text-center'>
                    <p className='type-ui-title text-strong'>Every result is hidden</p>
                    <p className='type-ui-sm mt-1 text-muted'>
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
                      hiddenUnitIds={combinedHiddenUnitIds}
                      filteredUnitIds={filtered.filteredUnitIds}
                      onHideProperty={property => setPendingHide({ scope: 'property', property })}
                      onHideUnit={(property, row) =>
                        setPendingHide({ scope: 'unit', property, row })
                      }
                      isBookmarked={bookmarkedPropertyIds.has(property.propertyId)}
                      onToggleBookmark={toggleBookmark}
                      newSince={newSince}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* The rail is a normal flex sibling at every non-mobile width, so the results
            column shrinks to meet it. Below 768px it becomes an overlay drawer, which
            is the only place an overlay is right: there is no width to share. */}
        {allProperties.length > 0 && (
          <>
            <div
              className={cn('results-rail-backdrop', showMap && 'is-open')}
              onClick={() => setShowMap(false)}
            />
            <ResultsMapPanel
              isOpen={showMap}
              onOpen={() => setShowMap(true)}
              onClose={() => setShowMap(false)}
              selected={mapSelection}
              onSelectionChange={setMapSelection}
              onViewportChange={setMapViewport}
              markers={mapMarkers}
              unpositionedCount={unpositionedCount}
              isFiltering={isMapFiltering}
              approximateCount={approximateCount}
            />
          </>
        )}
      </div>

      <UnhideConfirmModal
        pending={pendingUnhide?.entity ?? null}
        isAlways={pendingUnhide?.isAlways ?? false}
        onClose={() => setPendingUnhide(null)}
        onConfirm={async () => {
          if (!pendingUnhide) return;
          if (pendingUnhide.isAlways) unhideAlways(pendingUnhide.entity.entityKey);
          else unhide(pendingUnhide.entity.entityKey);
        }}
      />

      {/* Mounted only while it is open, so the always hide toggle inside it starts off
          on every hide rather than carrying the last answer over. */}
      {pendingHide && (
        <HideConfirmModal
          pending={pendingHide}
          onClose={() => setPendingHide(null)}
          onConfirm={confirmHide}
        />
      )}

      <UnshortlistConfirmModal
        pending={pendingUnshortlist}
        onClose={() => setPendingUnshortlist(null)}
        onConfirm={confirmUnshortlist}
      />

      {isNamingSearch && searchForm && (
        <SaveSearchModal
          filterSummary={describeSearchForm(searchForm)}
          isSaving={isSavingSearch}
          onClose={() => setIsNamingSearch(false)}
          onSave={saveSearch}
        />
      )}

      {/* Mounted only while it is open, like the edit modal, so each opening starts from
          the filter that is actually applied rather than a draft left behind. */}
      {isFilteringResults && (
        <ResultsFilterModal
          form={resultFilter}
          districts={mapSelection}
          facets={facets}
          onClose={() => setIsFilteringResults(false)}
          onApply={(next, districts) => {
            setMapSelection(districts);
            setResultFilter(next);
            setIsFilteringResults(false);
          }}
        />
      )}

      {isEditingSearch && searchForm && savedSearchName && (
        <EditSearchModal
          name={savedSearchName}
          form={searchForm}
          hidden={hidden}
          bookmarked={bookmarked}
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
