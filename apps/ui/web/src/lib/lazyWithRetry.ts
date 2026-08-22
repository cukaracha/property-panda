import { lazy, type ComponentType } from 'react';

// One-shot guard so a genuinely-missing chunk can never loop the page. Scoped to
// the tab (sessionStorage), cleared on any successful lazy load.
const RELOAD_FLAG = 'lazy-chunk-reload';

/**
 * `React.lazy` with recovery for a dynamic import that fails to load. After a
 * redeploy the old hashed chunk is pruned from S3, so a tab still running the
 * previous shell requests a chunk that 404s (and the SPA fallback serves
 * index.html as text/html) — the import rejects and, with no error boundary,
 * blanks the app. Here we reload once to pull a fresh index.html + current chunk
 * hashes; if the load still fails after that single reload, the error is rethrown
 * so an <ErrorBoundary> can show a friendly message instead of looping.
 */
export function lazyWithRetry<P>(factory: () => Promise<{ default: ComponentType<P> }>) {
  return lazy(async () => {
    try {
      const mod = await factory();
      sessionStorage.removeItem(RELOAD_FLAG);
      return mod;
    } catch (error) {
      if (!sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, '1');
        window.location.reload();
        // Hang while the page navigates away, so no fallback flashes first.
        return new Promise<never>(() => {});
      }
      throw error;
    }
  });
}
