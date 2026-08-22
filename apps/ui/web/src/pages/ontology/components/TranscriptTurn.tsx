import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ToolTrailCard from './ToolTrailCard';
import type { OntologyChatMessage } from '../types/ontology';
import '../../../components/assistant/markdown.css';

interface TranscriptTurnProps {
  message: OntologyChatMessage;
}

/**
 * One turn of the transcript.
 *
 * The user's turn is a constrained bubble and the answer is prose across the
 * measure, because that is the shape each actually is: a question is short and
 * belongs to someone, an answer is a piece of reading. The answer is markdown —
 * the agent cites pages and draws hop chains — so it renders through the same
 * `chat-markdown` styling as every other chat surface in the app.
 */
export default function TranscriptTurn({ message }: TranscriptTurnProps) {
  if (message.role === 'user') {
    return (
      <div className='flex justify-end'>
        <div className='max-w-[80%] rounded-[14px_4px_14px_14px] border border-line bg-panel-2 px-[15px] py-[11px] text-sm text-ink'>
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-2'>
      {message.trail && message.trail.length > 0 && <ToolTrailCard steps={message.trail} />}
      <div className='chat-markdown text-ink-2'>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
      </div>
    </div>
  );
}
