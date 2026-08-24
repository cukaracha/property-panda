import { useState } from 'react';
import { Bookmark } from 'lucide-react';
import Modal from '../../../components/modals/Modal';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';

/** The server caps the name at the same length, so the field stops before the 400. */
export const SAVED_SEARCH_NAME_MAX_LENGTH = 80;

// Long enough to name a search by its distinctive filters, short enough to stay one
// line in the saved list. The full summary is under the field either way.
const SUGGESTED_NAME_MAX_LENGTH = 60;

interface SaveSearchModalProps {
  filterSummary: string;
  isSaving: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}

function suggestName(filterSummary: string): string {
  if (filterSummary.length <= SUGGESTED_NAME_MAX_LENGTH) return filterSummary;
  const clipped = filterSummary.slice(0, SUGGESTED_NAME_MAX_LENGTH);
  const lastBreak = clipped.lastIndexOf(', ');
  return lastBreak > 0 ? clipped.slice(0, lastBreak) : clipped.trimEnd();
}

/**
 * Names a search before it is saved.
 *
 * The field starts from the filter summary rather than empty, because the name is
 * the only thing the saved list is scanned by and a suggested one is quicker to
 * edit than to write. It cannot be left empty: the name is how the search is found
 * again. The whole summary sits under it, so what is being saved is on screen before
 * the name is chosen.
 *
 * The caller mounts this only while it is open, which is what makes reopening start
 * from the current filters rather than from a name typed for an earlier search.
 */
export default function SaveSearchModal({
  filterSummary,
  isSaving,
  onClose,
  onSave,
}: SaveSearchModalProps) {
  const [name, setName] = useState(() => suggestName(filterSummary));

  const trimmed = name.trim();

  const save = () => {
    if (!trimmed || isSaving) return;
    onSave(trimmed);
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      dismissible={!isSaving}
      title='Save search'
      description='Saved searches sit under the filters on the search page. Click one to run it again.'
      icon={
        <span className='inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-line-brand bg-brand-subtle text-brand'>
          <Bookmark size={20} />
        </span>
      }
      iconColor=''
      footer={
        <>
          <Button variant='outline' onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!trimmed || isSaving}>
            {isSaving ? 'Saving' : 'Save search'}
          </Button>
        </>
      }
    >
      <label className='type-ui-eyebrow mb-2 block' htmlFor='saved-search-name'>
        Name
      </label>
      <Input
        id='saved-search-name'
        value={name}
        maxLength={SAVED_SEARCH_NAME_MAX_LENGTH}
        autoFocus
        onChange={event => setName(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') save();
        }}
      />
      <p className='type-ui-sm mt-3 text-muted'>{filterSummary}</p>
    </Modal>
  );
}
