/**
 * useSyncPoller — poll an async job's status until it reaches a terminal state.
 *
 * Ported from the serverless async pattern: a short initial delay (the worker
 * needs a moment to pick the job up), then a fixed interval, stopping on a
 * terminal status, an error, or a max-attempts ceiling (so a job stuck
 * 'processing' — e.g. a timed-out worker — can't poll forever). A transient
 * fetch failure only stops the poller once `maxConsecutiveErrors` of them land
 * in a row, so one bad gateway response cannot end a long-running job.
 *
 * The caller MUST memoize `fetchStatus` and `isTerminal` (useCallback) since they
 * are effect dependencies.
 */
import { useEffect, useRef, useState } from 'react';

export interface SyncPollerOptions<T> {
  fetchStatus: () => Promise<T>;
  isTerminal: (status: T) => boolean;
  enabled: boolean;
  initialDelayMs?: number;
  intervalMs?: number;
  maxAttempts?: number;
  /** Consecutive fetch failures tolerated before polling stops. 1 stops on the first. */
  maxConsecutiveErrors?: number;
}

export interface SyncPollerResult<T> {
  status: T | null;
  error: string | null;
  isPolling: boolean;
}

export function useSyncPoller<T>({
  fetchStatus,
  isTerminal,
  enabled,
  initialDelayMs = 5000,
  intervalMs = 10000,
  maxAttempts = 90,
  maxConsecutiveErrors = 1,
}: SyncPollerOptions<T>): SyncPollerResult<T> {
  const [status, setStatus] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const attemptsRef = useRef(0);
  const consecutiveErrorsRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    attemptsRef.current = 0;
    consecutiveErrorsRef.current = 0;
    setIsPolling(true);
    setError(null);

    const poll = async () => {
      if (cancelled) return;
      attemptsRef.current += 1;
      try {
        const next = await fetchStatus();
        if (cancelled) return;
        consecutiveErrorsRef.current = 0;
        setStatus(next);
        if (isTerminal(next)) {
          setIsPolling(false);
          return;
        }
      } catch (e) {
        if (cancelled) return;
        consecutiveErrorsRef.current += 1;
        if (consecutiveErrorsRef.current >= maxConsecutiveErrors) {
          setError(e instanceof Error ? e.message : 'Polling failed');
          setIsPolling(false);
          return;
        }
      }
      if (attemptsRef.current >= maxAttempts) {
        setError('Timed out waiting for the job to finish');
        setIsPolling(false);
        return;
      }
      timer = setTimeout(poll, intervalMs);
    };

    timer = setTimeout(poll, initialDelayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setIsPolling(false);
    };
  }, [
    enabled,
    fetchStatus,
    isTerminal,
    initialDelayMs,
    intervalMs,
    maxAttempts,
    maxConsecutiveErrors,
  ]);

  return { status, error, isPolling };
}
