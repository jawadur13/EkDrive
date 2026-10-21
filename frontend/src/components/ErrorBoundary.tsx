import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Without this, one thrown render error leaves a blank page with nothing to act on.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled error in the UI:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div className="card max-w-md p-8 text-center">
          <h1 className="text-base font-semibold text-slate-900">Something broke on this page</h1>
          <p className="mt-2 text-sm text-slate-500">
            Your files are safe — this is only the page failing to draw. Reloading usually fixes it.
          </p>
          <p className="mt-3 break-words text-xs text-slate-400">{this.state.error.message}</p>
          <div className="mt-6 flex justify-center gap-2">
            <button className="btn-secondary" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            <button className="btn-primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
