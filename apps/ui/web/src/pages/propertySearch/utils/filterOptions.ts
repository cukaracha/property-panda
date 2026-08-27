/**
 * Filter option lists for the PropertyGuru search form, plus the helpers that
 * turn the panel's form state into the request body the API expects.
 *
 * Every code below is PropertyGuru's own: they are read back from
 * `searchFilterData.filterValues` in a search page's __NEXT_DATA__, so the panel offers
 * exactly the choices the site accepts. A value the site does not know is not rejected,
 * it is ignored, and the search then comes back unfiltered.
 *
 * A search is one form per property type group, because one PropertyGuru query cannot
 * span two groups and because each type is worth filtering on its own terms: 1,000 sqft
 * is a large flat and a small landed home. buildSearchRequest turns that into the one
 * request per group the server fans out and consolidates.
 *
 * Filters the site has but this panel does not: everything that only applies to rentals,
 * which is lease term, availability, tenancy conditions and room type.
 */
import type {
  FilterFormState,
  GroupSearch,
  PropertyTypeGroup,
  SearchFilters,
  SearchFormState,
  SearchRequest,
} from '../../../types/listings';

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

/** The three groups the site partitions its property types into, in tab order. */
export const PROPERTY_TYPE_GROUPS: PropertyTypeGroup[] = ['N', 'H', 'L'];

export const PROPERTY_TYPE_GROUP_LABELS: Record<PropertyTypeGroup, string> = {
  N: 'Condo',
  H: 'HDB',
  L: 'Landed',
};

/**
 * Every property type code the site offers, under the group that owns it.
 *
 * A code sent under another group's query comes back with zero results rather than an
 * error, so the panel only ever offers a group its own codes and the server refuses the
 * rest. The HDB codes are flat types, which is why there are so many of them.
 */
export const PROPERTY_TYPE_OPTIONS_BY_GROUP: Record<PropertyTypeGroup, FilterOption[]> = {
  N: [
    { value: 'CONDO', label: 'Condominium' },
    { value: 'APT', label: 'Apartment' },
    { value: 'WALK', label: 'Walk-up' },
    { value: 'CLUS', label: 'Cluster house' },
    { value: 'EXCON', label: 'Executive condominium' },
  ],
  H: [
    { value: '1R', label: '1 room' },
    { value: '2A', label: '2A' },
    { value: '2I', label: '2I' },
    { value: '2S', label: '2S' },
    { value: '2RF', label: '2 room flexi' },
    { value: '3A', label: '3A' },
    { value: '3NG', label: '3NG' },
    { value: '3Am', label: '3A modified' },
    { value: '3NGm', label: '3NG modified' },
    { value: '3I', label: '3I' },
    { value: '3Im', label: '3I modified' },
    { value: '3S', label: '3S' },
    { value: '3STD', label: '3 standard' },
    { value: '3PA', label: '3PA' },
    { value: '4A', label: '4A' },
    { value: '4NG', label: '4NG' },
    { value: '4PA', label: '4PA' },
    { value: '4I', label: '4I' },
    { value: '4S', label: '4S' },
    { value: '4STD', label: '4 standard' },
    { value: '5A', label: '5A' },
    { value: '5I', label: '5I' },
    { value: '5PA', label: '5PA' },
    { value: '5S', label: '5S' },
    { value: '6J', label: 'Jumbo' },
    { value: 'EA', label: 'Executive apartment' },
    { value: 'EM', label: 'Executive maisonette' },
    { value: 'MG', label: 'Multi generation' },
    { value: 'TE', label: 'Terrace' },
  ],
  L: [
    { value: 'TERRA', label: 'Terraced house' },
    { value: 'CORN', label: 'Corner terrace' },
    { value: 'SEMI', label: 'Semi-detached house' },
    { value: 'DETAC', label: 'Detached house' },
    { value: 'BUNG', label: 'Bungalow' },
    { value: 'LBUNG', label: 'Good class bungalow' },
    { value: 'TOWN', label: 'Town house' },
    { value: 'CON', label: 'Conservation house' },
    { value: 'LCLUS', label: 'Cluster house' },
    { value: 'SHOPH', label: 'Shophouse' },
    { value: 'RLAND', label: 'Land only' },
  ],
};

/**
 * Every code across every group, for anything that has a type and wants its name. Not for
 * a chip row: a group is only ever offered its own codes.
 */
export const PROPERTY_TYPE_OPTIONS: FilterOption[] = PROPERTY_TYPE_GROUPS.flatMap(
  group => PROPERTY_TYPE_OPTIONS_BY_GROUP[group]
);

/** The group a property type code belongs to, for reading a result back to a tab. */
export const PROPERTY_TYPE_GROUP_BY_CODE: Record<string, PropertyTypeGroup> = Object.fromEntries(
  PROPERTY_TYPE_GROUPS.flatMap(group =>
    PROPERTY_TYPE_OPTIONS_BY_GROUP[group].map(option => [option.value, group])
  )
);

