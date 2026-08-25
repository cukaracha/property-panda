import { useCallback, useEffect, useId, useRef } from 'react';
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
   * Gives the card all the height it is allowed instead of letting it shrink-wrap its
   * content, and stops the body scrolling so the content can size itself against the
   * space. Use where the content wants the room, e.g. a map. Defaults to false.
   */
  fillHeight?: boolean;
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
 * Card (radius 20) centred over a blurred scrim, with dialog semantics: it is a
 * labelled `dialog`, focus moves into it on open (the first field where there is
 * one, the card otherwise) and returns to whatever opened it on close. The body
 * scrolls under a header and footer that do not, so a tall form never pushes its
 * actions off screen. Styled by .modal-scrim / .modal-card (styles/app.css).
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
  maxWidth = 'max-w-[468px]',
  fillHeight = false,
  dismissible = true,
}: ModalProps) {
  const modalId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

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

  // Focus moves into the card on open and back to the opener on close, so a
  // keyboard user is never left behind the scrim or dropped at the page top.
  useEffect(() => {
    if (!isOpen) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    const firstField = card?.querySelector<HTMLElement>(
      'input:not([type="hidden"]), select, textarea'
    );
    (firstField ?? card)?.focus();
    return () => {
      openerRef.current?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className='modal-scrim' onClick={dismissible ? onClose : undefined}>
      <div
        ref={cardRef}
        role='dialog'
        aria-modal='true'
        aria-label={title}
        tabIndex={-1}
        className={cn('modal-card relative', fillHeight && 'modal-card--fill', maxWidth)}
        onClick={e => e.stopPropagation()}
      >
        <div className='modal-head relative px-[22px] pb-4 pt-[22px]'>
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
              <div className='type-ui-title text-strong'>{title}</div>
              {description && <div className='type-ui-caption'>{description}</div>}
            </div>
          </div>
        </div>
        <div className='modal-body px-[22px] pb-[22px] pt-1.5'>{children}</div>
        {footer && (
          <div className='modal-foot flex justify-end gap-2.5 px-[22px] pb-[22px]'>{footer}</div>
        )}
      </div>
    </div>
  );
}
