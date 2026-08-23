/**
 * Property search contract - the shapes returned by the listings API and the
 * shapes the search form sends back to it.
 *
 * `status`, `propertyCount`, `unitCount` and `error` are always present on a
 * results response. `scrapedAt`, `properties` and `hiddenCounts` only appear
 * once the job has succeeded, so every consumer must treat them as optional.
 * Fields inside `info` are null when enrichment failed
 * (`info.enrichment === 'unavailable'`).
 */

export type SearchStatus = 'queued' | 'scraping' | 'enriching' | 'succeeded' | 'failed';

export type Enrichment = 'ok' | 'unavailable';

export interface Floorplan {
  label: string | null;
  imageUrl: string | null;
}

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
  floorplans: Floorplan[];
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
  hidden: boolean;
}

export interface UnitType {
  key: string;
  label: string;
  bedrooms: number | null;
  overview: UnitTypeOverviewData;
  units: Unit[];
}

export interface Property {
  propertyId: string;
  name: string;
  hidden: boolean;
  info: PropertyInfo;
  unitTypes: UnitType[];
}

export interface HiddenCounts {
  properties: number;
  units: number;
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
  scrapedAt?: number;
  properties?: Property[];
  hiddenCounts?: HiddenCounts;
  /** True when the scrape stopped before the last page, so results are partial. */
  truncated?: boolean;
  pagesScanned?: number;
  totalPages?: number;
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

export interface ListHiddenResponse {
  hidden: HiddenEntity[];
}

export interface HiddenMutationResponse {
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
  sort: string;
  order: string;
  maxPages: string;
}
