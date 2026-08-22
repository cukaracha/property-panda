/**
 * useOntologyConversations — the caller's past conversations about one ontology.
 *
 * A thin read: the list is server-side truth, so this fetches rather than tracking
 * anything locally, and `refresh` is what the Ask panel calls once a turn creates a
 * session that was not in the list before.
 *
 * `conversations === null` means loading, matching the convention the rest of this
 * page uses for a list that has not arrived yet. A failure leaves it null and sets
 * `error`, so "we do not know" stays distinct from "there are none": setting it to
 * an empty array on failure made a request that never came back look like an
 * ontology that has never been asked anything.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  listOntologyConversations,
  type OntologyConversationSummary,
} from '../../../services/ontologyService';

export function useOntologyConversations(buildId: string | null) {
  const [conversations, setConversations] = useState<OntologyConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!buildId) {
      setConversations(null);
      setError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const list = await listOntologyConversations(buildId);
        if (!cancelled) setConversations(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load conversations');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [buildId, reloadKey]);

  const refresh = useCallback(() => setReloadKey(key => key + 1), []);

  return useMemo(() => ({ conversations, error, refresh }), [conversations, error, refresh]);
}
