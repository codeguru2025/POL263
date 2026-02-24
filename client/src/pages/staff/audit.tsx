import StaffLayout from "@/components/layout/staff-layout";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

export default function AuditLogs() {
  const { data: logs, isLoading } = useQuery<any[]>({
    queryKey: ["/api/audit-logs"],
  });

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-display font-bold">Audit Logs</h1>
          <p className="text-muted-foreground mt-1">Track all system events within the current tenant scope.</p>
        </div>

        <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
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
                {logs && logs.length > 0 ? (
                  logs.map((log: any) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-sm">
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
          )}
        </div>
      </div>
    </StaffLayout>
  );
}