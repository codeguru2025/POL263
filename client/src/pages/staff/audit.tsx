import StaffLayout from "@/components/layout/staff-layout";
import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";

const ACTION_OPTIONS = [
  "CREATE_CLIENT",
  "CREATE_POLICY",
  "CREATE_PAYMENT",
  "UPDATE_ORGANIZATION",
  "CASH_RECEIPT",
  "UPDATE_CLIENT",
  "UPDATE_POLICY",
  "DELETE_CLIENT",
  "CREATE_CLAIM",
  "UPDATE_CLAIM",
  "CREATE_PRODUCT",
  "UPDATE_PRODUCT",
];

const PAGE_SIZE = 50;

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export default function AuditLogs() {
  const [searchInput, setSearchInput] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);

  const debouncedSearch = useDebounce(searchInput, 300);

  const prevFiltersRef = useRef({ search: "", action: "", from: "", to: "" });
  useEffect(() => {
    const prev = prevFiltersRef.current;
    if (
      prev.search !== debouncedSearch ||
      prev.action !== action ||
      prev.from !== from ||
      prev.to !== to
    ) {
      setPage(0);
      prevFiltersRef.current = { search: debouncedSearch, action, from, to };
    }
  }, [debouncedSearch, action, from, to]);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (action) params.set("action", action);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params.toString();
  }, [page, debouncedSearch, action, from, to]);

  const { data, isLoading } = useQuery<{ rows: any[]; total: number }>({
    queryKey: ["/api/audit-logs", page, debouncedSearch, action, from, to],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/audit-logs?${buildParams()}`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) return { rows: [], total: 0 };
      if (!res.ok) throw new Error("Failed to fetch audit logs");
      return res.json();
    },
  });

  const logs = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-display font-bold">Audit Logs</h1>
          <p className="text-muted-foreground mt-1">Track all system events within the current tenant scope.</p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by actor, action, entity..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={action} onValueChange={(v) => setAction(v === "__all__" ? "" : v)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All actions</SelectItem>
              {ACTION_OPTIONS.map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-[150px]"
              placeholder="From"
            />
            <span className="text-muted-foreground text-sm">to</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-[150px]"
              placeholder="To"
            />
          </div>
        </div>

        <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Target Entity</TableHead>
                      <TableHead>Request ID</TableHead>
                      <TableHead>Before/After Diff</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.length > 0 ? (
                      logs.map((log: any) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-sm whitespace-nowrap">
                            {new Date(log.timestamp).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {log.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{log.actorEmail || "system"}</TableCell>
                          <TableCell className="text-sm">
                            {log.entityType}
                            {log.entityId && (
                              <span className="text-muted-foreground ml-1 font-mono text-[10px]">
                                ({log.entityId.slice(0, 8)}...)
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-[10px] text-muted-foreground">
                            {log.requestId || "—"}
                          </TableCell>
                          <TableCell>
                            {log.before || log.after ? (
                              <details className="cursor-pointer">
                                <summary className="text-xs text-primary hover:underline">View diff</summary>
                                <div className="mt-2 space-y-2">
                                  {log.before && (
                                    <div>
                                      <span className="text-[10px] font-semibold text-destructive">BEFORE:</span>
                                      <pre className="text-[10px] bg-destructive/5 p-2 rounded-md font-mono mt-1 overflow-x-auto max-w-sm">
                                        {JSON.stringify(log.before, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                  {log.after && (
                                    <div>
                                      <span className="text-[10px] font-semibold text-emerald-600">AFTER:</span>
                                      <pre className="text-[10px] bg-emerald-500/5 p-2 rounded-md font-mono mt-1 overflow-x-auto max-w-sm">
                                        {JSON.stringify(log.after, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              </details>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">No diff</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No audit logs found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/30">
                <p className="text-sm text-muted-foreground">
                  {total === 0
                    ? "No results"
                    : `Showing ${showingFrom}–${showingTo} of ${total} results`}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {page + 1} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </StaffLayout>
  );
}
