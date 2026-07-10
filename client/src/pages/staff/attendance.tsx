import { useEffect, useRef, useState } from "react";
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
import { useAuth } from "@/hooks/use-auth";
import { ClipboardCheck, CheckCircle2, XCircle, Clock, Loader2, CalendarDays, Users, FileDown, QrCode, ScanLine, Printer, Plus } from "lucide-react";
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

/** HH:MM in Africa/Harare, for pre-filling <input type="time"> against a stored UTC instant. */
function toHarareHHMM(d: string | null | undefined): string {
  if (!d) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Harare", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(d));
  } catch {
    return "";
  }
}

/** Best-effort GPS fix; scanning still proceeds without one if permission is denied. */
async function getCoords(): Promise<{ latitude?: number; longitude?: number }> {
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10_000 });
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch {
    return {};
  }
}

function ScanAttendancePanel({ onScanned }: { onScanned: () => void }) {
  const { toast } = useToast();
  const scannerRef = useRef<any>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ eventType: string; log: any } | null>(null);

  const scanMutation = useMutation({
    mutationFn: async (qrToken: string) => {
      const { latitude, longitude } = await getCoords();
      const res = await apiRequest("POST", "/api/attendance/scan", { qrToken, latitude, longitude });
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data);
      onScanned();
      toast({ title: data.eventType === "clock_in" ? "Clocked in" : "Clocked out" });
    },
    onError: (err: any) => toast({ title: "Scan failed", description: err.message, variant: "destructive" }),
  });

  const stopScanner = async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.clear(); } catch { /* already stopped */ }
      scannerRef.current = null;
    }
    setScanning(false);
  };

  const startScanner = async () => {
    setResult(null);
    setScanning(true);
    const { Html5QrcodeScanner } = await import("html5-qrcode");
    const scanner = new Html5QrcodeScanner("qr-attendance-reader", { fps: 10, qrbox: 250 }, false);
    scannerRef.current = scanner;
    scanner.render(
      async (decodedText: string) => {
        if (busy) return;
        setBusy(true);
        await stopScanner();
        try {
          const parsed = JSON.parse(decodedText);
          await scanMutation.mutateAsync(parsed.token);
        } catch {
          toast({ title: "Not a valid attendance QR code", variant: "destructive" });
        } finally {
          setBusy(false);
        }
      },
      () => { /* ignore per-frame decode errors */ },
    );
  };

  useEffect(() => () => { scannerRef.current?.clear().catch(() => {}); }, []);

  return (
    <CardSection title="Scan to Clock In / Out" icon={ScanLine}>
      <div className="max-w-sm space-y-4">
        {result && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <p className="font-medium text-emerald-800">
              {result.eventType === "clock_in" ? `Clocked in at ${fmtTime(result.log.clockInAt)}` : `Clocked out at ${fmtTime(result.log.clockOutAt)}`}
            </p>
            {result.log.hoursWorked && (
              <p className="text-emerald-700">{Number(result.log.hoursWorked).toFixed(1)} hrs worked today</p>
            )}
          </div>
        )}
        {!scanning ? (
          <Button onClick={startScanner}>
            <ScanLine className="h-4 w-4 mr-2" />{result ? "Scan Again" : "Start Scan"}
          </Button>
        ) : (
          <>
            <div id="qr-attendance-reader" className="w-full" />
            <Button variant="outline" onClick={stopScanner}>Cancel</Button>
          </>
        )}
        <p className="text-xs text-muted-foreground">
          Point your camera at the QR code posted at your premises. Your first scan of the
          day clocks you in, your next scan clocks you out.
        </p>
      </div>
    </CardSection>
  );
}

function QrKiosksPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [label, setLabel] = useState("");
  const [branchId, setBranchId] = useState("");

  const { data: kiosks = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/attendance/qr-codes"] });
  const { data: branches = [] } = useQuery<any[]>({ queryKey: ["/api/branches"] });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/attendance/qr-codes", { label, branchId: branchId || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/qr-codes"] });
      setShowCreate(false); setLabel(""); setBranchId("");
      toast({ title: "QR kiosk created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <CardSection
      title="QR Attendance Kiosks"
      icon={QrCode}
      headerRight={<Button size="sm" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4 mr-1.5" />New Kiosk</Button>}
    >
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : kiosks.length === 0 ? (
        <EmptyState
          title="No QR kiosks yet"
          description="Create one per entrance/premises so staff can scan to clock in and out."
          className="border-0 bg-transparent py-8"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>QR Code</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {kiosks.map((k: any) => (
              <TableRow key={k.id}>
                <TableCell className="font-medium">{k.label}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {branches.find((b: any) => b.id === k.branchId)?.name || "—"}
                </TableCell>
                <TableCell>
                  {k.isActive ? <Badge className="bg-emerald-600 text-white text-xs">Active</Badge> : <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <img
                      src={`${getApiBase()}/api/attendance/qr-codes/${k.id}/image`}
                      alt={`QR code for ${k.label}`}
                      className="h-12 w-12 border rounded"
                    />
                    <Button size="sm" variant="outline" className="h-8 text-xs" asChild>
                      <a href={`${getApiBase()}/api/attendance/qr-codes/${k.id}/image`} target="_blank" rel="noopener noreferrer">
                        <Printer className="h-3.5 w-3.5 mr-1" />Print
                      </a>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New QR Kiosk</DialogTitle>
            <DialogDescription>Create a QR code to post at an entrance/premises.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Label</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Head Office Main Entrance" />
            </div>
            <div className="space-y-1.5">
              <Label>Branch <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!label.trim() || createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CardSection>
  );
}

export default function StaffAttendance() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { permissions } = useAuth();
  const canManageAttendance = permissions.includes("manage:attendance");

  // My attendance state
  const [logDate, setLogDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [logNotes, setLogNotes] = useState("");
  const [logClockIn, setLogClockIn] = useState("");
  const [logClockOut, setLogClockOut] = useState("");

  // Admin state
  const [filterDate, setFilterDate] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [approveId, setApproveId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [actionNotes, setActionNotes] = useState("");
  const [correctLog, setCorrectLog] = useState<any | null>(null);
  const [correctClockIn, setCorrectClockIn] = useState("");
  const [correctClockOut, setCorrectClockOut] = useState("");

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
    mutationFn: () => apiRequest("POST", "/api/attendance", {
      date: logDate,
      notes: logNotes,
      clockInTime: logClockIn || undefined,
      clockOutTime: logClockOut || undefined,
    }),
    onSuccess: () => {
      refetchMine();
      setLogNotes(""); setLogClockIn(""); setLogClockOut("");
      toast({ title: "Attendance logged", description: `Logged for ${fmtDate(logDate)}. Awaiting manager approval.` });
    },
    onError: (err: any) => toast({ title: "Could not log attendance", description: err.message, variant: "destructive" }),
  });

  const correctMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/attendance/${correctLog.id}/correct`, {
      clockInTime: correctClockIn || undefined,
      clockOutTime: correctClockOut || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/attendance"] });
      setCorrectLog(null);
      toast({ title: "Attendance corrected" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
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

        <Tabs defaultValue="scan">
          <TabsList>
            <TabsTrigger value="scan"><ScanLine className="h-4 w-4 mr-2" />Scan</TabsTrigger>
            <TabsTrigger value="my"><CalendarDays className="h-4 w-4 mr-2" />My Attendance</TabsTrigger>
            <TabsTrigger value="team">
              <Users className="h-4 w-4 mr-2" />
              Team Attendance
              {pendingCount > 0 && (
                <Badge variant="destructive" className="ml-2 text-xs px-1.5 py-0">{pendingCount}</Badge>
              )}
            </TabsTrigger>
            {canManageAttendance && (
              <TabsTrigger value="kiosks"><QrCode className="h-4 w-4 mr-2" />QR Kiosks</TabsTrigger>
            )}
          </TabsList>

          {/* ── Scan (QR clock in/out) ── */}
          <TabsContent value="scan" className="space-y-4">
            <ScanAttendancePanel onScanned={refetchMine} />
          </TabsContent>

          {/* ── QR Kiosks (admin) ── */}
          {canManageAttendance && (
            <TabsContent value="kiosks" className="space-y-4">
              <QrKiosksPanel />
            </TabsContent>
          )}

          {/* ── My Attendance ── */}
          <TabsContent value="my" className="space-y-4">
            <CardSection title="Manual Attendance Correction" description="Use the Scan tab to clock in/out normally. Use this to fix a missed scan — it fills in whichever time you enter without disturbing an existing scan." icon={ClipboardCheck}>
              <div className="space-y-4 max-w-sm">
                <div className="space-y-1.5">
                  <Label>Date</Label>
                  <Input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Clock In <span className="text-muted-foreground text-xs">(optional)</span></Label>
                    <Input type="time" value={logClockIn} onChange={(e) => setLogClockIn(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Clock Out <span className="text-muted-foreground text-xs">(optional)</span></Label>
                    <Input type="time" value={logClockOut} onChange={(e) => setLogClockOut(e.target.value)} />
                  </div>
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
                      <TableHead>Clock In</TableHead>
                      <TableHead>Clock Out</TableHead>
                      <TableHead>Hours</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Approval Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {myLogs.map((log: any) => (
                      <TableRow key={log.id}>
                        <TableCell className="font-medium">{fmtDate(log.date)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtTime(log.clockInAt)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtTime(log.clockOutAt)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{log.hoursWorked ? Number(log.hoursWorked).toFixed(1) : "—"}</TableCell>
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
                      <TableHead>Clock In</TableHead>
                      <TableHead>Clock Out</TableHead>
                      <TableHead>Hours</TableHead>
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
                        <TableCell className="text-sm text-muted-foreground">{fmtTime(log.clockInAt)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtTime(log.clockOutAt)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{log.hoursWorked ? Number(log.hoursWorked).toFixed(1) : "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{log.notes || "—"}</TableCell>
                        <TableCell>{statusBadge(log.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{log.approvalNotes || "—"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            {log.status === "pending" && (
                              <>
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
                              </>
                            )}
                            {log.status !== "pending" && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1 mr-1">
                                <Clock className="h-3 w-3" />{fmtTime(log.approvedAt)}
                              </span>
                            )}
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 text-xs"
                              onClick={() => { setCorrectLog(log); setCorrectClockIn(toHarareHHMM(log.clockInAt)); setCorrectClockOut(toHarareHHMM(log.clockOutAt)); }}
                            >
                              Correct
                            </Button>
                          </div>
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

      {/* Correct dialog */}
      <Dialog open={!!correctLog} onOpenChange={(v) => { if (!v) setCorrectLog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Correct Attendance</DialogTitle>
            <DialogDescription>
              Fix a missed or incorrect scan for {correctLog?.employee?.firstName} {correctLog?.employee?.lastName} on {correctLog ? fmtDate(correctLog.date) : ""}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Clock In</Label>
              <Input type="time" value={correctClockIn} onChange={(e) => setCorrectClockIn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Clock Out</Label>
              <Input type="time" value={correctClockOut} onChange={(e) => setCorrectClockOut(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrectLog(null)}>Cancel</Button>
            <Button onClick={() => correctMutation.mutate()} disabled={correctMutation.isPending}>
              {correctMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
