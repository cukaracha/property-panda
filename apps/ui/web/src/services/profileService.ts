/**
 * Profile service — the signed-in user's own Claude subscription token.
 *
 * The ontology agent runs every build on the token stored here, so a user must
 * save one before starting a build. GET never returns the token itself, only
 * whether one is configured, when it was saved, and its last four characters;
 * PUT with an empty string removes it.
 */
import { authFetch } from './authUtils';

const API_URL = import.meta.env.VITE_API_URL;

export interface ClaudeTokenStatus {
  configured: boolean;
  updatedAt: string | null;
  maskedSuffix: string | null;
}

/** Read whether the caller has a Claude token saved (never the token itself). */
export async function getClaudeTokenStatus(): Promise<ClaudeTokenStatus> {
  const response = await authFetch(`${API_URL}/profile/claude-token`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to read Claude token status');
  return data;
}

/** Save the caller's Claude token. An empty token removes the stored one. */
export async function putClaudeToken(token: string): Promise<ClaudeTokenStatus> {
  const response = await authFetch(`${API_URL}/profile/claude-token`, {
    method: 'PUT',
    body: JSON.stringify({ token }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to save Claude token');
  return data;
}
