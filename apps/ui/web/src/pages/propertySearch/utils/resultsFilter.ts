/**
 * What the current results actually contain, and the filter that narrows them to it.
 *
 * Pairs a derive step with an apply step the way `mapFilter.ts` pairs `propertyPoint`
 * with `filterByMap`, and for the same reason: the panel may only offer a value the
 * results carry, so the sets the chips grey themselves against and the predicates the
 * cards are filtered by have to be read off exactly the same fields.
 *
 * Only part of the search form can be answered here. Floor level, furnishing, unit and
 * project features, verified listings, video tours, distance to MRT and the keyword are
 * query parameters sent to PropertyGuru; nothing comes back in the payload to filter on,
 * so this module ignores them and the results panel does not offer them.
 *
 * Unlike the map filter, a record must positively match: a property whose tenure never
 * came through drops as soon as a tenure chip is on, and a unit with no price drops under
 * a price range. That is the opposite of the rule in `mapFilter.ts`, and deliberately so
 * -- a filter the user set by hand is answered honestly, where a missing coordinate is a
 * scrape failure they never asked about. What keeps a short list legible is on screen
 * instead: the count line, the count on the button, and the button that clears it.
 *
 * Districts are not read here. On the results screen they belong to the map rail, which
 * keeps its own rule about properties it cannot place, so applying them here as well
 * would quietly drop the ones the map deliberately keeps.
 */
import type { FilterFormState, ListingRow, Property } from '../../../types/listings';
import { toListingRows } from '../../../lib/listingRows';
import {
  BATHROOM_OPTIONS,
  BEDROOM_OPTIONS,
  LAST_POSTED_OPTIONS,
  PROPERTY_TYPE_OPTIONS,
  TENURE_OPTIONS,
} from './filterOptions';

export interface Bounds {
  min: number;
  max: number;
}

/** Every value the current results carry, one entry per group the panel offers. */
export interface ResultFacets {
  districtCode: Set<string>;
  propertyTypeCode: Set<string>;
  tenureCode: Set<string>;
  bedrooms: Set<number>;
  bathrooms: Set<number>;
  listingFeatures: Set<string>;
  lastPosted: Set<string>;
  price: Bounds | null;
  size: Bounds | null;
  psf: Bounds | null;
  top: Bounds | null;
}

export interface FilteredResults {
  properties: Property[];
  /** Units the filter took off a card, which the card counts under its table. */
  filteredUnitIds: Set<string>;
}

/** The groups this filter can answer, in the order the panel renders them. */
export const RESULT_FILTER_KEYS: (keyof FilterFormState)[] = [
  'minPrice',
  'maxPrice',
  'minSize',
  'maxSize',
  'minPsf',
  'maxPsf',
  'minTop',
  'maxTop',
  'propertyTypeCode',
  'tenureCode',
  'bedrooms',
  'bathrooms',
  'districtCode',
  'listingFeatures',
  'lastPosted',
];

const PROPERTY_TYPE_BY_LABEL: Record<string, string> = Object.fromEntries(
  PROPERTY_TYPE_OPTIONS.map(option => [option.label.toLowerCase(), option.value])
);

const TENURE_CODES = new Set(TENURE_OPTIONS.map(option => option.value));

const MAX_BEDROOM_CHIP = BEDROOM_OPTIONS[BEDROOM_OPTIONS.length - 1].value;
const MIN_BATHROOM_CHIP = BATHROOM_OPTIONS[0].value;
const MAX_BATHROOM_CHIP = BATHROOM_OPTIONS[BATHROOM_OPTIONS.length - 1].value;

const SECONDS_PER_DAY = 86400;

/**
 * The tenure a result states, as the code the chips use.
 *
 * The scrape stores prose rather than a code ("99-year Leasehold"), and states more of
 * them than the site offers as filters -- "Unknown Tenure" is a real value. Anything
 * without a chip to land on comes back null, which drops the property once a tenure chip
 * is on rather than answering a filter it cannot.
 */
