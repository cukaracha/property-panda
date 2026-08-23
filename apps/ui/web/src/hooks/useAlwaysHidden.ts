/**
 * useAlwaysHidden - the properties and units the user hides in every search.
 *
 * The app wide counterpart to useHiddenEntities, arranged the way useShortlist is: its
 * own collection on the server rather than a field on a saved search, because the whole
 * point is that it does not care which search turned an item up. So this reads and
 * writes the server directly instead of going through the results store, and both
 * screens that use it get the same list.
 *
 * What it does not borrow from the shortlist is the snapshotting. An entry stays the
 * light {entityKey, scope, id, label, createdAt} record a search's own hidden list
 * holds, since hiding only needs to name what to leave out and to say enough for the
 * user to recognise it later.
 *
 * Both mutations are optimistic and roll back only their own entry, so two of them in
 * the same tick cannot undo each other. Writes are chained behind one another so a hide
 * and an unhide of the same item cannot land out of order.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addAlwaysHidden, listAlwaysHidden, removeAlwaysHidden } from '../services/listingsService';
import type { HiddenEntity, HiddenScope } from '../types/listings';

export interface AlwaysHiddenResult {
  alwaysHidden: HiddenEntity[];
  alwaysHiddenPropertyIds: Set<string>;
  alwaysHiddenUnitIds: Set<string>;
  isLoading: boolean;
  error: string;
  hideAlways: (scope: HiddenScope, id: string, label: string) => Promise<void>;
  unhideAlways: (entityKey: string) => Promise<void>;
}

export function useAlwaysHidden(): AlwaysHiddenResult {
  const [alwaysHidden, setAlwaysHidden] = useState<HiddenEntity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const writeChain = useRef<Promise<void>>(Promise.resolve());
  const hiddenRef = useRef<HiddenEntity[]>([]);

  useEffect(() => {
    hiddenRef.current = alwaysHidden;
  }, [alwaysHidden]);

  useEffect(() => {
    let cancelled = false;
    listAlwaysHidden()
      .then(result => {
        if (cancelled) return;
        setAlwaysHidden(result.hidden);
        setError('');
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load the always hidden items');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hideAlways = useCallback((scope: HiddenScope, id: string, label: string) => {
    const entityKey = `${scope}#${id}`;
    if (hiddenRef.current.some(entity => entity.entityKey === entityKey)) {
      return Promise.resolve();
    }

    // Seconds, because that is what the server stamps and both ends sort on it.
    const entity: HiddenEntity = {
      entityKey,
      scope,
      id,
      label,
      createdAt: Math.floor(Date.now() / 1000),
    };
    setAlwaysHidden(current => [entity, ...current]);
    setError('');

    const write = writeChain.current
      .then(() => addAlwaysHidden(entity))
      .then(() => undefined)
      .catch(err => {
        setAlwaysHidden(current => current.filter(item => item.entityKey !== entityKey));
        setError(err instanceof Error ? err.message : 'Failed to always hide the item');
      });
    writeChain.current = write;
    return write;
  }, []);

  const unhideAlways = useCallback((entityKey: string) => {
    const removed = hiddenRef.current.find(entity => entity.entityKey === entityKey);
    if (!removed) return Promise.resolve();
    setAlwaysHidden(current => current.filter(entity => entity.entityKey !== entityKey));
    setError('');

    const write = writeChain.current
      .then(() => removeAlwaysHidden(removed.scope, removed.id))
      .then(() => undefined)
      .catch(err => {
        setAlwaysHidden(current =>
          current.some(entity => entity.entityKey === entityKey)
            ? current
            : [...current, removed].sort((a, b) => b.createdAt - a.createdAt)
        );
        setError(err instanceof Error ? err.message : 'Failed to unhide the item');
      });
    writeChain.current = write;
    return write;
  }, []);

  const alwaysHiddenPropertyIds = useMemo(
    () =>
      new Set(alwaysHidden.filter(entity => entity.scope === 'property').map(entity => entity.id)),
    [alwaysHidden]
  );

  const alwaysHiddenUnitIds = useMemo(
    () => new Set(alwaysHidden.filter(entity => entity.scope === 'unit').map(entity => entity.id)),
    [alwaysHidden]
  );

  return {
    alwaysHidden,
    alwaysHiddenPropertyIds,
    alwaysHiddenUnitIds,
    isLoading,
    error,
    hideAlways,
    unhideAlways,
  };
}
