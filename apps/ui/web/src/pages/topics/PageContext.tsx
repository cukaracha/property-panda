import { useEffect } from 'react';
import { useAiModeStore } from '../../store/useAiModeStore';
import type { Topic } from '../../data/topics';

/**
 * Topic page chat presentation. Sets the assistant panel subline (scope), the
 * "Try asking" chips, and — crucially — the topicId, which IS sent to the agent
 * so it can scope the course_knowledge_base tool to this topic. Clears the store
 * on unmount.
 */
export function useTopicPageContext(topic: Topic): void {
  const setChatUi = useAiModeStore(state => state.setChatUi);
  const reset = useAiModeStore(state => state.reset);

  useEffect(() => {
    setChatUi({ scope: topic.title, suggestions: [...topic.suggestions], topicId: topic.id });
    return () => reset();
  }, [setChatUi, reset, topic]);
}
