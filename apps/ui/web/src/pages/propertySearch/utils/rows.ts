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

export function toListingRows(property: Property): ListingRow[] {
  return property.unitTypes
    .flatMap(unitType =>
      unitType.units.map(unit => ({
        ...unit,
        bedrooms: unitType.bedrooms,
        unitTypeLabel: unitType.label,
      }))
    )
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
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
