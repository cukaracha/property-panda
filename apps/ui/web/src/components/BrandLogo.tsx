import { APP_NAME } from '../config/app';
import { cn } from '../lib/utils';

export interface BrandLogoProps {
  className?: string;
}

/** The app's initials, for the collapsed sidebar rail. */
function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word[0]);
  return (letters.join('') || name.slice(0, 2)).slice(0, 2).toUpperCase();
}

/**
 * The app wordmark, set in type rather than shipped as artwork, so it follows
 * APP_NAME and needs no light and dark image pair. The word/mark split is what the
 * collapsed sidebar rail swaps between (see app.css).
 */
export function BrandLogo({ className }: BrandLogoProps) {
  return (
    <span className={cn('brand-logo', className)}>
      <span className='brand-logo__word'>{APP_NAME}</span>
      <span className='brand-logo__mark' aria-hidden='true'>
        {initials(APP_NAME)}
      </span>
    </span>
  );
}
