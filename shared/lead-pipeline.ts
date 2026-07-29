/**
 * 6-stage lead pipeline. Each canonical stage maps to one or more legacy raw `leads.stage`
 * DB values (the column has accumulated several historical spellings — this is the one place
 * that normalizes them). Shared between the client Kanban board (client/src/pages/staff/leads.tsx)
 * and server-side reporting (server/executive-report.ts) so both sides of "how many leads are at
 * each stage" never drift apart.
 */
export const PIPELINE_STAGES = [
  {
    key: "new",
    label: "New",
    dbKeys: ["lead", "captured", "new"],
    color: "bg-slate-50 border-b border-slate-200",
    badgeColor: "bg-slate-100 text-slate-700",
  },
  {
    key: "contacted",
    label: "Contacted",
    dbKeys: ["contacted"],
    color: "bg-sky-50 border-b border-sky-100",
    badgeColor: "bg-sky-100 text-sky-700",
  },
  {
    key: "qualified",
    label: "Qualified",
    dbKeys: ["qualified", "application_started", "submitted"],
    color: "bg-violet-50 border-b border-violet-100",
    badgeColor: "bg-violet-100 text-violet-700",
  },
  {
    key: "quoted",
    label: "Quoted",
    dbKeys: ["quoted", "quote_generated", "approved", "agreed_to_pay"],
    color: "bg-amber-50 border-b border-amber-100",
    badgeColor: "bg-amber-100 text-amber-700",
  },
  {
    key: "converted",
    label: "Converted",
    dbKeys: ["converted", "activated"],
    color: "bg-emerald-50 border-b border-emerald-100",
    badgeColor: "bg-emerald-100 text-emerald-700",
  },
  {
    key: "lost",
    label: "Lost",
    dbKeys: ["lost"],
    color: "bg-red-50 border-b border-red-100",
    badgeColor: "bg-red-100 text-red-700",
  },
] as const;

export type LeadStageKey = (typeof PIPELINE_STAGES)[number]["key"];

/** Normalizes a raw `leads.stage` DB value into one of the 6 canonical stage keys. */
export function effectiveLeadStage(lead: { stage?: string | null }): LeadStageKey {
  const raw = (lead.stage ?? "new").trim();
  for (const s of PIPELINE_STAGES) {
    if ((s.dbKeys as readonly string[]).includes(raw)) return s.key;
  }
  return "new";
}

export function nextLeadStage(current: LeadStageKey): LeadStageKey | null {
  const idx = PIPELINE_STAGES.findIndex((s) => s.key === current);
  if (idx < 0 || idx >= PIPELINE_STAGES.length - 2) return null;
  const next = PIPELINE_STAGES[idx + 1];
  return next.key === "lost" ? null : next.key;
}
