import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, History, MessageCircleQuestion, Plus, Send } from 'lucide-react';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Spinner } from '../../../components/ui/spinner';
import ErrorAlert from './ErrorAlert';
import OntologyConversationList from './OntologyConversationList';
import ToolTrailCard from './ToolTrailCard';
import TranscriptTurn from './TranscriptTurn';
import type { OntologyChatMessage, TrailStep } from '../types/ontology';
import type {
  OntologyConversationSummary,
  OntologyIndexStatus,
} from '../../../services/ontologyService';

interface AskPhaseProps {
  messages: OntologyChatMessage[];
  trail: TrailStep[];
  /** The answer being written, for the turn in flight. Empty when nothing is streaming. */
  streamingAnswer: string;
  asking: boolean;
  isRestoring: boolean;
  error: string | null;
  indexStatus: OntologyIndexStatus | null;
  configured: boolean;
  conversations: OntologyConversationSummary[] | null;
  conversationsError: string | null;
  activeSessionId: string;
  onAsk: (question: string) => void;
  onNewConversation: () => void;
  onSelectConversation: (sessionId: string) => void;
  onRefreshConversations: () => void;
}

/**
 * Phase 3 — ask a question of the finished ontology.
 *
 * The panel shows the walk as well as the answer. A question that needs more than
 * one document is answered by following the graph across several rounds, which takes
 * time, so the trail is what tells the user the search is working rather than stuck.
 * It carries the reasoning between the tool calls as well as the calls themselves,
 * which is what makes it an account of the search rather than a log of it.
 *
 * The index is built alongside the graph and finishes separately, so the panel
 * reports its state plainly instead of letting a search fail for a reason the user
 * cannot see — and it gates only asking: the graph, the schema and the history stay
 * readable while the pages hydrate.
 *
 * The conversation is server-side, so History and New conversation are real: one
 * lists what the agent still remembers, the other makes it forget. There is no
 * button that merely empties the screen, because with memory behind it that would
 * be a lie — the next question would resolve "that one" against turns the user
 * believed they had cleared.
 *
 * Both controls are unconditional and disable rather than disappear. A history
 * picker that only exists once you have a history is undiscoverable, and hiding
 * History when the listing came back empty also hid it when the listing FAILED,
 * which put the error in a rail nothing could open. Where a control is unusable it
 * says why in its title instead.
 */
