/**
 * Where a property is, as a Google Maps query.
 *
 * One home for the rule, so a card's "is this clickable?" and the map it opens can
 * never disagree.
 *
 * The pin comes from the coordinates enrichment read off the project page, which puts
 * it on the building exactly. The address is the fallback for the handful of
 * properties that carry a street line but no point: Google resolves those to the
 * right street, within a few hundred metres. The project *name* is deliberately not
 * query material -- names resolve kilometres away often enough to matter, silently,
 * and a card that failed enrichment carries the listing's headline in `name` rather
 * than a project at all.
 *
 * Coordinates are checked with `typeof === 'number'` for the reason `propertyPoint`
 * gives: on results scraped before the map these keys are absent rather than null.
 * That function is not reused here, though -- it falls back to the district's anchor,
 * and a pin dropped at the centre of a district while the header names one building
 * would be worse than no pin at all.
 */
import type { PropertyInfo } from '../types/listings';

/** Whether the address line has an address to open. */
export function canOpenMap(info: PropertyInfo): boolean {
  return Boolean(info.address?.trim());
}

export function mapQuery(info: PropertyInfo): string | null {
  const { latitude, longitude } = info;

  if (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)
  ) {
    return `${latitude},${longitude}`;
  }

  // Scraped addresses are bare street lines with no postal code and no country.
  const address = info.address?.trim();
  return address ? `${address}, Singapore` : null;
}

/**
 * The keyless embed, which needs no API key and so no key in AppConfig.json. The
 * zoom is set because a coordinate pin has no place to size itself against, and
 * the default lands somewhere arbitrary.
 */
export function mapEmbedUrl(query: string): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=17&output=embed`;
}

/** Google's documented link-out scheme, for opening the same spot in a real tab. */
export function mapLinkUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
