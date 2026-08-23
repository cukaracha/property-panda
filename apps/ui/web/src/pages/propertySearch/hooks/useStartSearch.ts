/**
 * useStartSearch - POST one search and hand back the job id it was given.
 *
 * Starting and polling are separate hooks because they happen on separate
 * screens: the filters start a job and navigate away, and the results screen
 * polls whatever job it is pointed at.
 *
 * The POST is only ever driven by a click, never from an effect, because a
 * duplicate POST is a duplicate scrape and the scraper drives a real browser.
 */
import { useCallback, useState } from 'react';
import { triggerSearch } from '../../../services/listingsService';
import type { SearchRequest } from '../../../types/listings';

export interface StartSearchResult {
  isStarting: boolean;
  error: string;
  /** The new job id, or null when the request never got one. */
  startSearch: (request: SearchRequest) => Promise<string | null>;
}

export function useStartSearch(): StartSearchResult {
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState('');

  const startSearch = useCallback(async (request: SearchRequest) => {
    setIsStarting(true);
    setError('');
    try {
      const result = await triggerSearch(request);
      return result.jobId;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start the search');
      return null;
    } finally {
      setIsStarting(false);
    }
  }, []);

  return { isStarting, error, startSearch };
}
