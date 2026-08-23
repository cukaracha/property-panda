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
