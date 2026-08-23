import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SearchFilterPanel from './components/SearchFilterPanel';
import SearchProgressOverlay from './components/SearchProgressOverlay';
import SearchErrorPanel from './components/SearchErrorPanel';
import { usePropertySearch } from './hooks/usePropertySearch';
import { useSearchPageContext, type SearchPhase } from './PageContext';
import {
  usePropertySearchResultsStore,
  usePropertySearchStore,
} from '../../store/usePropertySearchStore';
import { buildSearchRequest, describeFilters } from './utils/filterOptions';

function derivePhase(
  jobId: string | null,
  hasStatus: boolean,
  statusValue: string | undefined,
  isStarting: boolean,
  error: string
): SearchPhase {
  if (isStarting) return 'running';
  if (error) return 'failed';
  if (!jobId) return 'idle';
  if (!hasStatus) return 'running';
  if (statusValue === 'succeeded') return 'succeeded';
  if (statusValue === 'failed') return 'failed';
  return 'running';
}

/**
 * Property search - the filters, and nothing else until a search has run.
 *
 * A running scrape raises a progress overlay over this screen rather than
 * navigating straight away, which is what keeps the poller out of the routing:
 * the results screen is only reached once the job has finished and its payload
 * is in the store, so nothing has to survive a route change mid-poll. A failed
 * search stays here, where the filters that caused it can be changed.
 */
export default function PropertySearch() {
  const navigate = useNavigate();
  const form = usePropertySearchStore(state => state.form);
  const setForm = usePropertySearchStore(state => state.setForm);
  const setResults = usePropertySearchResultsStore(state => state.setResults);

  const { jobId, status, isStarting, error, startSearch } = usePropertySearch();

  const phase = derivePhase(jobId, status !== null, status?.status, isStarting, error);
  const errorMessage = error || status?.error || '';

  const runSearch = () => startSearch(buildSearchRequest(form));

  // Only a finished search leaves this screen. The status object is a fresh one on
  // every poll, so the terminal check is what makes this fire once rather than per
  // poll, and navigating away unmounts the poller with it.
  useEffect(() => {
    if (status?.status !== 'succeeded') return;
    setResults(status);
    navigate('/properties/results');
  }, [status, setResults, navigate]);

  useSearchPageContext(
    {
      phase,
      status: status?.status ?? null,
      errorMessage,
      filterSummary: describeFilters(form),
    },
    { onRunSearch: runSearch }
  );

  // The overlay sits outside the column, not in it: it is fixed to the viewport with
  // inset 0, and a stacked sibling's margin would otherwise push the scrim down and
  // leave a strip of the page uncovered at the top.
  return (
    <>
      <div className='mx-auto max-w-5xl space-y-5 p-6'>
        <div>
          <h1 className='type-ui-h2 text-ink'>Property search</h1>
          <p className='type-ui-caption'>
            Scrape PropertyGuru for sale listings, grouped by property and unit type.
          </p>
        </div>

        <SearchFilterPanel
          form={form}
          onChange={setForm}
          onSearch={runSearch}
          isBusy={phase === 'running'}
        />

        {phase === 'failed' && (
          <SearchErrorPanel
            message={errorMessage || 'The scrape failed before it returned any results.'}
            detail={status?.errorDetail}
          />
        )}
      </div>

      {phase === 'running' && (
        <SearchProgressOverlay
          status={status?.status ?? 'queued'}
          listingCount={status?.listingCount ?? 0}
          pagesFetched={status?.pagesFetched ?? 0}
          pagesTotal={status?.pagesTotal ?? 0}
          detailsFetched={status?.detailsFetched ?? 0}
          detailsTotal={status?.detailsTotal ?? 0}
          note={status?.note}
        />
      )}
    </>
  );
}
