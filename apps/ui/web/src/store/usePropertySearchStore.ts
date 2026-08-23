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
 * The job id and the results are persisted, so a refresh of the results route
 * either picks the running scrape back up or lands on the results it already
 * finished. sessionStorage rather than localStorage because both belong to the
 * sitting that scraped them, and a result set from last week should not still be
 * on screen as though the scrape had just run.
 */

import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type {
  FilterFormState,
  SearchResultsResponse,
} from '../pages/propertySearch/types/listings';
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
  /**
   * True when the search was started in this page load, which is what says the
   * filter form still holds the filters behind what is on screen. It is not
   * persisted, so a reload leaves it false and the filters are reported as
   * unknown rather than read off a form that has reset to its defaults.
   */
  filtersOnRecord: boolean;
  startJob: (jobId: string) => void;
  setResults: (results: SearchResultsResponse) => void;
}

export const usePropertySearchResultsStore = create<PropertySearchResultsStore>()(
  persist(
    set => ({
      jobId: null,
      results: null,
      filtersOnRecord: false,
      // The previous search's results go with it. They are not what this job is
      // scraping, and leaving them would put stale cards under a live progress card.
      startJob: jobId => set({ jobId, results: null, filtersOnRecord: true }),
      setResults: results => set({ results, jobId: null }),
    }),
    {
      name: RESULTS_KEY,
      storage: createJSONStorage(() => safeSessionStorage),
      partialize: state => ({ jobId: state.jobId, results: state.results }),
    }
  )
);
