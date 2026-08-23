import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Spinner } from '../../components/ui/spinner';
import HiddenEntityList from '../../components/property/HiddenEntityList';
import { useAlwaysHidden } from '../../hooks/useAlwaysHidden';
import { useAlwaysHiddenPageContext } from './PageContext';
import type { HiddenScope } from '../../types/listings';

const GROUPS: { scope: HiddenScope; title: string; empty: string }[] = [
  {
    scope: 'property',
    title: 'Properties',
    empty: 'No properties are hidden from every search.',
  },
  { scope: 'unit', title: 'Units', empty: 'No units are hidden from every search.' },
];

/**
 * Always hidden - what the user has chosen to leave out of every search.
 *
 * The counterpart to the hidden items panel on the results screen, which only ever
 * covers the search in front of it. This list belongs to the app, so unhiding something
 * here brings it back everywhere at once.
 *
 * Rows rather than property cards, because an always hidden entry stores only the label
 * it was hidden under. There is nothing to re-scrape and nothing to price: the point of
 * the record is to name what to leave out and to let the user recognise it later.
 *
 * Nothing can be added from here. An item joins the list from the search results, where
 * the property or the row it names is actually on screen.
 */
export default function AlwaysHidden() {
  const { alwaysHidden, isLoading, error, unhideAlways } = useAlwaysHidden();

  useAlwaysHiddenPageContext(
    { entities: alwaysHidden, isLoading, errorMessage: error },
    { onUnhide: unhideAlways }
  );

  return (
    <div className='mx-auto max-w-5xl space-y-5 p-6'>
      <div>
        <h1 className='type-ui-h2 text-ink'>Always hidden</h1>
        <p className='type-ui-caption mt-1'>
          {alwaysHidden.length} {alwaysHidden.length === 1 ? 'item' : 'items'} left out of every
          search.
        </p>
      </div>

      {error && <p className='text-sm text-rose'>{error}</p>}

      {isLoading ? (
        <Card className='flex items-center justify-center p-10'>
          <Spinner />
        </Card>
      ) : alwaysHidden.length === 0 ? (
        <Card className='p-10 text-center'>
          <p className='type-ui-title text-ink'>Nothing is always hidden</p>
          <p className='type-ui-sm mt-1 text-ink-3'>
            Hide a property or a unit from the search results and tick always hide to keep it out of
            every search.
          </p>
          <Link to='/search' className='btn btn-secondary btn-sm mt-4'>
            <Search size={16} />
            Go to the property search
          </Link>
        </Card>
      ) : (
        <div className='space-y-4'>
          {GROUPS.map(group => (
            <Card key={group.scope} className='p-5'>
              <h2 className='type-ui-h3 text-ink'>{group.title}</h2>
              <div className='mt-4'>
                <HiddenEntityList
                  entities={alwaysHidden.filter(entity => entity.scope === group.scope)}
                  onUnhide={unhideAlways}
                  emptyMessage={group.empty}
                />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
