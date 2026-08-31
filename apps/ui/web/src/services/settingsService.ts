/**
 * Settings service - which transport a scrape reads the pages through.
 *
 * `api` reads PropertyGuru over plain HTTP and pays the unlocker for the page shapes
 * Cloudflare refuses, which needs nobody watching. `browser` drives a visible Chrome
 * window, which is free but asks the user to clear a challenge when one appears.
 *
 * The setting belongs to the machine rather than to a search, because it picks how pages
 * are fetched and nothing else: a search run in one mode and re-run in the other returns
 * the same thing. So nothing about a job, a saved search or a result records which
 * transport read it, and this is the only place in the SPA that knows the mode exists.
 */

const API_URL = import.meta.env.VITE_LISTINGS_API_URL || 'http://localhost:8000';

export type ScrapeMode = 'api' | 'browser';

export interface ScrapeModeResponse {
  mode: ScrapeMode;
}

/** Read the transport the next scrape will run on. */
export async function getScrapeMode(): Promise<ScrapeModeResponse> {
  const response = await fetch(`${API_URL}/settings/scrape-mode`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to read the scrape mode');
  return data;
}

/** Choose the transport every later scrape runs on. A run in flight is unaffected. */
export async function putScrapeMode(mode: ScrapeMode): Promise<ScrapeModeResponse> {
  const response = await fetch(`${API_URL}/settings/scrape-mode`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to save the scrape mode');
  return data;
}
