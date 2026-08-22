import type { ButtonHTMLAttributes, Ref } from 'react';
import { Spinner } from './spinner';
import { cn } from '../../lib/utils';

type ButtonVariant = 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary' | 'link';
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

// Variants map onto the ported .btn-* classes (styles/app.css).
const variantClasses: Record<ButtonVariant, string> = {
  default: 'btn-primary',
  outline: 'btn-secondary',
  ghost: 'btn-ghost',
  destructive: 'btn-danger',
  secondary: 'btn-secondary',
  link: 'btn-ghost text-cyan',
};

// variants that sit on a saturated fill → the loading spinner ring must invert
const onBrandVariants: Record<ButtonVariant, boolean> = {
  default: true,
  secondary: false,
  destructive: false,
  outline: false,
  ghost: false,
  link: false,
};

const sizeClasses: Record<ButtonSize, string> = {
  default: '',
  sm: 'btn-sm',
  lg: 'btn-lg',
  icon: 'btn-icon',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** React 19 passes ref as a plain prop; declared so callers that need to focus
   *  a button (a dialog's primary action) can reach the element. */
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  className,
  variant = 'default',
  size = 'default',
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn('btn', variantClasses[variant], sizeClasses[size], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner size='sm' onBrand={onBrandVariants[variant]} />}
      {children}
    </button>
  );
}
