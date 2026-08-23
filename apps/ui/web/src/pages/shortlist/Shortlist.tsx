import { Link } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Spinner } from '../../components/ui/spinner';
import PropertyCard from '../../components/property/PropertyCard';
import { useShortlist } from '../../hooks/useShortlist';
import { useShortlistPageContext } from './PageContext';
import { formatSavedOn } from './utils/savedOn';
import type { ListingRow } from '../../types/listings';

/**
 * Shortlist - every unit the user has hearted, laid out the way the results are.
 *
 * The server groups the stored snapshots into the same property shape a search
 * returns, so this renders through the same card and nothing here knows that its
 * properties came out of a file rather than a scrape.
 *
 * There is no hiding on this screen. A shortlist is already the list of what the
 * user chose to keep, so the way to take something off it is the heart that put it
 * there, and PropertyCard drops the hide affordances when no handler is passed.
 *
 * Each card says when it was saved, because a snapshot is frozen at heart time and
 * never re-scraped: the price on screen is the price it was, not the price it is.
 */
export default function Shortlist() {
  const { properties, shortlistedIds, propertyCount, unitCount, isLoading, error, remove } =
    useShortlist();

  const removeRow = (row: ListingRow) => remove(String(row.listingId));

  useShortlistPageContext(
    { properties, propertyCount, unitCount, isLoading, errorMessage: error },
    { onRemoveFromShortlist: remove }
  );

  return (
    <div className='mx-auto max-w-5xl space-y-5 p-6'>
      <div>
        <h1 className='type-ui-h2 text-ink'>Shortlist</h1>
        <p className='type-ui-caption mt-1'>
          {unitCount} {unitCount === 1 ? 'unit' : 'units'} across {propertyCount}{' '}
          {propertyCount === 1 ? 'property' : 'properties'}.
        </p>
      </div>

      {error && <p className='text-sm text-rose'>{error}</p>}

      {isLoading ? (
        <Card className='flex items-center justify-center p-10'>
          <Spinner />
        </Card>
      ) : properties.length === 0 ? (
        <Card className='p-10 text-center'>
          <p className='type-ui-title text-ink'>Nothing shortlisted yet</p>
          <p className='type-ui-sm mt-1 text-ink-3'>
            Run a search and click the heart on any unit to keep it here.
          </p>
          <Link to='/properties' className='btn btn-secondary btn-sm mt-4'>
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
              onToggleShortlist={(_property, row) => removeRow(row)}
              caption={formatSavedOn(property.shortlistedAt)}
              emptyMessage='No units left in this property.'
            />
          ))}
        </div>
      )}
    </div>
  );
}
