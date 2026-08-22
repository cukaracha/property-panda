import { cn } from '../lib/utils';

export interface BrandLogoProps {
  className?: string;
}

/**
 * The JustifyAI brand mark. Renders the full wordmark lockup by default and a
 * compact icon-only mark for the collapsed sidebar rail; each group carries a
 * light and dark PNG that the CSS swap in app.css picks from the active
 * `data-theme` (white on dark, black on light), mirroring the ThemeToggle swap.
 * Height is set by the surrounding context (sidebar / auth / loading).
 */
export function BrandLogo({ className }: BrandLogoProps) {
  return (
    <span className={cn('brand-logo', className)}>
      <span className='brand-logo__word'>
        <img
          className='brand-logo-img is-dark'
          src='/logo-name/justifyai-logo-name-white.png'
          alt='JustifyAI'
        />
        <img
          className='brand-logo-img is-light'
          src='/logo-name/justifyai-logo-name-black.png'
          alt=''
          aria-hidden='true'
        />
      </span>
      <span className='brand-logo__mark' aria-hidden='true'>
        <img className='brand-logo-img is-dark' src='/logo-name/Logo-White.png' alt='' />
        <img className='brand-logo-img is-light' src='/logo-name/Logo-Black.png' alt='' />
      </span>
    </span>
  );
}
