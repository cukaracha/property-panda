import { Check, Circle, Hand } from 'lucide-react';
import { Card } from '../../../components/ui/card';
import { Spinner } from '../../../components/ui/spinner';
import { cn } from '../../../lib/utils';
import type { SearchStatus } from '../types/listings';
import { ACTIVE_STEPS, STATUS_LABELS } from '../utils/format';

export interface ScrapeProgressProps {
  status: SearchStatus;
  propertyCount: number;
  unitCount: number;
  /** Set while the scrape is waiting on the user, e.g. an unsolved Cloudflare challenge. */
  note?: string | null;
}

/**
 * Live progress for a running scrape. The job moves queued to scraping to
 * enriching, so each step is either done, running, or still to come.
 *
 * A `note` means the scrape has stopped and needs the user before it can go on. It is
 * shown above the steps rather than beside them, because the steps keep saying
 * "scraping" throughout and would otherwise read as healthy progress.
 */
export default function ScrapeProgress({
  status,
  propertyCount,
  unitCount,
  note,
}: ScrapeProgressProps) {
  const currentIndex = ACTIVE_STEPS.indexOf(status);

  return (
    <Card className='p-5'>
      <div className='flex items-center gap-3'>
        <Spinner />
        <div>
          <p className='type-ui-title text-ink'>{STATUS_LABELS[status]}</p>
          <p className='type-ui-caption'>
            This can take a few minutes. Found {propertyCount} properties and {unitCount} units so
            far.
          </p>
        </div>
      </div>

      {note && (
        <div className='mt-4 flex items-start gap-2 rounded-surface border border-accent-line bg-accent-soft p-3'>
          <Hand size={16} className='mt-0.5 shrink-0 text-cyan' />
          <p className='text-sm text-ink'>{note}</p>
        </div>
      )}

      <ol className='mt-4 space-y-2'>
        {ACTIVE_STEPS.map((step, index) => {
          const isDone = currentIndex > index;
          const isCurrent = currentIndex === index;
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
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
