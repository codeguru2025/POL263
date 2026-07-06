import { useState } from "react";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, DataTable, dataTableStickyHeaderClass, EmptyState } from "@/components/ds";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getApiBase, getCsrfToken } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Search, MessageSquare, Loader2, ChevronLeft, ChevronRight } from "lucide-react";

interface ClientFeedback {
  id: string;
  clientId: string;
  type: string;
  subject: string;
  message: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const STATUSES = ["open", "acknowledged", "in_progress", "resolved", "closed"];
const PAGE_SIZE = 50;

function statusBadgeClass(status: string) {
  if (status === "open") return "bg-red-50 text-red-700 border-red-200";
  if (status === "acknowledged") return "bg-blue-50 text-blue-700 border-blue-200";
  if (status === "in_progress") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "resolved" || status === "closed") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  return "";
}

function ClientName({ clientId }: { clientId: string }) {
  const { data } = useQuery<any>({
    queryKey: [`/api/clients/${clientId}`],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/clients/${clientId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });
  if (!data) return <span className="text-muted-foreground text-xs">—</span>;
  return <span className="font-medium">{data.fullName || data.name || `${data.firstName || ""} ${data.lastName || ""}`.trim() || "—"}</span>;
}

export default function StaffFeedback() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { permissions } = useAuth();
  const canWrite = permissions.includes("write:client");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useQuery<{ rows: ClientFeedback[]; total: number }>({
    queryKey: ["/api/feedback", search, statusFilter, typeFilter, offset],
    queryFn: async () => {
      const p = new URLSearchParams();
      p.set("limit", String(PAGE_SIZE));
      p.set("offset", String(offset));
      if (search) p.set("search", search);
      if (statusFilter !== "all") p.set("status", statusFilter);
      if (typeFilter !== "all") p.set("type", typeFilter);
      const res = await fetch(getApiBase() + `/api/feedback?${p}`, { credentials: "include" });
      if (!res.ok) return { rows: [], total: 0 };
      return res.json();
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch(getApiBase() + `/api/feedback/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": await getCsrfToken() ?? "" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to update status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feedback"] });
      toast({ title: "Status updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Client Feedback & Complaints"
          description="Feedback and complaints submitted by clients through the client portal."
        />

        <CardSection
          title="Feedback inbox"
          icon={MessageSquare}
          flush
          headerRight={(
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative w-56">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search subject / message…"
                  className="pl-9 bg-background"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
                />
              </div>
              <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setOffset(0); }}>
                <SelectTrigger className="w-36"><SelectValue placeholder="All types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="complaint">Complaint</SelectItem>
                  <SelectItem value="feedback">Feedback</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setOffset(0); }}>
                <SelectTrigger className="w-40"><SelectValue placeholder="All statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : rows.length === 0 ? (
            <EmptyState
              title="No feedback found"
              description="No client feedback or complaints match the current filter."
              className="border-0 rounded-none bg-transparent py-10"
            />
          ) : (
            <>
              <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                <TableHeader className={dataTableStickyHeaderClass}>
                  <TableRow>
                    <TableHead className="pl-6">Client</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead className="pr-6">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((f) => (
                    <TableRow key={f.id} className="hover:bg-muted/30">
                      <TableCell className="pl-6"><ClientName clientId={f.clientId} /></TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] capitalize">{f.type}</Badge>
                      </TableCell>
                      <TableCell className="font-medium max-w-[220px] truncate" title={f.subject}>{f.subject}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[320px] truncate" title={f.message}>{f.message}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(f.createdAt).toLocaleString()}</TableCell>
                      <TableCell className="pr-6">
                        {canWrite ? (
                          <Select
                            value={f.status}
                            onValueChange={(status) => updateStatusMutation.mutate({ id: f.id, status })}
                            disabled={updateStatusMutation.isPending}
                          >
                            <SelectTrigger className="w-36 h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUSES.map((s) => (
                                <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="outline" className={`text-[10px] capitalize ${statusBadgeClass(f.status)}`}>
                            {f.status.replace(/_/g, " ")}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </DataTable>

              <div className="flex items-center justify-between px-6 py-3 border-t text-sm text-muted-foreground">
                <span>{total} total</span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                    <ChevronLeft className="h-4 w-4" /> Prev
                  </Button>
                  <Button size="sm" variant="outline" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
                    Next <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardSection>
      </PageShell>
    </StaffLayout>
  );
}
