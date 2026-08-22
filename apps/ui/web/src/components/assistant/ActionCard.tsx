import { useMemo } from 'react';
import { Check, X, Zap } from 'lucide-react';
import usePageContextStore from '../../store/usePageContextStore';
import type { WorkflowStep } from '../../types/chatbot';

export interface ActionCardProps {
  step: WorkflowStep;
  onApprove: (stepId: string, content: string) => void;
  onReject: (stepId: string, content: string) => void;
}

/**
 * A proposed page action (human-in-the-loop). While pending it shows Approve /
 * Reject; the label comes from the registered action's display() when available.
 * Once the user decides, it collapses to a resolved status.
 */
export function ActionCard({ step, onApprove, onReject }: ActionCardProps) {
  const actions = usePageContextStore(s => s.actions);

  const label = useMemo(() => {
    try {
      const payload = JSON.parse(step.content) as { name?: string } & Record<string, string>;
      const action = actions?.find(a => a.name === payload.name);
      if (action) return action.display(payload);
      return payload.name ? `Run ${payload.name}` : 'Proposed action';
    } catch {
      return 'Proposed action';
    }
  }, [step.content, actions]);

  const status = step.actionStatus ?? 'pending';

  return (
    <div className='cb-action'>
      <div className='cb-action__hd'>
        <Zap size={14} />
        <span>{label}</span>
      </div>
      {status === 'pending' ? (
        <div className='cb-action__btns'>
          <button
            type='button'
            className='cb-action__btn cb-action__btn--approve'
            onClick={() => onApprove(step.id, step.content)}
          >
            <Check size={15} /> Approve
          </button>
          <button
            type='button'
            className='cb-action__btn cb-action__btn--reject'
            onClick={() => onReject(step.id, step.content)}
          >
            <X size={15} /> Reject
          </button>
        </div>
      ) : (
        <div className={`cb-action__resolved is-${status}`}>
          {status === 'approved' ? 'Approved' : 'Rejected'}
        </div>
      )}
    </div>
  );
}
