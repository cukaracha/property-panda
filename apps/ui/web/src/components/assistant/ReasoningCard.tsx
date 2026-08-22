import { Brain, Loader, ChevronDown } from 'lucide-react';
import type { WorkflowStep } from '../../types/chatbot';
import { ToolCall } from './ToolCall';
import { toolMeta } from './toolMeta';

export interface ReasoningCardProps {
  /** Ordered reasoning/tool steps for this turn (stream order preserved). */
  steps: WorkflowStep[];
  /** True while the agent is still working this turn (spinner + thinking dots). */
  busy: boolean;
  /** Whether the collapsible body is open. */
  open: boolean;
  onToggle: () => void;
  /** Total think time for the finished turn, in ms (header summary). */
  thinkingMs?: number;
}

/** Parse a tool step's content into name / args / result. */
function parseTool(content: string): { name: string; args?: string; result?: string } {
  let body = content;
  let result: string | undefined;
  const arrow = body.indexOf('→');
  if (arrow >= 0) {
    result = body.slice(arrow + 1).trim() || undefined;
    body = body.slice(0, arrow).trim();
  }
  const paren = body.indexOf('(');
  if (paren >= 0 && body.endsWith(')')) {
    return {
      name: body.slice(0, paren).trim(),
      args: body.slice(paren + 1, -1).trim() || undefined,
      result,
    };
  }
  return { name: body.trim(), result };
}

/** One reason/tool row on the vertical timeline. */
function Step({ step, last, busy }: { step: WorkflowStep; last: boolean; busy: boolean }) {
  if (step.type === 'tool') {
    const { name, args, result } = parseTool(step.content);
    const Icon = toolMeta(name).icon;
    return (
      <div className='cb-step'>
        <div className='cb-step__rail'>
          {!last && <div className='cb-step__line' />}
          <div className='cb-step__node cb-step__node--tool'>
            <Icon size={12} />
          </div>
        </div>
        <div className={`cb-step__content${last ? ' cb-step__content--last' : ''}`}>
          <ToolCall name={name} args={args} result={result} running={busy && last} />
        </div>
      </div>
    );
  }
  return (
    <div className='cb-step'>
      <div className='cb-step__rail'>
        {!last && <div className='cb-step__line' />}
        <div className='cb-step__node'>
          <span className='cb-step__dot' />
        </div>
      </div>
      <div className={`cb-step__content${last ? ' cb-step__content--last' : ''}`}>
        <div className='cb-step__reason'>{step.content}</div>
      </div>
    </div>
  );
}

/**
 * The thinking card: collapsed by default. While busy the header spins a Loader
 * with animated "Thinking" dots; once done it shows the brain glyph plus a
 * "Thought for {n}s · {k} tools" summary. The body renders the reason/tool
 * timeline in stream order via the shared .cb-collapse grid-rows accordion.
 */
export function ReasoningCard({ steps, busy, open, onToggle, thinkingMs }: ReasoningCardProps) {
  const toolCount = steps.filter(s => s.type === 'tool').length;
  // Live turns carry wall-clock think time; replayed turns don't persist it, so
  // fall back to a plain label instead of "Thought for 0.0s".
  const doneLabel =
    thinkingMs != null ? `Thought for ${(thinkingMs / 1000).toFixed(1)}s` : 'Thought process';

  return (
    <div className='cb-think'>
      <button
        type='button'
        className={`cb-think-hd${open ? ' is-open' : ''}`}
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className='cb-think-hd__icon'>
          {busy ? (
            <span className='cb-spin'>
              <Loader size={15} />
            </span>
          ) : (
            <Brain size={15} />
          )}
        </span>
        <span className='cb-think-hd__label'>
          {busy ? (
            <>
              Thinking
              <span className='cb-dots'>
                <i />
                <i />
                <i />
              </span>
            </>
          ) : (
            doneLabel
          )}
        </span>
        {!busy && toolCount > 0 && (
          <span className='cb-think-hd__count'>
            · {toolCount} tool{toolCount > 1 ? 's' : ''}
          </span>
        )}
        <span className='cb-think-hd__chev'>
          <ChevronDown size={16} />
        </span>
      </button>

      <div className={`cb-collapse${open ? ' open' : ''}`}>
        <div>
          <div className='cb-think__body'>
            {steps.length === 0 && <div className='cb-think__empty'>Planning…</div>}
            {steps.map((step, i) => (
              <Step key={step.id} step={step} last={i === steps.length - 1} busy={busy} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
