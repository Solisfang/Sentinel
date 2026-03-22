import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

const MAX_RETRIES = 3;

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Sentinel] React error boundary caught:', error, info.componentStack);

    // Bridge JS errors to C# crash log
    try {
      const webview = (window as any).chrome?.webview;
      if (webview) {
        webview.postMessage({
          type: 'JS_ERROR',
          message: error.message,
          stack: error.stack ?? '',
          componentStack: info.componentStack ?? '',
        });
      }
    } catch {
      // Don't throw from the error boundary
    }
  }

  render() {
    if (this.state.hasError) {
      const canRetry = this.state.retryCount < MAX_RETRIES;

      return (
        <div style={{
          padding: '2rem',
          textAlign: 'center',
          color: '#fff',
          fontFamily: 'system-ui, sans-serif',
        }}>
          <h2 style={{ marginBottom: '1rem' }}>Something went wrong</h2>
          <p style={{ opacity: 0.7, marginBottom: '1.5rem', fontSize: '0.875rem' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          {canRetry ? (
            <button
              onClick={() => this.setState((prev) => ({
                hasError: false,
                error: null,
                retryCount: prev.retryCount + 1,
              }))}
              style={{
                padding: '0.5rem 1.5rem',
                borderRadius: '0.5rem',
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(255,255,255,0.1)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              Try Again ({MAX_RETRIES - this.state.retryCount} left)
            </button>
          ) : (
            <p style={{ opacity: 0.5, fontSize: '0.875rem' }}>
              Sentinel hit a permanent error. Please restart the application.
            </p>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
