/**
 * useShortlist - the units the user has hearted, wherever they are looking at them.
 *
 * The shortlist belongs to the app rather than to a search, which is deliberately the
 * opposite of hiding: hiding answers "not this one, in this search" and lives in the
 * saved search, while a shortlist answers "these are the ones I like" and does not care
 * which search turned a unit up. So this reads and writes the server directly instead of
 * going through the results store.
 *
 * Hearting sends the whole listing, not its id. Search jobs and their results are pruned
 * after a day and the results the browser holds die with the tab, so an id on its own
 * would name a unit nothing left could describe. The server groups the snapshots back
 * into the shape a search returns, which is what lets both screens render the same card.
 *
 * Both toggles are optimistic on the id set, since that is what fills the heart, and
 * roll back only their own entry so two toggles in the same tick cannot undo each other.
 * Writes are chained behind one another so a heart and an unheart of the same unit
 * cannot land out of order.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addShortlist, listShortlist, removeShortlist } from '../services/listingsService';
import type { ListingRow, Property, ShortlistProperty } from '../types/listings';

export interface ShortlistResult {
  properties: ShortlistProperty[];
  shortlistedIds: Set<string>;
  propertyCount: number;
  unitCount: number;
  isLoading: boolean;
  error: string;
  add: (property: Property, row: ListingRow) => Promise<void>;
  remove: (listingId: string) => Promise<void>;
}

/**
 * Drop one unit out of the grouped shape, along with a unit type or a property left
 * with nothing in it. Removing has to show on the shortlist page straight away, and
 * that page renders the grouped payload rather than a flat list of ids.
 */
function withoutUnit(properties: ShortlistProperty[], listingId: string): ShortlistProperty[] {
  return properties
    .map(property => ({
      ...property,
      unitTypes: property.unitTypes
        .map(unitType => ({
          ...unitType,
          units: unitType.units.filter(unit => String(unit.listingId) !== listingId),
        }))
        .filter(unitType => unitType.units.length > 0),
    }))
    .filter(property => property.unitTypes.length > 0);
}

function countUnits(properties: ShortlistProperty[]): number {
  return properties.reduce(
    (total, property) =>
      total + property.unitTypes.reduce((sum, unitType) => sum + unitType.units.length, 0),
    0
  );
}

export function useShortlist(): ShortlistResult {
  const [properties, setProperties] = useState<ShortlistProperty[]>([]);
  const [listingIds, setListingIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const writeChain = useRef<Promise<void>>(Promise.resolve());
  const propertiesRef = useRef<ShortlistProperty[]>([]);

  useEffect(() => {
    propertiesRef.current = properties;
  }, [properties]);

  const load = useCallback(async () => {
    const result = await listShortlist();
    setProperties(result.properties);
    setListingIds(result.listingIds);
  }, []);

  useEffect(() => {
    let cancelled = false;
    listShortlist()
      .then(result => {
        if (cancelled) return;
        setProperties(result.properties);
        setListingIds(result.listingIds);
        setError('');
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load the shortlist');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const add = useCallback(
    (property: Property, row: ListingRow) => {
      const listingId = String(row.listingId);
      setListingIds(current => (current.includes(listingId) ? current : [listingId, ...current]));
      setError('');

      const write = writeChain.current
        .then(() =>
          addShortlist({
            listingId,
            propertyId: property.propertyId,
            propertyName: property.name,
            info: property.info,
            bedrooms: row.bedrooms,
            price: row.price,
            bathrooms: row.bathrooms,
            floorAreaSqft: row.floorAreaSqft,
            psf: row.psf,
            url: row.url,
            listedAt: row.listedAt,
            listedLabel: row.listedLabel,
            agentName: row.agentName,
            agencyName: row.agencyName,
            floorplans: row.floorplans,
          })
        )
        // Re-read rather than splice the new unit in by hand: the server decides which
        // unit type it lands under and what the property now looks like, and there is
        // no second grouping implementation on this side to keep in step with it.
        .then(() => load())
        .catch(err => {
          setListingIds(current => current.filter(id => id !== listingId));
          setError(err instanceof Error ? err.message : 'Failed to shortlist the unit');
        });
      writeChain.current = write;
      return write;
    },
    [load]
  );

  const remove = useCallback((listingId: string) => {
    const previous = propertiesRef.current;
    setListingIds(current => current.filter(id => id !== listingId));
    setProperties(current => withoutUnit(current, listingId));
    setError('');

    const write = writeChain.current
      .then(() => removeShortlist(listingId))
      .then(() => undefined)
      .catch(err => {
        setListingIds(current => (current.includes(listingId) ? current : [listingId, ...current]));
        setProperties(previous);
        setError(err instanceof Error ? err.message : 'Failed to remove the unit');
      });
    writeChain.current = write;
    return write;
  }, []);

  const shortlistedIds = useMemo(() => new Set(listingIds), [listingIds]);

  // Counted from what is on screen rather than taken off the response, so an optimistic
  // removal does not leave the caption claiming a unit the card no longer shows.
  const unitCount = useMemo(() => countUnits(properties), [properties]);

  return {
    properties,
    shortlistedIds,
    propertyCount: properties.length,
    unitCount,
    isLoading,
    error,
    add,
    remove,
  };
}
