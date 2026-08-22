import { useTheme } from '../hooks/useTheme';
import { cn } from '../lib/utils';

export interface ThemeToggleProps {
  /** Pin the button top-right for full-bleed pages with no header to hold it. */
  floating?: boolean;
  /**
   * `'button'` (default) is the self-contained icon button. `'row'` renders a
   * full-width nav-style row — icon + "Dark mode" label + slide switch — for the
   * sidebar footer, where the switch (not the icon) is the affordance.
   */
  variant?: 'button' | 'row';
  className?: string;
}

const SunIcon = (
  <svg className='ico ti-sun' viewBox='0 0 24 24' aria-hidden='true'>
    <circle cx='12' cy='12' r='4.2' />
    <path d='M12 2.6v2.3M12 19.1v2.3M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.6 12h2.3M19.1 12h2.3M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6' />
  </svg>
);

const MoonIcon = (
  <svg className='ico ti-moon' viewBox='0 0 24 24' aria-hidden='true'>
    <path d='M20.5 13.4A8 8 0 1 1 10.6 3.5a6.3 6.3 0 0 0 9.9 9.9z' />
  </svg>
);

/**
 * Light/dark theme control. The default `'button'` variant is a self-contained
 * icon button that shows the SUN while dark (tap to go light) and the MOON while
 * light (tap to go dark). The `'row'` variant is a full-width sidebar row whose
 * icon reflects the CURRENT mode (moon while dark, sun while light) beside a
 * "Dark mode" label and a slide switch. Either way the CSS swap block in app.css
 * picks which SVG is visible from the active `data-theme`. Add `floating` on
 * full-bleed pages (login, Home chat).
 */
export function ThemeToggle({ floating, variant = 'button', className }: ThemeToggleProps) {
  const { theme, toggle } = useTheme();
  const next = theme === 'light' ? 'dark' : 'light';

  if (variant === 'row') {
    return (
      <button
        type='button'
        role='switch'
        aria-checked={theme === 'dark'}
        className={cn('nav-item', 'theme-row', className)}
        onClick={toggle}
        title={`Switch to ${next} theme`}
      >
        <span className='ni-icon'>
          {SunIcon}
          {MoonIcon}
        </span>
        <span className='ni-label'>Dark mode</span>
        <span className='theme-switch' aria-hidden='true'>
          <span className='theme-switch__knob' />
        </span>
      </button>
    );
  }

  return (
    <button
      type='button'
      className={cn('theme-toggle', floating && 'is-floating', className)}
      onClick={toggle}
      aria-pressed={theme === 'light'}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {SunIcon}
      {MoonIcon}
    </button>
  );
}
