/**
 * useChatEngine — the shared SSE streaming engine for the assistant.
 *
 * Owns the conversation state and the message/reasoning/tool/error/action event
 * routing for a single chat surface, independent of presentation, so the
 * StrictMode-safe accumulation pattern (currentContentRef / workflowStepsRef as the
 * per-turn source of truth, finalized via pure top-level setState) lives in exactly
 * one place.
 *
 * The grounding sent to the agent is the active page's context and its registered
 * actions, read non-reactively at send time.
 */
import { useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useAiModeStore } from '../../store/useAiModeStore';
import usePageContextStore from '../../store/usePageContextStore';
import { useAuth } from '../../context/AuthContext';
import { ASSISTANT_NAME } from '../../config/app';
import { invokeAgent, getConversation } from '../../services/chatAgentService';
import { readPersistedSessionId, writePersistedSessionId } from '../../lib/sessionStorage';
import type {
  ChatMessage as ChatMessageType,
  AgentStreamEvent,
  AgentEventType,
  WorkflowStep,
} from '../../types/chatbot';

/**
 * @param persistKey When set, the surface's session id is persisted under this
 * localStorage key so a reload resumes the same conversation, and past
 * conversations can be loaded in place via `loadConversation`. Omit for ephemeral
 * behavior. Distinct surfaces MUST pass distinct keys so they don't collide.
 */
