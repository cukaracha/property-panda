import { useEffect } from 'react';
import { useAiModeStore } from '../../store/useAiModeStore';
import usePageContextStore from '../../store/usePageContextStore';

/**
 * Conversations page presentation + agent grounding. Like Home this is a general,
 * unscoped assistant (no topicId, so course_knowledge_base stays unscoped), but
 * its purpose is resuming past chats: the user picks a conversation from the right
 * drawer and continues it in place. Registers a minimal page context (no page
 * actions) and clears both stores on unmount.
 */
export function useConversationsPageContext(): void {
  const setChatUi = useAiModeStore(state => state.setChatUi);
  const reset = useAiModeStore(state => state.reset);
  const setPageContext = usePageContextStore(state => state.setPageContext);
  const clearPageContext = usePageContextStore(state => state.clearPageContext);

  useEffect(() => {
    setChatUi({
      scope: undefined,
      topicId: undefined,
      suggestions: [],
    });
  }, [setChatUi]);

  useEffect(() => {
    setPageContext({
      pageName: 'Conversations',
      pageDescription: {
        title: 'Conversations',
        purpose: 'Browse and continue past chat conversations.',
        layout:
          'A chat column with a message thread and a composer, plus a collapsible drawer on the right listing the past conversations.',
        sections: ['Assistant chat thread', 'Message composer', 'Past conversations drawer'],
        notes:
          'The user can open the drawer to pick an earlier conversation and continue it here; the full prior context is restored server-side when they send the next message.',
      },
      contentDetailsProvider: null,
      actions: [],
    });

    return () => {
      reset();
      clearPageContext();
    };
  }, [setPageContext, clearPageContext, reset]);
}
