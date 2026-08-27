import { useState } from 'react';
import { ListFilter } from 'lucide-react';
import Modal from '../../../components/modals/Modal';
import { Button } from '../../../components/ui/button';
import PropertyTypeTabs from './PropertyTypeTabs';
import SearchFilterFields from './SearchFilterFields';
import type { PropertyTypeGroup, SearchFormState } from '../../../types/listings';
import type { ResultFacetsByGroup } from '../utils/resultsFilter';
import { countResultFilters, DEFAULT_RESULT_FILTER } from '../utils/resultsFilter';
import { setGroupForm } from '../utils/filterOptions';

export interface ResultsFilterModalProps {
  form: SearchFormState;
  /** The districts the map rail is pointing at, which this panel edits as one shared row. */
  districts: string[];
  /** What these results contain, which is the whole of what this panel may offer. */
  facets: ResultFacetsByGroup;
  onClose: () => void;
  onApply: (form: SearchFormState, districts: string[]) => void;
}

/**
 * Narrows the results already on screen, using the same filter groups the search itself
 * was run from, one property type at a time.
 *
 * A view filter and nothing more, exactly as the map rail beside it is: it re-runs no
 * scrape, touches neither the search form nor the saved search, and starts over with
 * each result set. Which is what lets it be tried freely -- the widest it can ever go is
 * back to what the search returned.
 *
 * The tab strip only offers the types these results actually contain, and turning one off
 * takes that type off the screen. Districts are the one row that is not per type: the map
 * rail edits the same selection, so it is held apart here and handed to whichever tab is
 * showing.
 *
 * The filter is applied on the footer press rather than as the chips are pressed, since
 * the modal covers the cards it would be filtering and a live count nobody can see is no
 * feedback at all. Cancel throws the draft away, and the caller mounts this only while
 * it is open, so each opening starts from what is actually applied.
 */
export default function ResultsFilterModal({
  form,
  districts,
  facets,
  onClose,
  onApply,
}: ResultsFilterModalProps) {
  const [draft, setDraft] = useState(form);
  const [draftDistricts, setDraftDistricts] = useState(districts);
  const [active, setActive] = useState<PropertyTypeGroup>(facets.groups[0] ?? 'N');
  const activeCount = countResultFilters(draft, draftDistricts, facets.groups);

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
            onClick={() => {
              setDraft(DEFAULT_RESULT_FILTER);
              setDraftDistricts([]);
            }}
          >
            Clear filters
          </Button>
          <Button variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onApply(draft, draftDistricts)}>Apply</Button>
        </>
      }
    >
      <div className='modal-scroll'>
        {/* One type of property is one tab, and a strip of one says nothing worth the
            row it would take. */}
        {facets.groups.length > 1 && (
          <div className='mb-4'>
            <PropertyTypeTabs
              form={draft}
              onChange={setDraft}
              active={active}
              onActiveChange={setActive}
              available={facets.groups}
            />
          </div>
        )}
        <SearchFilterFields
          group={active}
          // The districts belong to the map, so they are lent to the tab on screen and
          // split back out on change rather than kept once per type.
          form={{ ...draft.forms[active], districtCode: draftDistricts }}
          onChange={next => {
            setDraftDistricts(next.districtCode);
            setDraft(setGroupForm(draft, active, { ...next, districtCode: [] }));
          }}
          facets={facets.byGroup[active]}
        />
      </div>
    </Modal>
  );
}
