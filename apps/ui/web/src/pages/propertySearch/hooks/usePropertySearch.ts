/**
 * usePropertySearch - start a scrape, then poll it to completion.
 *
 * getSearchResults is both the poll and the fetch, so the results render
 * straight off the polled status with no follow-up request. The poller keeps
 * its last status across restarts, so the status is only surfaced once its
 * jobId matches the run in flight. Otherwise a second search would briefly show
 * the previous run's results.
 */
import { useCallback, useState } from 'react';
import { useSyncPoller } from '../../../hooks/useSyncPoller';
import {
  getSearchResults,
  SEARCH_TERMINAL,
  triggerSearch,
} from '../../../services/listingsService';
import type { SearchRequest, SearchResultsResponse } from '../types/listings';

const INITIAL_DELAY_MS = 5000;
const INTERVAL_MS = 5000;
// 30 minutes at the interval below. Long, because a scrape that stops for human
// verification is idle for however long it takes the user to notice the window.
const MAX_ATTEMPTS = 360;
const MAX_CONSECUTIVE_ERRORS = 3;

export interface PropertySearchResult {
  jobId: string | null;
  status: SearchResultsResponse | null;
  isStarting: boolean;
  isPolling: boolean;
  error: string;
  startSearch: (request: SearchRequest) => Promise<void>;
}

export function usePropertySearch(): PropertySearchResult {
  const [jobId, setJobId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState('');

  const fetchStatus = useCallback(async () => {
    if (!jobId) throw new Error('No search is running');
    return getSearchResults(jobId);
  }, [jobId]);

  const isTerminal = useCallback(
    (status: SearchResultsResponse) => SEARCH_TERMINAL.includes(status.status),
    []
  );

  const {
    status,
    error: pollError,
    isPolling,
  } = useSyncPoller<SearchResultsResponse>({
    fetchStatus,
    isTerminal,
    enabled: jobId !== null,
    initialDelayMs: INITIAL_DELAY_MS,
    intervalMs: INTERVAL_MS,
    maxAttempts: MAX_ATTEMPTS,
    maxConsecutiveErrors: MAX_CONSECUTIVE_ERRORS,
  });

  const startSearch = useCallback(async (request: SearchRequest) => {
    setIsStarting(true);
    setStartError('');
    setJobId(null);
    try {
      const result = await triggerSearch(request);
      setJobId(result.jobId);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Failed to start the search');
    } finally {
      setIsStarting(false);
    }
  }, []);

  const currentStatus = status && jobId && status.jobId === jobId ? status : null;

  // The poller only clears its error after the next run's first poll lands, so
  // a status left over from an earlier job means the error is that job's too.
  // Suppressing it stops a re-run flashing the previous failure for one commit.
  const isStaleError = status !== null && status.jobId !== jobId;

  return {
    jobId,
    status: currentStatus,
    isStarting,
    isPolling,
    error: startError || (isStaleError ? '' : pollError) || '',
    startSearch,
  };
}
