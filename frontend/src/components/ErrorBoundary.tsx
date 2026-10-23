import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./ui";

interface Props {
  children: ReactNode;
  /** Change this (e.g. the current path) to clear the error when the user navigates away. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/** Catches rendering errors so one broken view doesn't blank the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Only the error name and component stack; never request data or user input.
    console.error("View crashed:", error.name, info.componentStack);
  }

  componentDidUpdate(previous: Props): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-bg text-red-fg" aria-hidden="true">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold text-ink">Something went wrong on this page</h1>
        <p className="mt-2 text-sm text-ink-subtle">
          The rest of OrderWave is fine. Reload the page, and if it keeps happening, let us know what you were doing.
        </p>
        <div className="mt-6 flex gap-2">
          <Button onClick={() => window.location.reload()}>Reload page</Button>
          <Button variant="secondary" onClick={() => this.setState({ error: null })}>Try again</Button>
        </div>
      </div>
    );
  }
}
