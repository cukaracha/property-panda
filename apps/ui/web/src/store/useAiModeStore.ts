/**
 * Zustand store for AI Mode Status
 * Controls the color of the AiModeLogo based on agent activity
 */

import { create } from 'zustand';

type AiModeStatus =
  'idle' | 'thinking' | 'searching' | 'evaluating' | 'streaming' | 'complete' | 'error';

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
  /** Whether the floating assistant is mounted at all. A page opts in by setting it; off every page that has not. */
  assistantEnabled: boolean;
  /** Set the chat presentation (panel subline + suggestion chips) and whether the assistant is offered here. */
  setChatUi: (ui: { scope?: string; suggestions?: string[]; assistantEnabled?: boolean }) => void;
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
  assistantEnabled: false,
  setChatUi: ui =>
    set({
      scope: ui.scope,
      suggestions: ui.suggestions ?? [],
      assistantEnabled: ui.assistantEnabled ?? false,
    }),
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
      assistantEnabled: false,
    }),
}));
