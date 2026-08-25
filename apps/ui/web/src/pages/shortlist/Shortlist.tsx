import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Spinner } from '../../components/ui/spinner';
import PropertyCard from '../../components/property/PropertyCard';
import UnshortlistConfirmModal from '../../components/property/UnshortlistConfirmModal';
import { useShortlist } from '../../hooks/useShortlist';
import { useShortlistPageContext } from './PageContext';
import { formatSavedOn } from './utils/savedOn';
import type { PendingUnshortlist } from '../../types/listings';

/**
 * Shortlist - every unit the user has hearted, laid out the way the results are.
 *
 * The server groups the stored snapshots into the same property shape a search
 * returns, so this renders through the same card and nothing here knows that its
 * properties came out of a file rather than a scrape.
 *
 * There is no hiding on this screen. A shortlist is already the list of what the
 * user chose to keep, so the way to take something off it is the heart that put it
 * there, and PropertyCard drops the hide affordances when no handler is passed. Every
 * heart here is filled, so the only thing it can do is remove, and it confirms first:
 * the row it would need to put the unit back is the row that just disappeared.
 *
 * Each card says when it was saved, because a snapshot is frozen at heart time and
 * never re-scraped: the price on screen is the price it was, not the price it is.
 */
export default function Shortlist() {
  const { properties, shortlistedIds, propertyCount, unitCount, isLoading, error, remove } =
    useShortlist();

  const [pendingUnshortlist, setPendingUnshortlist] = useState<PendingUnshortlist | null>(null);

  const confirmUnshortlist = async () => {
    if (!pendingUnshortlist) return;
    await remove(String(pendingUnshortlist.row.listingId));
  };

  useShortlistPageContext(
    { properties, propertyCount, unitCount, isLoading, errorMessage: error },
    { onRemoveFromShortlist: remove }
  );

  // The modal sits outside the column for the same reason it does on the results
  // screen: its scrim is fixed with inset 0, and a stacked sibling's margin would push
  // it down and leave a strip of page uncovered.
  return (
    <>
      <div className='page-scroll'>
        <div className='mx-auto max-w-[1080px] space-y-6 px-6 pb-24 pt-10'>
          <div>
            <h1 className='type-ui-page-title text-strong'>Shortlist</h1>
            <p className='type-ui-caption mt-1'>
              {unitCount} {unitCount === 1 ? 'unit' : 'units'} across {propertyCount}{' '}
              {propertyCount === 1 ? 'property' : 'properties'}.
            </p>
          </div>

          {error && <p className='text-sm text-danger'>{error}</p>}

          {isLoading ? (
            <Card className='flex items-center justify-center px-6 py-16'>
              <Spinner />
            </Card>
          ) : properties.length === 0 ? (
            <Card className='px-6 py-16 text-center'>
              <p className='type-ui-title text-strong'>Nothing shortlisted yet</p>
              <p className='type-ui-sm mt-1 text-muted'>
                Run a search and click the heart on any unit to keep it here.
              </p>
              <Link to='/search' className='btn btn-secondary btn-sm mt-4'>
                <Heart size={16} />
                Go to the property search
              </Link>
            </Card>
          ) : (
            <div className='space-y-4'>
              {properties.map(property => (
                <PropertyCard
                  key={property.propertyId}
                  property={property}
                  shortlistedIds={shortlistedIds}
                  onToggleShortlist={(property, row) => setPendingUnshortlist({ property, row })}
                  caption={formatSavedOn(property.shortlistedAt)}
                  emptyMessage='No units left in this property.'
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <UnshortlistConfirmModal
        pending={pendingUnshortlist}
        onClose={() => setPendingUnshortlist(null)}
        onConfirm={confirmUnshortlist}
      />
    </>
  );
}
