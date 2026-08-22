import { Network } from 'lucide-react';
import { cn } from '../../../lib/utils';

export type OntologyView = 'build' | 'ontology' | 'ask';

interface OntologyPageBarProps {
  view: OntologyView;
  onViewChange: (view: OntologyView) => void;
  /** Whether a build has produced a result to look at. Gates the last two phases. */
  hasResult: boolean;
  /** Whether this deployment has an ontology agent runtime. Gates Ask on its own. */
  askConfigured: boolean;
}

/**
 * The page's title row and its workflow phase nav.
 *
 * The three phases are numbered because they are a sequence, not a set of tabs:
 * there is nothing to look at before a build and nothing to ask before there is a
 * graph. A locked phase says why in its tooltip rather than simply refusing —
 * "disabled and unexplained" is the state that reads as a bug.
 */
export default function OntologyPageBar({
  view,
  onViewChange,
  hasResult,
  askConfigured,
}: OntologyPageBarProps) {
  const steps: { key: OntologyView; step: number; label: string; reason?: string }[] = [
    { key: 'build', step: 1, label: 'Build' },
    {
      key: 'ontology',
      step: 2,
      label: 'Ontology',
      reason: hasResult ? undefined : 'Available once a build finishes',
    },
    {
      key: 'ask',
      step: 3,
      label: 'Ask',
      reason: !askConfigured
        ? 'Asking is not configured for this deployment'
        : hasResult
          ? undefined
          : 'Available once a build finishes',
    },
  ];

  return (
    <div className='flex flex-none flex-wrap items-center gap-x-[18px] gap-y-2.5 border-b border-line bg-canvas px-5 py-[11px]'>
      <span className='grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border border-accent-line bg-accent-soft text-cyan'>
        <Network className='h-4 w-4' />
      </span>
      <h1 className='text-[15.5px] font-semibold tracking-[-0.018em] text-ink'>Ontology</h1>

      <nav
        aria-label='Workflow phase'
        className='flex gap-[3px] rounded-control border border-line bg-panel p-1'
      >
        {steps.map(({ key, step, label, reason }) => {
          const isActive = view === key;
          const isDisabled = reason !== undefined;
          return (
            <button
              key={key}
              type='button'
              disabled={isDisabled}
              title={reason}
              aria-current={isActive ? 'step' : undefined}
              onClick={() => onViewChange(key)}
              className={cn(
                'flex items-center gap-2 rounded-[7px] px-[13px] py-1.5 text-[13px] font-semibold',
                'transition-colors duration-[var(--dur-fast)]',
                isActive && 'bg-accent-soft text-cyan',
                !isActive && !isDisabled && 'text-ink-3 hover:text-ink',
                // Muted ink rather than a global opacity drop: a half-transparent
                // control on this canvas reads as a rendering fault.
                isDisabled && 'cursor-not-allowed text-ink-4'
              )}
            >
              <span
                className={cn(
                  'grid h-[17px] w-[17px] shrink-0 place-items-center rounded-full text-[9.5px] font-bold',
                  isActive && 'bg-cyan text-accent-ink',
                  !isActive && !isDisabled && 'bg-panel-2 text-ink-4',
                  isDisabled && 'shadow-[inset_0_0_0_1px_var(--line)] text-ink-4'
                )}
              >
                {step}
              </span>
              {label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
