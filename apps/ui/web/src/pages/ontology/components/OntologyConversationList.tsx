import { useEffect } from 'react';
import { Clock } from 'lucide-react';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Spinner } from '../../../components/ui/spinner';
import { cn } from '../../../lib/utils';
import { formatStartTime, groupConversations } from '../../../lib/conversationGroups';
import type { OntologyConversationSummary } from '../../../services/ontologyService';

interface OntologyConversationListProps {
  /** null while loading — the convention the rest of this page uses for a pending list. */
  conversations: OntologyConversationSummary[] | null;
  error: string | null;
  activeSessionId: string;
  disabled: boolean;
  onSelect: (sessionId: string) => void;
  onRefresh: () => void;
}

/**
 * Past conversations about the open ontology, grouped by relative date and
 * labelled by start time.
 *
 * Purely presentational: the list lives in the page's hook, because a turn that
 * creates a new session completes there and has to reconcile it. Refreshing on
 * mount is what guarantees a just-finished conversation appears the first time
 * the user opens this.
 *
 * Reuses the drawer's row classes (styles/app-chat.css) — those carry no
 * positioning, unlike `.cb-drawer` itself, so they drop into the rail cleanly.
 * Fills its parent, which owns the rail's width and frame.
 */
export default function OntologyConversationList({
  conversations,
  error,
  activeSessionId,
  disabled,
  onSelect,
  onRefresh,
}: OntologyConversationListProps) {
  useEffect(() => {
    onRefresh();
    // Refresh on open only — the parent mounts this when History is toggled on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className='min-h-0 flex-1 overflow-y-auto px-2 py-2'>
      {/* Error first: a failed listing leaves conversations null as well, and testing
          null first would spin forever on a request that already came back. */}
      {error ? (
        <div className='flex flex-col items-center gap-3 py-8'>
          <div className='cb-drawer__error'>{error}</div>
          <Button variant='outline' size='sm' onClick={onRefresh}>
            Retry
          </Button>
        </div>
      ) : conversations === null ? (
        <div className='flex items-center justify-center py-8'>
          <Spinner />
        </div>
      ) : conversations.length === 0 ? (
        <div className='flex items-center justify-center py-8'>
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
                    disabled={disabled}
                    className={cn(
                      'cb-drawer__item',
                      conversation.sessionId === activeSessionId && 'is-active',
                      disabled && 'cursor-not-allowed opacity-60'
                    )}
                    onClick={() => onSelect(conversation.sessionId)}
                  >
                    <span className='cb-drawer__item-ic' aria-hidden='true'>
                      <Clock size={13} />
                    </span>
                    <span className='cb-drawer__item-time'>
                      {formatStartTime(conversation.createdAt)}
                    </span>
                    {conversation.sessionId === activeSessionId && (
                      <Badge tone='brand' className='ml-auto'>
                        Current
                      </Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
