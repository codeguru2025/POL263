import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiBase } from "@/lib/queryClient";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { PageHeader, PageShell, CardSection, EmptyState, EnhancedDataTable } from "@/components/ds";
import { AiInsightsPanel } from "@/components/ai-insights-panel";
import { Plus, Search, Filter, MoreHorizontal, FileText, ArrowRightLeft, Eye, Pencil, Trash2, FileDown, ChevronDown, AlertTriangle } from "lucide-react";
import { VALID_POLICY_TRANSITIONS, STATUS_LABELS } from "@/lib/policy-status-transitions";
import type { CountryFlagSettings } from "@/components/country-flag-fields";

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function getStatusColor(status: string) {
  switch (status) {
    case "active": return "bg-emerald-500/15 text-emerald-700 border-emerald-200";
    case "grace": return "bg-amber-500/15 text-amber-700 border-amber-200";
    case "lapsed": return "bg-destructive/15 text-destructive border-destructive/30";
    case "inactive": return "bg-blue-500/15 text-blue-700 border-blue-200";
    case "cancelled": return "bg-gray-500/15 text-gray-600 border-gray-200";
    default: return "bg-muted text-muted-foreground";
  }
}

interface PolicyListViewProps {
  getClientName: (clientId: string) => string;
  countryFlagSettings: CountryFlagSettings | undefined;
  canWritePolicy: boolean;
  canDeletePolicy: boolean;
  isAgent: boolean;
  onOpenDetail: (policy: any) => void;
  onOpenEditDialog: (policy: any) => void;
  onOpenUpgradeDialog: (policy: any) => void;
  onOpenTransition: (policy: any, target: string) => void;
  onOpenDelete: (policy: any) => void;
  onCreateClick: () => void;
}

