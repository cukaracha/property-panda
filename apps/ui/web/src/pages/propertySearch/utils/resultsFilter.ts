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
 * would quietly drop the ones the map deliberately keeps. They are also the one filter
 * that stays shared across the property types, for that same reason.
 *
 * Everything else is per property type, mirroring the search form: each type is narrowed
 * by its own bounds, and turning a type off takes it off the screen entirely.
 */
import type {
  FilterFormState,
  ListingRow,
  Property,
  PropertyTypeGroup,
  SearchFormState,
} from '../../../types/listings';
import { toListingRows } from '../../../lib/listingRows';
import {
  BATHROOM_OPTIONS,
  BEDROOM_OPTIONS,
  DEFAULT_FILTER_FORM,
  LAST_POSTED_OPTIONS,
  PROPERTY_TYPE_GROUP_BY_CODE,
  PROPERTY_TYPE_GROUPS,
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

/**
 * The same, one entry per property type, plus which types the results actually contain.
 *
 * Every group is present in `byGroup` whether or not the results carry one, so a lookup
 * is total and a tab that has just been turned back on has something to read. `groups` is
 * what the tab strip offers.
 */
export interface ResultFacetsByGroup {
  groups: PropertyTypeGroup[];
  byGroup: Record<PropertyTypeGroup, ResultFacets>;
}

export interface FilteredResults {
  properties: Property[];
  /** Units the filter took off a card, which the card counts under its table. */
  filteredUnitIds: Set<string>;
}

/** A results filter that narrows nothing: every type on, every bound clear. */
export const DEFAULT_RESULT_FILTER: SearchFormState = {
  groups: [...PROPERTY_TYPE_GROUPS],
  forms: { N: DEFAULT_FILTER_FORM, H: DEFAULT_FILTER_FORM, L: DEFAULT_FILTER_FORM },
};

/**
 * The groups this filter can answer, in the order the panel renders them.
 *
 * Districts are absent: they are shared across the property types and counted separately,
 * since the map rail edits the same selection.
 */
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

/**
 * The property type a result states, as the code the chips use.
 *
 * Enrichment states the type as prose ("Semi-Detached House"), which is the chip's own
 * label, but a property whose project page never loaded states the listing feed's raw
 * code instead. Both are read, since on landed homes the second is the common case.
 */
export function propertyTypeCodeOf(propertyType: string | null | undefined): string | null {
  if (!propertyType) return null;
  const text = propertyType.trim();
  if (PROPERTY_TYPE_GROUP_BY_CODE[text]) return text;
  return PROPERTY_TYPE_BY_LABEL[text.toLowerCase()] ?? null;
}

/**
 * Which property type group a result belongs to, which is what decides the tab it
 * answers to.
 *
 * The scrape stamps the group on every property it returns. Results cached before the
 * search covered more than condos carry none, and read as non-landed: that is not a
 * guess, it is what the scraper hardcoded at the time. The type code is tried in between
 * for the same reason it is read above, so a property that states its type but not its
 * group still lands on the right tab.
 */
export function propertyGroupOf(property: Property): PropertyTypeGroup {
  const stated = property.info.propertyTypeGroup;
  if (stated && (PROPERTY_TYPE_GROUPS as string[]).includes(stated)) {
    return stated as PropertyTypeGroup;
  }
  const code = propertyTypeCodeOf(property.info.propertyType);
  return (code && PROPERTY_TYPE_GROUP_BY_CODE[code]) || 'N';
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

function emptyFacets(): ResultFacets {
  return {
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
}

/**
 * Read every result once and collect what each property type's tab is allowed to offer.
 *
 * Per type, because each tab narrows its own type and nothing else: greying a bedroom
 * chip on the Landed tab because no flat has that many rooms would be answering the wrong
 * question. Districts are the exception and are collected once across every type, since
 * the map rail edits one selection for the whole result set.
 *
 * Taken over the properties before this filter runs, never after: a facet computed from
 * the filtered list would lose the last value carrying it the moment it was chosen, and
 * the chip the user just pressed would grey itself out.
 */
export function resultFacets(properties: Property[]): ResultFacetsByGroup {
  const now = Math.floor(Date.now() / 1000);
  const byGroup: Record<PropertyTypeGroup, ResultFacets> = {
    N: emptyFacets(),
    H: emptyFacets(),
    L: emptyFacets(),
  };
  const present = new Set<PropertyTypeGroup>();
  const districts = new Set<string>();

  for (const property of properties) {
    const group = propertyGroupOf(property);
    present.add(group);
    const facets = byGroup[group];
    const { district, propertyType, tenure, topYear } = property.info;
    if (district) districts.add(district);
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

  // The one shared set, handed to every tab so the district row reads the same whichever
  // tab it is rendered under.
  for (const group of PROPERTY_TYPE_GROUPS) byGroup[group].districtCode = districts;

  return { groups: PROPERTY_TYPE_GROUPS.filter(group => present.has(group)), byGroup };
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
  form: SearchFormState,
  hiddenUnitIds: Set<string>
): FilteredResults {
  // Built once per type rather than per property: each is a closure over parsed bounds,
  // and a result set is far longer than three.
  const matchers = {} as Record<
    PropertyTypeGroup,
    {
      property: ((property: Property) => boolean) | null;
      unit: ((row: ListingRow) => boolean) | null;
    }
  >;
  for (const group of PROPERTY_TYPE_GROUPS) {
    matchers[group] = {
      property: propertyMatcher(form.forms[group]),
      unit: unitMatcher(form.forms[group]),
    };
  }
  const allGroups = PROPERTY_TYPE_GROUPS.every(group => form.groups.includes(group));
  const narrows =
    !allGroups ||
    PROPERTY_TYPE_GROUPS.some(group => matchers[group].property || matchers[group].unit);
  if (!narrows) return { properties, filteredUnitIds: new Set() };

  const filteredUnitIds = new Set<string>();
  const kept: Property[] = [];

  for (const property of properties) {
    const group = propertyGroupOf(property);
    // A type switched off is off the screen, which is what the tab strip means here.
    if (!form.groups.includes(group)) continue;
    const { property: matchesProperty, unit: matchesUnit } = matchers[group];
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

/**
 * How many of these groups are set, for the count on the button that opens the panel.
 *
 * Districts come in separately, because the map rail holds that selection rather than the
 * filter form. Leaving a property type out counts once however many are left out, since
 * it is one decision on one strip.
 */
export function countResultFilters(
  form: SearchFormState,
  districts: string[],
  available: PropertyTypeGroup[]
): number {
  const perGroup = available
    .filter(group => form.groups.includes(group))
    .reduce(
      (total, group) =>
        total +
        RESULT_FILTER_KEYS.filter(key => {
          const value = form.forms[group][key];
          return Array.isArray(value) ? value.length > 0 : String(value).trim() !== '';
        }).length,
      0
    );
  const typesLeftOut = available.some(group => !form.groups.includes(group)) ? 1 : 0;
  return perGroup + typesLeftOut + (districts.length > 0 ? 1 : 0);
}
