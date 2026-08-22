import { Check } from 'lucide-react';
import { toolMeta } from './toolMeta';

export interface ToolCallProps {
  /** Mono tool name, e.g. `get_grades`. */
  name: string;
  /** Stringified arguments shown after the name. */
  args?: string;
  /** Tool result text, shown once the call resolves. */
  result?: string;
  /** While true, shows the spinning running indicator instead of the result. */
  running?: boolean;
}

/**
 * One tool-call row inside the thinking-card timeline. The live stream resolves
 * a tool in a single `tool` event (name + args + result together), so by the
 * time it renders it is normally `running=false`. The running state is kept for
 * the in-flight tail of the stream.
 */
export function ToolCall({ name, args, result, running = false }: ToolCallProps) {
  const meta = toolMeta(name);
  return (
    <div className='cb-tool'>
      <div className='cb-tool__hd'>
        <span className='cb-tool__name'>{name}</span>
        {args && <span className='cb-tool__args'>({args})</span>}
      </div>
      <div className='cb-tool__status'>
        {running ? (
          <>
            <span className='cb-spin cb-tool__running'>
              <meta.icon size={13} />
            </span>
            <span className='cb-tool__running-label'>{meta.label}…</span>
          </>
        ) : (
          <>
            <span className='cb-tool__done'>
              <Check size={13} />
            </span>
            <span className='cb-tool__result'>{result ?? meta.label}</span>
          </>
        )}
      </div>
    </div>
  );
}
