/**
 * Chat — the floating study assistant (Topic pages).
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

const Chat: React.FC = () => {
  const { isChatOpen, closeChat, scope, topicId } = useAiModeStore();
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
  } = useChatEngine({
    persistKey: topicId ? `chat:session:topic:${topicId}` : undefined,
  });

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
