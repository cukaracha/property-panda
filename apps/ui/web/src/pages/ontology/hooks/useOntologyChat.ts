/**
 * useOntologyChat — drives the Ask panel's conversation with one ontology.
 *
 * Holds the transcript, the live tool trail for the turn in flight, and the build's
 * index status. The conversation itself lives in AgentCore Memory: the transcript
 * here is a view of it, not the source of it, which is why a reload can resume a
 * conversation and why a follow-up saying "that one" is understood without anything
 * being replayed to the agent.
 *
 * The active conversation id is persisted per build, so each ontology independently
 * picks up where it was left. Rotating it is what "new conversation" means — and
 * the only thing that makes the agent forget.
 *
 * The trail interleaves the tools the agent called with the reasoning between them,
 * which is what turns a list of calls into an account of why the search went where it
 * did. A finished turn keeps it, so the walk stays auditable after the answer lands.
 * Only for turns taken here: the conversation endpoint returns role/content/timestamp,
 * so a restored transcript has answers without their trails rather than empty ones.
 *
 * The answer is painted from `delta` events as the agent writes it and committed
 * from the `answer` the stream returns. Two sources for the same prose, on purpose:
 * deltas are fragments and a dropped one would corrupt a stored transcript, whereas
 * the assembled answer arrives too late to watch. So the deltas are shown and
 * discarded, and the answer is what is kept.
 *
 * `indexStatus` is polled separately from the build's own status because the two
 * finish independently. A build can be `succeeded` while its pages are still being
 * embedded, so the panel keeps checking until the index is ready or has failed, and
 * says which rather than letting a search fail unexplained.
 *
 * Every async path carries the cancelled-flag guard the rest of this page uses, so
 * switching builds mid-answer cannot land a stale turn.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { askOntology, isOntologyChatConfigured } from '../../../services/ontologyChatService';
import {
  getOntologyConversation,
  getOntologyStatus,
  type OntologyIndexStatus,
} from '../../../services/ontologyService';
import { readPersistedSessionId, writePersistedSessionId } from '../../../lib/sessionStorage';
import type { OntologyChatMessage, TrailStep } from '../types/ontology';

// How often to re-check an index that is still hydrating. Hydration runs at the
// speed of embedding, so a build of any size settles within a few of these.
const INDEX_POLL_MS = 10000;

const persistKeyFor = (buildId: string) => `ontology:session:${buildId}`;

export function useOntologyChat(buildId: string | null) {
  const [messages, setMessages] = useState<OntologyChatMessage[]>([]);
  const [trail, setTrail] = useState<TrailStep[]>([]);
  // The answer so far, for the turn in flight. Empty whenever nothing is streaming.
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const [asking, setAsking] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [indexStatus, setIndexStatus] = useState<OntologyIndexStatus | null>(null);
  const [activeSessionId, setActiveSessionId] = useState('');

  // Read at send time, so a turn always goes to the conversation that was active
  // when it started rather than whatever a re-render settled on.
  const sessionIdRef = useRef('');
  // The live trail, mirrored non-reactively: the answer lands in the same tick the
  // last step arrives, so reading state there would attach a trail one step short.
  const trailRef = useRef<TrailStep[]>([]);
  // The streamed text, mirrored the same way. Deltas arrive faster than React
  // re-renders, so each one is appended to the ref and the state follows it.
  const streamingRef = useRef('');
  // Comparator for every async landing: which build was open when it was issued.
  const buildIdRef = useRef<string | null>(null);
  const askingRef = useRef(false);
  const restoringRef = useRef(false);
  // One-shot restore guard, per build — StrictMode double-invokes effects.
  const restoredForBuildRef = useRef<string | null>(null);

  // Single writer for the active conversation id: the non-reactive ref, the state,
  // and localStorage. Called only from handlers and effects, never during render.
  const applySessionId = useCallback((id: string) => {
    sessionIdRef.current = id;
    setActiveSessionId(id);
    if (buildIdRef.current) writePersistedSessionId(persistKeyFor(buildIdRef.current), id);
  }, []);

  // Replace the transcript with a past conversation and continue it in place. Two
  // guards, not one: double-clicking two rows must not land the loser's transcript
  // against the winner's id.
  const loadConversation = useCallback(
    async (sessionId: string) => {
      const forBuild = buildIdRef.current;
      if (!forBuild || askingRef.current || restoringRef.current) return;

      restoringRef.current = true;
      setIsRestoring(true);
      setTrail([]);
      trailRef.current = [];
      setStreamingAnswer('');
      streamingRef.current = '';
      setError(null);
      try {
        const history = await getOntologyConversation(forBuild, sessionId);
        if (buildIdRef.current !== forBuild) return;
        setMessages(
          history.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp }))
        );
        applySessionId(sessionId);
      } catch (e) {
        if (buildIdRef.current !== forBuild) return;
        setError(e instanceof Error ? e.message : 'That conversation could not be loaded');
      } finally {
        restoringRef.current = false;
        if (buildIdRef.current === forBuild) setIsRestoring(false);
      }
    },
    [applySessionId]
  );

  useEffect(() => {
    setMessages([]);
    setTrail([]);
    trailRef.current = [];
    setStreamingAnswer('');
    streamingRef.current = '';
    setError(null);
    setIndexStatus(null);
    setIsRestoring(false);
    restoringRef.current = false;
    buildIdRef.current = buildId;

    if (!buildId) {
      // Cleared, not left holding the old id: the page passes null while a build
      // reloads, so reopening the SAME ontology is A -> null -> A, and a guard
      // still holding A would silently skip the second restore.
      restoredForBuildRef.current = null;
      sessionIdRef.current = '';
      setActiveSessionId('');
      return;
    }

    if (restoredForBuildRef.current === buildId) return;
    restoredForBuildRef.current = buildId;

    const stored = readPersistedSessionId(persistKeyFor(buildId));
    if (stored) {
      sessionIdRef.current = stored;
      setActiveSessionId(stored);
      // Deferred out of the synchronous effect window — loadConversation flips
      // isRestoring immediately.
      queueMicrotask(() => void loadConversation(stored));
    } else {
      applySessionId(`${buildId}-${crypto.randomUUID()}`);
    }
  }, [buildId, applySessionId, loadConversation]);

  // Poll the build's index status until it settles.
  useEffect(() => {
    if (!buildId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      try {
        const status = await getOntologyStatus(buildId);
        if (cancelled) return;
        const next = status.indexStatus ?? 'pending';
        setIndexStatus(next);
        if (next === 'pending') timer = setTimeout(check, INDEX_POLL_MS);
      } catch {
        // A status blip is not worth showing here — the panel already reports a
        // failed search, and the next tick will pick the real state back up.
        if (!cancelled) timer = setTimeout(check, INDEX_POLL_MS);
      }
    };
    void check();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [buildId]);

  const ask = useCallback(
    async (question: string, onTurnComplete?: () => void) => {
      const trimmed = question.trim();
      if (!buildId || !trimmed || askingRef.current || restoringRef.current) return;

      // A conversation id always exists by the time asking is possible, but a turn
      // must never be sent without one — it would start an untracked thread.
      if (!sessionIdRef.current) applySessionId(`${buildId}-${crypto.randomUUID()}`);

      setError(null);
      setTrail([]);
      trailRef.current = [];
      setStreamingAnswer('');
      streamingRef.current = '';
      askingRef.current = true;
      setAsking(true);

      setMessages(prev => [
        ...prev,
        { role: 'user', content: trimmed, timestamp: new Date().toISOString() },
      ]);

      try {
        const { answer } = await askOntology({
          buildId,
          question: trimmed,
          conversationId: sessionIdRef.current,
          onEvent: event => {
            if (event.type === 'tool') {
              trailRef.current = [...trailRef.current, { type: 'tool', content: event.content }];
              setTrail(trailRef.current);
            } else if (event.type === 'reasoning') {
              // Thinking streams a fragment at a time, so consecutive reasoning events
              // are one step rather than forty rows. Same coalescing the main chat
              // does (components/chat/useChatEngine.ts). Tool events always push, so
              // the two stay interleaved in the order they happened.
              const last = trailRef.current[trailRef.current.length - 1];
              trailRef.current =
                last?.type === 'reasoning'
                  ? [
                      ...trailRef.current.slice(0, -1),
                      { ...last, content: last.content + event.content },
                    ]
                  : [...trailRef.current, { type: 'reasoning', content: event.content }];
              setTrail(trailRef.current);
            } else if (event.type === 'delta') {
              streamingRef.current += event.content;
              setStreamingAnswer(streamingRef.current);
            } else if (event.type === 'error') {
              setError(event.content);
            }
          },
        });
        // A turn that only errored has no answer to show. The error banner already
        // says what happened, so appending an empty bubble would just be noise.
        if (answer.trim()) {
          setMessages(prev => [
            ...prev,
            {
              role: 'assistant',
              content: answer,
              timestamp: new Date().toISOString(),
              // Kept with the turn, so the walk that produced this answer can be
              // reopened later rather than only watched while it ran.
              trail: trailRef.current,
            },
          ]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The ontology could not be searched');
      } finally {
        askingRef.current = false;
        setAsking(false);
        // Batched with the setMessages above, so the streamed text is replaced by
        // the committed turn in one paint rather than blanking between the two.
        setStreamingAnswer('');
        streamingRef.current = '';
        // Even a failed turn may have created the session server-side, so the
        // history list is reconciled either way.
        onTurnComplete?.();
      }
    },
    [buildId, applySessionId]
  );

  // Rotate the conversation id — the only thing that actually makes the agent
  // forget, which is why there is no button that merely empties the screen.
  const newConversation = useCallback(() => {
    if (!buildId || askingRef.current || restoringRef.current) return;
    setMessages([]);
    setTrail([]);
    trailRef.current = [];
    setStreamingAnswer('');
    streamingRef.current = '';
    setError(null);
    applySessionId(`${buildId}-${crypto.randomUUID()}`);
  }, [buildId, applySessionId]);

  return useMemo(
    () => ({
      messages,
      trail,
      streamingAnswer,
      asking,
      isRestoring,
      error,
      indexStatus,
      activeSessionId,
      configured: isOntologyChatConfigured(),
      ask,
      loadConversation,
      newConversation,
    }),
    [
      messages,
      trail,
      streamingAnswer,
      asking,
      isRestoring,
      error,
      indexStatus,
      activeSessionId,
      ask,
      loadConversation,
      newConversation,
    ]
  );
}
