/**
 * Chat agent service — SSE streaming from the local assistant.
 *
 * The agent used to be a Bedrock AgentCore runtime the browser invoked directly with
 * a Cognito access token. It now runs in the local server (apps/local/property_search)
 * on the Claude subscription token saved on the profile page, so the transport is a
 * plain `fetch` to loopback with no Authorization header, for the same reason the
 * listings service has none.
 *
 * The event protocol did not move. Every frame is still `data: {type, content}` with
 * type in reasoning|message|tool|action|status|error, which is what useChatEngine
 * routes and what types/chatbot.ts describes.
 */

import type { AgentStreamEvent, WorkflowStep } from '../types/chatbot';

/** The local server, the same host the listings service talks to. */
const API_URL = import.meta.env.VITE_LISTINGS_API_URL || 'http://localhost:8000';

// --- Types ---

export interface InvokeAgentRequest {
  prompt: string;
  sessionId: string;
  /** Formatted page context (<page_context>) for the human-in-the-loop assistant. */
  pageContext?: string;
  /** Available page actions (<page_actions>) the agent may propose. Only metadata is sent. */
  actions?: AgentActionMeta[];
  onEvent?: (event: AgentStreamEvent) => void;
}

/** The action metadata sent to the agent (client-side display/callback are stripped). */
export interface AgentActionMeta {
  name: string;
  description: string;
  parameters: Record<string, string>;
  example: string;
}

export interface InvokeAgentResponse {
  response: string;
}

/** One replayed turn of a past conversation. */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  /** The stored thinking-card trace (reasoning + tool steps) for assistant turns. */
  workflow?: WorkflowStep[];
}

// --- Public API ---

/**
 * Run one turn against the local chat agent, streaming its events back.
 *
 * The onEvent callback receives structured events in real time. Returns the full
 * concatenated message-type response when the stream completes.
 */
export async function invokeAgent(request: InvokeAgentRequest): Promise<InvokeAgentResponse> {
  const response = await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: request.prompt,
      sessionId: request.sessionId,
      pageContext: request.pageContext ?? '',
      actions: request.actions ?? [],
    }),
  });

  if (!response.ok) {
    throw new Error(`The assistant could not be reached: ${response.status}`);
  }

  // Stream SSE response
  if (request.onEvent && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    let buffer = '';

    try {
      for (let result = await reader.read(); !result.done; result = await reader.read()) {
        const { value } = result;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const event: AgentStreamEvent = JSON.parse(data);
              request.onEvent(event);
              if (event.type === 'message') {
                fullResponse += event.content;
              }
            } catch {
              // Skip unparseable events
            }
          }
        }
      }
      return { response: fullResponse };
    } finally {
      reader.releaseLock();
    }
  }

  // Non-streaming fallback
  const data = await response.json();
  const responseText =
    typeof data === 'string'
      ? data
      : data?.response || data?.content || data?.text || data?.message || JSON.stringify(data);
  return { response: responseText };
}

/**
 * Replay one past conversation as an ordered user/assistant transcript. Assistant
 * turns carry the stored workflow (reasoning + tool steps) for the thinking card.
 * An unknown id yields an empty list.
 */
export async function getConversation(sessionId: string): Promise<ConversationMessage[]> {
  const response = await fetch(`${API_URL}/chat/conversations/${encodeURIComponent(sessionId)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to load conversation');
  return data.messages;
}
