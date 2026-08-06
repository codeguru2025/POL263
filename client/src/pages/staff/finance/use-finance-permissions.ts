import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { getApiBase } from "@/lib/queryClient";
import { isAgentScoped } from "@shared/roles";
import { Receipt, Landmark, FileMinus, Users, ShieldCheck, type LucideIcon } from "lucide-react";
import { QK_PENDING_APPROVALS } from "./query-keys";

export type FinanceGroup = "payments" | "banking" | "spend" | "people" | "approvals";

export interface FinanceTabMeta {
  value: string;
  label: string;
  title: string;
  group: FinanceGroup;
}

// Single source of truth for every Finance tab: value, label, tooltip, and which
// group row it belongs to. Per-tab visibility is permission-dependent and is
// resolved inside the hook; this list is what deep-link validation and the
// grouped nav are both derived from, so it can't drift out of sync with the JSX.
const FINANCE_TAB_META: FinanceTabMeta[] = [
  { value: "payments", label: "Payments & Receipts", title: "All receipted payments linked to policies and clients", group: "payments" },
  { value: "receipting-by-staff", label: "Receipting by Staff", title: "How much each staff member and branch has receipted, by period", group: "payments" },
  { value: "paynow", label: "Mobile & Cash", title: "Mobile money (Paynow) and cash payment collection", group: "payments" },
  { value: "cashups", label: "Cash-up Reconciliation", title: "Daily cash reconciliation — count cash collected against receipts issued", group: "payments" },
  { value: "group-receipt", label: "Group Receipt", title: "Receipt a single payment across multiple policies in a group", group: "payments" },
  { value: "banking", label: "Banking & Cash", title: "Bank accounts, cash deposits, and per-admin cash accountability", group: "banking" },
  { value: "requisitions", label: "Requisitions", title: "Expenditure requests: raise, approve, and mark paid", group: "spend" },
  { value: "expenditures", label: "Expenditures", title: "Operating expenses and outgoing payments", group: "spend" },
  { value: "commissions", label: "Commissions", title: "Agent commission earnings and payout status", group: "people" },
  { value: "my-pnl", label: "My P&L", title: "Your collections vs commissions P&L for the period", group: "people" },
  { value: "fx-rates", label: "FX Rates", title: "USD-base exchange rates for consolidated financial statements", group: "people" },
  { value: "platform", label: "Platform Fees", title: "Platform revenue owed to POL263 (2.5% on all cleared receipts — policy premiums and funeral service payments)", group: "people" },
  { value: "month-end", label: "Month-End Close", title: "Run the month-end close: batch premium collection for overdue policies", group: "people" },
  { value: "approvals", label: "Receipt Approvals", title: "Review and approve backdated group receipts before they are applied", group: "approvals" },
];

export const FINANCE_GROUP_META: Record<FinanceGroup, { label: string; icon: LucideIcon }> = {
  payments: { label: "Payments", icon: Receipt },
  banking: { label: "Banking", icon: Landmark },
  spend: { label: "Spend", icon: FileMinus },
  people: { label: "People & Periodic", icon: Users },
  approvals: { label: "Receipt Approvals", icon: ShieldCheck },
};
export const FINANCE_GROUP_ORDER: FinanceGroup[] = ["payments", "banking", "spend", "people", "approvals"];

/** Shared permission flags, tab visibility, and deep-link (?tab=) sync for the Finance
 *  page. One instance is created in index.tsx and threaded down to whichever tab is
 *  currently rendered — this mirrors the original single-component behavior exactly,
 *  just relocated out of the (formerly) 3895-line finance.tsx. */
