import type { KeyboardEvent } from 'react';
import { ArrowUp } from 'lucide-react';
import { ASSISTANT_NAME } from '../../config/app';

export interface AssistantComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Auto-grow composer for the floating assistant panel. Enter sends, Shift+Enter
 * inserts a newline. The textarea grows to a max height then scrolls. An ArrowUp
 * send button sits at the trailing edge, with a small disclaimer line below.
 */
export function AssistantComposer({
  value,
  onChange,
  onSend,
  disabled = false,
  placeholder = `Message ${ASSISTANT_NAME}…`,
}: AssistantComposerProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const canSend = !disabled && value.trim().length > 0;

  return (
    <>
      <div className='cb-composer__row'>
        <textarea
          rows={1}
          className='cb-ta'
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type='button'
          className='cb-iconbtn cb-iconbtn--solid'
          onClick={onSend}
          disabled={!canSend}
          aria-label='Send'
        >
          <ArrowUp size={20} />
        </button>
      </div>
      <div className='cb-disclaimer'>
        {ASSISTANT_NAME} can make mistakes, so always double-check important details.
      </div>
    </>
  );
}
