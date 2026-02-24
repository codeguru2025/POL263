import StaffLayout from "@/components/layout/staff-layout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const mockAuditLogs = [
  {
    id: "evt_101",
    action: "UPDATE_LEASE",
    entity: "Lease",
    entityId: "lse_992",
    actor: "ausiziba@gmail.com",
    timestamp: "2023-10-24 14:32:01",
    diff: { status: ["PENDING", "ACTIVE"] }
  },
  {
    id: "evt_100",
    action: "CREATE_PROPERTY",
    entity: "Property",
    entityId: "prop_884",
    actor: "system_admin",
    timestamp: "2023-10-24 09:15:22",
    diff: null
  },
  {
    id: "evt_099",
    action: "DELETE_USER",
    entity: "User",
    entityId: "usr_421",
    actor: "ausiziba@gmail.com",
    timestamp: "2023-10-23 16:44:10",
    diff: null
  },
  {
    id: "evt_098",
    action: "ASSIGN_ROLE",
    entity: "UserRole",
    entityId: "ur_110",
    actor: "system_admin",
    timestamp: "2023-10-23 10:05:00",
    diff: { role: [null, "PROPERTY_MANAGER"] }
  }
];

export default function AuditLogs() {
  return (
    <StaffLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-display font-bold">Audit Logs</h1>
          <p className="text-muted-foreground mt-1">Track all system events within the current tenant scope.</p>
        </div>

        <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Event ID</TableHead>
                <TableHead>Timestamp</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Target Entity</TableHead>
                <TableHead>Before/After Diff</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mockAuditLogs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="font-mono text-xs">{log.id}</TableCell>
                  <TableCell className="text-sm">{log.timestamp}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {log.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{log.actor}</TableCell>
                  <TableCell className="text-sm">{log.entity} ({log.entityId})</TableCell>
                  <TableCell>
                    {log.diff ? (
                      <pre className="text-[10px] bg-muted p-2 rounded-md font-mono">
                        {JSON.stringify(log.diff, null, 2)}
                      </pre>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">No diff available</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </StaffLayout>
  );
}