export function tenureCodeOf(tenure: string | null | undefined): string | null {
  if (!tenure) return null;
  const text = tenure.trim();
  if (/^freehold$/i.test(text)) return 'F';
  const years = /^(\d+)\s*-?\s*year/i.exec(text);
  if (!years) return null;
  const code = `L${years[1]}`;
  return TENURE_CODES.has(code) ? code : null;
}

/** The same, for the property type, which the scrape states as the chip's own label. */
export function propertyTypeCodeOf(propertyType: string | null | undefined): string | null {
  if (!propertyType) return null;
  return PROPERTY_TYPE_BY_LABEL[propertyType.trim().toLowerCase()] ?? null;
}

/** "5+" is one chip, so a six bedroom unit answers to 5. Studio is 0, per BEDROOM_OPTIONS. */
function bedroomChip(bedrooms: number | null | undefined): number | null {
  if (typeof bedrooms !== 'number' || !Number.isFinite(bedrooms) || bedrooms < 0) return null;
  return Math.min(bedrooms, MAX_BEDROOM_CHIP);
}

function bathroomChip(bathrooms: number | null | undefined): number | null {
  if (typeof bathrooms !== 'number' || !Number.isFinite(bathrooms)) return null;
  if (bathrooms < MIN_BATHROOM_CHIP) return null;
  return Math.min(bathrooms, MAX_BATHROOM_CHIP);
}

function hasFloorplans(row: ListingRow): boolean {
  return (row.floorplans?.length ?? 0) > 0;
}

function postedWithin(row: ListingRow, days: number, now: number): boolean {
  if (typeof row.listedAt !== 'number') return false;
  return row.listedAt >= now - days * SECONDS_PER_DAY;
}

function extend(bounds: Bounds | null, value: number | null | undefined): Bounds | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return bounds;
  if (!bounds) return { min: value, max: value };
  return { min: Math.min(bounds.min, value), max: Math.max(bounds.max, value) };
}

function toNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Read every result once and collect what the panel is allowed to offer.
 *
 * Taken over the properties before this filter runs, never after: a facet computed from
 * the filtered list would lose the last value carrying it the moment it was chosen, and
 * the chip the user just pressed would grey itself out.
 */
export function resultFacets(properties: Property[]): ResultFacets {
  const now = Math.floor(Date.now() / 1000);
  const facets: ResultFacets = {
    districtCode: new Set(),
    propertyTypeCode: new Set(),
    tenureCode: new Set(),
    bedrooms: new Set(),
    bathrooms: new Set(),
    listingFeatures: new Set(),
    lastPosted: new Set(),
    price: null,
    size: null,
    psf: null,
    top: null,
  };

  for (const property of properties) {
    const { district, propertyType, tenure, topYear } = property.info;
    if (district) facets.districtCode.add(district);
    const typeCode = propertyTypeCodeOf(propertyType);
    if (typeCode) facets.propertyTypeCode.add(typeCode);
    const tenureCode = tenureCodeOf(tenure);
    if (tenureCode) facets.tenureCode.add(tenureCode);
    facets.top = extend(facets.top, topYear);

    for (const row of toListingRows(property)) {
      facets.price = extend(facets.price, row.price);
      facets.size = extend(facets.size, row.floorAreaSqft);
      facets.psf = extend(facets.psf, row.psf);
      const bedrooms = bedroomChip(row.bedrooms);
      if (bedrooms !== null) facets.bedrooms.add(bedrooms);
      const bathrooms = bathroomChip(row.bathrooms);
      if (bathrooms !== null) facets.bathrooms.add(bathrooms);
      if (hasFloorplans(row)) facets.listingFeatures.add('withFloorplans');
      for (const option of LAST_POSTED_OPTIONS) {
        if (postedWithin(row, Number(option.value), now)) facets.lastPosted.add(option.value);
      }
    }
  }

  return facets;
}

