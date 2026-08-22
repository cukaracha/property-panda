import { useState } from 'react';
import { Sparkles, RotateCcw, History } from 'lucide-react';
import { useConversationsPageContext } from './PageContext';
import { useChatEngine } from '../../components/chat/useChatEngine';
import { AssistantThread } from '../../components/assistant/AssistantThread';
import { AssistantComposer } from '../../components/assistant/AssistantComposer';
import ConversationDrawer from './components/ConversationDrawer';
import { ASSISTANT_NAME } from '../../config/app';
import { cn } from '../../lib/utils';

/**
 * Conversations — a full-page chat (same scaffold as Home) whose right drawer
 * lists the user's past conversations. Picking one replays it into this page's
 * own chat engine and continues it in place; the shared useChatEngine persists
 * this surface's session under its own key so a reload keeps the thread.
 */
export default function Conversations() {
  useConversationsPageContext();
  const [drawerOpen, setDrawerOpen] = useState(false);
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
    loadConversation,
    activeSessionId,
    isRestoring,
  } = useChatEngine({ persistKey: 'chat:session:conversations' });

  return (
    <div className='conv-surface'>
      <div className='conv-surface__main'>
        <div className='page-chat'>
          <header className='page-chat__head'>
            <div className='page-chat__head-inner'>
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
                  className={cn('cb-iconbtn', drawerOpen && 'is-active')}
                  onClick={() => setDrawerOpen(open => !open)}
                  aria-label='Past conversations'
                  aria-pressed={drawerOpen}
                  title='Past conversations'
                >
                  <History size={16} />
                </button>
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
                disabled={isLoading || isRestoring}
              />
            </div>
          </div>
        </div>
      </div>

      <ConversationDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        activeSessionId={activeSessionId}
        onSelect={loadConversation}
      />
    </div>
  );
}
