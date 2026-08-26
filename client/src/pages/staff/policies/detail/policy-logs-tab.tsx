import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection } from "@/components/ds";
import { History, Loader2 } from "lucide-react";
import { humanizeAction, humanizeEntityType, summarizeAuditEntry, summarizeChanges } from "@/lib/audit-format";

interface PolicyActivityEntry {
  id: string;
  source: "audit" | "view";
  timestamp: string;
  actorLabel: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  detail?: unknown;
}

interface PolicyLogsTabProps {
  selectedPolicy: any;
}

/** Plain-English line for a "view" entry (policy_view_log) — no before/after to diff, just what
 *  happened. Mirrors summarizeAuditEntry's sentence shape for a consistent reading experience
 *  alongside the mutation (audit_logs) entries in the same timeline. */
function summarizeViewEntry(entry: PolicyActivityEntry): string {
  const who = entry.actorLabel || (entry.action.startsWith("downloaded") ? "Someone" : "Someone");
  if (entry.action === "viewed") return `${who} opened this policy.`;
  if (entry.action === "downloaded_document") return `${who} downloaded the policy document.`;
  return `${who} ${humanizeAction(entry.action).toLowerCase()}.`;
}

export function PolicyLogsTab({ selectedPolicy }: PolicyLogsTabProps) {
  const { data, isLoading } = useQuery<{ entries: PolicyActivityEntry[]; refs: Record<string, string> }>({
    queryKey: ["/api/policies", selectedPolicy?.id, "activity-log"],
    enabled: !!selectedPolicy?.id,
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/policies/${selectedPolicy.id}/activity-log`, { credentials: "include" });
      if (!res.ok) return { entries: [], refs: {} };
      return res.json();
    },
  });

  const entries = data?.entries ?? [];
  const refs = data?.refs ?? {};

  return (
    <CardSection
      title="Policy Logs"
      description="Everything that's happened on this policy — edits, payments, members, claims, documents, and even someone simply opening it — newest first."
      icon={History}
      contentClassName="space-y-3"
    >
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
      ) : (
        <div className="divide-y divide-border rounded-md border">
          {entries.map((entry) => {
            const isAudit = entry.source === "audit";
            const changes = isAudit ? summarizeChanges(entry.before, entry.after, refs) : [];
            return (
              <div key={`${entry.source}-${entry.id}`} className="px-3 py-2.5 space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm leading-snug">
                    {isAudit ? summarizeAuditEntry(entry as any, refs) : summarizeViewEntry(entry)}
                  </p>
                  <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                </div>
                {isAudit && entry.entityType && (
                  <p className="text-xs text-muted-foreground">{humanizeEntityType(entry.entityType)}</p>
                )}
                {changes.length > 0 && (
                  <ul className="text-xs text-muted-foreground space-y-0.5 pl-3 border-l-2 border-border/60">
                    {changes.map((c) => (
                      <li key={c.field}>
                        <span className="font-medium text-foreground/80">{c.field}:</span>{" "}
                        {c.kind === "diff" ? (
                          <>{c.from} <span aria-hidden>→</span> {c.to}</>
                        ) : (
                          c.to
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </CardSection>
  );
}
