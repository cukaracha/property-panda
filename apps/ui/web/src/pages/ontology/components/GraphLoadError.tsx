import { AlertTriangle } from 'lucide-react';
import { Button } from '../../../components/ui/button';

/**
 * Fallback shown inside the graph panel when the force-graph chunk fails to load
 * (a stale chunk after a redeploy that even one auto-reload couldn't recover).
 * Sized to fill the panel so the rest of the page stays usable.
 */
export default function GraphLoadError() {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-3 px-6 text-center'>
      <span className='grid h-11 w-11 place-items-center rounded-surface border border-rose-line bg-rose-soft text-rose'>
        <AlertTriangle className='h-5 w-5' />
      </span>
      <div>
        <div className='text-sm font-semibold text-ink'>Couldn't load the graph</div>
        <p className='mt-1 text-sm text-ink-3'>
          The graph module failed to load. Reloading the page usually fixes it.
        </p>
      </div>
      <Button size='sm' onClick={() => window.location.reload()}>
        Reload page
      </Button>
    </div>
  );
}
