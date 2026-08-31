import { Check, Circle, CircleAlert } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Spinner } from '../../../components/ui/spinner';
import { cn } from '../../../lib/utils';
import type { SearchStatus } from '../../../types/listings';
import { PROGRESS_STEPS, STATUS_LABELS } from '../../../lib/listingsFormat';

export interface ScrapeProgressProps {
  status: SearchStatus;
  listingCount: number;
  pagesFetched: number;
  pagesTotal: number;
  detailsFetched: number;
  detailsTotal: number;
  /** Set when something outside the pages themselves has gone wrong, e.g. the unlocker
   *  refusing the account. Absent the rest of the time. */
  note?: string | null;
  onCancel: () => void;
  /** True from the moment Cancel is pressed until the job actually reports cancelled. */
  isCancelling: boolean;
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
 * The wait itself, filling the results column: a breathing brand mark, the phase the
 * scrape is in as the headline, a plain line about how long it takes, then the three
 * steps. Each step is either done, running, or still to come, and its count unfurls on
 * a width transition as its phase starts reporting.
 *
 * Enrichment is one page load per property and is most of a cold run, so it is the
 * step the count matters on -- without it the screen sits on the same line for over a
 * minute with no sign of whether anything is moving.
 *
 * A `note` is something wrong outside the pages themselves. It sits above the steps under
 * its own heading rather than beside them, because the steps keep reporting healthy
 * progress on whatever else is still in flight.
 *
 * Cancel sits under the steps rather than in the header, because it belongs to the run
 * rather than to the screen, and it is deliberately quiet: stopping a search is a way out
 * rather than the thing to do next. It stays pressed once used, since the scrape finishes
 * whatever it already has in flight before the job goes terminal.
 */
export default function ScrapeProgress(props: ScrapeProgressProps) {
  const { status, note } = props;
  // queued shares the first step: the job is only queued for the moment before the
  // worker picks it up. succeeded sits past the last one, so Done reads as ticked rather
  // than running, and cancelled never reaches this component at all.
  const currentIndex =
    status === 'queued'
      ? 0
      : status === 'succeeded'
        ? PROGRESS_STEPS.length
        : PROGRESS_STEPS.indexOf(status);

  return (
    <div className='flex flex-col items-center gap-6 py-16 text-center'>
      <img
        className='pp-brand-mark pp-breathe h-16 w-16'
        src='/icons/web-app-manifest-512x512.png'
        alt=''
        width={64}
        height={64}
      />

      <div className='flex flex-col items-center gap-2'>
        <h2 className='type-ui-h2 text-strong'>{STATUS_LABELS[status]}</h2>
        <p className='type-ui-sm max-w-[420px] text-muted'>
          Reading the listings and then each property behind them, which usually takes about a
          minute.
        </p>
      </div>

      {note && (
        <div className='w-full max-w-[520px] rounded-card border border-line-brand bg-brand-subtle p-4 text-left'>
          <p className='type-ui-eyebrow mb-2 flex items-center gap-1.5 text-brand'>
            <CircleAlert size={13} />
            Something is in the way
          </p>
          <p className='text-sm text-strong'>{note}</p>
        </div>
      )}

      <ol className='flex w-full max-w-[420px] flex-col gap-1.5 text-left'>
        {PROGRESS_STEPS.map((step, index) => {
          const isDone = currentIndex > index;
          const isCurrent = currentIndex === index;
          const detail = index <= currentIndex ? stepDetail(step, props) : '';
          return (
            <li
              key={step}
              className={cn(
                'flex items-center gap-2.5 rounded-control px-3 py-2.5 transition-[background-color,opacity] duration-[var(--duration-base)]',
                isCurrent && 'bg-brand-subtle',
                !isDone && !isCurrent && 'opacity-55'
              )}
            >
              <span
                className={cn(
                  'flex h-[26px] w-[26px] flex-none items-center justify-center rounded-pill transition-[background-color,color] duration-[var(--duration-base)]',
                  isDone
                    ? 'bg-brand-solid text-on-brand'
                    : isCurrent
                      ? 'bg-card text-brand'
                      : 'bg-sunken text-subtle'
                )}
              >
                {isDone ? (
                  <Check size={16} />
                ) : isCurrent ? (
                  <Spinner size='sm' />
                ) : (
                  <Circle size={16} />
                )}
              </span>
              <span
                className={cn(
                  'text-sm',
                  isCurrent ? 'font-semibold text-strong' : isDone ? 'text-body' : 'text-muted'
                )}
              >
                {STATUS_LABELS[step]}
              </span>
              <span className={cn('pp-unfurl type-data-xs text-muted', detail && 'is-shown')}>
                {detail}
              </span>
            </li>
          );
        })}
      </ol>

      <Button variant='ghost' size='sm' onClick={props.onCancel} disabled={props.isCancelling}>
        {props.isCancelling ? 'Cancelling' : 'Cancel search'}
      </Button>
    </div>
  );
}
