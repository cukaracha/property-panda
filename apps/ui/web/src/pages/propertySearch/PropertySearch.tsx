import { useState } from 'react';
import { Eye, EyeOff, SearchX } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import SearchFilterPanel from './components/SearchFilterPanel';
import ScrapeProgress from './components/ScrapeProgress';
import SearchErrorPanel from './components/SearchErrorPanel';
import PropertyCard from './components/PropertyCard';
import HiddenPanel from './components/HiddenPanel';
import HideConfirmModal from './components/HideConfirmModal';
import { usePropertySearch } from './hooks/usePropertySearch';
import { useHiddenEntities } from './hooks/useHiddenEntities';
import { usePropertySearchPageContext, type SearchPhase } from './PageContext';
import type { FilterFormState, PendingHide, Property, Unit, UnitType } from './types/listings';
import { buildSearchRequest, DEFAULT_FILTER_FORM, describeFilters } from './utils/filterOptions';
import { formatCurrency } from './utils/format';

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
 * Property search - run the PropertyGuru scraper, then browse the results by
 * property and unit type.
 *
 * The poller returns the results itself, so the cards render straight off the
 * polled status. Hidden properties and units stay in that result set and are
 * filtered at render time, which is what makes a hide reversible.
 */
export default function PropertySearch() {
  const [form, setForm] = useState<FilterFormState>(DEFAULT_FILTER_FORM);
  const [activeTabs, setActiveTabs] = useState<Record<string, string>>({});
  const [showHidden, setShowHidden] = useState(false);
  const [pendingHide, setPendingHide] = useState<PendingHide | null>(null);

  const { jobId, status, isStarting, error, startSearch } = usePropertySearch();
  const {
    hidden,
    hiddenPropertyIds,
    hiddenUnitIds,
    isLoading: isLoadingHidden,
    error: hiddenError,
    hide,
    unhide,
  } = useHiddenEntities();

  const phase = derivePhase(jobId, status !== null, status?.status, isStarting, error);
  const errorMessage = error || status?.error || '';
  const allProperties = status?.properties ?? [];
  const visibleProperties = allProperties.filter(
    property => !hiddenPropertyIds.has(property.propertyId)
  );

  const runSearch = () => {
    setActiveTabs({});
    startSearch(buildSearchRequest(form));
  };

  const commitHideProperty = (property: Property) =>
    hide('property', property.propertyId, property.name);

  const commitHideUnit = (property: Property, unitType: UnitType, unit: Unit) =>
    hide(
      'unit',
      String(unit.listingId),
      `${property.name}, ${unitType.label}, ${formatCurrency(unit.price)}`
    );

  const confirmHide = async () => {
    if (!pendingHide) return;
    if (pendingHide.scope === 'property') {
      await commitHideProperty(pendingHide.property);
      return;
    }
    await commitHideUnit(pendingHide.property, pendingHide.unitType, pendingHide.unit);
  };

  const hidePropertyById = (propertyId: string) => {
    const property = allProperties.find(item => item.propertyId === propertyId);
    if (property) commitHideProperty(property);
  };

  const hideUnitById = (listingId: string) => {
    for (const property of allProperties) {
      for (const unitType of property.unitTypes) {
        const unit = unitType.units.find(item => String(item.listingId) === listingId);
        if (unit) {
          commitHideUnit(property, unitType, unit);
          return;
        }
      }
    }
  };

  usePropertySearchPageContext(
    {
      phase,
      status: status?.status ?? null,
      errorMessage,
      filterSummary: describeFilters(form),
      properties: visibleProperties,
      activeTabs,
      hidden,
      showHidden,
      propertyCount: status?.propertyCount ?? 0,
      unitCount: status?.unitCount ?? 0,
    },
    {
      onHideProperty: hidePropertyById,
      onHideUnit: hideUnitById,
      onUnhide: unhide,
      onRerunSearch: runSearch,
    }
  );

  return (
    <div className='mx-auto max-w-5xl space-y-5 p-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h1 className='type-ui-h2 text-ink'>Property search</h1>
          <p className='type-ui-caption'>
            Scrape PropertyGuru for sale listings, grouped by property and unit type.
          </p>
        </div>
        <Button variant='outline' size='sm' onClick={() => setShowHidden(current => !current)}>
          {showHidden ? <EyeOff size={16} /> : <Eye size={16} />}
          {showHidden ? 'Hide the hidden items' : `Show hidden (${hidden.length})`}
        </Button>
      </div>

      <SearchFilterPanel
        form={form}
        onChange={setForm}
        onSearch={runSearch}
        isBusy={phase === 'running'}
      />

      {showHidden && (
        <HiddenPanel
          hidden={hidden}
          isLoading={isLoadingHidden}
          error={hiddenError}
          onUnhide={unhide}
        />
      )}

      {phase === 'failed' && (
        <SearchErrorPanel
          message={errorMessage || 'The scrape failed before it returned any results.'}
          detail={status?.errorDetail}
        />
      )}

      {phase === 'running' && (
        <ScrapeProgress
          status={status?.status ?? 'queued'}
          propertyCount={status?.propertyCount ?? 0}
          unitCount={status?.unitCount ?? 0}
          note={status?.note}
        />
      )}

      {phase === 'idle' && (
        <Card className='flex flex-col items-center gap-2 p-10 text-center'>
          <SearchX size={22} className='text-cyan' />
          <p className='type-ui-title text-ink'>Nothing searched yet</p>
          <p className='type-ui-sm text-ink-3'>
            Set your filters above, then run a search to pull listings from PropertyGuru.
          </p>
        </Card>
      )}

      {phase === 'succeeded' && (
        <div className='space-y-4'>
          <p className='type-ui-caption'>
            {status?.propertyCount ?? 0} properties and {status?.unitCount ?? 0} units found.{' '}
            {visibleProperties.length} of {allProperties.length} properties shown.
          </p>

          {status?.truncated && (
            <p className='type-ui-sm text-ink-3'>
              These results are partial. The scan covered {status.pagesScanned ?? 0} of{' '}
              {status.totalPages ?? 0} result pages, so raise pages to scan or narrow your filters
              to see the rest.
            </p>
          )}

          {allProperties.length === 0 ? (
            <Card className='p-10 text-center'>
              <p className='type-ui-title text-ink'>No properties matched</p>
              <p className='type-ui-sm mt-1 text-ink-3'>
                Try widening the price range, adding districts, or scanning more pages.
              </p>
            </Card>
          ) : visibleProperties.length === 0 ? (
            <Card className='p-10 text-center'>
              <p className='type-ui-title text-ink'>Every result is hidden</p>
              <p className='type-ui-sm mt-1 text-ink-3'>
                Open the hidden items panel to bring a property back.
              </p>
            </Card>
          ) : (
            visibleProperties.map(property => (
              <PropertyCard
                key={`${jobId ?? 'none'}-${property.propertyId}`}
                property={property}
                hiddenUnitIds={hiddenUnitIds}
                onHideProperty={property => setPendingHide({ scope: 'property', property })}
                onHideUnit={(property, unitType, unit) =>
                  setPendingHide({ scope: 'unit', property, unitType, unit })
                }
                onTabChange={(propertyId, tabId) =>
                  setActiveTabs(current => ({ ...current, [propertyId]: tabId }))
                }
              />
            ))
          )}
        </div>
      )}

      <HideConfirmModal
        pending={pendingHide}
        onClose={() => setPendingHide(null)}
        onConfirm={confirmHide}
      />
    </div>
  );
}
