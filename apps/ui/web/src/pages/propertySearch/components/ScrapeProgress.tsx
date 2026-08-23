import { Check, Circle, Hand } from 'lucide-react';
import { Card } from '../../../components/ui/card';
import { Spinner } from '../../../components/ui/spinner';
import { cn } from '../../../lib/utils';
import type { SearchStatus } from '../types/listings';
import { PROGRESS_STEPS, STATUS_LABELS } from '../utils/format';

export interface ScrapeProgressProps {
  status: SearchStatus;
  listingCount: number;
  pagesFetched: number;
  pagesTotal: number;
  detailsFetched: number;
  detailsTotal: number;
  /** Set while the scrape is waiting on the user, e.g. an unsolved Cloudflare challenge. */
  note?: string | null;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The count that rides in brackets after one step's label.
 *
 * A step says nothing until the phase that knows its number has started, because a
 * count that is only zero because nothing has reported yet reads as a stalled scrape
 * rather than as an unstarted one.
 */
function stepDetail(step: SearchStatus, props: ScrapeProgressProps): string {
  if (step === 'scraping') {
    if (!props.pagesTotal) return '';
    if (props.pagesFetched >= props.pagesTotal) return plural(props.pagesTotal, 'page');
    return `page ${props.pagesFetched + 1} of ${props.pagesTotal}`;
  }
  if (step === 'enriching') {
    if (props.detailsTotal) return `${props.detailsFetched} of ${props.detailsTotal}`;
    // Listings found but nothing to fetch means the property cache already held every
    // one of them, which is the whole difference between a warm search and a cold one.
    return props.listingCount ? 'cached' : '';
  }
  return `${plural(props.pagesFetched, 'page')}, ${plural(props.listingCount, 'listing')}`;
}

/**
 * Live progress for a running scrape: fetching listings, then fetching property
 * details, then done. Each step is either done, running, or still to come, and
 * carries how far through it is.
 *
 * Enrichment is one page load per property and is most of a cold run, so it is the
 * step the count matters on -- without it the card sits on the same line for over a
 * minute with no sign of whether anything is moving.
 *
 * A `note` means the scrape has stopped and needs the user before it can go on. It is
 * shown above the steps rather than beside them, because the steps keep reporting
 * healthy progress on whatever else is still in flight.
 */
export default function ScrapeProgress(props: ScrapeProgressProps) {
  const { status, note } = props;
  // queued shares the first step: the job is only queued while Chrome starts up.
  // succeeded sits past the last one, so Done reads as ticked rather than running.
  const currentIndex =
    status === 'queued'
      ? 0
      : status === 'succeeded'
        ? PROGRESS_STEPS.length
        : PROGRESS_STEPS.indexOf(status);

  return (
    <Card className='p-5'>
      {note && (
        <div className='mb-4 flex items-start gap-2 rounded-surface border border-accent-line bg-accent-soft p-3'>
          <Hand size={16} className='mt-0.5 shrink-0 text-cyan' />
          <p className='text-sm text-ink'>{note}</p>
        </div>
      )}

      <ol className='space-y-2'>
        {PROGRESS_STEPS.map((step, index) => {
          const isDone = currentIndex > index;
          const isCurrent = currentIndex === index;
          const detail = index <= currentIndex ? stepDetail(step, props) : '';
          return (
            <li key={step} className='flex items-center gap-2'>
              {isDone ? (
                <Check size={15} className='text-cyan' />
              ) : isCurrent ? (
                <Spinner size='sm' />
              ) : (
                <Circle size={15} className='text-ink-4' />
              )}
              <span
                className={cn(
                  'text-sm',
                  isCurrent ? 'text-ink' : isDone ? 'text-ink-2' : 'text-ink-3'
                )}
              >
                {STATUS_LABELS[step]}
                {detail && <span className='text-ink-3'> ({detail})</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
