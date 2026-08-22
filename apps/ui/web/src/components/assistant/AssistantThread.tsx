import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles, User, AlertCircle } from 'lucide-react';
import type { ChatMessage, WorkflowStep } from '../../types/chatbot';
import { ReasoningCard } from './ReasoningCard';
import { ActionCard } from './ActionCard';
import './markdown.css';

export type StreamPhase = 'thinking' | 'streaming' | 'done';

export type ActionHandler = (stepId: string, content: string) => void;

export interface AssistantThreadProps {
  messages: ChatMessage[];
  currentMessage: ChatMessage | null;
  workflowSteps: WorkflowStep[];
  streamPhase: StreamPhase;
  /** Greeting bubble copy, built from the first name + scope. */
  greeting: string;
  /** "Try asking" chips, shown only before the first user turn. */
  suggestions: string[];
  /** Sends a suggestion chip as a user turn. */
  onSendSuggestion: (text: string) => void;
  /** Approve a proposed action step (human-in-the-loop). */
  onActionApprove?: ActionHandler;
  /** Reject a proposed action step (human-in-the-loop). */
  onActionReject?: ActionHandler;
}

/** A user message bubble (right-aligned, tucked corner) with a generic user-icon avatar. */
function UserRow({ content }: { content: string }) {
  return (
    <div className='cb-row cb-row--user'>
      <span className='cb-avatar cb-avatar--user' aria-hidden='true'>
        <User size={14} />
      </span>
      <div className='flex min-w-0 flex-col items-end'>
        <div className='cb-userbubble'>{content}</div>
      </div>
    </div>
  );
}

/** A red, debug-oriented card surfaced when the agent emits an `error` event. */
function ErrorItem({ step }: { step: WorkflowStep }) {
  return (
    <div className='cb-error'>
      <div className='cb-error__hd'>
        <AlertCircle size={14} />
        <span>Error</span>
      </div>
      <pre className='cb-error__body'>{step.content}</pre>
    </div>
  );
}

/** An assistant turn: 28px accent avatar + thinking card + markdown answer (no turn label). */
function AssistantRow({
  steps,
  content,
  busy,
  thinkingMs,
  onActionApprove,
  onActionReject,
}: {
  steps: WorkflowStep[];
  content: string;
  busy: boolean;
  thinkingMs?: number;
  onActionApprove?: ActionHandler;
  onActionReject?: ActionHandler;
}) {
  const [open, setOpen] = useState(false);
  const reasonOrTool = steps.filter(s => s.type === 'reasoning' || s.type === 'tool');
  const errors = steps.filter(s => s.type === 'error');
  const actions = steps.filter(s => s.type === 'action');
  const showThinking = busy || reasonOrTool.length > 0;

  return (
    <div className='cb-row'>
      <span className='cb-avatar' aria-hidden='true'>
        <Sparkles size={14} />
      </span>
      <div className='cb-row__body'>
        {showThinking && (
          <ReasoningCard
            steps={reasonOrTool}
            busy={busy}
            open={open}
            onToggle={() => setOpen(o => !o)}
            thinkingMs={thinkingMs}
          />
        )}
        {errors.map(step => (
          <ErrorItem key={step.id} step={step} />
        ))}
        {content && (
          <div className='cb-answer chat-markdown'>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        )}
        {actions.map(step => (
          <ActionCard
            key={step.id}
            step={step}
            onApprove={onActionApprove ?? (() => {})}
            onReject={onActionReject ?? (() => {})}
          />
        ))}
      </div>
    </div>
  );
}

export function AssistantThread({
  messages,
  currentMessage,
  workflowSteps,
  streamPhase,
  greeting,
  suggestions,
  onSendSuggestion,
  onActionApprove,
  onActionReject,
}: AssistantThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [currentMessage?.content, workflowSteps, messages.length]);

  // Compare by id, not object reference: once a turn finalizes, the finalized
  // message and currentMessage share an id but later diverge into distinct objects
  // (e.g. an approve/reject updates each store independently) — a reference check
  // would then render the finalized turn twice.
  const isCurrentInHistory =
    currentMessage != null &&
    messages.length > 0 &&
    messages[messages.length - 1].id === currentMessage.id;

  const hasUserTurn = messages.some(m => m.role === 'user');
  const showSuggestions = !hasUserTurn && suggestions.length > 0;

  return (
    <>
      <AssistantRow steps={[]} content={greeting} busy={false} />

      {showSuggestions && (
        <div className='cb-suggest'>
          <div className='cb-suggest__lbl'>Try asking</div>
          <div className='cb-suggest__row'>
            {suggestions.map(s => (
              <button type='button' key={s} className='cb-chip' onClick={() => onSendSuggestion(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.map((message, index) =>
        message.role === 'user' ? (
          <UserRow key={message.id || index} content={message.content} />
        ) : (
          <AssistantRow
            key={message.id || index}
            steps={message.workflow ?? []}
            content={message.content}
            busy={false}
            thinkingMs={message.thinkingMs}
            onActionApprove={onActionApprove}
            onActionReject={onActionReject}
          />
        )
      )}

      {currentMessage && !isCurrentInHistory && (
        <AssistantRow
          steps={workflowSteps}
          content={currentMessage.content}
          busy={!!currentMessage.isStreaming && streamPhase !== 'done'}
          onActionApprove={onActionApprove}
          onActionReject={onActionReject}
        />
      )}

      <div ref={bottomRef} />
    </>
  );
}
