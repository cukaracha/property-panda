import { useState } from 'react';
import { CheckCheck, Map, SlidersHorizontal } from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { DropdownMenu } from '../../../components/inputs/DropdownMenu';
import FilterChipGroup from './FilterChipGroup';
import DistrictMapModal from './DistrictMapModal';
import type { FilterFormState, PropertyTypeGroup } from '../../../types/listings';
import type { ResultFacets } from '../utils/resultsFilter';
import {
  BATHROOM_OPTIONS,
  BEDROOM_OPTIONS,
  DISTANCE_TO_MRT_OPTIONS,
  DISTRICT_OPTIONS,
  FLOOR_LEVEL_OPTIONS,
  formatThousands,
  FURNISHING_OPTIONS,
  isLandOnly,
  KEYWORD_MAX_LENGTH,
  LAST_POSTED_OPTIONS,
  LISTING_FEATURE_OPTIONS,
  MAX_PAGES_LABEL,
  MAX_PAGES_OPTIONS,
  PROJECT_FEATURE_OPTIONS,
  PROPERTY_TYPE_OPTIONS_BY_GROUP,
  stripThousands,
  TENURE_OPTIONS,
  UNIT_FEATURE_OPTIONS,
  toggleOption,
} from '../utils/filterOptions';

export interface SearchFilterFieldsProps {
  /**
   * Which property type these filters belong to. It decides which type codes are on
   * offer and which groups exist at all, exactly as it does on the site: land size is
   * landed only, floor level is not, and a search for plots of land drops everything
   * about a building because a plot has no building on it.
   */
  group: PropertyTypeGroup;
  form: FilterFormState;
  onChange: (form: FilterFormState) => void;
  /**
   * What the results being filtered actually contain. Set only by the results filter,
   * which narrows a result set rather than describing a scrape: with it the groups no
   * result payload can answer are gone, the chips that would match nothing are greyed,
   * and the range fields suggest the span the results cover. Without it this is the
   * search form, unchanged.
   */
  facets?: ResultFacets;
}

type BoundsKey = 'price' | 'size' | 'psf' | 'top';

interface RangeField {
  min: keyof FilterFormState;
  max: keyof FilterFormState;
  label: string;
  /** False for a calendar year, which must never render as "2,003". */
  thousands: boolean;
  /** The observed span that fills this field's placeholders on the results filter. */
  bounds: BoundsKey;
}

type CodeListKey =
  | 'propertyTypeCode'
  | 'districtCode'
  | 'tenureCode'
  | 'floorLevel'
  | 'furnishing'
  | 'unitFeatures'
  | 'projectFeatures'
  | 'listingFeatures';

const PRIMARY_RANGE_FIELDS: RangeField[] = [
  { min: 'minPrice', max: 'maxPrice', label: 'Price', thousands: true, bounds: 'price' },
  { min: 'minSize', max: 'maxSize', label: 'Floor area in sqft', thousands: true, bounds: 'size' },
  { min: 'minTop', max: 'maxTop', label: 'TOP year', thousands: false, bounds: 'top' },
];

const MORE_RANGE_FIELDS: RangeField[] = [
  { min: 'minPsf', max: 'maxPsf', label: 'Price per sqft', thousands: true, bounds: 'psf' },
];

// Land size sits with the primary ranges, since it is the field a landed search is most
// often run on. `bounds` is unused for it: no search result states a plot's land area,
// so the results filter never renders this row.
const LAND_SIZE_FIELD: RangeField = {
  min: 'minSizeLand',
  max: 'maxSizeLand',
  label: 'Land size in sqft',
  thousands: true,
  bounds: 'size',
};

// The groups a search for plots of land does not have, which is what the site itself
// drops for Land only: a plot has no rooms, no furniture and no facilities.
const LAND_ONLY_HIDDEN_KEYS: (keyof FilterFormState)[] = [
  'bedrooms',
  'bathrooms',
  'furnishing',
  'unitFeatures',
  'projectFeatures',
];

// Everything behind the "More filters" toggle, so the button can say how many of them
// are set. A filter the user cannot see is worse than no filter at all.
const MORE_FILTER_KEYS: (keyof FilterFormState)[] = [
  'minPsf',
  'maxPsf',
  'bedrooms',
  'bathrooms',
  'districtCode',
  'floorLevel',
  'furnishing',
  'unitFeatures',
  'projectFeatures',
  'listingFeatures',
  'lastPosted',
  'distanceToMrt',
  'keyword',
];

