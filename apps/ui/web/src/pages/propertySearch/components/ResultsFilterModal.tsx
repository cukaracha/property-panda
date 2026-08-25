import { useState } from 'react';
import { ListFilter } from 'lucide-react';
import Modal from '../../../components/modals/Modal';
import { Button } from '../../../components/ui/button';
import SearchFilterFields from './SearchFilterFields';
import type { FilterFormState } from '../../../types/listings';
import type { ResultFacets } from '../utils/resultsFilter';
import { countResultFilters } from '../utils/resultsFilter';
import { DEFAULT_FILTER_FORM } from '../utils/filterOptions';

export interface ResultsFilterModalProps {
  form: FilterFormState;
  /** What these results contain, which is the whole of what this panel may offer. */
  facets: ResultFacets;
  onClose: () => void;
  onApply: (form: FilterFormState) => void;
}

/**
 * Narrows the results already on screen, using the same filter groups the search itself
 * was run from.
 *
 * A view filter and nothing more, exactly as the map rail beside it is: it re-runs no
 * scrape, touches neither the search form nor the saved search, and starts over with
 * each result set. Which is what lets it be tried freely -- the widest it can ever go is
 * back to what the search returned.
 *
 * The filter is applied on the footer press rather than as the chips are pressed, since
 * the modal covers the cards it would be filtering and a live count nobody can see is no
 * feedback at all. Cancel throws the draft away, and the caller mounts this only while
 * it is open, so each opening starts from what is actually applied.
 */
export default function ResultsFilterModal({
  form,
  facets,
  onClose,
  onApply,
}: ResultsFilterModalProps) {
  const [draft, setDraft] = useState(form);
  const activeCount = countResultFilters(draft);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title='Filter listings'
      description='Narrow what is on screen. Only the values these results contain can be chosen, and nothing here re-runs the search.'
      maxWidth='max-w-[940px]'
      icon={
        <span className='inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-line-brand bg-brand-subtle text-brand'>
          <ListFilter size={20} />
        </span>
      }
      iconColor=''
      footer={
        <>
          <Button
            variant='ghost'
            className='mr-auto'
            disabled={activeCount === 0}
            onClick={() => setDraft(DEFAULT_FILTER_FORM)}
          >
            Clear filters
          </Button>
          <Button variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onApply(draft)}>Apply</Button>
        </>
      }
    >
      {/* The card clips rather than scrolls, so the long half of the modal scrolls
          inside its own box and leaves the footer where it is. */}
      <div className='max-h-[60vh] overflow-y-auto pr-1'>
        <SearchFilterFields form={draft} onChange={setDraft} facets={facets} />
      </div>
    </Modal>
  );
}
