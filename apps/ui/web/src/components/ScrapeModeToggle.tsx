import { AppWindow, Zap } from 'lucide-react';
import { useScrapeMode } from '../hooks/useScrapeMode';
import { cn } from '../lib/utils';

export interface ScrapeModeToggleProps {
  className?: string;
}

/**
 * The scrape transport control, arranged as a nav row the way ThemeToggle's `row`
 * variant is: an icon over the current mode's name in the rail, and a full width
 * "Scrape mode" row with a slide switch in the mobile drawer. There is no second
 * variant, because nothing outside the rail offers this.
 *
 * It names the mode it is currently IN rather than the one it would switch to, which is
 * the rule the rail already follows for Light and Dark. Both icons are picked here in
 * JSX rather than swapped by CSS, since the theme's swap keys off `data-theme` on the
 * document and there is no such attribute for this.
 */
export function ScrapeModeToggle({ className }: ScrapeModeToggleProps) {
  const { mode, isReady, toggle } = useScrapeMode();
  const isBrowser = mode === 'browser';

  return (
    <button
      type='button'
      role='switch'
      aria-checked={isBrowser}
      className={cn('nav-item', className)}
      onClick={toggle}
      disabled={!isReady}
      title={`Switch to ${isBrowser ? 'API' : 'browser'} mode`}
    >
      <span className='ni-icon'>{isBrowser ? <AppWindow size={20} /> : <Zap size={20} />}</span>
      <span className='ni-short'>{isBrowser ? 'Browser' : 'API'}</span>
      <span className='ni-label'>Scrape mode</span>
      <span className='nav-switch' aria-hidden='true'>
        <span className='nav-switch__knob' />
      </span>
    </button>
  );
}
