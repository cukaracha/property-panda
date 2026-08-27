/**
 * Zustand stores for the property search, which is two sibling routes rather than
 * one page: the filters on /search and the results on /search/results.
 *
 * They are two stores rather than one because only one half is persisted, and the
 * persist middleware writes on every set. A single store would re-serialise the
 * whole result set on every keystroke in a filter field.
 *
 * The filter form is deliberately in memory only. That lifetime is already the one
 * the page wants: the form survives the trip to the results and back, and a refresh
 * of the filters starts clean.
 *
 * The results store holds the whole of the current search: the job id, the results,
 * a snapshot of the filters that produced them, the items it hides, the properties it
 * pins to the top, and the saved search it came from when it came from one. All of it is persisted, so a refresh of
 * the results route either picks the running scrape back up or lands on the results
 * it already finished, and either way still knows what was searched for. The snapshot
 * is a copy rather than a read of the live form, which is what lets the results screen
 * save its own search after the form has moved on. sessionStorage rather than
 * localStorage because both belong to the sitting that scraped them, and a result set
 * from last week should not still be on screen as though the scrape had just run.
 */

import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type {
  BookmarkedEntity,
  HiddenEntity,
  SearchFormState,
  SearchResultsResponse,
} from '../types/listings';
import { DEFAULT_SEARCH_FORM } from '../pages/propertySearch/utils/filterOptions';

const RESULTS_KEY = 'property-search-results';
// Bumped when the snapshot's shape changed: before the property type tabs it was one flat
// filter form rather than one per type. There is nothing to carry across, and a sitting
// left open across the change would otherwise put a shape this page cannot read on screen.
const RESULTS_VERSION = 2;

/**
 * sessionStorage, with a write that will not fit dropped rather than thrown.
 *
 * Scanning every page is the default, so a broad search can produce a result set
 * past the quota, and persist calls setItem inside the store's own set. Losing the
 * ability to survive a refresh is a far smaller failure than throwing out of the
 * update that put the results on screen in the first place.
 */
const safeSessionStorage: StateStorage = {
  getItem: name => {
    try {
      return sessionStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      sessionStorage.setItem(name, value);
    } catch {
      // Over quota, or storage unavailable. The results stay in memory for this
      // screen, they just will not come back after a refresh.
    }
  },
  removeItem: name => {
    try {
      sessionStorage.removeItem(name);
    } catch {
      // As above.
    }
  },
};

interface PropertySearchFormStore {
  form: SearchFormState;
  setForm: (form: SearchFormState) => void;
}

export const usePropertySearchStore = create<PropertySearchFormStore>(set => ({
  form: DEFAULT_SEARCH_FORM,
  setForm: form => set({ form }),
}));

interface PropertySearchResultsStore {
  /**
   * The job the results screen watches. Set when a search starts and cleared once
   * its results are in hand, so it is non-null exactly while there is something to
   * poll. A failed job keeps its id, which is what leaves the failure on screen
   * and re-readable after a reload.
   */
  jobId: string | null;
  /** The terminal poll payload of the last successful search, or null when there is none. */
  results: SearchResultsResponse | null;
  /** The filters the running or finished job was started with, or null before any. */
  searchForm: SearchFormState | null;
  /**
   * The saved search these results belong to, or null while the search is one the
   * user has run but not kept. It is what decides whether a hide is written through
   * to the server or only held here until the search is saved.
   */
  savedSearchId: string | null;
  savedSearchName: string | null;
  /** The properties and units this search hides, newest first. */
  hidden: HiddenEntity[];
  /** The properties this search pins to the top of its results, newest first. */
  bookmarked: BookmarkedEntity[];
  /**
   * When the saved search behind these results last finished a scrape, captured at the
   * moment this run was started. A listing posted after it is new.
   *
   * It is held here rather than read back from the saved search, because by the time the
   * results land the server has already moved that stamp forward to this run, and the
   * baseline the badges need is where it stood before.
   */
  newSince: number | null;
  startJob: (jobId: string, form: SearchFormState, saved: SavedSearchLink | null) => void;
  setResults: (results: SearchResultsResponse) => void;
  /**
   * Attach a search that has just been saved, keeping the items it already hides and
   * the properties it already pins.
   */
  linkSavedSearch: (searchId: string, name: string) => void;
  setHidden: (hidden: HiddenEntity[]) => void;
  setBookmarked: (bookmarked: BookmarkedEntity[]) => void;
}

/** What a search carries over from the saved search it was started from. */
export interface SavedSearchLink {
  searchId: string;
  name: string;
  hidden: HiddenEntity[];
  bookmarked: BookmarkedEntity[];
  lastRunAt: number | null;
}

export const usePropertySearchResultsStore = create<PropertySearchResultsStore>()(
  persist(
    set => ({
      jobId: null,
      results: null,
      searchForm: null,
      savedSearchId: null,
      savedSearchName: null,
      hidden: [],
      bookmarked: [],
      newSince: null,
      // The previous search's results go with it. They are not what this job is
      // scraping, and leaving them would put stale cards under a live progress card.
      // A run from the filters starts with nothing hidden and nothing pinned, a saved
      // one starts with whatever it was keeping when it was last run.
      startJob: (jobId, form, saved) =>
        set({
          jobId,
          results: null,
          searchForm: form,
          savedSearchId: saved?.searchId ?? null,
          savedSearchName: saved?.name ?? null,
          hidden: saved?.hidden ?? [],
          bookmarked: saved?.bookmarked ?? [],
          newSince: saved?.lastRunAt ?? null,
        }),
      setResults: results => set({ results, jobId: null }),
      linkSavedSearch: (searchId, name) => set({ savedSearchId: searchId, savedSearchName: name }),
      setHidden: hidden => set({ hidden }),
      setBookmarked: bookmarked => set({ bookmarked }),
    }),
    {
      name: RESULTS_KEY,
      version: RESULTS_VERSION,
      // Nothing survives the shape change, so a snapshot from before it starts over on
      // the initial state rather than being repaired into something it never was.
      migrate: () => ({}) as Partial<PropertySearchResultsStore>,
      storage: createJSONStorage(() => safeSessionStorage),
      partialize: state => ({
        jobId: state.jobId,
        results: state.results,
        searchForm: state.searchForm,
        savedSearchId: state.savedSearchId,
        savedSearchName: state.savedSearchName,
        hidden: state.hidden,
        bookmarked: state.bookmarked,
        newSince: state.newSince,
      }),
    }
  )
);
