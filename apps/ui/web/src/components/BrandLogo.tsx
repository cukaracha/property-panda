import { APP_NAME } from '../config/app';
import { cn } from '../lib/utils';

export interface BrandLogoProps {
  className?: string;
}

/**
 * The brand lockup: the panda mark beside the wordmark. The mark is the same
 * artwork the favicon and the web manifest use, so there is one image to keep;
 * the wordmark follows APP_NAME and is never a literal. The rail shows the mark
 * alone and the mobile drawer shows both (see app.css).
 */
export function BrandLogo({ className }: BrandLogoProps) {
  return (
    <span className={cn('brand-logo', className)}>
      <img
        className='pp-brand-mark'
        src='/icons/web-app-manifest-512x512.png'
        alt=''
        width={44}
        height={44}
      />
      <span className='brand-logo__word'>{APP_NAME}</span>
    </span>
  );
}
