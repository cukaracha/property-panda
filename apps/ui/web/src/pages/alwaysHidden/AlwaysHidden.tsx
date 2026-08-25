import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Spinner } from '../../components/ui/spinner';
import HiddenEntityList from '../../components/property/HiddenEntityList';
import UnhideConfirmModal from '../../components/property/UnhideConfirmModal';
import { useAlwaysHidden } from '../../hooks/useAlwaysHidden';
import { useAlwaysHiddenPageContext } from './PageContext';
import type { HiddenEntity } from '../../types/listings';

/**
 * Always hidden - what the user has chosen to leave out of every search.
 *
 * The counterpart to the hidden items panel on the results screen, which only ever
 * covers the search in front of it. This list belongs to the app, so unhiding something
 * here brings it back everywhere at once.
 *
 * Rows rather than property cards, because an always hidden entry stores only the label
 * it was hidden under. There is nothing to re-scrape and nothing to price: the point of
 * the record is to name what to leave out and to let the user recognise it later. One
 * table rather than a group per kind: the scope column carries what the groups did, and
 * here every row reads the same because everything on this page is app-wide.
 *
 * Unhiding asks first, and says in the asking that it brings the item back everywhere.
 * That warning used to be a footnote under the table, which is a line nobody reads at
 * the moment they need it.
 *
 * Nothing can be added from here. An item joins the list from the search results, where
 * the property or the row it names is actually on screen.
 */
export default function AlwaysHidden() {
  const { alwaysHidden, isLoading, error, unhideAlways } = useAlwaysHidden();
  const [pendingUnhide, setPendingUnhide] = useState<HiddenEntity | null>(null);

  useAlwaysHiddenPageContext(
    { entities: alwaysHidden, isLoading, errorMessage: error },
    { onUnhide: unhideAlways }
  );

  return (
    <div className='page-scroll'>
      <div className='mx-auto max-w-[1080px] space-y-6 px-6 pb-24 pt-10'>
        <div>
          <h1 className='type-ui-h1 text-strong'>Always hidden</h1>
          <p className='type-ui-caption mt-1'>
            {alwaysHidden.length} {alwaysHidden.length === 1 ? 'item' : 'items'} left out of every
            search.
          </p>
        </div>

        {error && <p className='text-sm text-danger'>{error}</p>}

        {isLoading ? (
          <Card className='flex items-center justify-center p-10'>
            <Spinner />
          </Card>
        ) : alwaysHidden.length === 0 ? (
          <Card className='p-10 text-center'>
            <p className='type-ui-title text-strong'>Nothing is always hidden</p>
            <p className='type-ui-sm mt-1 text-muted'>
              Hide a property or a unit from the search results and tick always hide to keep it out
              of every search.
            </p>
            <Link to='/search' className='btn btn-secondary btn-sm mt-4'>
              <Search size={16} />
              Go to the property search
            </Link>
          </Card>
        ) : (
          <Card className='p-5'>
            <HiddenEntityList
              rows={alwaysHidden.map(entity => ({
                entity,
                scopeLabel: 'Every search',
                onUnhide: () => setPendingUnhide(entity),
              }))}
              emptyMessage='Nothing is hidden from every search.'
            />
          </Card>
        )}
      </div>

      <UnhideConfirmModal
        pending={pendingUnhide}
        isAlways
        onClose={() => setPendingUnhide(null)}
        onConfirm={async () => {
          if (pendingUnhide) await unhideAlways(pendingUnhide.entityKey);
        }}
      />
    </div>
  );
}
