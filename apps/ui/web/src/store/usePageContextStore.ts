import { create } from 'zustand';
import type { Action } from '../types/chatbot';

export interface PageDescription {
  title: string;
  purpose: string;
  layout: string;
  sections: string[];
  notes: string;
}

interface PageContext {
  pageName: string;
  pageDescription: PageDescription;
  contentDetailsProvider: (() => string) | null;
  actions?: Action[];
}

interface PageContextState extends PageContext {
  setPageContext: (ctx: PageContext) => void;
  clearPageContext: () => void;
  getFormattedContext: () => string;
}

const DEFAULTS: PageContext = {
  pageName: 'Unknown',
  pageDescription: {
    title: 'Unknown',
    purpose: 'Unknown',
    layout: 'Unknown',
    sections: [],
    notes: 'Unknown',
  },
  contentDetailsProvider: null,
  actions: [],
};

function formatPageDescription(desc: PageDescription): string {
  const lines = [
    `Title: ${desc.title}`,
    `Purpose: ${desc.purpose}`,
    `Layout: ${desc.layout}`,
    ...desc.sections.map(s => `- ${s}`),
    `Notes: ${desc.notes}`,
  ];
  return lines.join('\n');
}

/**
 * Holds the current page's context + available actions for the human-in-the-loop
 * assistant. getFormattedContext() serializes it into the <page_context> string
 * the agent receives; the actions array is also sent so the agent knows what it
 * may propose. Pages set this on mount and clear it on unmount.
 */
const usePageContextStore = create<PageContextState>((set, get) => ({
  ...DEFAULTS,

  setPageContext: ({ pageName, pageDescription, contentDetailsProvider, actions }) =>
    set({ pageName, pageDescription, contentDetailsProvider, actions: actions || [] }),

  clearPageContext: () => set({ ...DEFAULTS }),

  getFormattedContext: () => {
    const { pageName, pageDescription, contentDetailsProvider, actions } = get();
    const contentDetails = contentDetailsProvider ? contentDetailsProvider() : 'Unknown';

    const now = new Date().toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

    const parts = [
      `**Current date and time**: ${now}`,
      '',
      `**Current page**: ${pageName}`,
      '',
      `**Page description**:\n${formatPageDescription(pageDescription)}`,
      '',
      contentDetails,
    ];

    if (actions && actions.length > 0) {
      parts.push('', '**Available actions**:');
      for (const action of actions) {
        const params = Object.entries(action.parameters)
          .map(([k, v]) => `  - ${k}: ${v}`)
          .join('\n');
        parts.push(
          `- ${action.name}: ${action.description}`,
          ...(params ? [params] : []),
          `  Example: ${action.example}`
        );
      }
    }

    return parts.join('\n');
  },
}));

export default usePageContextStore;
