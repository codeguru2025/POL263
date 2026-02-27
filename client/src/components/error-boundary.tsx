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

      let primaryActionLabel = "Back to home";
      let primaryActionHref = "/";
      let secondaryActionLabel: string | null = null;
      let secondaryActionHref: string | null = null;

      if (typeof window !== "undefined") {
        const path = window.location.pathname || "";
        if (path.startsWith("/staff")) {
          primaryActionLabel = "Go to staff login";
          primaryActionHref = "/staff/login";
          secondaryActionLabel = "Back to home";
          secondaryActionHref = "/";
        } else if (path.startsWith("/client")) {
          primaryActionLabel = "Go to client login";
          primaryActionHref = "/client/login";
          secondaryActionLabel = "Back to home";
          secondaryActionHref = "/";
        }
      }

      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background" role="alert">
          <div className="max-w-md w-full rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center space-y-4">
            <AlertTriangle className="h-12 w-12 text-destructive mx-auto" aria-hidden />
            <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              An unexpected error occurred. You may need to sign in again or return to a safe page.
            </p>
            {import.meta.env.DEV && (
              <pre className="text-left text-xs bg-muted p-3 rounded overflow-auto max-h-32">
                {this.state.error.message}
              </pre>
            )}
            <Button
              variant="outline"
              onClick={() => {
                if (primaryActionHref) {
                  window.location.href = primaryActionHref;
                } else {
                  window.location.reload();
                }
              }}
              className="mt-2"
            >
              {primaryActionLabel}
            </Button>
            {secondaryActionLabel && secondaryActionHref && (
              <Button
                variant="ghost"
                onClick={() => {
                  window.location.href = secondaryActionHref as string;
                }}
                className="mt-1 text-xs text-muted-foreground"
              >
                {secondaryActionLabel}
              </Button>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
