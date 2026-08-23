import { useNavigate } from 'react-router-dom';
import SearchFilterPanel from './components/SearchFilterPanel';
import SearchErrorPanel from './components/SearchErrorPanel';
import { useStartSearch } from './hooks/useStartSearch';
import { useSearchPageContext } from './PageContext';
import {
  usePropertySearchResultsStore,
  usePropertySearchStore,
} from '../../store/usePropertySearchStore';
import { buildSearchRequest, describeFilters } from './utils/filterOptions';

/**
 * Property search - the filters, and nothing else.
 *
 * Starting a search hands the job straight to the results screen, which is where
 * the progress is watched. Nothing is polled here, so the navigation is a plain
 * click handler rather than an effect chasing a status.
 *
 * The only failure that stays on this screen is a search that never started,
 * since that is the one the filters can be changed to fix.
 */
export default function PropertySearch() {
  const navigate = useNavigate();
  const form = usePropertySearchStore(state => state.form);
  const setForm = usePropertySearchStore(state => state.setForm);
  const startJob = usePropertySearchResultsStore(state => state.startJob);

  const { isStarting, error, startSearch } = useStartSearch();

  const runSearch = async () => {
    const jobId = await startSearch(buildSearchRequest(form));
    if (!jobId) return;
    startJob(jobId);
    navigate('/properties/results');
  };

  useSearchPageContext(
    { errorMessage: error, filterSummary: describeFilters(form) },
    { onRunSearch: runSearch }
  );

  return (
    <div className='mx-auto max-w-5xl space-y-5 p-6'>
      <div>
        <h1 className='type-ui-h2 text-ink'>Property search</h1>
        <p className='type-ui-caption'>
          Scrape PropertyGuru for sale listings, grouped by property and unit type.
        </p>
      </div>

      <SearchFilterPanel form={form} onChange={setForm} onSearch={runSearch} isBusy={isStarting} />

      {error && <SearchErrorPanel message={error} />}
    </div>
  );
}
