export interface SearchErrorPanelProps {
  message: string;
  detail?: string | null;
}

/**
 * A failed search, with the worker's own diagnosis kept one click away.
 *
 * The short message is what the user needs; the detail is the traceback or the
 * browser's stderr, which is only useful when someone is actually debugging, so
 * it stays collapsed.
 */
export default function SearchErrorPanel({ message, detail }: SearchErrorPanelProps) {
  return (
    <div className='rounded-card border border-rose-500 bg-danger-subtle p-4'>
      <p className='type-ui-title text-danger'>The search did not finish</p>
      <p className='mt-1 text-sm text-danger'>{message}</p>

      {detail && (
        <details className='mt-3'>
          <summary className='type-ui-sm cursor-pointer text-danger'>Show the details</summary>
          <div className='mt-2 overflow-x-auto'>
            <pre className='whitespace-pre font-mono text-xs text-danger'>{detail}</pre>
          </div>
        </details>
      )}
    </div>
  );
}