export function useFinancePermissions() {
  const { roles, permissions, user: authUser } = useAuth();
  const isAgent = isAgentScoped(roles);
  const canReadFinance = permissions.includes("read:finance");
  const canWriteFinance = permissions.includes("write:finance");
  const canApproveFinance = permissions.includes("approve:finance") || (authUser as any)?.isPlatformOwner;
  const canDeleteRequisition = permissions.includes("delete:requisition") || (authUser as any)?.isPlatformOwner;
  const canBackdatePayment = permissions.includes("backdate:payment") || (authUser as any)?.isPlatformOwner;
  const canEditPayment = permissions.includes("edit:payment") || (authUser as any)?.isPlatformOwner;
  const canDeleteExpenditure = permissions.includes("delete:expenditure") || (authUser as any)?.isPlatformOwner;
  const canReadCommission = permissions.includes("read:commission");
  const commissionOnly = canReadCommission && !canReadFinance;
  const canManageSettings = permissions.includes("manage:settings") || (authUser as any)?.isPlatformOwner;

  // Shares its cache entry with PendingApprovalsPanel's identical query (same
  // queryKey) — this doesn't cost an extra network request, just reads the count.
  const { data: pendingApprovalsForBadge = [] } = useQuery<any[]>({
    queryKey: QK_PENDING_APPROVALS,
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/payment-receipts/pending-approvals", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: canApproveFinance && !isAgent,
  });
  const pendingApprovalsCount = pendingApprovalsForBadge.length;

  // Single source of truth for per-tab visibility, computed once here so both the
  // deep-link validator (resolveTab) and the render-time group/tab pills stay
  // in sync — previously resolveTab validated against the full static tab list
  // regardless of the current user's actual permissions, so a ?tab=X deep-link for a
  // tab this user can't see would set activeTab to a value with no visible group
  // pill, rendering a mismatched highlight (wrong pill lit, orphaned content below).
  const tabVisibility: Record<string, boolean> = {
    payments: !commissionOnly,
    "receipting-by-staff": !commissionOnly && !isAgent,
    paynow: !commissionOnly,
    cashups: !commissionOnly,
    "group-receipt": canWriteFinance && !isAgent,
    banking: !commissionOnly && !isAgent,
    requisitions: !commissionOnly && !isAgent,
    expenditures: !commissionOnly && !isAgent,
    commissions: canReadCommission,
    "my-pnl": commissionOnly,
    "fx-rates": canManageSettings && !isAgent,
    platform: !commissionOnly && !isAgent,
    "month-end": canWriteFinance && !isAgent,
    approvals: canApproveFinance && !isAgent,
  };
  const visibleTabDefs = FINANCE_TAB_META.filter((t) => tabVisibility[t.value]);
  const visibleTabValues = new Set(visibleTabDefs.map((t) => t.value));

  // Deep-linkable tabs: keep nav links like /staff/finance?tab=requisitions in sync
  // with the active tab so Finance sub-sections are reachable from the menu.
  const search = useSearch();
  const [, setLocation] = useLocation();
  const resolveTab = (raw: string | null) => {
    if (commissionOnly) return "commissions";
    return raw && visibleTabValues.has(raw) ? raw : (visibleTabDefs[0]?.value ?? "payments");
  };
  const [activeTab, setActiveTab] = useState(() =>
    resolveTab(typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") : null),
  );
  useEffect(() => {
    setActiveTab(resolveTab(new URLSearchParams(search).get("tab")));
    // Re-resolve whenever anything feeding tabVisibility changes (not just the URL) — a
    // live permission change (role edit, mid-session re-fetch) must not leave activeTab
    // pointing at a tab that just became invisible.
  }, [search, commissionOnly, canApproveFinance, canWriteFinance, canManageSettings, canReadCommission, isAgent]);
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setLocation(value === (commissionOnly ? "commissions" : "payments") ? "/staff/finance" : `/staff/finance?tab=${value}`);
  };

  return {
    roles, permissions, authUser, isAgent,
    canReadFinance, canWriteFinance, canApproveFinance, canDeleteRequisition,
    canBackdatePayment, canEditPayment, canDeleteExpenditure, canReadCommission,
    commissionOnly, canManageSettings,
    pendingApprovalsCount,
    tabVisibility, visibleTabDefs, visibleTabValues,
    activeTab, setActiveTab, handleTabChange,
  };
}