export function PolicyListView({
  getClientName, countryFlagSettings, canWritePolicy, canDeletePolicy, isAgent,
  onOpenDetail, onOpenEditDialog, onOpenUpgradeDialog, onOpenTransition, onOpenDelete, onCreateClick,
}: PolicyListViewProps) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [countryFilter, setCountryFilter] = useState<string>("all");

  // limit=500 (the server's hard ceiling — see GET /api/policies) since this page has no
  // pagination UI of its own and expects the full list in one fetch. Without an explicit limit
  // the server silently defaults to 100, which for an org with >100 policies (like Falakhe)
  // meant the tail of the list just never loaded.
  const policiesQueryUrl = debouncedSearch
    ? `/api/policies?limit=500&q=${encodeURIComponent(debouncedSearch)}`
    : "/api/policies?limit=500";

  const { data: policies, isLoading: policiesLoading, isError: policiesError, error: policiesErrorObj, refetch: refetchPolicies } = useQuery<any[]>({
    queryKey: ["/api/policies", { q: debouncedSearch }],
    queryFn: async () => {
      const res = await fetch(getApiBase() + policiesQueryUrl, { credentials: "include" });
      if (res.status === 401 || res.status === 403) return [];
      if (!res.ok) throw new Error("Failed to fetch policies");
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const filteredPolicies = useMemo(() => {
    const list = Array.isArray(policies) ? policies : [];
    return list.filter((p: any) => {
      const matchesStatus = statusFilter === "all" || p.status === statusFilter;
      const matchesCountry = countryFilter === "all"
        || (countryFilter === "south_africa" && p.isSouthAfrica)
        || (countryFilter === "zimbabwe" && !p.isSouthAfrica);
      return matchesStatus && matchesCountry;
    });
  }, [policies, statusFilter, countryFilter]);

  return (
    <PageShell>
      <PageHeader
        title={<span className="font-display font-bold">Policies</span>}
        description="Manage policy lifecycles, billing cycles, and status transitions."
        actions={
          <div className="flex gap-2 flex-wrap">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-1.5 shadow-sm">
                  <FileDown className="h-4 w-4" /> Blank Forms <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <a href={getApiBase() + "/api/forms/blank/policy-application"} target="_blank" rel="noopener noreferrer">Policy Application Form</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={getApiBase() + "/api/forms/blank/waiver-request"} target="_blank" rel="noopener noreferrer">Waiver Request Form</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={getApiBase() + "/api/forms/blank/debit-order-mandate"} target="_blank" rel="noopener noreferrer">Debit Order Mandate</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={getApiBase() + "/api/forms/blank/claim-submission"} target="_blank" rel="noopener noreferrer">Claim Submission Form</a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button className="gap-2 shadow-sm" onClick={onCreateClick} data-testid="btn-create-policy">
              <Plus className="h-4 w-4" /> Issue New Policy
            </Button>
          </div>
        }
      />

      <AiInsightsPanel surface="policies" title="AI Insights" description="Ask AI to summarize the policy portfolio and flag retention/lapse trends worth attention." />

      <CardSection
        flush
        icon={FileText}
        title="Policy Directory"
        description="Search and filter your book of business, then open a policy to work on it."
      >
          {policiesError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Could not load policies"
              description={policiesErrorObj instanceof Error ? policiesErrorObj.message : "Something went wrong fetching the policy list."}
              action={<Button variant="outline" onClick={() => refetchPolicies()}>Try again</Button>}
              className="py-16"
            />
          ) : policiesLoading ? (
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="pl-6">Policy Number</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Premium</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Effective Date</TableHead>
                  <TableHead className="text-right pr-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-6"><div className="flex items-center gap-2"><Skeleton className="h-4 w-4 rounded" /><Skeleton className="h-3.5 w-28" /></div></TableCell>
                    <TableCell><Skeleton className="h-3.5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-3.5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-3.5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-3.5 w-20" /></TableCell>
                    <TableCell className="text-right pr-6"><Skeleton className="h-8 w-8 rounded ml-auto" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="px-4 pb-4 pt-2 sm:px-6">
            <EnhancedDataTable<any>
              columns={[
                {
                  id: "policyNumber",
                  header: "Policy Number",
                  accessor: (p: any) => p.policyNumber,
                  cell: (p: any) => (
                    <div className="flex items-center gap-2 font-medium">
                      <FileText className="h-4 w-4 text-primary/70 shrink-0" />
                      {p.policyNumber}
                      {p.isSouthAfrica && (
                        <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-700 border-blue-200" data-testid={`badge-south-africa-${p.id}`}>{countryFlagSettings?.flagLabel || "SA"}</Badge>
                      )}
                    </div>
                  ),
                },
                {
                  id: "client",
                  header: "Client",
                  accessor: (p: any) => getClientName(p.clientId),
                },
                {
                  id: "status",
                  header: "Status",
                  accessor: (p: any) => p.status,
                  cell: (p: any) => (
                    <Badge variant="outline" className={`font-medium ${getStatusColor(p.status)}`} data-testid={`badge-status-${p.id}`}>
                      {STATUS_LABELS[p.status] || p.status}
                    </Badge>
                  ),
                },
                {
                  id: "premium",
                  header: "Premium",
                  accessor: (p: any) => parseFloat(p.premiumAmount) || 0,
                  cell: (p: any) => `${p.currency} ${Number(p.premiumAmount).toFixed(2)}`,
                  cellClassName: "tabular-nums",
                },
                {
                  id: "schedule",
                  header: "Schedule",
                  accessor: (p: any) => p.paymentSchedule,
                  cellClassName: "text-muted-foreground capitalize",
                },
                {
                  id: "effectiveDate",
                  header: "Effective Date",
                  accessor: (p: any) => p.effectiveDate || "",
                  cellClassName: "text-muted-foreground",
                },
                {
                  id: "actions",
                  header: "Actions",
                  align: "right",
                  exportable: false,
                  sortable: false,
                  cell: (policy: any) => (
                    <div onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Policy actions" data-testid={`btn-actions-${policy.id}`}>
                            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onOpenDetail(policy)} data-testid={`menu-view-${policy.id}`}>
                            <Eye className="h-4 w-4 mr-2" /> View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { onOpenDetail(policy); setTimeout(() => onOpenEditDialog(policy), 100); }} data-testid={`menu-edit-${policy.id}`}>
                            <Pencil className="h-4 w-4 mr-2" /> Edit
                          </DropdownMenuItem>
                          {canWritePolicy && (
                            <DropdownMenuItem onClick={() => { onOpenDetail(policy); setTimeout(() => onOpenUpgradeDialog(policy), 100); }} data-testid={`menu-upgrade-${policy.id}`}>
                              <ArrowRightLeft className="h-4 w-4 mr-2" /> Upgrade Product
                            </DropdownMenuItem>
                          )}
                          {!isAgent && (VALID_POLICY_TRANSITIONS[policy.status] || []).length > 0 && (
                            <>
                              <DropdownMenuSeparator />
                              {VALID_POLICY_TRANSITIONS[policy.status]?.map((t) => (
                                <DropdownMenuItem key={t} onClick={() => onOpenTransition(policy, t)} data-testid={`menu-transition-${policy.id}-${t}`}>
                                  <ArrowRightLeft className="h-4 w-4 mr-2" /> → {STATUS_LABELS[t] || t}
                                </DropdownMenuItem>
                              ))}
                            </>
                          )}
                          {canDeletePolicy && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onOpenDelete(policy)} data-testid={`menu-delete-${policy.id}`}>
                                <Trash2 className="h-4 w-4 mr-2" /> Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ),
                },
              ]}
              rows={filteredPolicies}
              getRowKey={(p: any) => p.id}
              searchable={false}
              exportable
              exportFilename="policies"
              storageKey="policies-list"
              onRowClick={onOpenDetail}
              rowTestId={(p: any) => `row-policy-${p.id}`}
              emptyMessage={policies?.length === 0 ? "No policies yet" : "No matching policies"}
              toolbarExtra={
                <>
                  <div className="relative w-full sm:w-72 lg:w-64">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search policies..."
                      className="pl-9 bg-background h-9"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      data-testid="input-search-policies"
                    />
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full sm:w-40 shrink-0 h-9" data-testid="select-status-filter">
                      <Filter className="h-4 w-4 mr-2 shrink-0" />
                      <SelectValue placeholder="All Statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="grace">Grace</SelectItem>
                      <SelectItem value="lapsed">Lapsed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                  {countryFlagSettings?.isEnabled && (
                    <Select value={countryFilter} onValueChange={setCountryFilter}>
                      <SelectTrigger className="w-full sm:w-40 shrink-0 h-9" data-testid="select-country-filter">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="zimbabwe">{countryFlagSettings.homeLabel}</SelectItem>
                        <SelectItem value="south_africa">{countryFlagSettings.flagLabel}</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </>
              }
            />
            </div>
          )}
      </CardSection>
    </PageShell>
  );
}
