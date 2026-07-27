import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error boundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-bgPrimary p-6 text-center">
          <h1 className="text-lg font-semibold text-textPrimary">Something went wrong</h1>
          <p className="mt-2 max-w-md text-sm text-textSecondary">
            The app encountered an error on this screen. Your saved data is safe. Try reloading or use System
            Health from Settings.
          </p>
          <p className="mt-3 text-xs text-textMuted">{this.state.error.message}</p>
          <button
            type="button"
            className="mt-4 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
          <button
            type="button"
            className="mt-2 text-sm text-brand underline"
            onClick={() => window.location.reload()}
          >
            Reload app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