/**
 * The type codes the site hides its unit level filters behind. Land Only is a plot, so
 * bedrooms, bathrooms, floor area, build year, furnishing, unit features and facilities
 * are all questions it cannot answer, and PropertyGuru drops them from its own panel.
 */
export const LAND_ONLY_CODE = 'RLAND';

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
  // A real value in the site's own list, and a common one on landed homes.
  { value: 'NA', label: 'Unknown' },
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
  minSizeLand: '',
  maxSizeLand: '',
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

/**
 * A fresh search: condos, on the terms every search used to be run on.
 *
 * Every group carries a form whether or not it is switched on, so a tab turned off and
 * back on comes back with what was typed into it rather than empty.
 */
export const DEFAULT_SEARCH_FORM: SearchFormState = {
  groups: ['N'],
  forms: { N: DEFAULT_FILTER_FORM, H: DEFAULT_FILTER_FORM, L: DEFAULT_FILTER_FORM },
};

/** Replace one group's filters, leaving the other groups and the tab selection alone. */
export function setGroupForm(
  form: SearchFormState,
  group: PropertyTypeGroup,
  next: FilterFormState
): SearchFormState {
  return { ...form, forms: { ...form.forms, [group]: next } };
}

/**
 * Turn one property type on or off, refusing to turn the last one off.
 *
 * A search of nothing is not a narrower search, it is a request the server rejects, and a
 * results filter of nothing is a blank screen with no way back but Clear. `available`
 * bounds what "the last one" means, since the results filter offers only the types the
 * results contain: with landed absent, switching off condo and HDB leaves nothing even
 * though a landed tab is still nominally on.
 */
export function toggleGroup(
  form: SearchFormState,
  group: PropertyTypeGroup,
  available: PropertyTypeGroup[] = PROPERTY_TYPE_GROUPS
): SearchFormState {
  if (!form.groups.includes(group)) {
    return {
      ...form,
      groups: PROPERTY_TYPE_GROUPS.filter(g => g === group || form.groups.includes(g)),
    };
  }
  if (isLastGroupOn(form, group, available)) return form;
  return { ...form, groups: form.groups.filter(g => g !== group) };
}

/** Whether this is the one property type still standing, and so cannot be turned off. */
export function isLastGroupOn(
  form: SearchFormState,
  group: PropertyTypeGroup,
  available: PropertyTypeGroup[] = PROPERTY_TYPE_GROUPS
): boolean {
  if (!form.groups.includes(group)) return false;
  return available.filter(g => form.groups.includes(g)).length === 1;
}

/**
 * Whether this group's search is for plots of land alone, which the site answers with a
 * far shorter filter set: a plot has no bedrooms, no floor area and no build year.
 */
export function isLandOnly(group: PropertyTypeGroup, form: FilterFormState): boolean {
  return (
    group === 'L' &&
    form.propertyTypeCode.length > 0 &&
    form.propertyTypeCode.every(code => code === LAND_ONLY_CODE)
  );
}

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

/**
 * Build one group's filters, dropping every one the user left empty.
 *
 * The group decides which filters exist at all: land size is landed only, floor level is
 * hidden for landed, and a search for plots of land carries none of the unit level
 * filters. Those are left out here as well as hidden in the panel, so a value typed
 * before a type was chosen cannot ride along invisibly into the search.
 */
function buildGroupFilters(group: PropertyTypeGroup, form: FilterFormState): SearchFilters {
  const landOnly = isLandOnly(group, form);
  return {
    minPrice: toNumber(form.minPrice),
    maxPrice: toNumber(form.maxPrice),
    bedrooms: landOnly ? undefined : toList(form.bedrooms),
    bathrooms: landOnly ? undefined : toList(form.bathrooms),
    minSize: landOnly ? undefined : toNumber(form.minSize),
    maxSize: landOnly ? undefined : toNumber(form.maxSize),
    minSizeLand: group === 'L' ? toNumber(form.minSizeLand) : undefined,
    maxSizeLand: group === 'L' ? toNumber(form.maxSizeLand) : undefined,
    minPsf: toNumber(form.minPsf),
    maxPsf: toNumber(form.maxPsf),
    propertyTypeCode: toList(form.propertyTypeCode),
    districtCode: toList(form.districtCode),
    tenureCode: toList(form.tenureCode),
    floorLevel: group === 'L' ? undefined : toList(form.floorLevel),
    furnishing: landOnly ? undefined : toList(form.furnishing),
    unitFeatures: landOnly ? undefined : toList(form.unitFeatures),
    projectFeatures: landOnly ? undefined : toList(form.projectFeatures),
    minTop: landOnly ? undefined : toNumber(form.minTop),
    maxTop: landOnly ? undefined : toNumber(form.maxTop),
    distanceToMrt: form.distanceToMrt || undefined,
    keyword: form.keyword.trim() || undefined,
    isVerified: toFlag(form, 'isVerified'),
    withFloorplans: toFlag(form, 'withFloorplans'),
    withStream: toFlag(form, 'withStream'),
    lastPosted: toNumber(form.lastPosted),
  };
}

