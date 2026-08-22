import { Sparkles, RotateCcw } from 'lucide-react';
import { useHomePageContext } from './PageContext';
import { useChatEngine } from '../../components/chat/useChatEngine';
import { AssistantThread } from '../../components/assistant/AssistantThread';
import { AssistantComposer } from '../../components/assistant/AssistantComposer';
import { ASSISTANT_NAME } from '../../config/app';

/**
 * Home — the full-page chat, the app's primary surface. Reuses the shared
 * useChatEngine streaming engine (same StrictMode-safe accumulation as the
 * floating Topic-page assistant) rendered as a full-height column: a header, a
 * scrolling thread, and a pinned composer.
 */
export default function Home() {
  useHomePageContext();
  const {
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
  } = useChatEngine({ persistKey: 'chat:session:home' });

  return (
    <div className='page-chat'>
      <header className='page-chat__head'>
        <span className='page-chat__avatar' aria-hidden='true'>
          <Sparkles size={15} />
        </span>
        <div className='page-chat__id'>
          <div className='page-chat__name'>{ASSISTANT_NAME}</div>
          <div className='page-chat__scope'>
            {scope ? `${scope} assistant` : 'Your study assistant'}
          </div>
        </div>
        <div className='page-chat__actions'>
          <button
            type='button'
            className='cb-iconbtn'
            onClick={handleNewChat}
            aria-label='New chat'
            title='New chat'
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </header>

      <div className='page-chat__thread'>
        <div className='page-chat__thread-inner'>
          <AssistantThread
            messages={messages}
            currentMessage={currentAssistantMessage}
            workflowSteps={workflowSteps}
            streamPhase={streamPhase}
            greeting={greeting}
            suggestions={suggestions}
            onSendSuggestion={handleSendSuggestion}
            onActionApprove={handleActionApprove}
            onActionReject={handleActionReject}
          />
        </div>
      </div>

      <div className='page-chat__composer'>
        <div className='page-chat__composer-inner'>
          <AssistantComposer
            value={inputValue}
            onChange={setInputValue}
            onSend={handleSendMessage}
            disabled={isLoading}
          />
        </div>
      </div>
    </div>
  );
}