// The results filter has no collapse: what is left after the unanswerable groups go is
// about what the search panel shows before its own toggle, so hiding half of it again
// would only add a click.
const RESULT_RANGE_FIELDS: RangeField[] = [...PRIMARY_RANGE_FIELDS, ...MORE_RANGE_FIELDS];

const FLOORPLAN_FEATURE_OPTIONS = LISTING_FEATURE_OPTIONS.filter(
  option => option.value === 'withFloorplans'
);

function countActive(form: FilterFormState, keys: (keyof FilterFormState)[]): number {
  return keys.filter(key => {
    const value = form[key];
    return Array.isArray(value) ? value.length > 0 : String(value).trim() !== '';
  }).length;
}

/** The chips in a group with nothing behind them, or undefined when every one is live. */
function unavailableValues<T extends string | number>(
  options: { value: T }[],
  available: Set<T> | undefined
): T[] | undefined {
  if (!available) return undefined;
  return options.map(option => option.value).filter(value => !available.has(value));
}

/**
 * The fourteen filter groups themselves, without the card around them.
 *
 * Its own component because the search panel and the edit modal have to offer exactly
 * the same filters: a group added to one and not the other is a search the user can
 * run but never edit. The filters most searches start from stay on screen and the long
 * tail sits behind a "More filters" toggle, because showing all of them at once buries
 * whatever button follows.
 *
 * With `facets` it renders the same groups a third way, as the results filter. That
 * shares the component for the same reason the first two do: the filters offered over a
 * result set are a subset of the filters that produced it, and a subset is far easier to
 * keep honest here than in a second copy of the same chip wiring.
 */
