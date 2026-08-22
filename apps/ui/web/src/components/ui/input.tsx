import type { InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/** Text input styled by the ported .input class (styles/app.css). */
export function Input({ className, type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type={type} className={cn('input', className)} {...props} />;
}
