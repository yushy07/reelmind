import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[REELMIND] render error', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="alert error-boundary-alert" role="alert">
          <strong>Something went wrong in the studio view.</strong>
          <small className="error-boundary-msg">
            {this.state.error.message}
          </small>
          <button className="secondary error-boundary-btn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
