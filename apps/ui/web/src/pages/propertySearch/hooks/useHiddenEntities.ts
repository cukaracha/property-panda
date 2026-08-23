/**
 * useHiddenEntities - the reversible hide list for the search on screen.
 *
 * Hiding never deletes anything: the page keeps the full result set and filters at
 * render time, so an unhide puts the card or row straight back. The list belongs to
 * the search rather than to the app, so it lives in the results store and reaches the
 * server only once that search is a saved one. From then on every hide and unhide
 * writes the whole list through, and a failed write puts the list back the way it was
 * so the screen never shows a change the stored search did not take.
 *
 * Writes are chained one behind another through a ref. Each one sends the full list,
 * so two hides in quick succession could otherwise land out of order and leave the
 * server holding the earlier, shorter one.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { updateSavedSearchHidden } from '../../../services/listingsService';
import { usePropertySearchResultsStore } from '../../../store/usePropertySearchStore';
import type { HiddenEntity, HiddenScope } from '../types/listings';

export interface HiddenEntitiesResult {
  hidden: HiddenEntity[];
  hiddenPropertyIds: Set<string>;
  hiddenUnitIds: Set<string>;
  error: string;
  hide: (scope: HiddenScope, id: string, label: string) => Promise<void>;
  unhide: (entityKey: string) => Promise<void>;
}

export function useHiddenEntities(): HiddenEntitiesResult {
  const hidden = usePropertySearchResultsStore(state => state.hidden);
  const setHidden = usePropertySearchResultsStore(state => state.setHidden);
  const [error, setError] = useState('');
  const writeChain = useRef<Promise<void>>(Promise.resolve());

  const mutate = useCallback(
    (next: HiddenEntity[], previous: HiddenEntity[], failureMessage: string) => {
      const { savedSearchId } = usePropertySearchResultsStore.getState();
      setHidden(next);
      setError('');
      if (!savedSearchId) return Promise.resolve();

      const write = writeChain.current
        .then(() => updateSavedSearchHidden(savedSearchId, next))
        .then(() => undefined)
        .catch(err => {
          // Only roll back when nothing has moved on since, so a later mutation that
          // already replaced this list is not undone by an older failure.
          if (usePropertySearchResultsStore.getState().hidden === next) setHidden(previous);
          setError(err instanceof Error ? err.message : failureMessage);
        });
      writeChain.current = write;
      return write;
    },
    [setHidden]
  );

  const hide = useCallback(
    (scope: HiddenScope, id: string, label: string) => {
      const current = usePropertySearchResultsStore.getState().hidden;
      const entityKey = `${scope}#${id}`;
      if (current.some(entity => entity.entityKey === entityKey)) return Promise.resolve();

      // Seconds, because that is what the server stamps and both ends sort on it.
      const entity: HiddenEntity = {
        entityKey,
        scope,
        id,
        label,
        createdAt: Math.floor(Date.now() / 1000),
      };
      return mutate([entity, ...current], current, 'Failed to hide the item');
    },
    [mutate]
  );

  const unhide = useCallback(
    (entityKey: string) => {
      const current = usePropertySearchResultsStore.getState().hidden;
      if (!current.some(entity => entity.entityKey === entityKey)) return Promise.resolve();
      const next = current.filter(entity => entity.entityKey !== entityKey);
      return mutate(next, current, 'Failed to unhide the item');
    },
    [mutate]
  );

  const hiddenPropertyIds = useMemo(
    () => new Set(hidden.filter(entity => entity.scope === 'property').map(entity => entity.id)),
    [hidden]
  );

  const hiddenUnitIds = useMemo(
    () => new Set(hidden.filter(entity => entity.scope === 'unit').map(entity => entity.id)),
    [hidden]
  );

  return { hidden, hiddenPropertyIds, hiddenUnitIds, error, hide, unhide };
}
