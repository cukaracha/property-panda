/**
 * Chat — the floating assistant panel.
 * A thin presentation wrapper over useChatEngine: it adds the open/close panel
 * chrome and renders nothing when the panel is closed. AppLayout renders the
 * <AssistantPill/> launcher when this panel is closed.
 */
import React from 'react';
import { useAiModeStore } from '../../store/useAiModeStore';
import { useChatEngine } from './useChatEngine';
import { AssistantPanel } from '../assistant/AssistantPanel';
import { AssistantThread } from '../assistant/AssistantThread';
import { AssistantComposer } from '../assistant/AssistantComposer';

// One assistant, one conversation. The key is fixed rather than derived from the
// page, so the thread survives a reload and does not fork per surface.
const CHAT_SESSION_KEY = 'chat:session:properties';

const Chat: React.FC = () => {
  const { isChatOpen, closeChat, scope } = useAiModeStore();
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
    suggestions,
  } = useChatEngine({ persistKey: CHAT_SESSION_KEY });

  if (!isChatOpen) return null;

  return (
    <AssistantPanel
      scope={scope}
      onNewChat={handleNewChat}
      onClose={closeChat}
      composer={
        <AssistantComposer
          value={inputValue}
          onChange={setInputValue}
          onSend={handleSendMessage}
          disabled={isLoading}
        />
      }
    >
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
    </AssistantPanel>
  );
};

export default Chat;
