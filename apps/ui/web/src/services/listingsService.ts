/**
 * Listings service - the PropertyGuru scraper's async pipeline (client side).
 *
 * Talks to the local server on this machine.
 *
 * Flow: triggerSearch (202 + jobId) -> poll getSearchResults until the job is
 * succeeded or failed. There is deliberately no separate status endpoint:
 * getSearchResults is both the poll and the fetch, and its `properties` array
 * is only populated once status is 'succeeded'.
 *
 * Hidden properties and units are a separate, reversible server-side list. The
 * page applies it at render time over the full result set, so unhiding puts a
 * row straight back without re-running the scrape.
 */
import type {
  HiddenMutationResponse,
  HiddenScope,
  ListHiddenResponse,
  SearchRequest,
  SearchResultsResponse,
  SearchStatus,
  TriggerSearchResponse,
} from '../pages/propertySearch/types/listings';

/**
 * The local API (apps/local/property_search). It runs on this machine because the scrape
 * needs a real, visible browser window: the source sits behind a Cloudflare challenge
 * that only clears for a genuine browser, and that sometimes means a person clicking in
 * it. There is no Authorization header because there is nothing to authenticate against:
 * the server listens on loopback and serves one person.
 */
const API_URL = import.meta.env.VITE_LISTINGS_API_URL || 'http://localhost:8000';

/** Terminal states for the search poller. */
export const SEARCH_TERMINAL: SearchStatus[] = ['succeeded', 'failed'];

/**
 * Read a response body without assuming it is JSON. A gateway 502/504 answers
 * with HTML, so parsing before the ok check turns a transient outage into a
 * raw SyntaxError instead of the caller's own message.
 */
async function readBody<T>(response: Response): Promise<(T & { message?: string }) | null> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Start an async scrape of the listings source. Returns the jobId (HTTP 202). */
export async function triggerSearch(request: SearchRequest): Promise<TriggerSearchResponse> {
  const response = await fetch(`${API_URL}/listings/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const data = await readBody<TriggerSearchResponse>(response);
  if (!response.ok || !data) throw new Error(data?.message || 'Failed to start the search');
  return data;
}

/** Fetch a search job's status and, once it has succeeded, its full results. */
export async function getSearchResults(jobId: string): Promise<SearchResultsResponse> {
  const response = await fetch(`${API_URL}/listings/results?jobId=${encodeURIComponent(jobId)}`);
  const data = await readBody<SearchResultsResponse>(response);
  if (!response.ok || !data) throw new Error(data?.message || 'Failed to get the search results');
  return data;
}

/** List every property and unit the user has hidden. */
export async function listHidden(): Promise<ListHiddenResponse> {
  const response = await fetch(`${API_URL}/listings/hidden`);
  const data = await readBody<ListHiddenResponse>(response);
  if (!response.ok || !data) throw new Error(data?.message || 'Failed to load hidden items');
  return data;
}

/** Hide a property or a single unit. The label is kept for the hidden panel. */
export async function hideEntity(
  scope: HiddenScope,
  id: string,
  label: string
): Promise<HiddenMutationResponse> {
  const response = await fetch(`${API_URL}/listings/hidden`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, id, label }),
  });
  const data = await readBody<HiddenMutationResponse>(response);
  if (!response.ok || !data) throw new Error(data?.message || 'Failed to hide the item');
  return data;
}

/** Unhide by entity key (`property#<id>` or `unit#<id>`). */
export async function unhideEntity(entityKey: string): Promise<HiddenMutationResponse> {
  const response = await fetch(`${API_URL}/listings/hidden/${encodeURIComponent(entityKey)}`, {
    method: 'DELETE',
  });
  const data = await readBody<HiddenMutationResponse>(response);
  if (!response.ok || !data) throw new Error(data?.message || 'Failed to unhide the item');
  return data;
}
