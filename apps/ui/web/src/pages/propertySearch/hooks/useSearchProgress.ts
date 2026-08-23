/**
 * useSearchProgress - poll one scrape to completion.
 *
 * getSearchResults is both the poll and the fetch, so the results arrive on the
 * last poll and the page never needs a follow-up request. The job id comes from
 * the caller rather than from state in here, because the job outlives the screen
 * that started it: the filters start it and the results screen watches it, and a
 * reload can pick a job back up from its id alone.
 *
 * The poller keeps its last status across restarts, so a status is only
 * surfaced once its jobId matches the job being watched. Otherwise a second
 * search would briefly show the previous run's results.
 */
import { useCallback } from 'react';
import { useSyncPoller } from '../../../hooks/useSyncPoller';
import { getSearchResults, SEARCH_TERMINAL } from '../../../services/listingsService';
import type { SearchResultsResponse } from '../types/listings';

const INITIAL_DELAY_MS = 5000;
const INTERVAL_MS = 5000;
// 30 minutes at the interval below. Long, because a scrape that stops for human
// verification is idle for however long it takes the user to notice the window.
const MAX_ATTEMPTS = 360;
const MAX_CONSECUTIVE_ERRORS = 3;

export interface SearchProgressResult {
  status: SearchResultsResponse | null;
  isPolling: boolean;
  error: string;
}

export function useSearchProgress(jobId: string | null): SearchProgressResult {
  const fetchStatus = useCallback(async () => {
    if (!jobId) throw new Error('No search is running');
    return getSearchResults(jobId);
  }, [jobId]);

  const isTerminal = useCallback(
    (status: SearchResultsResponse) => SEARCH_TERMINAL.includes(status.status),
    []
  );

  const { status, error, isPolling } = useSyncPoller<SearchResultsResponse>({
    fetchStatus,
    isTerminal,
    enabled: jobId !== null,
    initialDelayMs: INITIAL_DELAY_MS,
    intervalMs: INTERVAL_MS,
    maxAttempts: MAX_ATTEMPTS,
    maxConsecutiveErrors: MAX_CONSECUTIVE_ERRORS,
  });

  // The poller only clears its error after the next job's first poll lands, so a
  // status left over from an earlier job means the error is that job's too.
  // Suppressing it stops a re-run flashing the previous failure for one commit.
  const isStaleError = status !== null && status.jobId !== jobId;

  return {
    status: status && jobId && status.jobId === jobId ? status : null,
    isPolling,
    error: (isStaleError ? '' : error) || '',
  };
}
