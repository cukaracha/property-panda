/**
 * useScrapeMode - read/toggle the transport a scrape reads the pages through.
 *
 * The source of truth is the server, not this browser, because the thing that acts on
 * the choice is the scrape thread. That also means a reload, a second tab and a restart
 * all agree, which is the one thing localStorage could not give here.
 *
 * The write is optimistic and reverts on failure, so the rail answers a click at once
 * rather than after a round trip. Until the first read lands there is nothing truthful
 * to show, which is what `isReady` is for: a control that says API before the server has
 * said so would let one click save the mode the machine is already in.
 */
import { useCallback, useEffect, useState } from 'react';
import { getScrapeMode, putScrapeMode } from '../services/settingsService';
import type { ScrapeMode } from '../services/settingsService';

export interface ScrapeModeResult {
  mode: ScrapeMode;
  isReady: boolean;
  toggle: () => void;
}

export function useScrapeMode(): ScrapeModeResult {
  const [mode, setMode] = useState<ScrapeMode>('api');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getScrapeMode()
      .then(result => {
        if (!cancelled) setMode(result.mode);
      })
      .catch(() => {
        // Nothing to say on the rail: a server that cannot be reached is already the
        // loudest thing on the screen by the time anyone looks here.
      })
      .finally(() => {
        if (!cancelled) setIsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(() => {
    const previous = mode;
    const next: ScrapeMode = mode === 'api' ? 'browser' : 'api';
    setMode(next);
    putScrapeMode(next).catch(() => setMode(previous));
  }, [mode]);

  return { mode, isReady, toggle };
}
