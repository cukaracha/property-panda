import { useCallback, useEffect, useId } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  icon?: ReactNode;
  iconColor?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
  /**
   * When false, the modal cannot be dismissed: Escape and backdrop clicks are
   * ignored and the close (×) button is hidden. Use during an in-flight request
   * the user must not interrupt. Defaults to true.
   */
  dismissible?: boolean;
}

/**
 * Ids of every open modal, innermost last.
 *
 * Escape is listened for on `document`, so without this every open modal answers the same
 * keypress and a modal opened from inside another closes both -- taking the outer one's
 * unsaved draft with it. Only the topmost may respond.
 */
const openModals: string[] = [];

/**
 * Dark modal card (radius 20) centred over a blurred scrim. Header = accent
 * icon tile + title + description with a ghost close button; body and footer
 * follow. Styled by .modal-scrim / .modal-card (styles/app.css).
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  description,
  icon,
  iconColor = '',
  children,
  footer,
  maxWidth = 'max-w-[444px]',
  dismissible = true,
}: ModalProps) {
  const modalId = useId();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !dismissible) return;
      if (openModals[openModals.length - 1] !== modalId) return;
      onClose();
    },
    [onClose, dismissible, modalId]
  );

  useEffect(() => {
    if (!isOpen) return;
    openModals.push(modalId);
    return () => {
      const index = openModals.lastIndexOf(modalId);
      if (index !== -1) openModals.splice(index, 1);
    };
  }, [isOpen, modalId]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div className='modal-scrim' onClick={dismissible ? onClose : undefined}>
      <div className={cn('modal-card relative', maxWidth)} onClick={e => e.stopPropagation()}>
        <div className='relative px-[22px] pb-4 pt-[22px]'>
          {dismissible && (
            <button
              type='button'
              className='btn btn-icon btn-sm btn-ghost absolute right-3.5 top-3.5'
              aria-label='Close'
              onClick={onClose}
            >
              <X size={15} />
            </button>
          )}
          <div className='flex items-start gap-3.5 pr-8'>
            {icon && <div className={iconColor}>{icon}</div>}
            <div className='flex min-w-0 flex-col gap-[5px]'>
              <div className='type-ui-title text-ink'>{title}</div>
              {description && <div className='type-ui-caption leading-[1.45]'>{description}</div>}
            </div>
          </div>
        </div>
        <div className='px-[22px] pb-[22px] pt-1.5'>{children}</div>
        {footer && <div className='flex justify-end gap-2.5 px-[22px] pb-[22px]'>{footer}</div>}
      </div>
    </div>
  );
}
