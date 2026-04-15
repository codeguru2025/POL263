import type { LucideIcon } from "lucide-react";
import { FolderOpen, Shield, UserCircle, Users, Wallet, Wrench } from "lucide-react";

export type ReportSectionId = "policies" | "finance" | "agents" | "claims" | "operations" | "payroll";

/** Backend / client dataset keys used to gate report queries. */
export type ReportDatasetId =
  | "policies"
  | "claims"
  | "payments"
  | "funeralCases"
  | "fleet"
  | "expenditures"
  | "payrollEmployees"
  | "commissionPlans"
  | "commissionSummary"
  | "platformReceivables"
  | "reinstatements"
  | "activations"
  | "conversions"
  | "activePolicies"
  | "awaitingPayments"
  | "overduePolicies"
  | "preLapsePolicies"
  | "lapsedPolicies"
  | "newJoinings"
  | "agentProductivity"
  | "policyDetails"
  | "financeReport"
  | "underwriterPayable"
  | "cashups"
  | "receiptReport"
  | "branches"
  | "products"
  | "users";

export const SECTION_META: Record<ReportSectionId, { label: string; icon: LucideIcon }> = {
  policies: { label: "Policies", icon: FolderOpen },
  finance: { label: "Finance", icon: Wallet },
  agents: { label: "Agents", icon: UserCircle },
  claims: { label: "Claims", icon: Shield },
  operations: { label: "Operations", icon: Wrench },
  payroll: { label: "Payroll", icon: Users },
};

export const SECTION_TAB_DEFS: Record<ReportSectionId, { value: string; label: string; testId?: string }[]> = {
  policies: [
    { value: "policies", label: "Overview", testId: "tab-policies-report" },
    { value: "policy-details", label: "Policy details", testId: "tab-policy-details" },
    { value: "active-policies", label: "Active", testId: "tab-active-policies" },
    { value: "awaiting-payments", label: "Awaiting payment", testId: "tab-awaiting-payments" },
    { value: "overdue", label: "Overdue / grace", testId: "tab-overdue" },
    { value: "pre-lapse", label: "Pre-lapse", testId: "tab-pre-lapse" },
    { value: "lapsed", label: "Lapsed", testId: "tab-lapsed" },
    { value: "new-joinings", label: "New joinings", testId: "tab-new-joinings" },
    { value: "activations", label: "Activations", testId: "tab-activations" },
    { value: "conversions", label: "Conversions", testId: "tab-conversions-report" },
    { value: "reinstatements", label: "Reinstatements", testId: "tab-reinstatements-report" },
  ],
  finance: [
    { value: "finance", label: "Finance", testId: "tab-finance-report" },
    { value: "underwriter-payable", label: "Underwriter payable", testId: "tab-underwriter-payable" },
    { value: "receipts", label: "Receipts", testId: "tab-receipts-report" },
    { value: "payments", label: "Payments", testId: "tab-payments-report" },
    { value: "expenditures", label: "Expenditure", testId: "tab-expenditures-report" },
    { value: "cashups", label: "Cashups", testId: "tab-cashups-report" },
    { value: "platform", label: "POL263 revenue", testId: "tab-platform-report" },
  ],
  agents: [
    { value: "agent-productivity", label: "Agent productivity", testId: "tab-agent-productivity" },
    { value: "commissions", label: "Commissions", testId: "tab-commissions-report" },
  ],
  claims: [{ value: "claims", label: "Claims", testId: "tab-claims-report" }],
  operations: [
    { value: "funerals", label: "Funerals", testId: "tab-funerals-report" },
    { value: "fleet", label: "Fleet", testId: "tab-fleet-report" },
  ],
  payroll: [{ value: "payroll", label: "Payroll", testId: "tab-payroll-report" }],
};

const ALL_SECTIONS: ReportSectionId[] = ["policies", "finance", "agents", "claims", "operations", "payroll"];

export function tabsForSection(
  section: ReportSectionId,
  opts: { canReadCommission: boolean; canReadFuneralOps: boolean; canReadFleet: boolean },
) {
  if (section === "agents" && !opts.canReadCommission) {
    return SECTION_TAB_DEFS.agents.filter((t) => t.value !== "commissions");
  }
  if (section === "operations") {
    return SECTION_TAB_DEFS.operations.filter((t) => {
      if (t.value === "funerals") return opts.canReadFuneralOps;
      if (t.value === "fleet") return opts.canReadFleet;
      return true;
    });
  }
  return SECTION_TAB_DEFS[section];
}

export function visibleReportSections(opts: {
  canReadFinance: boolean;
  canReadClaim: boolean;
  canReadFuneralOps: boolean;
  canReadFleet: boolean;
  canReadPayroll: boolean;
}): ReportSectionId[] {
  const out: ReportSectionId[] = ["policies"];
  if (opts.canReadFinance) out.push("finance");
  out.push("agents");
  if (opts.canReadClaim) out.push("claims");
  if (opts.canReadFuneralOps || opts.canReadFleet) out.push("operations");
  if (opts.canReadPayroll) out.push("payroll");
  return out;
}

/** Which API datasets a report tab loads (for query `enabled`). */
export const TAB_DATASETS: Record<string, ReportDatasetId[]> = {
  policies: ["policies"],
  "policy-details": ["policyDetails"],
  "active-policies": ["activePolicies"],
  "awaiting-payments": ["awaitingPayments"],
  overdue: ["overduePolicies"],
  "pre-lapse": ["preLapsePolicies"],
  lapsed: ["lapsedPolicies"],
  "new-joinings": ["newJoinings"],
  activations: ["activations"],
  conversions: ["conversions"],
  reinstatements: ["reinstatements"],
  finance: ["financeReport"],
  "underwriter-payable": ["underwriterPayable"],
  receipts: ["receiptReport"],
  payments: ["payments"],
  expenditures: ["expenditures"],
  cashups: ["cashups"],
  platform: ["platformReceivables"],
  "agent-productivity": ["agentProductivity"],
  commissions: ["commissionPlans", "commissionSummary"],
  claims: ["claims"],
  funerals: ["funeralCases"],
  fleet: ["fleet"],
  payroll: ["payrollEmployees"],
};

export function tabUsesDataset(tab: string, dataset: ReportDatasetId): boolean {
  return (TAB_DATASETS[tab] ?? []).includes(dataset);
}

export function buildStaffReportHref(section: ReportSectionId, tab: string): string {
  return `/staff/reports?section=${encodeURIComponent(section)}&tab=${encodeURIComponent(tab)}`;
}

export function reportContextLabel(section: ReportSectionId, tabValue: string): string {
  const tab = SECTION_TAB_DEFS[section].find((t) => t.value === tabValue);
  return `${SECTION_META[section].label} — ${tab?.label ?? tabValue}`;
}

export function parseReportSearchParams(search: string): { section: ReportSectionId; tab: string } {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const rawSection = params.get("section") as ReportSectionId | null;
  const rawTab = params.get("tab");
  const section = rawSection && ALL_SECTIONS.includes(rawSection) ? rawSection : "policies";
  const tabs = SECTION_TAB_DEFS[section].map((t) => t.value);
  const tab = rawTab && tabs.includes(rawTab) ? rawTab : SECTION_TAB_DEFS[section][0]!.value;
  return { section, tab };
}

export const REPORT_FILTER_DATASETS: ReportDatasetId[] = ["branches", "products", "users"];
