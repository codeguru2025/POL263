import { apiJson } from "./client";

export interface Lead {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  productInterest: string | null;
  source: string | null;
  stage: string | null;
  notes: string | null;
  agentId: string | null;
  createdAt: string;
}

/** Mirrors client/src/pages/staff/leads.tsx's PIPELINE_STAGES exactly — 6 display stages,
 *  each mapping one or more legacy DB stage values. Advancing always writes the display
 *  stage's own key, never a legacy value, so this list only needs to grow, not the reverse
 *  mapping below. */
export const PIPELINE_STAGES = [
  { key: "new", label: "New", dbKeys: ["lead", "captured", "new"] },
  { key: "contacted", label: "Contacted", dbKeys: ["contacted"] },
  { key: "qualified", label: "Qualified", dbKeys: ["qualified", "application_started", "submitted"] },
  { key: "quoted", label: "Quoted", dbKeys: ["quoted", "quote_generated", "approved", "agreed_to_pay"] },
  { key: "converted", label: "Converted", dbKeys: ["converted", "activated"] },
  { key: "lost", label: "Lost", dbKeys: ["lost"] },
] as const;

export type StageKey = (typeof PIPELINE_STAGES)[number]["key"];

export function effectiveStage(lead: Lead): StageKey {
  const raw = (lead.stage ?? "new").trim();
  for (const s of PIPELINE_STAGES) {
    if ((s.dbKeys as readonly string[]).includes(raw)) return s.key;
  }
  return "new";
}

export async function getLeads(): Promise<Lead[]> {
  return apiJson("/api/leads?limit=500");
}

export interface CreateLeadInput {
  firstName: string;
  lastName?: string;
  phone?: string;
  email?: string;
  productInterest?: string;
  source?: string;
}

export async function createLead(input: CreateLeadInput): Promise<Lead> {
  return apiJson("/api/leads", {
    method: "POST",
    body: JSON.stringify({ ...input, source: input.source || "walk_in", stage: "new" }),
  });
}

export async function updateLead(id: string, patch: Partial<Pick<Lead, "notes" | "productInterest" | "stage">>): Promise<Lead> {
  return apiJson(`/api/leads/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function moveLeadStage(id: string, stage: StageKey): Promise<Lead> {
  return updateLead(id, { stage });
}
