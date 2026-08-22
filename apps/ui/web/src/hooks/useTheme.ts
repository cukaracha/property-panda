/**
 * useTheme — read/toggle the light/dark theme.
 *
 * The source of truth is the `data-theme` attribute on <html>, set before first
 * paint by the no-flash inline script in index.html. This hook subscribes to that
 * attribute via a MutationObserver (so any writer — the toggle, another tab's
 * storage event — keeps every component in sync) using useSyncExternalStore, and
 * persists the choice under APP_THEME_KEY. Default is light.
 */
import { useSyncExternalStore, useCallback } from 'react';
import { APP_THEME_KEY } from '../config/app';

export type Theme = 'light' | 'dark';

function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function subscribe(onStoreChange: () => void): () => void {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });

  // Cross-tab sync: another tab wrote the choice — mirror it onto this document,
  // which trips the observer above and re-renders subscribers.
  const onStorage = (e: StorageEvent) => {
    if (e.key === APP_THEME_KEY && e.newValue) {
      document.documentElement.setAttribute(
        'data-theme',
        e.newValue === 'light' ? 'light' : 'dark'
      );
    }
  };
  window.addEventListener('storage', onStorage);

  return () => {
    observer.disconnect();
    window.removeEventListener('storage', onStorage);
  };
}

export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(APP_THEME_KEY, theme);
  } catch {
    // persistence is best-effort
  }
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => 'light' as Theme);
  const toggle = useCallback(() => {
    setTheme(currentTheme() === 'light' ? 'dark' : 'light');
  }, []);
  return { theme, setTheme, toggle };
}
