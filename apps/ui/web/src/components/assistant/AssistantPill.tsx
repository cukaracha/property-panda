import { Sparkles } from 'lucide-react';
import { ASSISTANT_NAME } from '../../config/app';
import { cn } from '../../lib/utils';

export interface AssistantPillProps {
  /** Opens the floating chat panel. */
  onClick: () => void;
  /** Takes the pill out of the paint, the hit test and the tab order. See .cb-hidden. */
  isHidden?: boolean;
}

/**
 * The fixed bottom-right launcher pill shown while the floating chat is closed.
 * Clicking it opens the assistant panel. Dark pill with a cyan spark, z-1000.
 */
export function AssistantPill({ onClick, isHidden }: AssistantPillProps) {
  return (
    <button
      type='button'
      className={cn('cb-pill cb-anim', isHidden && 'cb-hidden')}
      onClick={onClick}
      aria-label={`Ask ${ASSISTANT_NAME}`}
    >
      <span className='cb-pill__spark'>
        <Sparkles size={19} />
      </span>
      Ask {ASSISTANT_NAME}
    </button>
  );
}
