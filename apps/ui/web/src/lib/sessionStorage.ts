/**
 * Per-surface chat session-id persistence.
 *
 * A conversation lives server-side, keyed by its session id, so the only thing a
 * reload has to recover is which session it was.
 *
 * Gated on a key so ephemeral surfaces (no key) never touch storage, and wrapped
 * in try/catch because private-mode and quota-exceeded both throw.
 */

export const readPersistedSessionId = (key?: string): string | null => {
  if (!key) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writePersistedSessionId = (key: string | undefined, id: string): void => {
  if (!key) return;
  try {
    localStorage.setItem(key, id);
  } catch {
    // Storage unavailable — fall back to ephemeral (in-memory) behavior.
  }
};
