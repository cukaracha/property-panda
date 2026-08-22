/**
 * Chat Agent Service - AgentCore SSE Streaming
 *
 * Invokes the Chat Agent via Bedrock AgentCore runtime.
 * Uses HTTPS with Server-Sent Events (SSE) for streaming responses.
 * Authentication via Cognito access token (Bearer auth).
 */

import { getAccessToken, authFetch } from './authUtils';
import type { AgentStreamEvent, WorkflowStep } from '../types/chatbot';

// Environment configuration
const AGENTCORE_RUNTIME_ARN = import.meta.env.VITE_AGENTCORE_RUNTIME_ARN;

// REST front door — the read-only past-conversations proxies (list/replay) go
// through API Gateway (Cognito ID token via authFetch), unlike invokeAgent's
// access-token Bearer straight to the AgentCore runtime.
const API_URL = import.meta.env.VITE_API_URL;

// Extract region from Cognito User Pool ID (format: ap-southeast-2_xxx)
const USER_POOL_ID = import.meta.env.VITE_USER_POOL_ID || '';
const REGION = USER_POOL_ID.split('_')[0] || 'ap-southeast-2';

// --- Types ---

export interface InvokeAgentRequest {
  prompt: string;
  actorId: string;
  sessionId: string;
  /** Current topic id (e.g. 'phys2001'), sent so the agent can scope the course_knowledge_base tool. */
  topicId?: string;
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

/** A past chat session (AgentCore Memory), labelled by its start time. */
export interface ConversationSummary {
  sessionId: string;
  /** ISO-8601 conversation start time. */
  createdAt: string;
}

/** One replayed turn of a past conversation. */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  /** Reconstructed thinking-card trace (reasoning + tool steps) for assistant turns. */
  workflow?: WorkflowStep[];
}

// --- Public API ---

/**
 * Invoke the Chat Agent via AgentCore runtime.
 *
 * Sends a prompt to the agent and streams back SSE events.
 * The onEvent callback receives structured events in real-time.
 * Returns the full concatenated message-type response when complete.
 */
export async function invokeAgent(request: InvokeAgentRequest): Promise<InvokeAgentResponse> {
  if (!AGENTCORE_RUNTIME_ARN) {
    throw new Error('AgentCore Runtime ARN not configured. Please set VITE_AGENTCORE_RUNTIME_ARN.');
  }

  const accessToken = await getAccessToken();
  const encodedArn = encodeURIComponent(AGENTCORE_RUNTIME_ARN);
  const url = `https://bedrock-agentcore.${REGION}.amazonaws.com/runtimes/${encodedArn}/invocations?qualifier=DEFAULT`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': request.sessionId,
    },
    body: JSON.stringify({
      prompt: request.prompt,
      actor_id: request.actorId,
      session_id: request.sessionId,
      topic_id: request.topicId ?? '',
      page_context: request.pageContext ?? '',
      actions: request.actions ?? [],
      bearer_token: accessToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`AgentCore invocation failed: ${response.status} ${response.statusText}`);
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
 * List the signed-in user's past chat conversations, newest first. Goes through
 * API Gateway (the browser can't sign the AgentCore data-plane); the actor is
 * derived server-side from the Cognito token, so only the caller's sessions come
 * back.
 */
export async function listConversations(): Promise<ConversationSummary[]> {
  const response = await authFetch(`${API_URL}/conversations`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to list conversations');
  return data.conversations;
}

/**
 * Replay one past conversation as an ordered user/assistant transcript. Assistant
 * turns carry a reconstructed workflow (reasoning + tool steps) for the thinking
 * card. A foreign or unknown id yields an empty list.
 */
export async function getConversation(sessionId: string): Promise<ConversationMessage[]> {
  const response = await authFetch(`${API_URL}/conversations/${encodeURIComponent(sessionId)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to load conversation');
  return data.messages;
}
