import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { getApiBase } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/**
 * Owns which policy (if any) is open in detail view, and keeps it in sync with a persistent
 * `?policyId=` query param — mirroring the `?tab=` / `?section=&tab=` conventions already used
 * by finance/use-finance-permissions.ts and reports/index.tsx.
 *
 * DELIBERATE BEHAVIOR CHANGE from the original policies.tsx: the original mechanism used
 * `?openPolicy=<id>`, consumed it ONCE on match, then stripped it from the URL via
 * `setLocation("/staff/policies", { replace: true })` — i.e. it was self-clearing and NOT
 * bookmarkable/shareable, and pressing the browser back button out of a detail view did nothing
 * useful (the param was already gone). This hook instead makes `?policyId=<id>` persistent: it
 * stays in the URL the whole time the detail view is open, so the URL can be bookmarked, shared,
 * or navigated to directly, and the browser back/forward buttons move between list and detail.
 */
export function usePolicySelection() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { toast } = useToast();

  const [showDetailView, setShowDetailView] = useState(false);
  const [selectedPolicy, setSelectedPolicy] = useState<any>(null);

  const urlPolicyId = new URLSearchParams(searchString).get("policyId");

  // Resolves ?policyId=<id> to the full policy record whenever it doesn't match what's
  // currently selected (first load of a bookmarked/shared link, or browser back/forward
  // landing on a different policy). A direct single-record fetch is simplest and correct
  // regardless of which view is active or what the list view's current search filter is.
  const { data: resolvedPolicy, isFetched: isResolveFetched } = useQuery<any>({
    queryKey: ["/api/policies", urlPolicyId, "selection"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/policies/${urlPolicyId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!urlPolicyId && urlPolicyId !== selectedPolicy?.id,
  });

  useEffect(() => {
    if (!urlPolicyId) {
      if (showDetailView) {
        setShowDetailView(false);
        setSelectedPolicy(null);
      }
      return;
    }
    if (urlPolicyId === selectedPolicy?.id) {
      if (!showDetailView) setShowDetailView(true);
      return;
    }
    if (resolvedPolicy?.id === urlPolicyId) {
      setSelectedPolicy(resolvedPolicy);
      setShowDetailView(true);
      return;
    }
    // The fetch for this policyId has settled but didn't resolve to a matching record — it's
    // either been deleted or the user lacks permission to view it. A bookmarked/shared
    // ?policyId= link can easily go stale, so this isn't a rare path: fail loudly (toast) and
    // drop the dead param instead of silently falling back to the list view with no explanation.
    if (isResolveFetched && resolvedPolicy == null) {
      toast({
        title: "Policy not found",
        description: "It may have been deleted, or you may not have permission to view it.",
        variant: "destructive",
      });
      setLocation("/staff/policies", { replace: true });
    }
  }, [urlPolicyId, resolvedPolicy, isResolveFetched, selectedPolicy?.id, showDetailView, toast, setLocation]);

  const openDetail = (policy: any) => {
    setSelectedPolicy(policy);
    setShowDetailView(true);
    setLocation(`/staff/policies?policyId=${policy.id}`);
  };

  const closeDetail = () => {
    setShowDetailView(false);
    setSelectedPolicy(null);
    setLocation("/staff/policies");
  };

  return {
    showDetailView,
    selectedPolicy,
    // Exposed raw so callers can update the in-memory selection without touching the URL
    // (e.g. a mutation's onSuccess refreshing selectedPolicy with the server's response,
    // or a list-view row action like "Transition"/"Delete" that targets a policy without
    // navigating into its detail view).
    setSelectedPolicy,
    openDetail,
    closeDetail,
  };
}
