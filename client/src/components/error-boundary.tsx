import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background" role="alert">
          <div className="max-w-md w-full rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center space-y-4">
            <AlertTriangle className="h-12 w-12 text-destructive mx-auto" aria-hidden />
            <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              An unexpected error occurred. Please refresh the page or try again later.
            </p>
            {import.meta.env.DEV && (
              <pre className="text-left text-xs bg-muted p-3 rounded overflow-auto max-h-32">
                {this.state.error.message}
              </pre>
            )}
            <Button
              variant="outline"
              onClick={() => window.location.reload()}
              className="mt-2"
            >
              Reload page
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
