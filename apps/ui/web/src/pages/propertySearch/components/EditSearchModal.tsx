import { useState } from 'react';
import { BookmarkX, Eye, Pencil } from 'lucide-react';
import Modal from '../../../components/modals/Modal';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import PropertyTypeTabs from './PropertyTypeTabs';
import SearchFilterFields from './SearchFilterFields';
import { SAVED_SEARCH_NAME_MAX_LENGTH } from './SaveSearchModal';
import type {
  BookmarkedEntity,
  HiddenEntity,
  PropertyTypeGroup,
  SearchFormState,
} from '../../../types/listings';
import { buildSearchRequest, setGroupForm } from '../utils/filterOptions';

export interface EditSearchModalProps {
  name: string;
  form: SearchFormState;
  hidden: HiddenEntity[];
  bookmarked: BookmarkedEntity[];
  /** "Save and rerun" from the results, "Save" from the saved searches list. */
  confirmLabel: string;
  isSaving: boolean;
  onClose: () => void;
  onSave: (
    name: string,
    form: SearchFormState,
    hidden: HiddenEntity[],
    bookmarked: BookmarkedEntity[]
  ) => void;
}

const GROUPS: { scope: HiddenEntity['scope']; title: string }[] = [
  { scope: 'property', title: 'Hidden properties' },
  { scope: 'unit', title: 'Hidden units' },
];

/**
 * The filters as the request they would send, which is what makes two forms the same
 * search. Retyping a field to the value it already had is not a change, and neither is
 * clearing one that was already empty.
 */
function describeRequest(form: SearchFormState): string {
  return JSON.stringify(buildSearchRequest(form));
}

function describeKeys(entities: { entityKey: string }[]): string {
  return entities.map(entity => entity.entityKey).join('|');
}

/**
 * Edits one saved search: its name, its filters, the items it hides and the properties
 * it pins to the top.
 *
 * All of it in one modal because it is one thing to the user, and nothing here touches
 * the stored search until the footer is pressed. Cancel throws the draft away, which is
 * what makes unhiding or unpinning something in here safe to try. The footer stays
 * disabled until something actually differs from what is stored.
 *
 * The caller mounts this only while it is open, so each opening starts from what is
 * stored rather than from a draft left over from the last time.
 */
export default function EditSearchModal({
  name,
  form,
  hidden,
  bookmarked,
  confirmLabel,
  isSaving,
  onClose,
  onSave,
}: EditSearchModalProps) {
  const [draftName, setDraftName] = useState(name);
  const [draftForm, setDraftForm] = useState(form);
  const [active, setActive] = useState<PropertyTypeGroup>(form.groups[0]);
  const [draftHidden, setDraftHidden] = useState(hidden);
  const [draftBookmarked, setDraftBookmarked] = useState(bookmarked);

  const trimmed = draftName.trim();
  // Saving from the results screen also re-runs the scrape, which opens a browser
  // window, so a press that would store exactly what is already stored is not offered.
  const hasChanges =
    trimmed !== name.trim() ||
    describeRequest(draftForm) !== describeRequest(form) ||
    describeKeys(draftHidden) !== describeKeys(hidden) ||
    describeKeys(draftBookmarked) !== describeKeys(bookmarked);

  const save = () => {
    if (!trimmed || !hasChanges || isSaving) return;
    onSave(trimmed, draftForm, draftHidden, draftBookmarked);
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      dismissible={!isSaving}
      title='Edit search'
      description='Change the name, the filters, or what this search keeps hidden and pinned.'
      maxWidth='max-w-[940px]'
      icon={
        <span className='inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-line-brand bg-brand-subtle text-brand'>
          <Pencil size={20} />
        </span>
      }
      iconColor=''
      footer={
        <>
          <Button variant='outline' onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!trimmed || !hasChanges || isSaving}>
            {isSaving ? 'Saving' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className='modal-scroll'>
        <label className='type-ui-eyebrow mb-2 block' htmlFor='edit-search-name'>
          Name
        </label>
        <Input
          id='edit-search-name'
          value={draftName}
          maxLength={SAVED_SEARCH_NAME_MAX_LENGTH}
          autoFocus
          onChange={event => setDraftName(event.target.value)}
        />
        {!trimmed && <p className='type-ui-sm mt-2 text-danger'>A search needs a name.</p>}

        <div className='mt-5 space-y-4 border-t border-line pt-4'>
          <PropertyTypeTabs
            form={draftForm}
            onChange={setDraftForm}
            active={active}
            onActiveChange={setActive}
          />
          <SearchFilterFields
            group={active}
            form={draftForm.forms[active]}
            onChange={next => setDraftForm(setGroupForm(draftForm, active, next))}
          />
        </div>

        <div className='mt-5 space-y-4 border-t border-line pt-4'>
          <p className='type-ui-eyebrow'>Hidden items</p>
          {draftHidden.length === 0 ? (
            <p className='type-ui-sm text-muted'>This search hides nothing.</p>
          ) : (
            GROUPS.map(group => {
              const entries = draftHidden.filter(entity => entity.scope === group.scope);
              if (entries.length === 0) return null;
              return (
                <div key={group.scope}>
                  <p className='type-ui-sm mb-1 text-muted'>{group.title}</p>
                  <ul className='divide-y divide-line-2 border-y border-line'>
                    {entries.map(entity => (
                      <li
                        key={entity.entityKey}
                        className='flex items-center justify-between gap-3 py-2'
                      >
                        <span className='min-w-0 truncate text-sm text-body'>{entity.label}</span>
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() =>
                            setDraftHidden(current =>
                              current.filter(item => item.entityKey !== entity.entityKey)
                            )
                          }
                        >
                          <Eye size={16} />
                          Unhide
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </div>

        <div className='mt-5 space-y-4 border-t border-line pt-4'>
          <p className='type-ui-eyebrow'>Bookmarked properties</p>
          {draftBookmarked.length === 0 ? (
            <p className='type-ui-sm text-muted'>This search bookmarks nothing.</p>
          ) : (
            <ul className='divide-y divide-line-2 border-y border-line'>
              {draftBookmarked.map(entity => (
                <li key={entity.entityKey} className='flex items-center justify-between gap-3 py-2'>
                  <span className='min-w-0 truncate text-sm text-body'>{entity.label}</span>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() =>
                      setDraftBookmarked(current =>
                        current.filter(item => item.entityKey !== entity.entityKey)
                      )
                    }
                  >
                    <BookmarkX size={16} />
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
