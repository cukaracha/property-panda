/**
 * Zustand store for AI Mode Status
 * Controls the color of the AiModeLogo based on agent activity
 */

import { create } from 'zustand';

type AiModeStatus =
  | 'idle'
  | 'thinking'
  | 'searching'
  | 'evaluating'
  | 'streaming'
  | 'complete'
  | 'error';

interface AiModeStore {
  status: AiModeStatus;
  setStatus: (status: AiModeStatus) => void;
  isChatOpen: boolean;
  /** True once the chat has been opened at least once this session, so the orb's proactive suggestion hint is no longer shown. */
  suggestionViewed: boolean;
  /** UI-only label for the active page, shown as the assistant panel subline. Never sent to the agent. */
  scope?: string;
  /** UI-only "Try asking" chips, shown before the first user turn. Never sent to the agent. */
  suggestions: string[];
  /** Current topic id (e.g. 'phys2001') for the active page. Unlike scope/suggestions this IS sent to the agent, so it can scope the course_knowledge_base tool. Undefined off unit-scoped pages. */
  topicId?: string;
  /** Set the chat presentation (panel subline + suggestion chips) and the current topic id. */
  setChatUi: (ui: { scope?: string; suggestions?: string[]; topicId?: string }) => void;
  toggleChat: () => void;
  openChat: () => void;
  closeChat: () => void;
  reset: () => void;
}

export const useAiModeStore = create<AiModeStore>(set => ({
  status: 'idle',
  setStatus: status => set({ status }),
  isChatOpen: false,
  suggestionViewed: false,
  scope: undefined,
  suggestions: [],
  topicId: undefined,
  setChatUi: ui => set({ scope: ui.scope, suggestions: ui.suggestions ?? [], topicId: ui.topicId }),
  toggleChat: () =>
    set(state => ({
      isChatOpen: !state.isChatOpen,
      suggestionViewed: state.suggestionViewed || !state.isChatOpen,
    })),
  openChat: () => set({ isChatOpen: true, suggestionViewed: true }),
  closeChat: () => set({ isChatOpen: false }),
  reset: () =>
    set({
      status: 'idle',
      isChatOpen: false,
      suggestionViewed: false,
      scope: undefined,
      suggestions: [],
      topicId: undefined,
    }),
}));
