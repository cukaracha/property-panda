import { Check } from 'lucide-react';
import { Spinner } from '../../../components/ui/spinner';

const STEPS = ['Uploading', 'Queued', 'Converting'];

interface ConversionStepsProps {
  /** Index of the in-progress step; every step before it is complete. */
  activeIndex: number;
}

/**
 * The progressive conversion checklist shown while a job runs: each completed
 * step keeps a cyan checkmark and stays visible, the active step shows a spinner,
 * and later steps stay hidden until reached. The whole list unmounts once the job
 * finishes and the result renders.
 */
export default function ConversionSteps({ activeIndex }: ConversionStepsProps) {
  return (
    <div className='flex flex-col gap-2'>
      {STEPS.slice(0, activeIndex + 1).map((label, i) => (
        <div key={label} className='flex items-center gap-2 text-sm text-ink-3'>
          {i < activeIndex ? <Check size={15} className='text-cyan' /> : <Spinner size='sm' />}
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
