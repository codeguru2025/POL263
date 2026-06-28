import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ClipboardCheck, CheckCircle2, XCircle, Clock, Loader2, CalendarDays, Users, FileDown } from "lucide-react";
import { apiRequest, getApiBase } from "@/lib/queryClient";

function statusBadge(status: string) {
  if (status === "approved") return <Badge className="bg-emerald-600 text-white text-xs">Approved</Badge>;
  if (status === "rejected") return <Badge variant="destructive" className="text-xs">Rejected</Badge>;
  return <Badge variant="secondary" className="text-xs">Pending</Badge>;
}

function fmtDate(d: string) {
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-ZA", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }); }
  catch { return d; }
}

function fmtTime(d: string | null | undefined) {
  if (!d) return "—";
  try { return new Date(d).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }); }
  catch { return d; }
}

export default function StaffAttendance() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // My attendance state
  const [logDate, setLogDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [logNotes, setLogNotes] = useState("");

  // Admin state
  const [filterDate, setFilterDate] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [approveId, setApproveId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [actionNotes, setActionNotes] = useState("");

  // My own logs
  const { data: myLogs = [], isLoading: loadingMine, refetch: refetchMine } = useQuery<any[]>({
    queryKey: ["/api/attendance/my"],
  });

  // Team logs (requires write:payroll permission)
  // Query key includes filter values so each combination is cached independently
  const { data: teamLogs = [], isLoading: loadingTeam, refetch: refetchTeam } = useQuery<any[]>({
    queryKey: ["/api/attendance", { date: filterDate, status: filterStatus }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterDate) params.set("date", filterDate);
      if (filterStatus && filterStatus !== "all") params.set("status", filterStatus);
      const res = await fetch(`/api/attendance?${params}`, { credentials: "include" });
      if (!res.ok) { if (res.status === 403) return []; throw new Error(await res.text()); }
      return res.json();
    },
    retry: false,
  });

  const logMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/attendance", { date: logDate, notes: logNotes }),
    onSuccess: () => {
      refetchMine();
      setLogNotes("");
      toast({ title: "Attendance logged", description: `Logged for ${fmtDate(logDate)}. Awaiting manager approval.` });
    },
    onError: (err: any) => toast({ title: "Could not log attendance", description: err.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/attendance/${id}/approve`, { notes: actionNotes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance"] });
      setApproveId(null); setActionNotes("");
      toast({ title: "Attendance approved" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/attendance/${id}/reject`, { notes: actionNotes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance"] });
      setRejectId(null); setActionNotes("");
      toast({ title: "Attendance rejected" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const pendingCount = teamLogs.filter((l: any) => l.status === "pending").length;

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Attendance"
          description="Log daily attendance and manage approvals"
          titleDataTestId="text-attendance-title"
          actions={(
            <Button variant="outline" className="gap-1.5 shadow-sm" asChild>
              <a href={getApiBase() + "/api/forms/blank/attendance-log"} target="_blank" rel="noopener noreferrer">
                <FileDown className="h-4 w-4" /> Blank Attendance Log
              </a>
            </Button>
          )}
        />

        <Tabs defaultValue="my">
          <TabsList>
            <TabsTrigger value="my"><CalendarDays className="h-4 w-4 mr-2" />My Attendance</TabsTrigger>
            <TabsTrigger value="team">
              <Users className="h-4 w-4 mr-2" />
              Team Attendance
              {pendingCount > 0 && (
                <Badge variant="destructive" className="ml-2 text-xs px-1.5 py-0">{pendingCount}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── My Attendance ── */}
          <TabsContent value="my" className="space-y-4">
            <CardSection title="Log Today's Attendance" icon={ClipboardCheck}>
              <div className="space-y-4 max-w-sm">
                <div className="space-y-1.5">
                  <Label>Date</Label>
                  <Input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Textarea
                    value={logNotes}
                    onChange={(e) => setLogNotes(e.target.value)}
                    rows={2}
                  />
                </div>
                <Button onClick={() => logMutation.mutate()} disabled={logMutation.isPending}>
                  {logMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Logging…</> : <><ClipboardCheck className="h-4 w-4 mr-2" />Log Attendance</>}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Your log will be reviewed and approved by your manager or admin.
                </p>
              </div>
            </CardSection>

            <CardSection title="My Attendance History" icon={CalendarDays}>
              {loadingMine ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : myLogs.length === 0 ? (
                <EmptyState
                  title="No attendance logged yet"
                  description="Use the form above to log your first attendance entry."
                  className="border-0 bg-transparent py-8"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Logged At</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Approval Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {myLogs.map((log: any) => (
                      <TableRow key={log.id}>
                        <TableCell className="font-medium">{fmtDate(log.date)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtTime(log.loggedAt)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{log.notes || "—"}</TableCell>
                        <TableCell>{statusBadge(log.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{log.approvalNotes || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardSection>
          </TabsContent>

          {/* ── Team Attendance (manager/admin) ── */}
          <TabsContent value="team" className="space-y-4">
            <CardSection title="Team Attendance" icon={Users}>
              {/* Filters */}
              <div className="flex flex-wrap gap-3 mb-4">
                <div className="space-y-1">
                  <Label className="text-xs">Date</Label>
                  <Input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="w-44 h-8" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Status</Label>
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="w-36 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button size="sm" variant="outline" className="h-8" onClick={() => { setFilterDate(""); setFilterStatus("all"); }}>Clear</Button>
                </div>
              </div>

              {loadingTeam ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : teamLogs.length === 0 ? (
                <EmptyState
                  title="No attendance logs found"
                  description="Logs will appear here once employees start logging attendance."
                  className="border-0 bg-transparent py-8"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Logged At</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Approval Notes</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {teamLogs.map((log: any) => (
                      <TableRow key={log.id}>
                        <TableCell className="font-medium">
                          {log.employee?.firstName} {log.employee?.lastName}
                          <div className="text-xs text-muted-foreground">{log.employee?.employeeNumber}</div>
                        </TableCell>
                        <TableCell>{fmtDate(log.date)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtTime(log.loggedAt)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{log.notes || "—"}</TableCell>
                        <TableCell>{statusBadge(log.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{log.approvalNotes || "—"}</TableCell>
                        <TableCell>
                          {log.status === "pending" && (
                            <div className="flex gap-1">
                              <Button
                                size="sm" variant="outline"
                                className="h-7 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                                onClick={() => { setApproveId(log.id); setActionNotes(""); }}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Approve
                              </Button>
                              <Button
                                size="sm" variant="outline"
                                className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50"
                                onClick={() => { setRejectId(log.id); setActionNotes(""); }}
                              >
                                <XCircle className="h-3.5 w-3.5 mr-1" />Reject
                              </Button>
                            </div>
                          )}
                          {log.status !== "pending" && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />{fmtTime(log.approvedAt)}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardSection>
          </TabsContent>
        </Tabs>
      </PageShell>

      {/* Approve dialog */}
      <Dialog open={!!approveId} onOpenChange={(v) => { if (!v) setApproveId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Approve Attendance</DialogTitle>
            <DialogDescription>Confirm the employee reported for work. Add a note if needed.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label>Approval Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea value={actionNotes} onChange={(e) => setActionNotes(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveId(null)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => approveId && approveMutation.mutate(approveId)}
              disabled={approveMutation.isPending}
            >
              {approveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="h-4 w-4 mr-2" />Approve</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectId} onOpenChange={(v) => { if (!v) setRejectId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject Attendance</DialogTitle>
            <DialogDescription>Reject this attendance log. Please provide a reason.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label>Reason</Label>
            <Textarea value={actionNotes} onChange={(e) => setActionNotes(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => rejectId && rejectMutation.mutate(rejectId)}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><XCircle className="h-4 w-4 mr-2" />Reject</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
