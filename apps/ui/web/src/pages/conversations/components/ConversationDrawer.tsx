import { useEffect, useState } from 'react';
import { X, Clock } from 'lucide-react';
import { Spinner } from '../../../components/ui/spinner';
import { Button } from '../../../components/ui/button';
import { listConversations } from '../../../services/chatAgentService';
import type { ConversationSummary } from '../../../services/chatAgentService';
import { cn } from '../../../lib/utils';
import { formatStartTime, groupConversations } from '../../../lib/conversationGroups';

export interface ConversationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** The session currently loaded into the page's chat (highlighted in the list). */
  activeSessionId: string;
  /** Load the picked conversation into the page's chat, in place. */
  onSelect: (sessionId: string) => void;
}

/**
 * The Conversations page's right-hand drawer: lists the signed-in user's past
 * chat sessions (newest first, grouped by relative date and labelled by start
 * time). Fetches on open; picking a row continues that conversation in place
 * without closing the drawer. Slides in from the right over a scrim.
 */
export default function ConversationDrawer({
  isOpen,
  onClose,
  activeSessionId,
  onSelect,
}: ConversationDrawerProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Fetch (or refetch) the list whenever the drawer opens or Retry bumps the key.
  // First setState lives inside the async closure so it isn't a synchronous
  // effect-body update.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await listConversations();
        if (!cancelled) setConversations(list);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load conversations');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, reloadKey]);

  // Escape closes the drawer (mirrors Modal).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  return (
    <>
      {isOpen && <div className='cb-drawer__backdrop' onClick={onClose} aria-hidden='true' />}
      <aside className={cn('cb-drawer', isOpen && 'is-open')} aria-hidden={!isOpen}>
        <div className='cb-drawer__panel'>
          <header className='cb-drawer__head'>
            <span className='cb-drawer__title'>Conversations</span>
            <button
              type='button'
              className='cb-iconbtn'
              onClick={onClose}
              aria-label='Close conversations'
              title='Close'
            >
              <X size={16} />
            </button>
          </header>

          <div className='cb-drawer__body'>
            {loading ? (
              <div className='cb-drawer__state'>
                <Spinner />
              </div>
            ) : error ? (
              <div className='cb-drawer__state'>
                <div className='cb-drawer__error'>{error}</div>
                <Button variant='outline' size='sm' onClick={() => setReloadKey(k => k + 1)}>
                  Retry
                </Button>
              </div>
            ) : conversations.length === 0 ? (
              <div className='cb-drawer__state'>
                <span className='cb-drawer__empty'>No conversations yet</span>
              </div>
            ) : (
              groupConversations(conversations).map(group => (
                <div key={group.label}>
                  <div className='cb-drawer__group'>{group.label}</div>
                  <ul className='cb-drawer__list'>
                    {group.items.map(conversation => (
                      <li key={conversation.sessionId}>
                        <button
                          type='button'
                          className={cn(
                            'cb-drawer__item',
                            conversation.sessionId === activeSessionId && 'is-active'
                          )}
                          onClick={() => onSelect(conversation.sessionId)}
                        >
                          <span className='cb-drawer__item-ic' aria-hidden='true'>
                            <Clock size={13} />
                          </span>
                          <span className='cb-drawer__item-time'>
                            {formatStartTime(conversation.createdAt)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
