import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import { Spinner } from '../../../components/ui/spinner';
import { splitTrailStep, trailIcon } from '../utils/trailIcons';
import type { TrailStep } from '../types/ontology';

interface ToolTrailCardProps {
  steps: TrailStep[];
  /** The turn is still running, so the card streams open and cannot be collapsed shut. */
  live?: boolean;
}

/** How near the bottom counts as being at it, in px. A couple of lines of slack,
 *  so a step landing mid-scroll does not read as the reader having moved away. */
const AT_BOTTOM_PX = 24;

/** One row on the timeline: a boxed glyph for a tool call, a plain dot for the
 *  reasoning between calls. Both nodes and the rail share the same 22px axis, which
 *  is what keeps the two kinds of row reading as one sequence. */
function Step({ step, last }: { step: TrailStep; last: boolean }) {
  const isTool = step.type === 'tool';
  const { name, detail } = isTool ? splitTrailStep(step.content) : { name: '', detail: '' };
  const meta = trailIcon(name);

  return (
    <div className='cb-step'>
      <div className='cb-step__rail'>
        {!last && <div className='cb-step__line' />}
        {isTool ? (
          <div className='cb-step__node cb-step__node--tool'>
            <meta.icon size={12} />
          </div>
        ) : (
          <div className='cb-step__node'>
            <span className='cb-step__dot' />
          </div>
        )}
      </div>
      <div className={`cb-step__content${last ? ' cb-step__content--last' : ''}`}>
        {isTool ? (
          // .cb-tool is what carries min-width: 0, so a long page list truncates
          // rather than widening the card.
          <div className='cb-tool'>
            <div className='cb-tool__hd'>
              <span className='cb-tool__name'>{name}</span>
              {detail && <span className='cb-tool__args'>{detail}</span>}
            </div>
          </div>
        ) : (
          <div className='cb-step__reason'>{step.content}</div>
        )}
      </div>
    </div>
  );
}

/**
 * The search's intermediate steps — what the agent looked at on the way to an
 * answer, and the reasoning that sent it there.
 *
 * Live, it is the only evidence the search is working rather than stuck, so it is
 * open and streaming, and it renders from the moment the question is sent rather
 * than from the first tool call. The gap between the two is the orchestrator
 * deciding what to search for, which is now filled by its reasoning rather than by
 * nothing. Once the answer lands it collapses onto the turn it belongs to and stays
 * there: an answer that walked six documents is worth being able to check
 * afterwards, not only while it runs.
 *
 * Reuses the assistant timeline's row classes (styles/app-chat.css) rather than
 * restating them, the same way the conversation list reuses the drawer's — those
 * carry no positioning of their own. The tool row stops at name and arguments: the
 * ontology trail reports a call, not its result, so the reference's status line
 * would have nothing to put in it.
 *
 * Every step is rendered and the body scrolls within a capped height, rather than
 * only the newest few being kept. What the cap is really for is the card's height —
 * a reasoning row is wrapped prose, so a long search would otherwise walk the answer
 * off the bottom of the page — and a cap answers that without discarding anything.
 */
export default function ToolTrailCard({ steps, live = false }: ToolTrailCardProps) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Whether a new step should pull the view down with it. The reader's own scrolling
  // is what sets this: moving up during a search stops the card dragging them back,
  // and returning to the bottom resumes the follow.
  const followRef = useRef(true);

  useEffect(() => {
    const body = bodyRef.current;
    // Only while the turn is running. A finished trail is an account of the search
    // and reads from its first step, so an expanded card is left where it opens.
    if (!live || !followRef.current || !body) return;
    // Assigned rather than animated: reasoning arrives a fragment at a time and the
    // last step grows continuously, so a smooth scroll would spend the whole search
    // chasing a target that has already moved.
    body.scrollTop = body.scrollHeight;
  }, [steps, live]);

  // A finished turn that recorded no steps has nothing to collapse, so it renders
  // nothing. A live one always has its header to show.
  if (steps.length === 0 && !live) return null;

  const expanded = live || open;
  // Counted over tool calls alone. The header is a summary of what the search did,
  // and it should not inflate because the model happened to think in four bursts.
  const toolCount = steps.filter(step => step.type === 'tool').length;

  const handleScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    followRef.current = body.scrollHeight - body.scrollTop - body.clientHeight < AT_BOTTOM_PX;
  };

  return (
    <div className='rounded-[11px] border border-line bg-panel-2'>
      {live ? (
        <div className='flex items-center gap-2 px-3 py-2'>
          <Spinner size='sm' />
          <span className='type-ui-eyebrow text-ink-3'>Searching</span>
        </div>
      ) : (
        <button
          type='button'
          aria-expanded={open}
          onClick={() => setOpen(value => !value)}
          className='flex w-full items-center gap-2 px-3 py-2 text-left'
        >
          <Search className='h-3.5 w-3.5 shrink-0 text-ink-4' />
          <span className='type-ui-eyebrow text-ink-3'>
            Searched the graph · {toolCount} step{toolCount === 1 ? '' : 's'}
          </span>
          {open ? (
            <ChevronUp className='ml-auto h-3.5 w-3.5 text-ink-4' />
          ) : (
            <ChevronDown className='ml-auto h-3.5 w-3.5 text-ink-4' />
          )}
        </button>
      )}

      {expanded && steps.length > 0 && (
        <div
          ref={bodyRef}
          onScroll={handleScroll}
          className='max-h-[260px] overflow-y-auto px-3 pb-1 pt-1'
        >
          {steps.map((step, index) => (
            <Step key={index} step={step} last={index === steps.length - 1} />
          ))}
        </div>
      )}
    </div>
  );
}
