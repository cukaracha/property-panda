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
 * Saved searches are the request bodies themselves, kept so a set of filters worth
 * running twice does not have to be retyped. Each one carries the properties and
 * units it hides, because hiding belongs to the search that turned them up: the
 * page keeps the full result set and filters at render time, so unhiding puts a
 * row straight back without re-running the scrape. Bookmarks ride along the same
 * way, pinning a property to the top of every run of that search.
 *
 * The shortlist is the opposite arrangement on purpose. It belongs to the app rather
 * than to a search, so it is one collection of its own, and it stores each unit whole
 * rather than by id, so it outlives the job that found it. The always hidden list sits
 * on that side too: one collection of its own, applied to every search rather than to
 * the one that turned the item up.
 */
import type {
  AlwaysHiddenResponse,
  BookmarkedEntity,
  HiddenEntity,
  HiddenScope,
  ListSavedSearchesResponse,
  MutationResponse,
  SavedSearch,
  SearchRequest,
  SearchResultsResponse,
  SearchStatus,
  ShortlistPayload,
  ShortlistResponse,
  TriggerSearchResponse,
} from '../types/listings';

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

/**
 * Start an async scrape of the listings source. Returns the jobId (HTTP 202).
 *
 * savedSearchId names the search being re-run, when there is one. It rides beside the
 * request rather than inside it, so a saved search is still byte for byte what a fresh
 * run sends, and the server stamps that search's last run once the scrape succeeds.
 */
export async function triggerSearch(
  request: SearchRequest,
  savedSearchId?: string
): Promise<TriggerSearchResponse> {
  const response = await fetch(`${API_URL}/listings/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(savedSearchId ? { ...request, savedSearchId } : request),
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

/** List every saved search, newest first. */
export async function listSavedSearches(): Promise<ListSavedSearchesResponse> {
  const response = await fetch(`${API_URL}/listings/saved-searches`);
  const data = await readBody<ListSavedSearchesResponse>(response);
  if (!response.ok || !data) throw new Error(data?.message || 'Failed to load saved searches');
  return data;
}

/** Save one search under a name. The server mints the id, so names may repeat. */
export async function createSavedSearch(
  name: string,
  request: SearchRequest,
  hidden: HiddenEntity[],
  bookmarked: BookmarkedEntity[]
): Promise<SavedSearch> {
  const response = await fetch(`${API_URL}/listings/saved-searches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, request, hidden, bookmarked }),
  });
  const data = await readBody<SavedSearch>(response);
  if (!response.ok || !data) throw new Error(data?.message || 'Failed to save the search');
  return data;
}

/** Replace one saved search's name, request, hidden items and bookmarks. */
export async function updateSavedSearch(
  searchId: string,
  name: string,
  request: SearchRequest,
  hidden: HiddenEntity[],
  bookmarked: BookmarkedEntity[]
): Promise<SavedSearch> {
  const response = await fetch(
    `${API_URL}/listings/saved-searches/${encodeURIComponent(searchId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, request, hidden, bookmarked }),
    }
  );
  const data = await readBody<SavedSearch>(response);
  if (!response.ok || !data) throw new Error(data?.message || 'Failed to update the saved search');
  return data;
}

/**
 * Replace one saved search's hidden items, leaving its filters alone. Its own call
 * because the results screen writes it on every hide and unhide, where resending the
 * filters would mean the screen deciding what they are.
 */
export async function updateSavedSearchHidden(
  searchId: string,
  hidden: HiddenEntity[]
): Promise<SavedSearch> {
  const response = await fetch(
    `${API_URL}/listings/saved-searches/${encodeURIComponent(searchId)}/hidden`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden }),
    }
  );
  const data = await readBody<SavedSearch>(response);
  if (!response.ok || !data) throw new Error(data?.message || 'Failed to update the hidden items');
  return data;
}

/**
 * Replace one saved search's bookmarked properties, leaving its filters alone. The
 * mirror of updateSavedSearchHidden, and its own call for the same reason.
 */
export async function updateSavedSearchBookmarked(
  searchId: string,
  bookmarked: BookmarkedEntity[]
): Promise<SavedSearch> {
  const response = await fetch(
    `${API_URL}/listings/saved-searches/${encodeURIComponent(searchId)}/bookmarked`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookmarked }),
    }
  );
  const data = await readBody<SavedSearch>(response);
  if (!response.ok || !data) throw new Error(data?.message || 'Failed to update the bookmarks');
  return data;
}

/** Forget one saved search by id. */
export async function deleteSavedSearch(searchId: string): Promise<MutationResponse> {
  const response = await fetch(
    `${API_URL}/listings/saved-searches/${encodeURIComponent(searchId)}`,
    { method: 'DELETE' }
  );
  const data = await readBody<MutationResponse>(response);
  if (!response.ok || !data) throw new Error(data?.message || 'Failed to delete the saved search');
  return data;
}

/** Every shortlisted unit, already grouped into the shape a search result returns. */
export async function listShortlist(): Promise<ShortlistResponse> {
  const response = await fetch(`${API_URL}/listings/shortlist`);
  const data = await readBody<ShortlistResponse>(response);
  if (!response.ok || !data) throw new Error(data?.message || 'Failed to load the shortlist');
  return data;
}

/** Shortlist one unit, sending the listing as it stands rather than a reference. */
export async function addShortlist(payload: ShortlistPayload): Promise<ShortlistPayload> {
  const response = await fetch(`${API_URL}/listings/shortlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await readBody<ShortlistPayload>(response);
  if (!response.ok || !data) throw new Error(data?.message || 'Failed to shortlist the unit');
  return data;
}

/** Drop one unit from the shortlist by its listing id. */
export async function removeShortlist(listingId: string): Promise<MutationResponse> {
  const response = await fetch(`${API_URL}/listings/shortlist/${encodeURIComponent(listingId)}`, {
    method: 'DELETE',
  });
  const data = await readBody<MutationResponse>(response);
  if (!response.ok || !data) {
    throw new Error(data?.message || 'Failed to remove the unit from the shortlist');
  }
  return data;
}

/** Every property and unit hidden in every search, newest first. */
export async function listAlwaysHidden(): Promise<AlwaysHiddenResponse> {
  const response = await fetch(`${API_URL}/listings/hidden`);
  const data = await readBody<AlwaysHiddenResponse>(response);
  if (!response.ok || !data) {
    throw new Error(data?.message || 'Failed to load the always hidden items');
  }
  return data;
}

/** Always hide one property or unit, sending the label the results screen showed. */
export async function addAlwaysHidden(entity: HiddenEntity): Promise<HiddenEntity> {
  const response = await fetch(`${API_URL}/listings/hidden`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entity),
  });
  const data = await readBody<HiddenEntity>(response);
  if (!response.ok || !data) throw new Error(data?.message || 'Failed to always hide the item');
  return data;
}

/**
 * Stop always hiding one entity. The key goes as two path segments rather than one,
 * because it carries a `#` the browser would otherwise keep out of the request.
 */
export async function removeAlwaysHidden(
  scope: HiddenScope,
  id: string
): Promise<MutationResponse> {
  const response = await fetch(
    `${API_URL}/listings/hidden/${encodeURIComponent(scope)}/${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  );
  const data = await readBody<MutationResponse>(response);
  if (!response.ok || !data) throw new Error(data?.message || 'Failed to unhide the item');
  return data;
}
