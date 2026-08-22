import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './ui/button';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches render-time errors — including a lazy chunk that fails to load after a
 * redeploy (see lazyWithRetry) — so a single broken subtree degrades to a
 * friendly message instead of unmounting the whole app to a blank page. Pass
 * `fallback` to scope the recovery UI to a region; the default is a full-page
 * reload prompt used as the app-wide safety net.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? <DefaultErrorFallback />;
    }
    return this.props.children;
  }
}

function DefaultErrorFallback() {
  return (
    <div className='grid min-h-screen place-items-center bg-canvas px-6'>
      <div className='flex max-w-md flex-col items-center gap-4 text-center'>
        <span className='grid h-12 w-12 place-items-center rounded-surface border border-rose-line bg-rose-soft text-rose'>
          <AlertTriangle className='h-6 w-6' />
        </span>
        <div>
          <h1 className='type-ui-h2 text-ink'>Something went wrong</h1>
          <p className='mt-1 text-sm text-ink-3'>
            The app ran into an unexpected error. Reloading usually clears it.
          </p>
        </div>
        <Button onClick={() => window.location.reload()}>Reload page</Button>
      </div>
    </div>
  );
}
