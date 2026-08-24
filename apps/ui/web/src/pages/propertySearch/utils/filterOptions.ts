/**
 * Filter option lists for the PropertyGuru search form, plus the helpers that
 * turn the panel's form state into the request body the API expects.
 *
 * Every code below is PropertyGuru's own: they are read back from
 * `searchFilterData.filterValues` in a search page's __NEXT_DATA__, so the panel offers
 * exactly the choices the site accepts. A value the site does not know is not rejected,
 * it is ignored, and the search then comes back unfiltered.
 *
 * Filters the site has but this panel does not: everything that only applies to rentals
 * (lease term, availability, tenancy conditions, room type) and to landed homes (land
 * size), because the scraper searches non-landed homes for sale.
 */
import type { FilterFormState, SearchFilters, SearchRequest } from '../../../types/listings';

export interface FilterOption {
  value: string;
  label: string;
  /** Hover text, for a chip whose label is a code rather than a name. */
  title?: string;
}

export interface NumericFilterOption {
  value: number;
  label: string;
}

export const PROPERTY_TYPE_OPTIONS: FilterOption[] = [
  { value: 'CONDO', label: 'Condominium' },
  { value: 'APT', label: 'Apartment' },
  { value: 'WALK', label: 'Walk-up' },
  { value: 'CLUS', label: 'Cluster house' },
  { value: 'EXCON', label: 'Executive condominium' },
];

export const BEDROOM_OPTIONS: NumericFilterOption[] = [
  { value: 0, label: 'Studio' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5+' },
];

export const BATHROOM_OPTIONS: NumericFilterOption[] = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5+' },
];

// Singapore's 28 postal districts, named as PropertyGuru names them. The chip shows the
// code alone to keep 28 of them readable; the name is the hover text.
export const DISTRICT_NAMES = [
  'Boat Quay / Raffles Place / Marina',
  'Chinatown / Tanjong Pagar',
  'Alexandra / Commonwealth',
  'Harbourfront / Telok Blangah',
  'Buona Vista / West Coast / Clementi New Town',
  'City Hall / Clarke Quay',
  'Beach Road / Bugis / Rochor',
  'Farrer Park / Serangoon Rd',
  'Orchard / River Valley',
  'Tanglin / Holland / Bukit Timah',
  'Newton / Novena',
  'Balestier / Toa Payoh',
  'Macpherson / Potong Pasir',
  'Eunos / Geylang / Paya Lebar',
  'East Coast / Marine Parade',
  'Bedok / Upper East Coast',
  'Changi Airport / Changi Village',
  'Pasir Ris / Tampines',
  'Hougang / Punggol / Sengkang',
  'Ang Mo Kio / Bishan / Thomson',
  'Clementi Park / Upper Bukit Timah',
  'Boon Lay / Jurong / Tuas',
  'Dairy Farm / Bukit Panjang / Choa Chu Kang',
  'Lim Chu Kang / Tengah',
  'Admiralty / Woodlands',
  'Mandai / Upper Thomson',
  'Sembawang / Yishun',
  'Seletar / Yio Chu Kang',
];

export const DISTRICT_OPTIONS: FilterOption[] = DISTRICT_NAMES.map((name, index) => {
  const code = `D${String(index + 1).padStart(2, '0')}`;
  return { value: code, label: code, title: `${code} ${name}` };
});

/** The same names keyed by code, for anything that has a code and wants the name. */
export const DISTRICT_NAME_BY_CODE: Record<string, string> = Object.fromEntries(
  DISTRICT_NAMES.map((name, index) => [`D${String(index + 1).padStart(2, '0')}`, name])
);

export const TENURE_OPTIONS: FilterOption[] = [
  { value: 'F', label: 'Freehold' },
  { value: 'L99', label: '99-year' },
  { value: 'L103', label: '103-year' },
  { value: 'L110', label: '110-year' },
  { value: 'L999', label: '999-year' },
  { value: 'L9999', label: '9999-year' },
];

