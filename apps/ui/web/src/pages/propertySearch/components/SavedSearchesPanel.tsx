import type { KeyboardEvent } from 'react';
import { Card } from '../../../components/ui/card';
import { Spinner } from '../../../components/ui/spinner';
import SavedSearchMenu from './SavedSearchMenu';
import type { SavedSearch } from '../../../types/listings';
import { describeFilters, toFilterForm } from '../utils/filterOptions';
import { formatLastRun } from '../utils/lastRun';
import { cn } from '../../../lib/utils';

export interface SavedSearchesPanelProps {
  savedSearches: SavedSearch[];
  isLoading: boolean;
  error: string;
  /** The one being started, so only its row shows the spinner. */
  runningSearchId: string | null;
  isStarting: boolean;
  onRun: (search: SavedSearch) => void;
  onEdit: (search: SavedSearch) => void;
  onDelete: (search: SavedSearch) => void;
}

function describeLists(search: SavedSearch): string {
  const parts = [];
  const hiddenCount = search.hidden.length;
  const bookmarkedCount = search.bookmarked.length;
  if (hiddenCount) parts.push(hiddenCount === 1 ? '1 item hidden' : `${hiddenCount} items hidden`);
  if (bookmarkedCount) parts.push(`${bookmarkedCount} bookmarked`);
  return parts.join(', ');
}

/**
 * The searches kept for re-running, newest first.
 *
 * The row itself runs the search and lands on the results, following the clickable row
 * in DataTable: reachable by keyboard, with the menu beside it stopping its own clicks
 * from reaching the row. Every row is disabled while one is starting, because the
 * scraper drives a single browser and runs one scrape at a time.
 */
export default function SavedSearchesPanel({
  savedSearches,
  isLoading,
  error,
  runningSearchId,
  isStarting,
  onRun,
  onEdit,
  onDelete,
}: SavedSearchesPanelProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLLIElement>, search: SavedSearch) => {
    if (isStarting) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRun(search);
    }
  };

  return (
    <Card className='p-5'>
      <h2 className='type-ui-h3 text-strong'>Saved searches</h2>

      {error && <p className='mt-2 text-sm text-danger'>{error}</p>}

      {isLoading ? (
        <div className='flex items-center gap-2 py-6 text-muted'>
          <Spinner size='sm' />
          <p className='text-sm'>Loading saved searches</p>
        </div>
      ) : savedSearches.length === 0 ? (
        <p className='type-ui-sm mt-2 text-muted'>
          Nothing saved yet. Run a search, then press "Save search" on the results to keep its
          filters here.
        </p>
      ) : (
        <>
          <p className='type-ui-sm mt-1 text-muted'>Click one to run it again.</p>
          <ul className='mt-4 divide-y divide-line-2 border-y border-line'>
            {savedSearches.map(search => {
              const listSummary = describeLists(search);
              return (
                <li
                  key={search.searchId}
                  className={cn(
                    'flex items-center justify-between gap-3 px-2 py-3 transition-colors',
                    isStarting
                      ? 'opacity-60'
                      : 'cursor-pointer hover:bg-sunken focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none'
                  )}
                  role='link'
                  tabIndex={isStarting ? -1 : 0}
                  aria-label={`Run ${search.name}`}
                  onClick={() => !isStarting && onRun(search)}
                  onKeyDown={event => handleKeyDown(event, search)}
                >
                  <div className='min-w-0'>
                    <p className='truncate text-sm text-body'>{search.name}</p>
                    <p className='type-ui-sm truncate text-muted'>
                      {describeFilters(toFilterForm(search))}
                      {listSummary && ` (${listSummary})`}
                    </p>
                    <p className='type-ui-sm truncate text-muted'>
                      {formatLastRun(search.lastRunAt)}
                    </p>
                  </div>
                  <div className='flex flex-shrink-0 items-center gap-1'>
                    {runningSearchId === search.searchId && <Spinner size='sm' />}
                    <SavedSearchMenu
                      searchName={search.name}
                      onEdit={() => onEdit(search)}
                      onDelete={() => onDelete(search)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