export default function AskPhase({
  messages,
  trail,
  streamingAnswer,
  asking,
  isRestoring,
  error,
  indexStatus,
  configured,
  conversations,
  conversationsError,
  activeSessionId,
  onAsk,
  onNewConversation,
  onSelectConversation,
  onRefreshConversations,
}: AskPhaseProps) {
  const [question, setQuestion] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const lastSessionRef = useRef(activeSessionId);

  useEffect(() => {
    // Restoring a long thread would otherwise fling the transcript to the bottom,
    // so the render that swaps conversations is the one render that does not scroll.
    const switched = lastSessionRef.current !== activeSessionId;
    lastSessionRef.current = activeSessionId;
    if (switched) return;
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, trail, streamingAnswer, activeSessionId]);

  const ready = indexStatus === 'ready';
  const disabled = !configured || !ready || asking || isRestoring;
  // Reading a past conversation while the pages hydrate is genuinely useful, so
  // these stay live even when asking is not.
  const busy = asking || isRestoring;

  const submit = () => {
    if (!question.trim() || disabled) return;
    onAsk(question);
    setQuestion('');
  };

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex flex-none flex-wrap items-start justify-between gap-3 border-b border-line bg-canvas px-[18px] py-3'>
        <div>
          <div className='flex flex-wrap items-center gap-2'>
            <h2 className='text-[14.5px] font-semibold tracking-[-0.012em] text-ink'>Ask</h2>
            {indexStatus === 'pending' && <Badge tone='neutral'>Indexing</Badge>}
            {indexStatus === 'failed' && <Badge tone='warning'>Index failed</Badge>}
          </div>
          <p className='mt-0.5 text-xs text-ink-4'>
            Answers walk the graph, so they can cross documents
          </p>
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          {configured && (
            <Button
              size='sm'
              variant={historyOpen ? 'outline' : 'ghost'}
              aria-pressed={historyOpen}
              onClick={() => setHistoryOpen(open => !open)}
              disabled={busy}
            >
              <History className='h-4 w-4' />
              History
            </Button>
          )}
          {configured && (
            <Button
              size='sm'
              variant='ghost'
              onClick={onNewConversation}
              disabled={busy || messages.length === 0}
              title={
                messages.length === 0
                  ? 'This conversation has no turns yet'
                  : 'Start a conversation the agent will not remember this one in'
              }
            >
              <Plus className='h-4 w-4' />
              New conversation
            </Button>
          )}
        </div>
      </div>

      <div className='flex min-h-0 flex-1'>
        {historyOpen && configured && (
          <div className='flex min-h-0 w-[196px] flex-none flex-col border-r border-line bg-canvas min-[900px]:w-[224px] min-[1200px]:w-[258px]'>
            <div className='type-ui-eyebrow flex-none px-3 pb-1.5 pt-3 text-ink-4'>
              Past conversations
            </div>
            <OntologyConversationList
              conversations={conversations}
              error={conversationsError}
              activeSessionId={activeSessionId}
              disabled={busy}
              onSelect={onSelectConversation}
              onRefresh={onRefreshConversations}
            />
          </div>
        )}

        <div className='flex min-w-0 flex-1 flex-col'>
          <div className='min-h-0 flex-1 overflow-y-auto'>
            <div className='mx-auto flex max-w-[760px] flex-col gap-[18px] px-[22px] pb-2 pt-5'>
              {!configured && (
                <div className='alert'>
                  <AlertTriangle className='h-5 w-5 shrink-0' />
                  <div className='min-w-0 flex-1'>
                    <div className='font-semibold'>Asking is not configured</div>
                    <div className='mt-0.5'>
                      This build of the app has no ontology agent runtime, so questions cannot be
                      sent.
                    </div>
                  </div>
                </div>
              )}

              {configured && indexStatus === 'pending' && (
                <div className='alert'>
                  <Spinner size='sm' />
                  <div className='min-w-0 flex-1'>
                    <div className='font-semibold'>Still indexing</div>
                    <div className='mt-0.5'>
                      The graph is ready, but the pages are still being indexed for search. This
                      usually takes a minute or two after a build finishes.
                    </div>
                  </div>
                </div>
              )}

              {configured && indexStatus === 'failed' && (
                <div className='alert is-rose'>
                  <AlertTriangle className='h-5 w-5 shrink-0' />
                  <div className='min-w-0 flex-1'>
                    <div className='font-semibold'>The pages could not be indexed</div>
                    <div className='mt-0.5'>
                      The graph above is complete and valid, but this ontology cannot be searched.
                      Change its documents in Build and update it to try indexing again.
                    </div>
                  </div>
                </div>
              )}

              {isRestoring && (
                <div className='flex items-center gap-3 rounded-surface border border-line px-4 py-3 text-sm text-ink-3'>
                  <Spinner size='sm' />
                  Loading conversation
                </div>
              )}

              {!isRestoring && messages.length === 0 && !asking && (
                <div className='flex flex-col items-start gap-3 py-6'>
                  <span className='grid h-[38px] w-[38px] place-items-center rounded-surface border border-accent-line bg-accent-soft text-cyan'>
                    <MessageCircleQuestion className='h-5 w-5' />
                  </span>
                  <p className='max-w-prose text-sm leading-relaxed text-ink-3'>
                    Ask anything about these documents. Answers follow the graph, so a question
                    whose answer is split across two documents can still be answered when they share
                    an entity.
                  </p>
                </div>
              )}

              {!isRestoring &&
                messages.map((message, index) => <TranscriptTurn key={index} message={message} />)}

              {/* The trail and the answer being written are one turn, so they stack
                  together above the composer and scroll as a unit. */}
              {asking && (
                <div className='flex flex-col gap-2'>
                  <ToolTrailCard steps={trail} live />
                  {streamingAnswer && (
                    <TranscriptTurn message={{ role: 'assistant', content: streamingAnswer }} />
                  )}
                </div>
              )}

              {error && <ErrorAlert title='The question could not be answered' message={error} />}

              <div ref={endRef} />
            </div>
          </div>

          <div className='flex-none border-t border-line'>
            <div className='mx-auto flex max-w-[760px] flex-col gap-2 px-[22px] py-3'>
              <textarea
                value={question}
                onChange={event => setQuestion(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                rows={2}
                disabled={disabled}
                placeholder={
                  ready
                    ? 'Ask a question about these documents'
                    : 'Available once indexing finishes'
                }
                className='textarea min-h-[64px] w-full resize-none disabled:opacity-60'
              />
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <span className='text-xs text-ink-4'>
                  {messages.length === 0 && !asking && !isRestoring
                    ? 'Questions that join two things across documents are what this is for.'
                    : 'Enter to send · Shift+Enter for a new line'}
                </span>
                <Button onClick={submit} disabled={disabled || !question.trim()} loading={asking}>
                  {asking ? (
                    'Searching…'
                  ) : (
                    <>
                      <Send className='h-4 w-4' />
                      Ask
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
