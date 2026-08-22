/**
 * Centralized authentication utilities: a single source of truth for the auth
 * header and authenticated fetches, with short-term caching of the token.
 */

import { fetchAuthSession } from 'aws-amplify/auth';

const HEADER_CACHE_TTL_MS = 30000; // 30s — balance freshness vs. redundant session fetches

// Refresh the access token when it has less than this much life left. The token is
// forwarded across multiple hops (chat → A2A subagent → MCP gateway), each of which
// re-validates it, and AgentCore rejects tokens with <60s remaining ("ineffectual
// token"). Refresh well ahead of that so every hop sees a comfortably-fresh token.
const ACCESS_TOKEN_MIN_TTL_SECONDS = 15 * 60; // 15 min

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

let cachedHeaders: Record<string, string> | null = null;
let cacheExpiry = 0;

export function clearAuthHeadersCache(): void {
  cachedHeaders = null;
  cacheExpiry = 0;
}

/**
 * Get the Cognito access token directly.
 *
 * Unlike getAuthHeaders() which returns the id token for API Gateway, this
 * returns the access token needed for services like Bedrock AgentCore that
 * require Bearer auth with an access token.
 */
export async function getAccessToken(): Promise<string> {
  let session = await fetchAuthSession();
  let accessToken = session.tokens?.accessToken;

  // Proactively refresh if the token is close to expiry. Amplify only auto-refreshes
  // once the token has actually expired, so without this it can hand back a token with
  // seconds of life left — which dies partway through the multi-hop forward chain.
  const exp = accessToken?.payload?.exp; // epoch seconds
  const secondsLeft = exp ? exp - Date.now() / 1000 : 0;
  if (!accessToken || secondsLeft < ACCESS_TOKEN_MIN_TTL_SECONDS) {
    session = await fetchAuthSession({ forceRefresh: true }); // mint a fresh ~60-min token
    accessToken = session.tokens?.accessToken;
  }

  const token = accessToken?.toString();
  if (!token) {
    throw new AuthenticationError('No access token available');
  }
  return token;
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  if (cachedHeaders && Date.now() < cacheExpiry) {
    return cachedHeaders;
  }

  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();

  if (!token) {
    throw new AuthenticationError('No authentication token available');
  }

  // The REST API Gateway Cognito authorizer treats the entire Authorization
  // header value as the JWT, so the raw ID token is sent with no "Bearer "
  // prefix. The ID token (not the access token) is used because given_name /
  // family_name claims live only on the ID token.
  cachedHeaders = {
    Authorization: token,
    'Content-Type': 'application/json',
  };
  cacheExpiry = Date.now() + HEADER_CACHE_TTL_MS;

  return cachedHeaders;
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = await getAuthHeaders();

  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {}),
    },
  });

  // Force a fresh token on the next attempt if the session has expired.
  if (response.status === 401) {
    clearAuthHeadersCache();
  }

  return response;
}
