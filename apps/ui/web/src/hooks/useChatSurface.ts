/**
 * useChatSurface - the chat presentation one screen sets, and the teardown it needs.
 *
 * Registering a scope per screen is what keeps the assistant panel naming the screen
 * the user is actually on, and clearing both stores on the way out is what stops the
 * next screen from inheriting the last one's suggestions before it registers its own.
 */
import { useEffect } from 'react';
import { useAiModeStore } from '../store/useAiModeStore';
import usePageContextStore from '../store/usePageContextStore';

export function useChatSurface(scope: string, suggestions: string[]): void {
  const setChatUi = useAiModeStore(state => state.setChatUi);
  const reset = useAiModeStore(state => state.reset);
  const clearPageContext = usePageContextStore(state => state.clearPageContext);

  useEffect(() => {
    setChatUi({ scope, suggestions, assistantEnabled: true });
  }, [setChatUi, scope, suggestions]);

  useEffect(() => {
    return () => {
      reset();
      clearPageContext();
    };
  }, [reset, clearPageContext]);
}
