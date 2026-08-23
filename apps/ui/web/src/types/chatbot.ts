/**
 * TypeScript interfaces for the Chat Agent
 */

// --- Agent Stream Events ---

// `action` events carry a proposed <act> JSON payload. They drive the
// human-in-the-loop approve/reject flow (see usePageContextStore + useChatEngine).
//
// `message` carries prose in fragments as the agent writes it, which useChatEngine
// accumulates into the answer bubble.
export type AgentEventType = 'reasoning' | 'message' | 'tool' | 'action' | 'status' | 'error';

export interface AgentStreamEvent {
  type: AgentEventType;
  content: string;
}

// --- Actions (human-in-the-loop) ---

/**
 * A page action the agent may propose. name/description/parameters/example are
 * serialized into the page context sent to the agent; display/callback are
 * client-side only (never sent) — display renders the proposal, callback runs it
 * on approval.
 */
export interface Action {
  name: string;
  description: string;
  parameters: Record<string, string>;
  example: string;
  display: (params: Record<string, string>) => string;
  callback: (params: Record<string, string>) => void;
}

// --- Workflow ---

export interface WorkflowStep {
  id: string;
  type: 'reasoning' | 'tool' | 'error' | 'action';
  content: string;
  timestamp: string;
  /** For action steps: the approval state of the proposed action. */
  actionStatus?: 'pending' | 'approved' | 'rejected';
}

// --- Messages ---

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  workflow?: WorkflowStep[];
  /** Total wall-clock time the assistant spent thinking for this turn, in ms. */
  thinkingMs?: number;
  /** Number of tool calls made during this turn. */
  toolCount?: number;
}