export const FLOOR_LEVEL_OPTIONS: FilterOption[] = [
  { value: 'GND', label: 'Ground' },
  { value: 'LOW', label: 'Low' },
  { value: 'MID', label: 'Mid' },
  { value: 'HIGH', label: 'High' },
  { value: 'PENT', label: 'Penthouse' },
];

export const FURNISHING_OPTIONS: FilterOption[] = [
  { value: 'UNFUR', label: 'Unfurnished' },
  { value: 'PART', label: 'Partially furnished' },
  { value: 'FULL', label: 'Fully furnished' },
];

export const UNIT_FEATURE_OPTIONS: FilterOption[] = [
  { value: 'AIRC', label: 'Aircon' },
  { value: 'BAL', label: 'Balcony' },
  { value: 'BATH', label: 'Bath tub' },
  { value: 'CORN', label: 'Corner unit' },
  { value: 'MAID', label: 'Helper’s room' },
  { value: 'PPOOL', label: 'Private pool' },
  { value: 'RENO', label: 'Renovated' },
  { value: 'TERR', label: 'Terrace' },
];

export const PROJECT_FEATURE_OPTIONS: FilterOption[] = [
  { value: 'GYM', label: 'Gym' },
  { value: 'PARK', label: 'Parking' },
  { value: 'SWIM', label: 'Swimming pool' },
  { value: 'TEN', label: 'Tennis court' },
];

/** One chip group in the panel, three separate flags on the request. */
export const LISTING_FEATURE_OPTIONS: FilterOption[] = [
  { value: 'isVerified', label: 'Verified listings' },
  { value: 'withFloorplans', label: 'With floor plan' },
  { value: 'withStream', label: 'With video or virtual tour' },
];

export const DISTANCE_TO_MRT_OPTIONS: FilterOption[] = [
  { value: '0.25', label: 'Under 250 m' },
  { value: '0.5', label: 'Under 500 m' },
  { value: '0.75', label: 'Under 750 m' },
  { value: '1', label: 'Under 1 km' },
  { value: '1.5', label: 'Under 1.5 km' },
];

export const LAST_POSTED_OPTIONS: FilterOption[] = [
  { value: '3', label: 'Within 3 days' },
  { value: '7', label: 'Within 1 week' },
  { value: '14', label: 'Within 2 weeks' },
  { value: '31', label: 'Within 1 month' },
];

export const KEYWORD_MAX_LENGTH = 100;

export const MAX_PAGES_LABEL = 'Pages to scan';

export const MAX_PAGES_ALL = '0';

/**
 * "All" is the value 0, which the local scraper reads as every page the search has.
 * It is 0 rather than a word because the request body carries a number, and a value
 * that did not parse would fall back to a single page without saying so.
 */
export const MAX_PAGES_OPTIONS: FilterOption[] = [
  { value: MAX_PAGES_ALL, label: 'All' },
  ...Array.from({ length: 10 }, (_, index) => {
    const pages = String(index + 1);
    return { value: pages, label: pages };
  }),
];

export const DEFAULT_FILTER_FORM: FilterFormState = {
  minPrice: '',
  maxPrice: '',
  minSize: '',
  maxSize: '',
  minPsf: '',
  maxPsf: '',
  minTop: '',
  maxTop: '',
  bedrooms: [],
  bathrooms: [],
  propertyTypeCode: [],
  districtCode: [],
  tenureCode: [],
  floorLevel: [],
  furnishing: [],
  unitFeatures: [],
  projectFeatures: [],
  listingFeatures: [],
  distanceToMrt: '',
  keyword: '',
  lastPosted: '',
  maxPages: MAX_PAGES_ALL,
};

/** Add the value when absent, remove it when present. Used by the chip groups. */
export function toggleOption<T>(selected: T[], value: T): T[] {
  return selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value];
}

/**
 * Reduce what the user typed back to the digits the form state holds, so the
 * separators the panel renders never reach the request body.
 */
