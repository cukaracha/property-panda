import { useState } from 'react';
import { RotateCcw, Search } from 'lucide-react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import PropertyTypeTabs from './PropertyTypeTabs';
import SearchFilterFields from './SearchFilterFields';
import type { PropertyTypeGroup, SearchFormState } from '../../../types/listings';
import { DEFAULT_FILTER_FORM, setGroupForm } from '../utils/filterOptions';

export interface SearchFilterPanelProps {
  form: SearchFormState;
  onChange: (form: SearchFormState) => void;
  onSearch: () => void;
  isBusy: boolean;
}

/**
 * The search form. Ranges stay raw digit strings until the request is built, and the
 * multi choice filters are toggle chips.
 *
 * One search covers as many property types as the strip has switched on, and each of them
 * carries a complete filter set of its own. The fields themselves are SearchFilterFields,
 * which the edit modal renders too. What is left here is the card around them: the
 * heading, the reset and the search button.
 *
 * Reset clears the tab on screen rather than the whole search, because that is the one
 * the user is looking at, and wiping the two they cannot see would be a change with no
 * feedback.
 */
export default function SearchFilterPanel({
  form,
  onChange,
  onSearch,
  isBusy,
}: SearchFilterPanelProps) {
  const [active, setActive] = useState<PropertyTypeGroup>(form.groups[0]);

  return (
    <Card className='p-5'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <h2 className='type-ui-h3 text-strong'>Search filters</h2>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => onChange(setGroupForm(form, active, DEFAULT_FILTER_FORM))}
        >
          <RotateCcw size={16} />
          Reset filters
        </Button>
      </div>

      <div className='mt-4'>
        <PropertyTypeTabs
          form={form}
          onChange={onChange}
          active={active}
          onActiveChange={setActive}
        />
      </div>

      <div className='mt-4'>
        <SearchFilterFields
          group={active}
          form={form.forms[active]}
          onChange={next => onChange(setGroupForm(form, active, next))}
        />
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
