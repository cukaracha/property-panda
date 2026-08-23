/**
 * Zustand stores for the property search, which is two sibling routes rather than
 * one page: the filters on /properties and the results on /properties/results.
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
 * a snapshot of the filters that produced them, the items it hides, and the saved
 * search it came from when it came from one. All of it is persisted, so a refresh of
 * the results route either picks the running scrape back up or lands on the results
 * it already finished, and either way still knows what was searched for. The snapshot
 * is a copy rather than a read of the live form, which is what lets the results screen
 * save its own search after the form has moved on. sessionStorage rather than
 * localStorage because both belong to the sitting that scraped them, and a result set
 * from last week should not still be on screen as though the scrape had just run.
 */

import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { FilterFormState, HiddenEntity, SearchResultsResponse } from '../types/listings';
import { DEFAULT_FILTER_FORM } from '../pages/propertySearch/utils/filterOptions';

const RESULTS_KEY = 'property-search-results';

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
  form: FilterFormState;
  setForm: (form: FilterFormState) => void;
}

export const usePropertySearchStore = create<PropertySearchFormStore>(set => ({
  form: DEFAULT_FILTER_FORM,
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
  searchForm: FilterFormState | null;
  /**
   * The saved search these results belong to, or null while the search is one the
   * user has run but not kept. It is what decides whether a hide is written through
   * to the server or only held here until the search is saved.
   */
  savedSearchId: string | null;
  savedSearchName: string | null;
  /** The properties and units this search hides, newest first. */
  hidden: HiddenEntity[];
  startJob: (jobId: string, form: FilterFormState, saved: SavedSearchLink | null) => void;
  setResults: (results: SearchResultsResponse) => void;
  /** Attach a search that has just been saved, keeping the items it already hides. */
  linkSavedSearch: (searchId: string, name: string) => void;
  setHidden: (hidden: HiddenEntity[]) => void;
}

/** What a search carries over from the saved search it was started from. */
export interface SavedSearchLink {
  searchId: string;
  name: string;
  hidden: HiddenEntity[];
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
      // The previous search's results go with it. They are not what this job is
      // scraping, and leaving them would put stale cards under a live progress card.
      // A run from the filters starts with nothing hidden, a saved one starts with
      // whatever it was keeping hidden when it was last run.
      startJob: (jobId, form, saved) =>
        set({
          jobId,
          results: null,
          searchForm: form,
          savedSearchId: saved?.searchId ?? null,
          savedSearchName: saved?.name ?? null,
          hidden: saved?.hidden ?? [],
        }),
      setResults: results => set({ results, jobId: null }),
      linkSavedSearch: (searchId, name) => set({ savedSearchId: searchId, savedSearchName: name }),
      setHidden: hidden => set({ hidden }),
    }),
    {
      name: RESULTS_KEY,
      storage: createJSONStorage(() => safeSessionStorage),
      partialize: state => ({
        jobId: state.jobId,
        results: state.results,
        searchForm: state.searchForm,
        savedSearchId: state.savedSearchId,
        savedSearchName: state.savedSearchName,
        hidden: state.hidden,
      }),
    }
  )
);