function propertyMatcher(form: FilterFormState): ((property: Property) => boolean) | null {
  const types = new Set(form.propertyTypeCode);
  const tenures = new Set(form.tenureCode);
  const minTop = toNumber(form.minTop);
  const maxTop = toNumber(form.maxTop);
  if (!types.size && !tenures.size && minTop === null && maxTop === null) return null;

  return (property: Property) => {
    const { propertyType, tenure, topYear } = property.info;
    if (types.size) {
      const code = propertyTypeCodeOf(propertyType);
      if (!code || !types.has(code)) return false;
    }
    if (tenures.size) {
      const code = tenureCodeOf(tenure);
      if (!code || !tenures.has(code)) return false;
    }
    if (minTop !== null || maxTop !== null) {
      if (typeof topYear !== 'number') return false;
      if (minTop !== null && topYear < minTop) return false;
      if (maxTop !== null && topYear > maxTop) return false;
    }
    return true;
  };
}

function unitMatcher(form: FilterFormState): ((row: ListingRow) => boolean) | null {
  const minPrice = toNumber(form.minPrice);
  const maxPrice = toNumber(form.maxPrice);
  const minSize = toNumber(form.minSize);
  const maxSize = toNumber(form.maxSize);
  const minPsf = toNumber(form.minPsf);
  const maxPsf = toNumber(form.maxPsf);
  const bedrooms = new Set(form.bedrooms);
  const bathrooms = new Set(form.bathrooms);
  const lastPosted = toNumber(form.lastPosted);
  const floorplansOnly = form.listingFeatures.includes('withFloorplans');
  const hasRange =
    minPrice !== null ||
    maxPrice !== null ||
    minSize !== null ||
    maxSize !== null ||
    minPsf !== null ||
    maxPsf !== null;
  if (!hasRange && !bedrooms.size && !bathrooms.size && lastPosted === null && !floorplansOnly) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const withinRange = (value: number | null, min: number | null, max: number | null) => {
    if (min === null && max === null) return true;
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    if (min !== null && value < min) return false;
    if (max !== null && value > max) return false;
    return true;
  };

  return (row: ListingRow) => {
    if (!withinRange(row.price, minPrice, maxPrice)) return false;
    if (!withinRange(row.floorAreaSqft, minSize, maxSize)) return false;
    if (!withinRange(row.psf, minPsf, maxPsf)) return false;
    if (bedrooms.size) {
      const chip = bedroomChip(row.bedrooms);
      if (chip === null || !bedrooms.has(chip)) return false;
    }
    if (bathrooms.size) {
      const chip = bathroomChip(row.bathrooms);
      if (chip === null || !bathrooms.has(chip)) return false;
    }
    if (lastPosted !== null && !postedWithin(row, lastPosted, now)) return false;
    if (floorplansOnly && !hasFloorplans(row)) return false;
    return true;
  };
}

/**
 * Narrow the results to the filter, at both levels the form works on.
 *
 * A property level filter takes the whole card off. A unit level one takes rows off the
 * table and only then takes the card, and only when the filter is what emptied it: a
 * property whose every unit is merely hidden keeps its card and the footnote that
 * explains it, exactly as before this filter existed.
 */
export function filterResults(
  properties: Property[],
  form: FilterFormState,
  hiddenUnitIds: Set<string>
): FilteredResults {
  const matchesProperty = propertyMatcher(form);
  const matchesUnit = unitMatcher(form);
  if (!matchesProperty && !matchesUnit) return { properties, filteredUnitIds: new Set() };

  const filteredUnitIds = new Set<string>();
  const kept: Property[] = [];

  for (const property of properties) {
    if (matchesProperty && !matchesProperty(property)) continue;
    if (!matchesUnit) {
      kept.push(property);
      continue;
    }

    const shown = toListingRows(property).filter(row => !hiddenUnitIds.has(String(row.listingId)));
    const dropped: string[] = [];
    let matched = 0;
    for (const row of shown) {
      if (matchesUnit(row)) matched += 1;
      else dropped.push(String(row.listingId));
    }
    if (shown.length > 0 && matched === 0) continue;
    for (const id of dropped) filteredUnitIds.add(id);
    kept.push(property);
  }

  return { properties: kept, filteredUnitIds };
}

/** How many of these groups are set, for the count on the button that opens the panel. */
export function countResultFilters(form: FilterFormState): number {
  return RESULT_FILTER_KEYS.filter(key => {
    const value = form[key];
    return Array.isArray(value) ? value.length > 0 : String(value).trim() !== '';
  }).length;
}
