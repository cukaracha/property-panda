/**
 * Profile service — the Claude subscription token the assistant runs on.
 *
 * Every chat turn runs on the token stored here, so one has to be saved before the
 * assistant can answer. GET never returns the token itself, only whether one is
 * configured, when it was saved, and its last four characters; PUT with an empty
 * string removes it.
 */

const API_URL = import.meta.env.VITE_LISTINGS_API_URL || 'http://localhost:8000';

export interface ClaudeTokenStatus {
  configured: boolean;
  updatedAt: string | null;
  maskedSuffix: string | null;
}

/** Read whether a Claude token is saved (never the token itself). */
export async function getClaudeTokenStatus(): Promise<ClaudeTokenStatus> {
  const response = await fetch(`${API_URL}/profile/claude-token`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to read Claude token status');
  return data;
}

/** Save the Claude token. An empty token removes the stored one. */
export async function putClaudeToken(token: string): Promise<ClaudeTokenStatus> {
  const response = await fetch(`${API_URL}/profile/claude-token`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to save Claude token');
  return data;
}
