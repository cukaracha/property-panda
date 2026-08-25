import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SearchFilterPanel from './components/SearchFilterPanel';
import SavedSearchesPanel from './components/SavedSearchesPanel';
import SearchErrorPanel from './components/SearchErrorPanel';
import EditSearchModal from './components/EditSearchModal';
import DeleteSearchConfirmModal from './components/DeleteSearchConfirmModal';
import { useSavedSearches } from './hooks/useSavedSearches';
import { useStartSearch } from './hooks/useStartSearch';
import { useSearchPageContext } from './PageContext';
import {
  usePropertySearchResultsStore,
  usePropertySearchStore,
} from '../../store/usePropertySearchStore';
import type {
  BookmarkedEntity,
  FilterFormState,
  HiddenEntity,
  SavedSearch,
} from '../../types/listings';
import { buildSearchRequest, describeFilters, toFilterForm } from './utils/filterOptions';

/**
 * Property search - the filters, and the searches kept from earlier.
 *
 * Starting a search hands the job straight to the results screen, which is where
 * the progress is watched. Nothing is polled here, so the navigation is a plain
 * click handler rather than an effect chasing a status.
 *
 * The only failure that stays on this screen is a search that never started,
 * since that is the one the filters can be changed to fix.
 *
 * Clicking a saved search runs it, carrying its stored hidden items and bookmarks
 * into the new results. Editing one from its menu changes the stored row and stops there, which
 * is the difference between that modal and the one on the results screen.
 */
export default function PropertySearch() {
  const navigate = useNavigate();
  const form = usePropertySearchStore(state => state.form);
  const setForm = usePropertySearchStore(state => state.setForm);
  const startJob = usePropertySearchResultsStore(state => state.startJob);
  const [editing, setEditing] = useState<SavedSearch | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [deleting, setDeleting] = useState<SavedSearch | null>(null);
  const [runningSearchId, setRunningSearchId] = useState<string | null>(null);

  const { isStarting, error, startSearch } = useStartSearch();
  const {
    savedSearches,
    isLoading: isLoadingSaved,
    error: savedError,
    update: updateSavedSearch,
    remove: deleteSavedSearch,
  } = useSavedSearches();

  const runSearch = async () => {
    const jobId = await startSearch(buildSearchRequest(form));
    if (!jobId) return;
    startJob(jobId, form, null);
    navigate('/search/results');
  };

  // The saved row goes with the job, so the results screen knows which search it is
  // showing, hides what that search was already hiding and pins what it already pinned.
  const runSavedSearch = async (saved: SavedSearch) => {
    setRunningSearchId(saved.searchId);
    const savedForm = toFilterForm(saved);
    const jobId = await startSearch(buildSearchRequest(savedForm), saved.searchId);
    setRunningSearchId(null);
    if (!jobId) return;
    setForm(savedForm);
    startJob(jobId, savedForm, {
      searchId: saved.searchId,
      name: saved.name,
      hidden: saved.hidden,
      bookmarked: saved.bookmarked,
      lastRunAt: saved.lastRunAt,
    });
    navigate('/search/results');
  };

  const runSavedSearchById = (searchId: string) => {
    const saved = savedSearches.find(search => search.searchId === searchId);
    if (saved) runSavedSearch(saved);
  };

  const saveEdit = async (
    name: string,
    edited: FilterFormState,
    hidden: HiddenEntity[],
    bookmarked: BookmarkedEntity[]
  ) => {
    if (!editing) return;
    setIsUpdating(true);
    const saved = await updateSavedSearch(
      editing.searchId,
      name,
      buildSearchRequest(edited),
      hidden,
      bookmarked
    );
    setIsUpdating(false);
    if (saved) setEditing(null);
  };

  useSearchPageContext(
    { errorMessage: error, filterSummary: describeFilters(form), savedSearches },
    {
      onRunSearch: runSearch,
      onRunSavedSearch: runSavedSearchById,
      // The panel already shows why a delete failed, so the assistant's own copy of
      // it is swallowed rather than left as an unhandled rejection.
      onDeleteSavedSearch: searchId => {
        deleteSavedSearch(searchId).catch(() => {});
      },
    }
  );

  return (
    <>
      <div className='page-scroll'>
        <div className='mx-auto max-w-[1080px] space-y-6 px-6 pb-24 pt-10'>
          <h1 className='type-ui-page-title text-strong'>Property search</h1>

          <SearchFilterPanel
            form={form}
            onChange={setForm}
            onSearch={runSearch}
            isBusy={isStarting}
          />

          <SavedSearchesPanel
            savedSearches={savedSearches}
            isLoading={isLoadingSaved}
            error={savedError}
            runningSearchId={runningSearchId}
            isStarting={isStarting}
            onRun={runSavedSearch}
            onEdit={setEditing}
            onDelete={setDeleting}
          />

          {error && <SearchErrorPanel message={error} />}
        </div>
      </div>

      {editing && (
        <EditSearchModal
          name={editing.name}
          form={toFilterForm(editing)}
          hidden={editing.hidden}
          bookmarked={editing.bookmarked}
          confirmLabel='Save'
          isSaving={isUpdating}
          onClose={() => setEditing(null)}
          onSave={saveEdit}
        />
      )}

      <DeleteSearchConfirmModal
        search={deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await deleteSavedSearch(deleting.searchId);
        }}
      />
    </>
  );
}
