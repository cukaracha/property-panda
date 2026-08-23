/**
 * useHiddenEntities - the reversible hide list for properties and units.
 *
 * Hiding never deletes anything: the page keeps the full result set and filters
 * at render time, so an unhide puts the card or row straight back. Each
 * mutation updates local state first, then reconciles with the server, and
 * rolls back only its own entity when the request fails, so two mutations in
 * the same tick cannot discard each other.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hideEntity, listHidden, unhideEntity } from '../../../services/listingsService';
import type { HiddenEntity, HiddenScope } from '../types/listings';

export interface HiddenEntitiesResult {
  hidden: HiddenEntity[];
  hiddenPropertyIds: Set<string>;
  hiddenUnitIds: Set<string>;
  isLoading: boolean;
  error: string;
  hide: (scope: HiddenScope, id: string, label: string) => Promise<void>;
  unhide: (entityKey: string) => Promise<void>;
}

export function useHiddenEntities(): HiddenEntitiesResult {
  const [hidden, setHidden] = useState<HiddenEntity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const hiddenRef = useRef<HiddenEntity[]>([]);

  useEffect(() => {
    hiddenRef.current = hidden;
  }, [hidden]);

  const refresh = useCallback(async () => {
    try {
      const result = await listHidden();
      setHidden(result.hidden);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load hidden items');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    listHidden()
      .then(result => {
        if (cancelled) return;
        setHidden(result.hidden);
        setError('');
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load hidden items');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hide = useCallback(
    async (scope: HiddenScope, id: string, label: string) => {
      const entityKey = `${scope}#${id}`;
      if (hiddenRef.current.some(entity => entity.entityKey === entityKey)) return;

      const optimistic: HiddenEntity = { entityKey, scope, id, label, createdAt: Date.now() };
      setHidden(current =>
        current.some(entity => entity.entityKey === entityKey) ? current : [...current, optimistic]
      );
      setError('');
      try {
        await hideEntity(scope, id, label);
        await refresh();
      } catch (err) {
        setHidden(current => current.filter(entity => entity.entityKey !== entityKey));
        setError(err instanceof Error ? err.message : 'Failed to hide the item');
      }
    },
    [refresh]
  );

  const unhide = useCallback(
    async (entityKey: string) => {
      const removed = hiddenRef.current.find(entity => entity.entityKey === entityKey);
      setHidden(current => current.filter(entity => entity.entityKey !== entityKey));
      setError('');
      try {
        await unhideEntity(entityKey);
        await refresh();
      } catch (err) {
        if (removed) {
          setHidden(current =>
            current.some(entity => entity.entityKey === entityKey) ? current : [...current, removed]
          );
        }
        setError(err instanceof Error ? err.message : 'Failed to unhide the item');
      }
    },
    [refresh]
  );

  const hiddenPropertyIds = useMemo(
    () => new Set(hidden.filter(entity => entity.scope === 'property').map(entity => entity.id)),
    [hidden]
  );

  const hiddenUnitIds = useMemo(
    () => new Set(hidden.filter(entity => entity.scope === 'unit').map(entity => entity.id)),
    [hidden]
  );

  return { hidden, hiddenPropertyIds, hiddenUnitIds, isLoading, error, hide, unhide };
}
