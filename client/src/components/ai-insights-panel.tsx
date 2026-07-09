import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { CardSection } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles } from "lucide-react";

export type AiSurface = "daily_report" | "dashboard" | "finance" | "policies" | "claims";

/**
 * On-demand AI insights for a page's data. Never auto-runs on mount — every Opus
 * call costs real money, so generation always requires an explicit click.
 * Renders nothing if the current user lacks the use:ai permission.
 */
export function AiInsightsPanel({
  surface,
  title = "AI Insights",
  description = "Ask AI to summarize this data and flag anything worth attention.",
  date,
}: {
  surface: AiSurface;
  title?: string;
  description?: string;
  /** YYYY-MM-DD — only meaningful for the daily_report surface. */
  date?: string;
}) {
  const { permissions } = useAuth();
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (q?: string) => {
      const res = await apiRequest("POST", "/api/ai/insights", { surface, date, question: q || undefined });
      const data = await res.json();
      return data.text as string;
    },
    onSuccess: (text) => setResult(text),
  });

  if (!permissions.includes("use:ai")) return null;

  const notConfigured = mutation.isError && /not configured/i.test(mutation.error?.message || "");
  const ask = (q?: string) => {
    setResult(null);
    mutation.mutate(q);
    if (q) setQuestion("");
  };

  return (
    <CardSection title={title} description={description}>
      <div className="space-y-3">
        {!result && !mutation.isPending && (
          <Button size="sm" onClick={() => ask(undefined)} className="gap-1.5" data-testid={`button-ai-insights-${surface}`}>
            <Sparkles className="h-3.5 w-3.5" /> Generate Insights
          </Button>
        )}
        {mutation.isPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Analyzing…
          </div>
        )}
        {mutation.isError && !mutation.isPending && (
          <p className="text-sm text-destructive">
            {notConfigured ? "AI features aren't configured for this environment yet." : mutation.error.message}
          </p>
        )}
        {result && !mutation.isPending && (
          <div className="space-y-3">
            <p className="text-sm whitespace-pre-line">{result}</p>
            <div className="flex gap-2 items-center">
              <Input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a follow-up question…"
                className="flex-1 h-8 text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && question.trim()) ask(question.trim());
                }}
              />
              <Button size="sm" variant="outline" disabled={!question.trim()} onClick={() => ask(question.trim())}>
                Ask
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setResult(null);
                  mutation.reset();
                }}
              >
                Reset
              </Button>
            </div>
          </div>
        )}
      </div>
    </CardSection>
  );
}
