import { useState } from 'react';
import { Map, SlidersHorizontal } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { DropdownMenu } from '../../../components/inputs/DropdownMenu';
import FilterChipGroup from './FilterChipGroup';
import DistrictMapModal from './DistrictMapModal';
import type { FilterFormState } from '../../../types/listings';
import {
  BATHROOM_OPTIONS,
  BEDROOM_OPTIONS,
  DISTANCE_TO_MRT_OPTIONS,
  DISTRICT_OPTIONS,
  FLOOR_LEVEL_OPTIONS,
  formatThousands,
  FURNISHING_OPTIONS,
  KEYWORD_MAX_LENGTH,
  LAST_POSTED_OPTIONS,
  LISTING_FEATURE_OPTIONS,
  MAX_PAGES_LABEL,
  MAX_PAGES_OPTIONS,
  PROJECT_FEATURE_OPTIONS,
  PROPERTY_TYPE_OPTIONS,
  stripThousands,
  TENURE_OPTIONS,
  UNIT_FEATURE_OPTIONS,
  toggleOption,
} from '../utils/filterOptions';

export interface SearchFilterFieldsProps {
  form: FilterFormState;
  onChange: (form: FilterFormState) => void;
}

interface RangeField {
  min: keyof FilterFormState;
  max: keyof FilterFormState;
  label: string;
  /** False for a calendar year, which must never render as "2,003". */
  thousands: boolean;
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
  { min: 'minPrice', max: 'maxPrice', label: 'Price', thousands: true },
  { min: 'minSize', max: 'maxSize', label: 'Floor area in sqft', thousands: true },
  { min: 'minTop', max: 'maxTop', label: 'TOP year', thousands: false },
];

const MORE_RANGE_FIELDS: RangeField[] = [
  { min: 'minPsf', max: 'maxPsf', label: 'Price per sqft', thousands: true },
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

function countActive(form: FilterFormState, keys: (keyof FilterFormState)[]): number {
  return keys.filter(key => {
    const value = form[key];
    return Array.isArray(value) ? value.length > 0 : String(value).trim() !== '';
  }).length;
}

/**
 * The fourteen filter groups themselves, without the card around them.
 *
 * Its own component because the search panel and the edit modal have to offer exactly
 * the same filters: a group added to one and not the other is a search the user can
 * run but never edit. The filters most searches start from stay on screen and the long
 * tail sits behind a "More filters" toggle, because showing all of them at once buries
 * whatever button follows.
 */
export default function SearchFilterFields({ form, onChange }: SearchFilterFieldsProps) {
  const [showMore, setShowMore] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);

  const setField = (key: keyof FilterFormState, value: string) =>
    onChange({ ...form, [key]: value });

  const toggleCode = (key: CodeListKey, value: string) =>
    onChange({ ...form, [key]: toggleOption(form[key], value) });

  const toggleCount = (key: 'bedrooms' | 'bathrooms', value: number) =>
    onChange({ ...form, [key]: toggleOption(form[key], value) });

  const moreCount = countActive(form, MORE_FILTER_KEYS);

  // The separators are a display concern only: the form keeps the raw digits, so a
  // number never reaches the request body wearing a comma.
  const rangeValue = (field: RangeField, key: keyof FilterFormState) =>
    field.thousands ? formatThousands(String(form[key])) : String(form[key]);

  const renderRanges = (fields: RangeField[]) =>
    fields.map(field => (
      <div key={field.label}>
        <p className='type-ui-eyebrow mb-1.5'>{field.label}</p>
        <div className='flex items-center gap-2'>
          <Input
            type='text'
            inputMode='numeric'
            placeholder='Min'
            aria-label={`Minimum ${field.label.toLowerCase()}`}
            value={rangeValue(field, field.min)}
            onChange={event => setField(field.min, stripThousands(event.target.value))}
          />
          <span className='text-sm text-ink-3' aria-hidden>
            -
          </span>
          <Input
            type='text'
            inputMode='numeric'
            placeholder='Max'
            aria-label={`Maximum ${field.label.toLowerCase()}`}
            value={rangeValue(field, field.max)}
            onChange={event => setField(field.max, stripThousands(event.target.value))}
          />
        </div>
      </div>
    ));

  return (
    <>
      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
        {renderRanges(PRIMARY_RANGE_FIELDS)}
      </div>

      <div className='mt-4 space-y-4'>
        <FilterChipGroup
          label='Property type'
          options={PROPERTY_TYPE_OPTIONS}
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
          {!showMore && moreCount > 0 && ` (${moreCount})`}
        </Button>
      </div>

      {showMore && (
        <div className='mt-4 space-y-4 border-t border-line pt-4'>
          <div className='grid gap-4 sm:grid-cols-2'>{renderRanges(MORE_RANGE_FIELDS)}</div>

          <FilterChipGroup
            label='Bedrooms'
            options={BEDROOM_OPTIONS}
            selected={form.bedrooms}
            onToggle={value => toggleCount('bedrooms', value)}
          />
          <FilterChipGroup
            label='Bathrooms'
            options={BATHROOM_OPTIONS}
            selected={form.bathrooms}
            onToggle={value => toggleCount('bathrooms', value)}
          />
          <FilterChipGroup
            label='District'
            options={DISTRICT_OPTIONS}
            selected={form.districtCode}
            onToggle={value => toggleCode('districtCode', value)}
            // The chips stay: the map is a second way into the same field, not the only
            // way in, and either view updates the other because both read form.districtCode.
            action={
              <Button variant='ghost' size='sm' onClick={() => setIsMapOpen(true)}>
                <Map size={15} />
                View on map
              </Button>
            }
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
            <div className='sm:col-span-2'>
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

      <DistrictMapModal
        isOpen={isMapOpen}
        onClose={() => setIsMapOpen(false)}
        selected={form.districtCode}
        onChange={codes => onChange({ ...form, districtCode: codes })}
      />
    </>
  );
}
