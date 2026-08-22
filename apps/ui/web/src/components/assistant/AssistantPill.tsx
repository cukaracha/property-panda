import { Sparkles } from 'lucide-react';
import { ASSISTANT_NAME } from '../../config/app';

export interface AssistantPillProps {
  /** Opens the floating chat panel. */
  onClick: () => void;
}

/**
 * The fixed bottom-right launcher pill shown while the floating chat is closed.
 * Clicking it opens the assistant panel. Dark pill with a cyan spark, z-1000.
 */
export function AssistantPill({ onClick }: AssistantPillProps) {
  return (
    <button
      type='button'
      className='cb-pill cb-anim'
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
