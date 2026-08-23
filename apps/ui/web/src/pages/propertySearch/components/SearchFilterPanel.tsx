import { RotateCcw, Search } from 'lucide-react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import SearchFilterFields from './SearchFilterFields';
import type { FilterFormState } from '../types/listings';
import { DEFAULT_FILTER_FORM } from '../utils/filterOptions';

export interface SearchFilterPanelProps {
  form: FilterFormState;
  onChange: (form: FilterFormState) => void;
  onSearch: () => void;
  isBusy: boolean;
}

/**
 * The search form. Ranges stay raw digit strings until the request is built, and the
 * multi choice filters are toggle chips.
 *
 * The fields themselves are SearchFilterFields, which the edit modal renders too. What
 * is left here is the card around them: the heading, the reset and the search button.
 */
export default function SearchFilterPanel({
  form,
  onChange,
  onSearch,
  isBusy,
}: SearchFilterPanelProps) {
  return (
    <Card className='p-5'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <h2 className='type-ui-h3 text-ink'>Search filters</h2>
        <Button variant='ghost' size='sm' onClick={() => onChange(DEFAULT_FILTER_FORM)}>
          <RotateCcw size={16} />
          Reset filters
        </Button>
      </div>

      <div className='mt-4'>
        <SearchFilterFields form={form} onChange={onChange} />
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
