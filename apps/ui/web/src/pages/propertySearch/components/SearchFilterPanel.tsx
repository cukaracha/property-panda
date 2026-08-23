import { useState } from 'react';
import { RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { DropdownMenu } from '../../../components/inputs/DropdownMenu';
import FilterChipGroup from './FilterChipGroup';
import type { FilterFormState } from '../types/listings';
import {
  BATHROOM_OPTIONS,
  BEDROOM_OPTIONS,
  DEFAULT_FILTER_FORM,
  DISTANCE_TO_MRT_OPTIONS,
  DISTRICT_OPTIONS,
  FLOOR_LEVEL_OPTIONS,
  FURNISHING_OPTIONS,
  KEYWORD_MAX_LENGTH,
  LAST_POSTED_OPTIONS,
  LISTING_FEATURE_OPTIONS,
  MAX_PAGES_LABEL,
  MAX_PAGES_OPTIONS,
  ORDER_OPTIONS,
  PROJECT_FEATURE_OPTIONS,
  PROPERTY_TYPE_OPTIONS,
  SORT_OPTIONS,
  TENURE_OPTIONS,
  UNIT_FEATURE_OPTIONS,
  toggleOption,
} from '../utils/filterOptions';

export interface SearchFilterPanelProps {
  form: FilterFormState;
  onChange: (form: FilterFormState) => void;
  onSearch: () => void;
  isBusy: boolean;
}

interface RangeField {
  min: keyof FilterFormState;
  max: keyof FilterFormState;
  label: string;
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
  { min: 'minPrice', max: 'maxPrice', label: 'Price' },
  { min: 'minSize', max: 'maxSize', label: 'Floor area in sqft' },
];

const MORE_RANGE_FIELDS: RangeField[] = [
  { min: 'minTop', max: 'maxTop', label: 'TOP year' },
  { min: 'minPsf', max: 'maxPsf', label: 'Price per sqft' },
];

// Everything behind the "More filters" toggle, so the button can say how many of them
// are set. A filter the user cannot see is worse than no filter at all.
const MORE_FILTER_KEYS: (keyof FilterFormState)[] = [
  'minTop',
  'maxTop',
  'minPsf',
  'maxPsf',
  'bathrooms',
  'tenureCode',
  'floorLevel',
  'furnishing',
  'unitFeatures',
  'projectFeatures',
  'listingFeatures',
  'distanceToMrt',
  'keyword',
];

function countActive(form: FilterFormState, keys: (keyof FilterFormState)[]): number {
  return keys.filter(key => {
    const value = form[key];
    return Array.isArray(value) ? value.length > 0 : String(value).trim() !== '';
  }).length;
}

/**
 * The search form. Text ranges stay strings until the request is built, and the
 * multi choice filters are toggle chips.
 *
 * The split mirrors PropertyGuru's own: the filters most searches use stay on screen
 * and the long tail sits behind a "More filters" toggle, because showing all fourteen
 * groups at once buries the search button.
 */
export default function SearchFilterPanel({
  form,
  onChange,
  onSearch,
  isBusy,
}: SearchFilterPanelProps) {
  const [showMore, setShowMore] = useState(false);

  const setField = (key: keyof FilterFormState, value: string) =>
    onChange({ ...form, [key]: value });

  const toggleCode = (key: CodeListKey, value: string) =>
    onChange({ ...form, [key]: toggleOption(form[key], value) });

  const toggleCount = (key: 'bedrooms' | 'bathrooms', value: number) =>
    onChange({ ...form, [key]: toggleOption(form[key], value) });

  const moreCount = countActive(form, MORE_FILTER_KEYS);

  const renderRanges = (fields: RangeField[]) =>
    fields.map(field => (
      <div key={field.label}>
        <p className='type-ui-eyebrow mb-1.5'>{field.label}</p>
        <div className='flex items-center gap-2'>
          <Input
            type='number'
            inputMode='numeric'
            placeholder='Min'
            aria-label={`Minimum ${field.label.toLowerCase()}`}
            value={String(form[field.min])}
            onChange={event => setField(field.min, event.target.value)}
          />
          <Input
            type='number'
            inputMode='numeric'
            placeholder='Max'
            aria-label={`Maximum ${field.label.toLowerCase()}`}
            value={String(form[field.max])}
            onChange={event => setField(field.max, event.target.value)}
          />
        </div>
      </div>
    ));

  return (
    <Card className='p-5'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <h2 className='type-ui-h3 text-ink'>Search filters</h2>
        <Button variant='ghost' size='sm' onClick={() => onChange(DEFAULT_FILTER_FORM)}>
          <RotateCcw size={16} />
          Reset filters
        </Button>
      </div>

      <div className='mt-4 grid gap-4 sm:grid-cols-2'>{renderRanges(PRIMARY_RANGE_FIELDS)}</div>

      <div className='mt-4 space-y-4'>
        <FilterChipGroup
          label='Property type'
          options={PROPERTY_TYPE_OPTIONS}
          selected={form.propertyTypeCode}
          onToggle={value => toggleCode('propertyTypeCode', value)}
        />
        <FilterChipGroup
          label='Bedrooms'
          options={BEDROOM_OPTIONS}
          selected={form.bedrooms}
          onToggle={value => toggleCount('bedrooms', value)}
        />
        <FilterChipGroup
          label='District'
          options={DISTRICT_OPTIONS}
          selected={form.districtCode}
          onToggle={value => toggleCode('districtCode', value)}
        />
      </div>

      <div className='mt-4'>
        <Button variant='ghost' size='sm' onClick={() => setShowMore(current => !current)}>
          <SlidersHorizontal size={16} />
          {showMore ? 'Fewer filters' : 'More filters'}
          {!showMore && moreCount > 0 && ` (${moreCount})`}
        </Button>
      </div>

      {showMore && (
        <div className='mt-4 space-y-4 border-t border-line pt-4'>
          <div className='grid gap-4 sm:grid-cols-2'>{renderRanges(MORE_RANGE_FIELDS)}</div>

          <FilterChipGroup
            label='Bathrooms'
            options={BATHROOM_OPTIONS}
            selected={form.bathrooms}
            onToggle={value => toggleCount('bathrooms', value)}
          />
          <FilterChipGroup
            label='Tenure'
            options={TENURE_OPTIONS}
            selected={form.tenureCode}
            onToggle={value => toggleCode('tenureCode', value)}
          />
          <FilterChipGroup
            label='Floor level'
            options={FLOOR_LEVEL_OPTIONS}
            selected={form.floorLevel}
            onToggle={value => toggleCode('floorLevel', value)}
          />
          <FilterChipGroup
            label='Furnishing'
            options={FURNISHING_OPTIONS}
            selected={form.furnishing}
            onToggle={value => toggleCode('furnishing', value)}
          />
          <FilterChipGroup
            label='Unit features'
            options={UNIT_FEATURE_OPTIONS}
            selected={form.unitFeatures}
            onToggle={value => toggleCode('unitFeatures', value)}
          />
          <FilterChipGroup
            label='Facilities'
            options={PROJECT_FEATURE_OPTIONS}
            selected={form.projectFeatures}
            onToggle={value => toggleCode('projectFeatures', value)}
          />
          <FilterChipGroup
            label='Listing features'
            options={LISTING_FEATURE_OPTIONS}
            selected={form.listingFeatures}
            onToggle={value => toggleCode('listingFeatures', value)}
          />

          <div className='grid gap-4 sm:grid-cols-2'>
            <div>
              <p className='type-ui-eyebrow mb-1.5'>Distance to MRT or LRT</p>
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
              <p className='type-ui-eyebrow mb-1.5'>Keyword</p>
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

      <div className='mt-4 grid gap-4 sm:grid-cols-4'>
        <div>
          <p className='type-ui-eyebrow mb-1.5'>Listed</p>
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
          <p className='type-ui-eyebrow mb-1.5'>Sort by</p>
          <DropdownMenu
            aria-label='Sort by'
            value={form.sort}
            onChange={event => setField('sort', event.target.value)}
          >
            {SORT_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </DropdownMenu>
        </div>
        <div>
          <p className='type-ui-eyebrow mb-1.5'>Order</p>
          <DropdownMenu
            aria-label='Order'
            value={form.order}
            onChange={event => setField('order', event.target.value)}
          >
            {ORDER_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </DropdownMenu>
        </div>
        <div>
          <p className='type-ui-eyebrow mb-1.5'>{MAX_PAGES_LABEL}</p>
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
      </div>

      <div className='mt-5 flex justify-end'>
        <Button onClick={onSearch} loading={isBusy} disabled={isBusy}>
          <Search size={16} />
          {isBusy ? 'Searching' : 'Search listings'}
        </Button>
      </div>
    </Card>
  );
}
