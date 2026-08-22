/**
 * Ontology chat service — AgentCore SSE streaming for the Ask panel.
 *
 * Invokes the ontology retrieval runtime directly, exactly as chatAgentService
 * invokes the chat runtime: HTTPS to the AgentCore data plane, Cognito access token
 * as a Bearer, Server-Sent Events back. There is no API Gateway route in this path,
 * because the runtime carries its own Cognito JWT authorizer.
 *
 * A different runtime from the chat agent, so a different ARN. The build id and the
 * conversation id go in the body; the caller's identity does not, because the agent
 * reads it off the verified token rather than trusting anything the browser sends.
 * Prior turns do not go either — the agent reads them out of AgentCore Memory, so
 * what it is told it said is what it actually said.
 */

import { getAccessToken } from './authUtils';
import type { AgentStreamEvent } from '../types/chatbot';

const ONTOLOGY_RUNTIME_ARN = import.meta.env.VITE_ONTOLOGY_AGENT_RUNTIME_ARN;

// Extract region from Cognito User Pool ID (format: ap-southeast-2_xxx)
const USER_POOL_ID = import.meta.env.VITE_USER_POOL_ID || '';
const REGION = USER_POOL_ID.split('_')[0] || 'ap-southeast-2';

export interface AskOntologyRequest {
  buildId: string;
  question: string;
  /**
   * Which conversation this turn belongs to. Doubles as the runtime session id, so
   * one conversation keeps one warm container workspace — but it is the body value
   * that decides the transcript, since the runtime's session id has lifecycle rules
   * of its own that a two-week-old conversation must not depend on.
   */
  conversationId: string;
  onEvent?: (event: AgentStreamEvent) => void;
}

export interface AskOntologyResponse {
  answer: string;
}

/** True when the retrieval runtime's ARN was injected at build time. */
export function isOntologyChatConfigured(): boolean {
  return Boolean(ONTOLOGY_RUNTIME_ARN);
}

/**
 * Ask one question of one ontology, streaming the search as it runs.
 *
 * The onEvent callback receives every event as it arrives: `tool` events are the
 * walk itself (a dispatch, a search, a page read), `delta` events are the answer
 * being written a fragment at a time, and `message` events are each completed block
 * of it. Returns the concatenated message text once the stream ends, which is the
 * authoritative answer: deltas are for painting, and only messages are accumulated
 * here.
 */
export async function askOntology(request: AskOntologyRequest): Promise<AskOntologyResponse> {
  if (!ONTOLOGY_RUNTIME_ARN) {
    throw new Error(
      'Ontology agent runtime ARN not configured. Please set VITE_ONTOLOGY_AGENT_RUNTIME_ARN.'
    );
  }

  const accessToken = await getAccessToken();
  const encodedArn = encodeURIComponent(ONTOLOGY_RUNTIME_ARN);
  const url = `https://bedrock-agentcore.${REGION}.amazonaws.com/runtimes/${encodedArn}/invocations?qualifier=DEFAULT`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': request.conversationId,
    },
    body: JSON.stringify({
      buildId: request.buildId,
      question: request.question,
      conversationId: request.conversationId,
    }),
  });

  if (!response.ok) {
    throw new Error(`AgentCore invocation failed: ${response.status} ${response.statusText}`);
  }

  if (request.onEvent && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let answer = '';
    let buffer = '';

    try {
      for (let result = await reader.read(); !result.done; result = await reader.read()) {
        const { value } = result;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event: AgentStreamEvent = JSON.parse(line.slice(6));
              request.onEvent(event);
              if (event.type === 'message') {
                answer += (answer ? '\n\n' : '') + event.content;
              }
            } catch {
              // Skip unparseable events
            }
          }
        }
      }
      return { answer };
    } finally {
      reader.releaseLock();
    }
  }

  // Non-streaming fallback
  const data = await response.json();
  const text =
    typeof data === 'string' ? data : data?.content || data?.answer || JSON.stringify(data);
  return { answer: text };
}
