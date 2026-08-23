/**
 * useBookmarkedEntities - the properties pinned to the top of the search on screen.
 *
 * The mirror image of useHiddenEntities. Bookmarking sorts rather than filters: the
 * page keeps the full result set and moves a pinned card to the front at render time,
 * so removing a bookmark drops it back where the server put it. The list belongs to
 * the search rather than to the app, so it lives in the results store and reaches the
 * server only once that search is a saved one. From then on every bookmark and removal
 * writes the whole list through, and a failed write puts the list back the way it was.
 *
 * Writes are chained one behind another through a ref, for the reason hiding chains
 * its own: each one sends the full list, so two in quick succession could otherwise
 * land out of order and leave the server holding the earlier, shorter one.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { updateSavedSearchBookmarked } from '../../../services/listingsService';
import { usePropertySearchResultsStore } from '../../../store/usePropertySearchStore';
import type { BookmarkedEntity } from '../../../types/listings';

export interface BookmarkedEntitiesResult {
  bookmarked: BookmarkedEntity[];
  bookmarkedPropertyIds: Set<string>;
  error: string;
  bookmark: (id: string, label: string) => Promise<void>;
  unbookmark: (entityKey: string) => Promise<void>;
}

export function useBookmarkedEntities(): BookmarkedEntitiesResult {
  const bookmarked = usePropertySearchResultsStore(state => state.bookmarked);
  const setBookmarked = usePropertySearchResultsStore(state => state.setBookmarked);
  const [error, setError] = useState('');
  const writeChain = useRef<Promise<void>>(Promise.resolve());

  const mutate = useCallback(
    (next: BookmarkedEntity[], previous: BookmarkedEntity[], failureMessage: string) => {
      const { savedSearchId } = usePropertySearchResultsStore.getState();
      setBookmarked(next);
      setError('');
      if (!savedSearchId) return Promise.resolve();

      const write = writeChain.current
        .then(() => updateSavedSearchBookmarked(savedSearchId, next))
        .then(() => undefined)
        .catch(err => {
          // Only roll back when nothing has moved on since, so a later mutation that
          // already replaced this list is not undone by an older failure.
          if (usePropertySearchResultsStore.getState().bookmarked === next) setBookmarked(previous);
          setError(err instanceof Error ? err.message : failureMessage);
        });
      writeChain.current = write;
      return write;
    },
    [setBookmarked]
  );

  const bookmark = useCallback(
    (id: string, label: string) => {
      const current = usePropertySearchResultsStore.getState().bookmarked;
      const entityKey = `property#${id}`;
      if (current.some(entity => entity.entityKey === entityKey)) return Promise.resolve();

      // Seconds, because that is what the server stamps and both ends sort on it.
      const entity: BookmarkedEntity = {
        entityKey,
        scope: 'property',
        id,
        label,
        createdAt: Math.floor(Date.now() / 1000),
      };
      return mutate([entity, ...current], current, 'Failed to bookmark the property');
    },
    [mutate]
  );

  const unbookmark = useCallback(
    (entityKey: string) => {
      const current = usePropertySearchResultsStore.getState().bookmarked;
      if (!current.some(entity => entity.entityKey === entityKey)) return Promise.resolve();
      const next = current.filter(entity => entity.entityKey !== entityKey);
      return mutate(next, current, 'Failed to remove the bookmark');
    },
    [mutate]
  );

  const bookmarkedPropertyIds = useMemo(
    () => new Set(bookmarked.map(entity => entity.id)),
    [bookmarked]
  );

  return { bookmarked, bookmarkedPropertyIds, error, bookmark, unbookmark };
}