export function stripThousands(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, '');
  const [whole, ...rest] = cleaned.split('.');
  return rest.length > 0 ? `${whole}.${rest.join('')}` : whole;
}

/**
 * Group a raw digit string for display ("1200000" to "1,200,000"). The fraction
 * is left alone, trailing "." included, so the field does not rewrite itself
 * between the point and the first decimal.
 */
export function formatThousands(value: string): string {
  const [whole, fraction] = value.split('.');
  const grouped = whole ? Number(whole).toLocaleString('en-SG') : '';
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

function toNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toList<T>(values: T[]): T[] | undefined {
  return values.length > 0 ? values : undefined;
}

function toFlag(form: FilterFormState, feature: string): true | undefined {
  return form.listingFeatures.includes(feature) ? true : undefined;
}

/** Build the POST body, dropping every filter the user left empty. */
export function buildSearchRequest(form: FilterFormState): SearchRequest {
  return {
    source: 'propertyguru',
    maxPages: toNumber(form.maxPages) ?? 1,
    filters: {
      minPrice: toNumber(form.minPrice),
      maxPrice: toNumber(form.maxPrice),
      bedrooms: toList(form.bedrooms),
      bathrooms: toList(form.bathrooms),
      minSize: toNumber(form.minSize),
      maxSize: toNumber(form.maxSize),
      minPsf: toNumber(form.minPsf),
      maxPsf: toNumber(form.maxPsf),
      propertyTypeCode: toList(form.propertyTypeCode),
      districtCode: toList(form.districtCode),
      tenureCode: toList(form.tenureCode),
      floorLevel: toList(form.floorLevel),
      furnishing: toList(form.furnishing),
      unitFeatures: toList(form.unitFeatures),
      projectFeatures: toList(form.projectFeatures),
      minTop: toNumber(form.minTop),
      maxTop: toNumber(form.maxTop),
      distanceToMrt: form.distanceToMrt || undefined,
      keyword: form.keyword.trim() || undefined,
      isVerified: toFlag(form, 'isVerified'),
      withFloorplans: toFlag(form, 'withFloorplans'),
      withStream: toFlag(form, 'withStream'),
      lastPosted: toNumber(form.lastPosted),
    },
  };
}

function toText(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

function toFeatures(filters: SearchFilters): string[] {
  return LISTING_FEATURE_OPTIONS.filter(option => filters[option.value as keyof SearchFilters]).map(
    option => option.value
  );
}

/**
 * Put a request back in the panel, the inverse of buildSearchRequest.
 *
 * Every field is written rather than merged over the defaults, so a filter the
 * request does not carry is cleared rather than left over from whatever was in the
 * panel before. `sort` and `order` have no field to come back to and are dropped:
 * they are the same on every search the panel builds.
 */
export function toFilterForm(request: SearchRequest): FilterFormState {
  const filters = request.filters || {};
  return {
    minPrice: toText(filters.minPrice),
    maxPrice: toText(filters.maxPrice),
    minSize: toText(filters.minSize),
    maxSize: toText(filters.maxSize),
    minPsf: toText(filters.minPsf),
    maxPsf: toText(filters.maxPsf),
    minTop: toText(filters.minTop),
    maxTop: toText(filters.maxTop),
    bedrooms: filters.bedrooms ?? [],
    bathrooms: filters.bathrooms ?? [],
    propertyTypeCode: filters.propertyTypeCode ?? [],
    districtCode: filters.districtCode ?? [],
    tenureCode: filters.tenureCode ?? [],
    floorLevel: filters.floorLevel ?? [],
    furnishing: filters.furnishing ?? [],
    unitFeatures: filters.unitFeatures ?? [],
    projectFeatures: filters.projectFeatures ?? [],
    listingFeatures: toFeatures(filters),
    distanceToMrt: filters.distanceToMrt ?? '',
    keyword: filters.keyword ?? '',
    lastPosted: toText(filters.lastPosted),
    maxPages: String(request.maxPages ?? 1),
  };
}

function describeCodes<T extends string | number>(
  options: { value: T; label: string }[],
  selected: T[]
): string {
  return selected
    .map(value => options.find(option => option.value === value)?.label ?? String(value))
    .join(', ');
}

/** A short human summary of the active filters, for the agent page context. */
export function describeFilters(form: FilterFormState): string {
  const parts: string[] = [];
  if (form.minPrice || form.maxPrice) {
    parts.push(`price ${form.minPrice || 'any'} to ${form.maxPrice || 'any'}`);
  }
  if (form.minSize || form.maxSize) {
    parts.push(`floor area ${form.minSize || 'any'} to ${form.maxSize || 'any'} sqft`);
  }
  if (form.minPsf || form.maxPsf) {
    parts.push(`psf ${form.minPsf || 'any'} to ${form.maxPsf || 'any'}`);
  }
  if (form.minTop || form.maxTop) {
    parts.push(`TOP year ${form.minTop || 'any'} to ${form.maxTop || 'any'}`);
  }
  if (form.bedrooms.length > 0) {
    parts.push(`bedrooms ${describeCodes(BEDROOM_OPTIONS, form.bedrooms)}`);
  }
  if (form.bathrooms.length > 0) {
    parts.push(`bathrooms ${describeCodes(BATHROOM_OPTIONS, form.bathrooms)}`);
  }
  if (form.propertyTypeCode.length > 0) {
    parts.push(`property types ${describeCodes(PROPERTY_TYPE_OPTIONS, form.propertyTypeCode)}`);
  }
  if (form.districtCode.length > 0) {
    // Named, not bare codes: this string is what the assistant reads as page context, and
    // "D09" tells it nothing that "D09 Orchard / River Valley" does not.
    parts.push(
      `districts ${form.districtCode
        .map(code =>
          DISTRICT_NAME_BY_CODE[code] ? `${code} ${DISTRICT_NAME_BY_CODE[code]}` : code
        )
        .join(', ')}`
    );
  }
  if (form.tenureCode.length > 0) {
    parts.push(`tenure ${describeCodes(TENURE_OPTIONS, form.tenureCode)}`);
  }
  if (form.floorLevel.length > 0) {
    parts.push(`floor level ${describeCodes(FLOOR_LEVEL_OPTIONS, form.floorLevel)}`);
  }
  if (form.furnishing.length > 0) {
    parts.push(`furnishing ${describeCodes(FURNISHING_OPTIONS, form.furnishing)}`);
  }
  if (form.unitFeatures.length > 0) {
    parts.push(`unit features ${describeCodes(UNIT_FEATURE_OPTIONS, form.unitFeatures)}`);
  }
  if (form.projectFeatures.length > 0) {
    parts.push(`facilities ${describeCodes(PROJECT_FEATURE_OPTIONS, form.projectFeatures)}`);
  }
  if (form.listingFeatures.length > 0) {
    parts.push(describeCodes(LISTING_FEATURE_OPTIONS, form.listingFeatures).toLowerCase());
  }
  if (form.distanceToMrt) {
    const distance = describeCodes(DISTANCE_TO_MRT_OPTIONS, [form.distanceToMrt]).toLowerCase();
    parts.push(`an MRT or LRT ${distance} away`);
  }
  if (form.keyword.trim()) parts.push(`keyword "${form.keyword.trim()}"`);
  if (form.lastPosted) {
    parts.push(`listed ${describeCodes(LAST_POSTED_OPTIONS, [form.lastPosted]).toLowerCase()}`);
  }
  // A narrowed scan is a filter the person actually set, so it is named. The
  // default is not: "all pages scanned" appeared on every row and said nothing
  // the default did not already say.
  if (form.maxPages !== MAX_PAGES_ALL) parts.push(`${form.maxPages} pages scanned`);
  if (parts.length === 0) return 'no filters set';
  return parts.join(', ');
}
