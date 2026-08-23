/**
 * Property search contract - the shapes returned by the listings API and the
 * shapes the search form sends back to it.
 *
 * `status`, `propertyCount`, `unitCount` and `error` are always present on a
 * results response. `scrapedAt` and `properties` only appear once the job has
 * succeeded, so every consumer must treat them as optional.
 * Fields inside `info` are null when enrichment failed
 * (`info.enrichment === 'unavailable'`).
 */

export type SearchStatus = 'queued' | 'scraping' | 'enriching' | 'succeeded' | 'failed';

export type Enrichment = 'ok' | 'unavailable';

export interface PropertyInfo {
  district: string | null;
  districtName: string | null;
  regionName: string | null;
  address: string | null;
  topYear: number | null;
  totalUnits: number | null;
  floors: number | null;
  tenure: string | null;
  developer: string | null;
  propertyType: string | null;
  psfRange: string | null;
  projectUrl: string | null;
  imageUrl: string | null;
  enrichment: Enrichment;
}

export interface UnitTypeOverviewData {
  sqftMin: number | null;
  sqftMax: number | null;
  typicalSqft: number | null;
  unitCount: number;
  priceMin: number | null;
  priceMax: number | null;
  psfMin: number | null;
  psfMax: number | null;
}

export interface Unit {
  listingId: number;
  price: number | null;
  bathrooms: number | null;
  floorAreaSqft: number | null;
  psf: number | null;
  url: string;
  listedAt: number | null;
  listedLabel: string | null;
  agentName: string | null;
  agencyName: string | null;
  /**
   * The listing's own floorplan images, newest scrape onwards. Results cached before
   * the scraper started keeping them have no key at all, so read it defensively.
   */
  floorplans?: string[];
}

export interface UnitType {
  key: string;
  label: string;
  bedrooms: number | null;
  overview: UnitTypeOverviewData;
  units: Unit[];
}

/**
 * One row of a property's consolidated listings table. A unit carries no bedroom
 * count of its own, because the scraper hangs that off the unit type it grouped
 * the unit into, so flattening a property back into one table joins each unit to
 * its type on the way out.
 */
export interface ListingRow extends Unit {
  bedrooms: number | null;
  unitTypeLabel: string;
}

export interface Property {
  propertyId: string;
  name: string;
  info: PropertyInfo;
  unitTypes: UnitType[];
}

export interface SearchResultsResponse {
  jobId: string;
  status: SearchStatus;
  propertyCount: number;
  unitCount: number;
  error: string | null;
  /** The worker's traceback or the browser's stderr, for debugging a failed job. */
  errorDetail?: string | null;
  /**
   * What the scrape is currently blocked on, while it is blocked. The local scraper
   * sets this when Cloudflare puts up a challenge the browser could not clear by
   * itself, so the page can tell the user to go and click in the Chrome window it
   * opened. It clears again on its own once the page loads.
   */
  note?: string | null;
  /**
   * Live progress for the readout. Every one is present on every response, and a
   * total is 0 until the phase that knows it begins: the page total only exists
   * once page 1 has reported how many pages there are, and a `detailsTotal` of 0
   * during enrichment means the property cache already covered every property.
   */
  listingCount: number;
  pagesFetched: number;
  pagesTotal: number;
  detailsFetched: number;
  detailsTotal: number;
  scrapedAt?: number;
  properties?: Property[];
  /** True when the scrape stopped before the last page, so results are partial. */
  truncated?: boolean;
  pagesScanned?: number;
  totalPages?: number;
  /**
   * True when the job row outlived the result file behind it, which is what a
   * succeeded job with nothing to show looks like after a prune. An end state, not
   * a fault, so the page says the results are gone rather than that nothing matched.
   */
  expired?: boolean;
}

export interface TriggerSearchResponse {
  jobId: string;
}

export type HiddenScope = 'property' | 'unit';

export interface HiddenEntity {
  entityKey: string;
  scope: HiddenScope;
  id: string;
  label: string;
  createdAt: number;
}

export type PendingHide =
  | { scope: 'property'; property: Property }
  | { scope: 'unit'; property: Property; row: ListingRow };

export interface MutationResponse {
  message?: string;
}

export interface SearchFilters {
  minPrice?: number;
  maxPrice?: number;
  bedrooms?: number[];
  bathrooms?: number[];
  minSize?: number;
  maxSize?: number;
  minPsf?: number;
  maxPsf?: number;
  propertyTypeCode?: string[];
  districtCode?: string[];
  tenureCode?: string[];
  floorLevel?: string[];
  furnishing?: string[];
  unitFeatures?: string[];
  projectFeatures?: string[];
  minTop?: number;
  maxTop?: number;
  distanceToMrt?: string;
  keyword?: string;
  isVerified?: boolean;
  withFloorplans?: boolean;
  withStream?: boolean;
  lastPosted?: number;
  sort?: string;
  order?: string;
}

export interface SearchRequest {
  source: 'propertyguru';
  maxPages: number;
  filters: SearchFilters;
}

/**
 * One search kept for re-running. It stores the request rather than the form, so the
 * server holds the same shape it validates a live search against, and the panel is
 * repopulated from it through toFilterForm.
 *
 * Hiding is part of the search rather than a list of its own, so re-running a saved
 * search brings back the same properties and units dismissed the last time.
 */
export interface SavedSearch {
  searchId: string;
  name: string;
  source: 'propertyguru';
  maxPages: number;
  filters: SearchFilters;
  hidden: HiddenEntity[];
  createdAt: number;
}

export interface ListSavedSearchesResponse {
  savedSearches: SavedSearch[];
}

/**
 * The filter panel's raw form state: text inputs stay strings until submit.
 *
 * `listingFeatures` is one chip group in the panel but three separate flags on the
 * request, because that is how PropertyGuru models it: it groups them under "Listing
 * Features" and still sends isVerified / withFloorplans / withStream individually.
 */
export interface FilterFormState {
  minPrice: string;
  maxPrice: string;
  minSize: string;
  maxSize: string;
  minPsf: string;
  maxPsf: string;
  minTop: string;
  maxTop: string;
  bedrooms: number[];
  bathrooms: number[];
  propertyTypeCode: string[];
  districtCode: string[];
  tenureCode: string[];
  floorLevel: string[];
  furnishing: string[];
  unitFeatures: string[];
  projectFeatures: string[];
  listingFeatures: string[];
  distanceToMrt: string;
  keyword: string;
  lastPosted: string;
  /** "0" means every page the search has. See MAX_PAGES_OPTIONS. */
  maxPages: string;
}