export function useChatEngine({ persistKey }: { persistKey?: string } = {}) {
  const { setStatus: setAiModeStatus, openChat, scope, suggestions } = useAiModeStore();
  const { name } = useAuth();

  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState<ChatMessageType | null>(
    null
  );
  // Active chat session id. Lazy-init from storage (one read) so a persisted
  // surface resumes its session; `sessionIdRef` is the non-reactive copy read at
  // send time (never read during render, per react-hooks/refs).
  const [activeSessionId, setActiveSessionId] = useState(
    () => readPersistedSessionId(persistKey) ?? crypto.randomUUID()
  );
  const sessionIdRef = useRef(activeSessionId);
  // True while a past conversation is being fetched/replayed (composer disabled).
  const [isRestoring, setIsRestoring] = useState(false);
  // Guards the one-shot mount restore against StrictMode's double-invoke.
  const didRestoreRef = useRef(false);

  // Workflow steps accumulator for the current streaming response.
  const workflowStepsRef = useRef<WorkflowStep[]>([]);
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const lastEventTypeRef = useRef<AgentEventType | null>(null);

  // Per-turn source of truth for the streamed text + the turn start time, so the
  // finalize step builds the completed message from pure values rather than
  // reading them inside a setState updater (which StrictMode double-invokes).
  const currentContentRef = useRef('');
  const turnStartRef = useRef(0);
  // Guards against overlapping turns (StrictMode double-fire / rapid clicks).
  const isTurnActiveRef = useRef(false);

  const firstName = name?.split(/\s+/)[0] || name || 'there';
  const greeting =
    `Hi ${firstName}, I'm **${ASSISTANT_NAME}**` +
    (scope ? `, your assistant for **${scope}**` : '') +
    '. Ask me about what is on the page, and I can act on it for you once you approve.';

  const handleStreamEvent = (event: AgentStreamEvent) => {
    switch (event.type) {
      case 'message': {
        setAiModeStatus('streaming');
        const needsSeparator =
          lastEventTypeRef.current !== null &&
          lastEventTypeRef.current !== 'message' &&
          lastEventTypeRef.current !== 'status';

        const prefix = needsSeparator ? '\n\n' : '';

        currentContentRef.current += prefix + event.content;
        const text = currentContentRef.current;
        setCurrentAssistantMessage(prev =>
          prev ? { ...prev, content: text, isStreaming: true } : prev
        );

        lastEventTypeRef.current = 'message';
        break;
      }

      case 'reasoning': {
        setAiModeStatus('thinking');
        const steps = workflowStepsRef.current;
        const last = steps[steps.length - 1];
        if (last && last.type === 'reasoning') {
          const updated = { ...last, content: last.content + event.content };
          workflowStepsRef.current = [...steps.slice(0, -1), updated];
        } else {
          workflowStepsRef.current = [
            ...steps,
            {
              id: uuidv4(),
              type: 'reasoning' as const,
              content: event.content,
              timestamp: new Date().toISOString(),
            },
          ];
        }
        setWorkflowSteps([...workflowStepsRef.current]);
        lastEventTypeRef.current = 'reasoning';
        break;
      }

      case 'tool': {
        setAiModeStatus('searching');
        const toolStep: WorkflowStep = {
          id: uuidv4(),
          type: 'tool',
          content: event.content,
          timestamp: new Date().toISOString(),
        };
        workflowStepsRef.current = [...workflowStepsRef.current, toolStep];
        setWorkflowSteps([...workflowStepsRef.current]);
        lastEventTypeRef.current = 'tool';
        break;
      }

      case 'error': {
        // The agent caught an exception and surfaced it instead of crashing the
        // stream. Store it as a workflow step so the thread renders a red card.
        setAiModeStatus('error');
        const errorStep: WorkflowStep = {
          id: uuidv4(),
          type: 'error',
          content: event.content,
          timestamp: new Date().toISOString(),
        };
        workflowStepsRef.current = [...workflowStepsRef.current, errorStep];
        setWorkflowSteps([...workflowStepsRef.current]);
        lastEventTypeRef.current = 'error';
        break;
      }

      case 'action': {
        // The agent proposed a page action (an <act> JSON payload). Record it as a
        // pending action step; the thread renders Approve/Reject and the user decides.
        setAiModeStatus('idle');
        const actionStep: WorkflowStep = {
          id: uuidv4(),
          type: 'action',
          content: event.content,
          timestamp: new Date().toISOString(),
          actionStatus: 'pending',
        };
        workflowStepsRef.current = [...workflowStepsRef.current, actionStep];
        setWorkflowSteps([...workflowStepsRef.current]);
        lastEventTypeRef.current = 'action';
        break;
      }

      case 'status':
        // Handled after invokeAgent resolves.
        break;
    }
  };

  // Runs one stateless SSE turn against the agent. Resets the per-turn streaming
  // trace, then streams reasoning/tool/message events. Guarded so overlapping
  // turns can't race (StrictMode double-fire / rapid clicks).
  const runAgentTurn = async (prompt: string) => {
    if (isTurnActiveRef.current) return;
    isTurnActiveRef.current = true;

    setIsLoading(true);
    setAiModeStatus('thinking');

    workflowStepsRef.current = [];
    setWorkflowSteps([]);
    lastEventTypeRef.current = null;
    currentContentRef.current = '';
    turnStartRef.current = Date.now();

    const userMessage: ChatMessageType = {
      id: uuidv4(),
      role: 'user',
      content: prompt,
      timestamp: new Date().toISOString(),
      isStreaming: false,
    };
    setMessages(prev => [...prev, userMessage]);

    // Assistant response placeholder. Its id/timestamp are captured so finalize
    // can build the completed message without an impure updater.
    const assistantId = uuidv4();
    const assistantTimestamp = new Date().toISOString();
    setCurrentAssistantMessage({
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: assistantTimestamp,
      isStreaming: true,
    });
    openChat();

    try {
      // Read the page context/actions non-reactively at send time, so a turn always
      // carries the active page's grounding rather than a stale one.
      const { getFormattedContext, actions } = usePageContextStore.getState();
      const actionMeta = (actions ?? []).map(a => ({
        name: a.name,
        description: a.description,
        parameters: a.parameters,
        example: a.example,
      }));
      await invokeAgent({
        prompt,
        sessionId: sessionIdRef.current,
        pageContext: getFormattedContext(),
        actions: actionMeta,
        onEvent: handleStreamEvent,
      });

      // Stream complete — finalize with two pure, top-level updates so StrictMode
      // can double-invoke them without appending the message twice.
      const finalizedSteps = [...workflowStepsRef.current];
      const completed: ChatMessageType = {
        id: assistantId,
        role: 'assistant',
        content: currentContentRef.current,
        timestamp: assistantTimestamp,
        isStreaming: false,
        workflow: finalizedSteps.length > 0 ? finalizedSteps : undefined,
        thinkingMs: Date.now() - turnStartRef.current,
        toolCount: finalizedSteps.filter(s => s.type === 'tool').length,
      };
      setMessages(prev => [...prev, completed]);
      setCurrentAssistantMessage(completed);
      setAiModeStatus('idle');
    } catch {
      setAiModeStatus('error');
      if (!currentContentRef.current) {
        // Nothing streamed — drop the empty placeholder.
        setCurrentAssistantMessage(null);
      } else {
        setCurrentAssistantMessage(prev => (prev ? { ...prev, isStreaming: false } : prev));
      }
      setTimeout(() => setAiModeStatus('idle'), 3000);
    } finally {
      setIsLoading(false);
      isTurnActiveRef.current = false;
    }
  };

  const handleSendMessage = () => {
    if (!inputValue.trim()) return;
    const messageText = inputValue;
    setInputValue('');
    void runAgentTurn(messageText);
  };

  const handleSendSuggestion = (text: string) => {
    if (isLoading) return;
    void runAgentTurn(text);
  };

  // Mark a proposed action step approved/rejected in the finalized message + the
  // live trace (they share step ids), so the Approve/Reject card resolves in place.
  const setActionStatus = (stepId: string, status: 'approved' | 'rejected') => {
    const update = (steps: WorkflowStep[]) =>
      steps.map(s => (s.id === stepId ? { ...s, actionStatus: status } : s));
    workflowStepsRef.current = update(workflowStepsRef.current);
    setWorkflowSteps([...workflowStepsRef.current]);
    setMessages(prev => prev.map(m => (m.workflow ? { ...m, workflow: update(m.workflow) } : m)));
    setCurrentAssistantMessage(prev =>
      prev?.workflow ? { ...prev, workflow: update(prev.workflow) } : prev
    );
  };

  // Approve: run the registered client-side callback for the proposed action.
  const handleActionApprove = (stepId: string, content: string) => {
    setActionStatus(stepId, 'approved');
    try {
      const payload = JSON.parse(content) as { name?: string };
      const action = usePageContextStore.getState().actions?.find(a => a.name === payload.name);
      action?.callback(payload as Record<string, string>);
    } catch {
      // Invalid action JSON — nothing to run.
    }
  };

  // Reject: tell the agent so it can continue without executing the action.
  const handleActionReject = (stepId: string, content: string) => {
    setActionStatus(stepId, 'rejected');
    let name = 'the action';
    try {
      name = (JSON.parse(content) as { name?: string }).name || name;
    } catch {
      // keep the generic label
    }
    void runAgentTurn(
      `The user rejected the proposed action: ${name}. Please continue without executing it.`
    );
  };

  // Single writer for the active session id: keeps the non-reactive ref (read at
  // send time), the state (for consumers / persistence), and localStorage in
  // sync. Called only from handlers/effects, never during render.
  const applySessionId = (id: string) => {
    sessionIdRef.current = id;
    setActiveSessionId(id);
    writePersistedSessionId(persistKey, id);
  };

  // Load a past conversation into this surface and continue it in place: replace
  // the thread with the replayed transcript and reuse its session id, so the next
  // turn rehydrates full history server-side (nothing is replayed to the agent from
  // here). Resets the same transient state handleNewChat does.
  const loadConversation = async (sessionId: string) => {
    if (isTurnActiveRef.current) return;
    setIsRestoring(true);
    try {
      const history = await getConversation(sessionId);
      const restored: ChatMessageType[] = history.map(m => ({
        id: uuidv4(),
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        isStreaming: false,
        workflow: m.workflow,
      }));
      setMessages(restored);
      setCurrentAssistantMessage(null);
      setWorkflowSteps([]);
      workflowStepsRef.current = [];
      currentContentRef.current = '';
      lastEventTypeRef.current = null;
      setInputValue('');
      setAiModeStatus('idle');
      applySessionId(sessionId);
    } catch {
      setAiModeStatus('error');
      setTimeout(() => setAiModeStatus('idle'), 3000);
    } finally {
      setIsRestoring(false);
    }
  };

  // New chat: reset the thread + rotate the session id for a fresh transcript.
  const handleNewChat = () => {
    if (isTurnActiveRef.current) return;
    setMessages([]);
    setCurrentAssistantMessage(null);
    setWorkflowSteps([]);
    workflowStepsRef.current = [];
    currentContentRef.current = '';
    lastEventTypeRef.current = null;
    setInputValue('');
    setAiModeStatus('idle');
    applySessionId(crypto.randomUUID());
  };

  // Mount restore (persistent surfaces only): if a session id was persisted,
  // replay it so a refresh keeps the thread; otherwise persist the freshly-minted
  // id so the first turn's session survives a reload. One-shot via didRestoreRef
  // (StrictMode double-invokes effects); only setState after the await inside
  // loadConversation, never synchronously here.
  useEffect(() => {
    if (!persistKey || didRestoreRef.current) return;
    didRestoreRef.current = true;

    const stored = readPersistedSessionId(persistKey);
    if (stored) {
      // Defer out of the synchronous effect window — loadConversation flips
      // isRestoring immediately (mirrors the open-from-anywhere handler below).
      queueMicrotask(() => void loadConversation(stored));
    } else {
      writePersistedSessionId(persistKey, sessionIdRef.current);
    }
    // loadConversation is stable enough for this one-shot restore; deliberately
    // bound once so it runs only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compute stream phase for the thinking indicator.
  const streamPhase: 'thinking' | 'streaming' | 'done' =
    currentAssistantMessage?.isStreaming && currentAssistantMessage?.content
      ? 'streaming'
      : isLoading
        ? 'thinking'
        : 'done';

  return {
    messages,
    currentAssistantMessage,
    workflowSteps,
    streamPhase,
    inputValue,
    setInputValue,
    isLoading,
    handleSendMessage,
    handleSendSuggestion,
    handleNewChat,
    handleActionApprove,
    handleActionReject,
    greeting,
    scope,
    suggestions,
    // Past-conversation surfaces (Conversations page); harmless extras elsewhere.
    loadConversation,
    activeSessionId,
    isRestoring,
  };
}