/**
 * Build the POST body: one search per property type the form covers.
 *
 * They are separate because a single PropertyGuru query cannot span two groups, and each
 * carries its own page budget for the same reason it carries its own filters. The server
 * runs them together and consolidates what comes back into one result set.
 */
export function buildSearchRequest(form: SearchFormState): SearchRequest {
  return {
    source: 'propertyguru',
    searches: form.groups.map(group => ({
      propertyTypeGroup: group,
      maxPages: toNumber(form.forms[group].maxPages) ?? 1,
      filters: buildGroupFilters(group, form.forms[group]),
    })),
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
 * Put one group's filters back in the panel, the inverse of buildGroupFilters.
 *
 * Every field is written rather than merged over the defaults, so a filter the
 * request does not carry is cleared rather than left over from whatever was in the
 * panel before. `sort` and `order` have no field to come back to and are dropped:
 * they are the same on every search the panel builds.
 */
function toFilterForm(search: GroupSearch): FilterFormState {
  const filters = search.filters || {};
  return {
    minPrice: toText(filters.minPrice),
    maxPrice: toText(filters.maxPrice),
    minSize: toText(filters.minSize),
    maxSize: toText(filters.maxSize),
    minSizeLand: toText(filters.minSizeLand),
    maxSizeLand: toText(filters.maxSizeLand),
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
    maxPages: String(search.maxPages ?? 1),
  };
}

/**
 * A stored request or saved search read back into the whole panel.
 *
 * A row with no `searches` is one carrying a flat maxPages and filters, which is every
 * request written before the property type tabs existed. It reads as a single non-landed
 * search, because that is exactly what it was: the scraper hardcoded that group. Nothing
 * is migrated on disk, and the row is rewritten in the new shape the first time it is
 * saved again.
 */
export function toSearchForm(request: {
  searches?: GroupSearch[];
  maxPages?: number;
  filters?: SearchFilters;
}): SearchFormState {
  const searches: GroupSearch[] =
    request.searches && request.searches.length > 0
      ? request.searches
      : [
          {
            propertyTypeGroup: 'N',
            maxPages: request.maxPages ?? 1,
            filters: request.filters ?? {},
          },
        ];

  const forms = { ...DEFAULT_SEARCH_FORM.forms };
  for (const search of searches) forms[search.propertyTypeGroup] = toFilterForm(search);
  return {
    // Canonical tab order rather than the order the request happens to list them in, so
    // two searches covering the same types always read the same way.
    groups: PROPERTY_TYPE_GROUPS.filter(group =>
      searches.some(search => search.propertyTypeGroup === group)
    ),
    forms,
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

/** A short human summary of one property type's active filters. */
export function describeFilters(form: FilterFormState): string {
  const parts: string[] = [];
  if (form.minPrice || form.maxPrice) {
    parts.push(`price ${form.minPrice || 'any'} to ${form.maxPrice || 'any'}`);
  }
  if (form.minSize || form.maxSize) {
    parts.push(`floor area ${form.minSize || 'any'} to ${form.maxSize || 'any'} sqft`);
  }
  if (form.minSizeLand || form.maxSizeLand) {
    parts.push(`land size ${form.minSizeLand || 'any'} to ${form.maxSizeLand || 'any'} sqft`);
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

/**
 * The whole search described one property type at a time, for the agent page context and
 * for the modal that names a search before saving it.
 *
 * Each type is named even when its filters are empty, because covering HDB with no
 * filters at all is a real search and a summary that left it out would describe a
 * different one.
 */
export function describeSearchForm(form: SearchFormState): string {
  return form.groups
    .map(group => `${PROPERTY_TYPE_GROUP_LABELS[group]} (${describeFilters(form.forms[group])})`)
    .join(', ');
}

/**
 * The same search as one line of a list.
 *
 * A search of one type reads out in full, which is what the saved searches list has
 * always shown. Several types do not: three full descriptions on one row are longer than
 * the row, so each type is named with a count of what is set under it instead.
 */
export function summariseSearchForm(form: SearchFormState): string {
  if (form.groups.length === 1) {
    const group = form.groups[0];
    return `${PROPERTY_TYPE_GROUP_LABELS[group]}, ${describeFilters(form.forms[group])}`;
  }
  return form.groups
    .map(group => {
      const count = countFilters(form.forms[group]);
      const label = PROPERTY_TYPE_GROUP_LABELS[group];
      if (count === 0) return `${label} (no filters)`;
      return `${label} (${count} ${count === 1 ? 'filter' : 'filters'})`;
    })
    .join(', ');
}

/** How many of one property type's filter groups are set. Excludes the page budget. */
function countFilters(form: FilterFormState): number {
  return Object.entries(form).filter(([key, value]) => {
    if (key === 'maxPages') return false;
    return Array.isArray(value) ? value.length > 0 : String(value).trim() !== '';
  }).length;
}
