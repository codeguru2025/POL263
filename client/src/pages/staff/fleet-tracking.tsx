import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Car, MapPin, Gauge, Loader2, LogOut } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

function fmtTime(d: string | null | undefined) {
  if (!d) return "—";
  try { return new Date(d).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }); }
  catch { return d; }
}

/** Buffers watchPosition updates and flushes them as a batch every `intervalMs`. */
function useVehiclePingStream(assignmentId: string | null, intervalMs = 30_000) {
  const bufferRef = useRef<any[]>([]);
  const watchIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!assignmentId) return;
    let cancelled = false;
    let flushTimer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      const { Geolocation } = await import("@capacitor/geolocation");
      if (cancelled) return;
      watchIdRef.current = await Geolocation.watchPosition({ enableHighAccuracy: true }, (pos) => {
        if (!pos) return;
        bufferRef.current.push({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          speedKmh: pos.coords.speed != null ? pos.coords.speed * 3.6 : undefined,
          recordedAt: new Date(pos.timestamp).toISOString(),
        });
      });

      flushTimer = setInterval(async () => {
        if (bufferRef.current.length === 0) return;
        const pings = bufferRef.current;
        bufferRef.current = [];
        try {
          await apiRequest("POST", `/api/fleet/checkouts/${assignmentId}/pings`, { pings });
        } catch {
          // dropped batch is acceptable — next flush carries newer pings
        }
      }, intervalMs);
    })();

    return () => {
      cancelled = true;
      if (flushTimer) clearInterval(flushTimer);
      if (watchIdRef.current) {
        import("@capacitor/geolocation").then(({ Geolocation }) => Geolocation.clearWatch({ id: watchIdRef.current! }));
      }
    };
  }, [assignmentId, intervalMs]);
}

function MyVehiclePanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedVehicleId, setSelectedVehicleId] = useState("");

  const { data: mine, isLoading } = useQuery<any>({ queryKey: ["/api/fleet/checkouts/mine"] });
  const { data: available = [] } = useQuery<any[]>({ queryKey: ["/api/fleet/available"], enabled: !mine });
  const { data: myAttendance = [] } = useQuery<any[]>({ queryKey: ["/api/attendance/my"], enabled: !mine });
  // Africa/Harare is UTC+2 — matches the server's definition of "today" (see date-utils.ts).
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const todayLog = myAttendance.find((l: any) => l.date === todayStr);
  const isClockedIn = !!todayLog?.clockInAt && !todayLog?.clockOutAt;

  useVehiclePingStream(mine?.id ?? null);

  const checkoutMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/fleet/${selectedVehicleId}/checkout`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fleet/checkouts/mine"] });
      toast({ title: "Vehicle checked out" });
    },
    onError: (err: any) => toast({ title: "Could not check out vehicle", description: err.message, variant: "destructive" }),
  });

  const returnMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/fleet/checkouts/${mine.id}/return`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fleet/checkouts/mine"] });
      toast({ title: "Vehicle returned" });
    },
    onError: (err: any) => toast({ title: "Could not return vehicle", description: err.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  if (mine) {
    return (
      <CardSection title="Active Checkout" icon={Car}>
        <div className="max-w-sm space-y-3">
          <p className="text-sm">
            You checked out <span className="font-medium">{mine.vehicle?.registration}</span>
            {mine.vehicle?.make ? ` (${mine.vehicle.make} ${mine.vehicle.model || ""})` : ""} at {fmtTime(mine.startDate)}.
          </p>
          <p className="text-xs text-muted-foreground">
            Your location is being reported while this vehicle is checked out. Keep the app open while driving.
          </p>
          <Button variant="outline" onClick={() => returnMutation.mutate()} disabled={returnMutation.isPending}>
            {returnMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><LogOut className="h-4 w-4 mr-2" />Return Vehicle</>}
          </Button>
        </div>
      </CardSection>
    );
  }

  return (
    <CardSection title="Check Out a Vehicle" icon={Car}>
      <div className="max-w-sm space-y-3">
        {!isClockedIn ? (
          <EmptyState
            title="Clock in first"
            description="You must clock in via the Attendance → Scan tab before checking out a company vehicle."
            className="border-0 bg-transparent py-8"
          />
        ) : available.length === 0 ? (
          <EmptyState title="No vehicles available" description="All company vehicles are currently checked out." className="border-0 bg-transparent py-8" />
        ) : (
          <>
            <Select value={selectedVehicleId} onValueChange={setSelectedVehicleId}>
              <SelectTrigger><SelectValue placeholder="Select a vehicle" /></SelectTrigger>
              <SelectContent>
                {available.map((v: any) => (
                  <SelectItem key={v.id} value={v.id}>{v.registration} {v.make ? `— ${v.make} ${v.model || ""}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => checkoutMutation.mutate()} disabled={!selectedVehicleId || checkoutMutation.isPending}>
              {checkoutMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check Out"}
            </Button>
          </>
        )}
      </div>
    </CardSection>
  );
}

function LiveTrackingPanel() {
  const { data: active = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/fleet/checkouts/active"],
    refetchInterval: 20_000,
  });

  const withPosition = active.filter((a: any) => a.latestPing);
  const center: [number, number] = withPosition.length > 0
    ? [Number(withPosition[0].latestPing.latitude), Number(withPosition[0].latestPing.longitude)]
    : [-17.8252, 31.0335]; // Harare fallback

  return (
    <div className="space-y-4">
      <CardSection title="Live Vehicle Map" icon={MapPin} contentClassName="p-0" flush>
        <div style={{ height: 400 }}>
          <MapContainer center={center} zoom={withPosition.length > 0 ? 12 : 6} style={{ height: "100%", width: "100%" }}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; OpenStreetMap contributors'
            />
            {withPosition.map((a: any) => (
              <CircleMarker
                key={a.id}
                center={[Number(a.latestPing.latitude), Number(a.latestPing.longitude)]}
                radius={8}
                pathOptions={{ color: "#0f766e", fillColor: "#0f766e", fillOpacity: 0.8 }}
              >
                <Popup>
                  <div className="text-xs">
                    <div className="font-medium">{a.vehicle?.registration}</div>
                    <div>Speed: {a.latestPing.speedKmh ? `${Number(a.latestPing.speedKmh).toFixed(0)} km/h` : "—"}</div>
                    <div>As of {fmtTime(a.latestPing.recordedAt)}</div>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      </CardSection>

      <CardSection title="Checked-Out Vehicles" icon={Gauge}>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : active.length === 0 ? (
          <EmptyState title="No vehicles checked out" description="Vehicles will appear here once a driver checks one out." className="border-0 bg-transparent py-8" />
        ) : (
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vehicle</TableHead>
                <TableHead>Checked Out</TableHead>
                <TableHead>Speed</TableHead>
                <TableHead>Last Update</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {active.map((a: any) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.vehicle?.registration}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{fmtTime(a.startDate)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {a.latestPing?.speedKmh ? `${Number(a.latestPing.speedKmh).toFixed(0)} km/h` : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {a.latestPing ? fmtTime(a.latestPing.recordedAt) : <Badge variant="secondary" className="text-xs">No GPS yet</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        )}
      </CardSection>
    </div>
  );
}

export default function FleetTracking() {
  const { permissions } = useAuth();
  const canUseFleet = permissions.includes("use:fleet");
  const canReadFleet = permissions.includes("read:fleet");

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Fleet Tracking"
          description="Check out company vehicles and monitor live location, speed, and stops"
          titleDataTestId="text-fleet-tracking-title"
        />

        {canUseFleet && canReadFleet ? (
          <Tabs defaultValue="my">
            <TabsList>
              <TabsTrigger value="my"><Car className="h-4 w-4 mr-2" />My Vehicle</TabsTrigger>
              <TabsTrigger value="live"><MapPin className="h-4 w-4 mr-2" />Live Tracking</TabsTrigger>
            </TabsList>
            <TabsContent value="my" className="space-y-4"><MyVehiclePanel /></TabsContent>
            <TabsContent value="live" className="space-y-4"><LiveTrackingPanel /></TabsContent>
          </Tabs>
        ) : canUseFleet ? (
          <MyVehiclePanel />
        ) : canReadFleet ? (
          <LiveTrackingPanel />
        ) : (
          <EmptyState title="No access" description="You don't have permission to view fleet tracking." />
        )}
      </PageShell>
    </StaffLayout>
  );
}