export default function SearchFilterFields({
  group,
  form,
  onChange,
  facets,
}: SearchFilterFieldsProps) {
  const [showMore, setShowMore] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const typeOptions = PROPERTY_TYPE_OPTIONS_BY_GROUP[group];
  // Everything about a building, dropped for a search that is asking about a plot of
  // land. The values stay in the form so unpicking Land only brings them back, and
  // buildSearchRequest leaves them out of the request for as long as this holds.
  const landOnly = isLandOnly(group, form);

  const setField = (key: keyof FilterFormState, value: string) =>
    onChange({ ...form, [key]: value });

  const toggleCode = (key: CodeListKey, value: string) =>
    onChange({ ...form, [key]: toggleOption(form[key], value) });

  const toggleCount = (key: 'bedrooms' | 'bathrooms', value: number) =>
    onChange({ ...form, [key]: toggleOption(form[key], value) });

  // On the results filter this selects the districts the results reach, since the rest
  // are greyed and selecting them would only narrow the list to nothing.
  const selectAllDistricts = () =>
    onChange({
      ...form,
      districtCode: DISTRICT_OPTIONS.filter(
        option => !facets || facets.districtCode.has(option.value)
      ).map(option => option.value),
    });

  // Only what this property type actually shows, since a badge counting a row that is
  // not on screen sends the user hunting for a filter that is not there.
  const moreCount = countActive(
    form,
    MORE_FILTER_KEYS.filter(key => {
      if (group === 'L' && key === 'floorLevel') return false;
      return !landOnly || !LAND_ONLY_HIDDEN_KEYS.includes(key);
    })
  );

  // Price, then whatever this property type has to say about size and age. Land size
  // stands beside floor area, and is the one size a plot of land has.
  const primaryRanges = PRIMARY_RANGE_FIELDS.flatMap(field => {
    const rows = landOnly && field.min !== 'minPrice' ? [] : [field];
    return field.min === 'minSize' && group === 'L' ? [...rows, LAND_SIZE_FIELD] : rows;
  });

  // The separators are a display concern only: the form keeps the raw digits, so a
  // number never reaches the request body wearing a comma.
  const rangeValue = (field: RangeField, key: keyof FilterFormState) =>
    field.thousands ? formatThousands(String(form[key])) : String(form[key]);

  // Nothing is clamped to the span the results cover: it is stated as a placeholder and
  // a value outside it simply matches nothing, which is a filter answering honestly.
  const placeholder = (field: RangeField, edge: 'Min' | 'Max') => {
    const bounds = facets?.[field.bounds];
    if (!bounds) return edge;
    const value = Math.round(edge === 'Min' ? bounds.min : bounds.max);
    return `${edge} ${field.thousands ? formatThousands(String(value)) : value}`;
  };

  const renderRanges = (fields: RangeField[]) =>
    fields.map(field => (
      <div key={field.label}>
        <p className='type-ui-eyebrow mb-2'>{field.label}</p>
        <div className='flex items-center gap-2'>
          <Input
            type='text'
            inputMode='numeric'
            placeholder={placeholder(field, 'Min')}
            aria-label={`Minimum ${field.label.toLowerCase()}`}
            value={rangeValue(field, field.min)}
            onChange={event => setField(field.min, stripThousands(event.target.value))}
          />
          <span className='shrink-0 text-sm text-muted' aria-hidden>
            to
          </span>
          <Input
            type='text'
            inputMode='numeric'
            placeholder={placeholder(field, 'Max')}
            aria-label={`Maximum ${field.label.toLowerCase()}`}
            value={rangeValue(field, field.max)}
            onChange={event => setField(field.max, stripThousands(event.target.value))}
          />
        </div>
      </div>
    ));

  if (facets) {
    return (
      <>
        <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
          {renderRanges(RESULT_RANGE_FIELDS)}
        </div>

        <div className='mt-4 space-y-4'>
          {/* Not for HDB: the results feed labels every flat "HDB" and never its flat
              type, so the whole row could only ever sit greyed. The tab above is the
              narrowing HDB results can answer. */}
          {group !== 'H' && (
            <FilterChipGroup
              label='Property type'
              options={typeOptions}
              selected={form.propertyTypeCode}
              onToggle={value => toggleCode('propertyTypeCode', value)}
              unavailable={unavailableValues(typeOptions, facets.propertyTypeCode)}
            />
          )}
          <FilterChipGroup
            label='Tenure'
            options={TENURE_OPTIONS}
            selected={form.tenureCode}
            onToggle={value => toggleCode('tenureCode', value)}
            unavailable={unavailableValues(TENURE_OPTIONS, facets.tenureCode)}
          />
          <FilterChipGroup
            label='Bedrooms'
            options={BEDROOM_OPTIONS}
            selected={form.bedrooms}
            onToggle={value => toggleCount('bedrooms', value)}
            unavailable={unavailableValues(BEDROOM_OPTIONS, facets.bedrooms)}
          />
          <FilterChipGroup
            label='Bathrooms'
            options={BATHROOM_OPTIONS}
            selected={form.bathrooms}
            onToggle={value => toggleCount('bathrooms', value)}
            unavailable={unavailableValues(BATHROOM_OPTIONS, facets.bathrooms)}
          />
          {/* No "View on map" here: the map is already beside these results, and it is
              the same selection this row edits. */}
          <FilterChipGroup
            label='Filter by district'
            options={DISTRICT_OPTIONS}
            selected={form.districtCode}
            onToggle={value => toggleCode('districtCode', value)}
            unavailable={unavailableValues(DISTRICT_OPTIONS, facets.districtCode)}
            action={
              <Button variant='ghost' size='sm' onClick={selectAllDistricts}>
                <CheckCheck size={15} />
                Select all
              </Button>
            }
          />
          <FilterChipGroup
            label='Listing features'
            options={FLOORPLAN_FEATURE_OPTIONS}
            selected={form.listingFeatures}
            onToggle={value => toggleCode('listingFeatures', value)}
            unavailable={unavailableValues(FLOORPLAN_FEATURE_OPTIONS, facets.listingFeatures)}
          />

          <div className='grid gap-4 sm:grid-cols-2'>
            <div>
              <p className='type-ui-eyebrow mb-2'>Listed</p>
              <DropdownMenu
                aria-label='Listed within'
                value={form.lastPosted}
                onChange={event => setField('lastPosted', event.target.value)}
              >
                <option value=''>Any date</option>
                {LAST_POSTED_OPTIONS.map(option => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={!facets.lastPosted.has(option.value)}
                  >
                    {option.label}
                  </option>
                ))}
              </DropdownMenu>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>{renderRanges(primaryRanges)}</div>

      <div className='mt-4 space-y-4'>
        <FilterChipGroup
          label='Property type'
          options={typeOptions}
          selected={form.propertyTypeCode}
          onToggle={value => toggleCode('propertyTypeCode', value)}
        />
        <FilterChipGroup
          label='Tenure'
          options={TENURE_OPTIONS}
          selected={form.tenureCode}
          onToggle={value => toggleCode('tenureCode', value)}
        />
      </div>

      <div className='mt-4'>
        <Button variant='ghost' size='sm' onClick={() => setShowMore(current => !current)}>
          <SlidersHorizontal size={16} />
          {showMore ? 'Fewer filters' : 'More filters'}
          {!showMore && moreCount > 0 && <Badge tone='positive'>{`${moreCount} set`}</Badge>}
        </Button>
      </div>

      {showMore && (
        <div className='mt-4 space-y-4 border-t border-line pt-4'>
          <div className='grid gap-4 sm:grid-cols-2'>{renderRanges(MORE_RANGE_FIELDS)}</div>

          {!landOnly && (
            <FilterChipGroup
              label='Bedrooms'
              options={BEDROOM_OPTIONS}
              selected={form.bedrooms}
              onToggle={value => toggleCount('bedrooms', value)}
            />
          )}
          {!landOnly && (
            <FilterChipGroup
              label='Bathrooms'
              options={BATHROOM_OPTIONS}
              selected={form.bathrooms}
              onToggle={value => toggleCount('bathrooms', value)}
            />
          )}
          <FilterChipGroup
            label='Filter by district'
            options={DISTRICT_OPTIONS}
            selected={form.districtCode}
            onToggle={value => toggleCode('districtCode', value)}
            // The chips stay: the map is a second way into the same field, not the only
            // way in, and either view updates the other because both read form.districtCode.
            action={
              <span className='flex items-center gap-1'>
                <Button variant='ghost' size='sm' onClick={selectAllDistricts}>
                  <CheckCheck size={15} />
                  Select all
                </Button>
                <Button variant='ghost' size='sm' onClick={() => setIsMapOpen(true)}>
                  <Map size={15} />
                  View on map
                </Button>
              </span>
            }
          />
          {/* A landed home has no floor to be on, which is why the site drops this row
              for the whole group rather than for Land only alone. */}
          {group !== 'L' && (
            <FilterChipGroup
              label='Floor level'
              options={FLOOR_LEVEL_OPTIONS}
              selected={form.floorLevel}
              onToggle={value => toggleCode('floorLevel', value)}
            />
          )}
          {!landOnly && (
            <FilterChipGroup
              label='Furnishing'
              options={FURNISHING_OPTIONS}
              selected={form.furnishing}
              onToggle={value => toggleCode('furnishing', value)}
            />
          )}
          {!landOnly && (
            <FilterChipGroup
              label='Unit features'
              options={UNIT_FEATURE_OPTIONS}
              selected={form.unitFeatures}
              onToggle={value => toggleCode('unitFeatures', value)}
            />
          )}
          {!landOnly && (
            <FilterChipGroup
              label='Facilities'
              options={PROJECT_FEATURE_OPTIONS}
              selected={form.projectFeatures}
              onToggle={value => toggleCode('projectFeatures', value)}
            />
          )}
          <FilterChipGroup
            label='Listing features'
            options={LISTING_FEATURE_OPTIONS}
            selected={form.listingFeatures}
            onToggle={value => toggleCode('listingFeatures', value)}
          />

          <div className='grid gap-4 sm:grid-cols-2'>
            <div>
              <p className='type-ui-eyebrow mb-2'>Listed</p>
              <DropdownMenu
                aria-label='Listed within'
                value={form.lastPosted}
                onChange={event => setField('lastPosted', event.target.value)}
              >
                <option value=''>Any date</option>
                {LAST_POSTED_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </DropdownMenu>
            </div>
            <div>
              <p className='type-ui-eyebrow mb-2'>Distance to MRT or LRT</p>
              <DropdownMenu
                aria-label='Distance to MRT or LRT'
                value={form.distanceToMrt}
                onChange={event => setField('distanceToMrt', event.target.value)}
              >
                <option value=''>Any distance</option>
                {DISTANCE_TO_MRT_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </DropdownMenu>
            </div>
            <div>
              <p className='type-ui-eyebrow mb-2'>{MAX_PAGES_LABEL}</p>
              <DropdownMenu
                aria-label={MAX_PAGES_LABEL}
                value={form.maxPages}
                onChange={event => setField('maxPages', event.target.value)}
              >
                {MAX_PAGES_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </DropdownMenu>
            </div>
            <div className='sm:col-span-2'>
              <p className='type-ui-eyebrow mb-2'>Keyword</p>
              <Input
                type='text'
                placeholder='Words in the listing, e.g. penthouse'
                aria-label='Keyword'
                maxLength={KEYWORD_MAX_LENGTH}
                value={form.keyword}
                onChange={event => setField('keyword', event.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      <DistrictMapModal
        isOpen={isMapOpen}
        onClose={() => setIsMapOpen(false)}
        selected={form.districtCode}
        onChange={codes => onChange({ ...form, districtCode: codes })}
      />
    </>
  );
}
