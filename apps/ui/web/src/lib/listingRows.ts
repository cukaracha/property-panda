/**
 * Flatten one property's unit types back into a single listings table.
 *
 * The scraper groups listings by bedroom count and hangs the count off the group
 * rather than the listing, so a consolidated table has to join each unit to its
 * unit type to know how many bedrooms it has. Rows come out ordered by price
 * across every bedroom count, which is the order a table of one property reads
 * in; the units inside a single group already arrive that way.
 */
import type { ListingRow, Property } from '../types/listings';

/**
 * Whether a listing was posted since the saved search behind it last ran.
 *
 * A unit whose listing date never came through is never new: the alternative is
 * calling something new because the scrape missed a field, which is the one wrong
 * answer this badge must not give.
 */
export function isNewSince(row: ListingRow, newSince: number | null | undefined): boolean {
  if (!newSince || row.listedAt == null) return false;
  return row.listedAt > newSince;
}

/**
 * With a `newSince` the rows posted since it come first, still price-ordered inside
 * each half, so what is new is at the top of the property without the rest of the
 * table losing the order it is read in. Without one the output is unchanged.
 */
export function toListingRows(property: Property, newSince?: number | null): ListingRow[] {
  const rows = property.unitTypes
    .flatMap(unitType =>
      unitType.units.map(unit => ({
        ...unit,
        bedrooms: unitType.bedrooms,
        unitTypeLabel: unitType.label,
      }))
    )
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  if (!newSince) return rows;
  return [
    ...rows.filter(row => isNewSince(row, newSince)),
    ...rows.filter(row => !isNewSince(row, newSince)),
  ];
}

/**
 * Every `property#<id>` and `unit#<id>` key a result set contains.
 *
 * Hiding is kept per search and survives a re-run, so a stored list can name a unit
 * that today's results no longer carry. The results screen filters the list through
 * this before counting or listing it, which keeps the panel to what is on screen
 * while the entry stays stored for the run that brings it back.
 */
export function resultEntityKeys(properties: Property[]): Set<string> {
  const keys = new Set<string>();
  for (const property of properties) {
    keys.add(`property#${property.propertyId}`);
    for (const unitType of property.unitTypes) {
      for (const unit of unitType.units) keys.add(`unit#${unit.listingId}`);
    }
  }
  return keys;
}
