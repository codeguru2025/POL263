import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch, useLocation } from "wouter";
import { getApiBase } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import {
  buildStaffReportHref,
  parseReportSearchParams,
  tabUsesDataset,
  tabsForSection,
  visibleReportSections,
  type ReportDatasetId,
  type ReportSectionId,
} from "@/lib/staff-reports-nav";
import { buildQuery, type ReportFiltersState } from "./export-button";

/** Shared filter state, URL/section/tab resolution, and dataset gating for every report tab.
 *  One instance is created in index.tsx and passed down to whichever section component is
 *  currently rendered — this mirrors the original single-component behavior exactly, just
 *  relocated out of the (formerly) 2582-line reports.tsx. */
export function useReportFilters() {
  const { permissions, isLoading: authLoading } = useAuth();
  const canReadFinance = permissions.includes("read:finance");
  const canReadClaim = permissions.includes("read:claim");
  const canReadFuneralOps = permissions.includes("read:funeral_ops");
  const canReadFleet = permissions.includes("read:fleet");
  const canReadPayroll = permissions.includes("read:payroll");
  const canReadCommission = permissions.includes("read:commission");

  const sectionOpts = useMemo(
    () => ({ canReadCommission, canReadFuneralOps, canReadFleet }),
    [canReadCommission, canReadFuneralOps, canReadFleet],
  );

  const visibleSections = useMemo(
    () =>
      visibleReportSections({
        canReadFinance,
        canReadClaim,
        canReadFuneralOps,
        canReadFleet,
        canReadPayroll,
      }),
    [canReadFinance, canReadClaim, canReadFuneralOps, canReadFleet, canReadPayroll],
  );

  const searchString = useSearch();
  const [, setLocation] = useLocation();

  const { reportSection, activeReport } = useMemo(() => {
    const parsed = parseReportSearchParams(searchString);
    let section: ReportSectionId = parsed.section;
    // While permissions are still loading, visibleSections is a placeholder (empty perms ⇒
    // only "policies"/"agents" look visible) — trust the URL's section as-is rather than
    // falling back, otherwise every fresh/full page load of e.g. ?section=finance briefly
    // (but deterministically, since the effect below fires before permissions resolve)
    // bounces the user to a default section before permissions are known.
    if (!authLoading && !visibleSections.includes(section)) section = visibleSections[0]!;
    const tabs = tabsForSection(section, sectionOpts);
    let tab = parsed.tab;
    if (!tabs.some((x) => x.value === tab)) tab = tabs[0]!.value;
    return { reportSection: section, activeReport: tab };
  }, [searchString, visibleSections, sectionOpts, authLoading]);

  useEffect(() => {
    if (authLoading) return;
    const parsed = parseReportSearchParams(searchString);
    if (parsed.section === reportSection && parsed.tab === activeReport) return;
    setLocation(buildStaffReportHref(reportSection, activeReport));
  }, [searchString, reportSection, activeReport, setLocation, authLoading]);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [userId, setUserId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [productId, setProductId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [runKey, setRunKey] = useState(0);

  useEffect(() => {
    setRunKey(0);
  }, [reportSection, activeReport]);

  const filters = useMemo<ReportFiltersState>(() => ({
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
    userId: userId || undefined,
    branchId: branchId || undefined,
    productId: productId || undefined,
    agentId: agentId || undefined,
    status: statusFilter || undefined,
  }), [fromDate, toDate, userId, branchId, productId, agentId, statusFilter]);
  const q = buildQuery(filters);
  const qAppend = q ? q.replace("?", "&") : "";
  const fk = [fromDate, toDate, userId, branchId, productId, agentId, statusFilter];

  const load = runKey > 0;
  const need = (d: ReportDatasetId) => load && tabUsesDataset(activeReport, d);

  const { data: users = [] } = useQuery<any[]>({
    queryKey: ["reports", "filter-users"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/users", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: branches = [] } = useQuery<any[]>({
    queryKey: ["reports", "filter-branches"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/branches", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: products = [] } = useQuery<any[]>({
    queryKey: ["reports", "filter-products"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/products", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  return {
    authLoading,
    canReadFinance, canReadClaim, canReadFuneralOps, canReadFleet, canReadPayroll, canReadCommission,
    sectionOpts, visibleSections,
    reportSection, activeReport,
    fromDate, setFromDate, toDate, setToDate, userId, setUserId,
    branchId, setBranchId, productId, setProductId, agentId, setAgentId,
    statusFilter, setStatusFilter, runKey, setRunKey,
    filters, q, qAppend, fk, need,
    users, branches, products,
  };
}

export type UseReportFilters = ReturnType<typeof useReportFilters>;

/** Props common to every report section component. */
export interface ReportSectionBaseProps {
  filters: ReportFiltersState;
  q: string;
  qAppend: string;
  fk: string[];
  runKey: number;
  need: (d: ReportDatasetId) => boolean;
}
