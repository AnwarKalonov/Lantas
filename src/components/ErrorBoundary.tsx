import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  label: string;
}

interface State {
  error: Error | null;
}

/**
 * Keep a render failure inside one view. The rest of the app, including the
 * session store and the user's open files, stays usable.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label}]`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty-state" role="alert" style={{ padding: 32 }}>
        <p>
          <strong>{this.props.label} stopped rendering.</strong>
        </p>
        <p>{this.state.error.message || "An unexpected component error."}</p>
        <button
          type="button"
          className="button-primary"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </div>
    );
  }
}
