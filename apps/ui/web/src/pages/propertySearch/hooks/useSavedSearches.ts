/**
 * useSavedSearches - the searches the user has kept for re-running.
 *
 * A saved search holds the request body rather than the form, so the server stores
 * exactly the shape it validates a live search against and the panel is filled back
 * in through toSearchForm.
 *
 * Saving cannot be optimistic, because the id comes back from the server with the
 * stored row. Editing is not either, for the same reason: the row on screen is the
 * one the server stored. Deleting is, and rolls back only its own row when the
 * request fails, so two deletes in the same tick cannot discard each other. It also
 * re-raises, so a caller confirming the delete in a modal can report the failure
 * rather than closing on a success that did not happen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
  updateSavedSearch,
} from '../../../services/listingsService';
import type {
  BookmarkedEntity,
  HiddenEntity,
  SavedSearch,
  SearchRequest,
} from '../../../types/listings';

export interface SavedSearchesResult {
  savedSearches: SavedSearch[];
  isLoading: boolean;
  error: string;
  save: (
    name: string,
    request: SearchRequest,
    hidden: HiddenEntity[],
    bookmarked: BookmarkedEntity[]
  ) => Promise<SavedSearch | null>;
  update: (
    searchId: string,
    name: string,
    request: SearchRequest,
    hidden: HiddenEntity[],
    bookmarked: BookmarkedEntity[]
  ) => Promise<SavedSearch | null>;
  remove: (searchId: string) => Promise<void>;
}

export function useSavedSearches(): SavedSearchesResult {
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const savedRef = useRef<SavedSearch[]>([]);

  useEffect(() => {
    savedRef.current = savedSearches;
  }, [savedSearches]);

  useEffect(() => {
    let cancelled = false;
    listSavedSearches()
      .then(result => {
        if (cancelled) return;
        setSavedSearches(result.savedSearches);
        setError('');
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load saved searches');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(
    async (
      name: string,
      request: SearchRequest,
      hidden: HiddenEntity[],
      bookmarked: BookmarkedEntity[]
    ) => {
      setError('');
      try {
        const saved = await createSavedSearch(name, request, hidden, bookmarked);
        setSavedSearches(current => [saved, ...current]);
        return saved;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save the search');
        return null;
      }
    },
    []
  );

  // Not optimistic either: the row is replaced with what the server stored, so an
  // edit the server normalised does not read back differently after a reload.
  const update = useCallback(
    async (
      searchId: string,
      name: string,
      request: SearchRequest,
      hidden: HiddenEntity[],
      bookmarked: BookmarkedEntity[]
    ) => {
      setError('');
      try {
        const saved = await updateSavedSearch(searchId, name, request, hidden, bookmarked);
        setSavedSearches(current =>
          current.map(search => (search.searchId === searchId ? saved : search))
        );
        return saved;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update the saved search');
        return null;
      }
    },
    []
  );

  const remove = useCallback(async (searchId: string) => {
    const removed = savedRef.current.find(search => search.searchId === searchId);
    setSavedSearches(current => current.filter(search => search.searchId !== searchId));
    setError('');
    try {
      await deleteSavedSearch(searchId);
    } catch (err) {
      if (removed) {
        setSavedSearches(current =>
          current.some(search => search.searchId === searchId)
            ? current
            : [...current, removed].sort((a, b) => b.createdAt - a.createdAt)
        );
      }
      const message = err instanceof Error ? err.message : 'Failed to delete the saved search';
      setError(message);
      throw new Error(message, { cause: err });
    }
  }, []);

  return { savedSearches, isLoading, error, save, update, remove };
}
