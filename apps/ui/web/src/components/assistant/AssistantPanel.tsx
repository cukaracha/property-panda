import type { ReactNode } from 'react';
import { Sparkles, RotateCcw, ChevronDown } from 'lucide-react';
import { ASSISTANT_NAME } from '../../config/app';

export interface AssistantPanelProps {
  /** Accepted so callers need not change, but the subline no longer names a screen. */
  scope?: string;
  /** Resets the thread and starts a fresh agent session. */
  onNewChat: () => void;
  /** Minimises (closes) the panel. */
  onClose: () => void;
  /** Composer node, rendered in the footer. */
  composer?: ReactNode;
  children?: ReactNode;
}

/**
 * The floating assistant chat panel (open state). Fixed bottom-right, radius 20,
 * a white card that rises in. Header: a Sparkles avatar with a presence dot, the
 * assistant name over one fixed subline, plus New chat and Minimise buttons.
 *
 * The subline no longer names the screen. The assistant is still handed the current
 * screen's context on every turn; the header simply stopped repeating it.
 */
export function AssistantPanel({ onNewChat, onClose, composer, children }: AssistantPanelProps) {
  return (
    <div className='cb-panel cb-anim' role='dialog' aria-label={`${ASSISTANT_NAME} assistant`}>
      <div className='cb-head'>
        <span className='cb-head__avatar' aria-hidden='true'>
          <Sparkles size={14} />
          <span className='cb-head__dot' />
        </span>
        <div className='cb-head__id'>
          <div className='cb-head__name'>{ASSISTANT_NAME}</div>
          <div className='cb-head__scope'>Your personal assistant</div>
        </div>
        <div className='cb-head__actions'>
          <button
            type='button'
            className='cb-iconbtn'
            onClick={onNewChat}
            aria-label='New chat'
            title='New chat'
          >
            <RotateCcw size={16} />
          </button>
          <button
            type='button'
            className='cb-iconbtn'
            onClick={onClose}
            aria-label='Minimise'
            title='Minimise'
          >
            <ChevronDown size={18} />
          </button>
        </div>
      </div>

      <div className='cb-thread'>{children}</div>

      {composer && <div className='cb-composer'>{composer}</div>}
    </div>
  );
}
