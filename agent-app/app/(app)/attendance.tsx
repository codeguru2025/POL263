import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { useAuth } from "../../src/context/AuthContext";
import { scanAttendance, getMyAttendance, getLiveAttendance, type AttendanceLog, type LiveAttendanceStats, type ScanResult } from "../../src/api/attendance";

type Segment = "scan" | "my" | "live";

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(d: string): string {
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-ZA", { weekday: "short", day: "2-digit", month: "short" }); }
  catch { return d; }
}

/** Same extraction as the web app's QR reader (client/src/pages/staff/attendance.tsx) —
 *  the kiosk QR encodes a real URL (/staff/attendance?scan=<token>) so a phone's default
 *  camera app also offers "Open," but still accepts the older raw-JSON payload. */
function extractScanToken(decodedText: string): string | null {
  try {
    const parsed = JSON.parse(decodedText);
    if (parsed && typeof parsed.token === "string" && parsed.token) return parsed.token;
  } catch { /* not JSON */ }
  try {
    const url = new URL(decodedText);
    const token = url.searchParams.get("scan");
    if (token) return token;
  } catch { /* not a URL either */ }
  return null;
}

export default function AttendanceScreen() {
  const { permissions } = useAuth();
  const canViewTeam = permissions.includes("read:payroll");
  const [segment, setSegment] = useState<Segment>("scan");

  return (
    <View style={styles.screen}>
      <View style={styles.segments}>
        <SegmentButton label="Scan" active={segment === "scan"} onPress={() => setSegment("scan")} />
        <SegmentButton label="My Attendance" active={segment === "my"} onPress={() => setSegment("my")} />
        {canViewTeam && <SegmentButton label="Live" active={segment === "live"} onPress={() => setSegment("live")} />}
      </View>
      {segment === "scan" && <ScanPanel />}
      {segment === "my" && <MyAttendancePanel />}
      {segment === "live" && canViewTeam && <LivePanel />}
    </View>
  );
}

function SegmentButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.segmentBtn, active && styles.segmentBtnActive]} onPress={onPress}>
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ScanPanel() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");

  const handleScanned = useCallback(async ({ data }: { data: string }) => {
    if (busy) return;
    const token = extractScanToken(data);
    if (!token) return; // not our QR — ignore, keep scanning
    setBusy(true);
    setScanning(false);
    setError("");
    try {
      let latitude: number | undefined;
      let longitude: number | undefined;
      try {
        const loc = await Location.requestForegroundPermissionsAsync();
        if (loc.status === "granted") {
          const pos = await Location.getCurrentPositionAsync({});
          latitude = pos.coords.latitude;
          longitude = pos.coords.longitude;
        }
      } catch { /* best-effort, proceed without coords — server accepts either way */ }

      const res = await scanAttendance(token, latitude, longitude);
      setResult(res);
    } catch (err: any) {
      setError(err?.message || "Scan failed");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  if (!permission) return <View style={styles.center}><ActivityIndicator /></View>;

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Camera access is needed to scan the attendance QR code.</Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant camera access</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      {result && (
        <View style={styles.resultBox}>
          <Text style={styles.resultTitle}>
            {result.eventType === "clock_in" ? `Clocked in at ${fmtTime(result.log.clockInAt)}` : `Clocked out at ${fmtTime(result.log.clockOutAt)}`}
          </Text>
          {result.log.hoursWorked && <Text style={styles.resultSub}>{Number(result.log.hoursWorked).toFixed(1)} hrs worked today</Text>}
          {result.activeVehicleCheckout && (
            <Text style={styles.resultWarn}>
              {result.activeVehicleCheckout.registration || "A vehicle"} is still checked out to you.
            </Text>
          )}
        </View>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {scanning ? (
        <View style={styles.cameraWrap}>
          <CameraView
            style={StyleSheet.absoluteFill}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={handleScanned}
          />
          <Pressable style={styles.cancelBtn} onPress={() => setScanning(false)}>
            <Text style={styles.buttonText}>Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.button} onPress={() => { setResult(null); setScanning(true); }} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{result ? "Scan Again" : "Start Scan"}</Text>}
        </Pressable>
      )}
      <Text style={styles.hint}>
        Point your camera at the QR code posted at your premises. Your first scan of the day
        clocks you in, your next scan clocks you out.
      </Text>
    </View>
  );
}

function MyAttendancePanel() {
  const [logs, setLogs] = useState<AttendanceLog[] | null>(null);

  useEffect(() => { getMyAttendance().then(setLogs).catch(() => setLogs([])); }, []);

  if (logs === null) return <View style={styles.center}><ActivityIndicator /></View>;
  if (logs.length === 0) return <View style={styles.center}><Text style={styles.hint}>No attendance logged yet.</Text></View>;

  return (
    <FlatList
      style={styles.panel}
      data={logs}
      keyExtractor={(l) => l.id}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{fmtDate(item.date)}</Text>
            <Text style={styles.rowSub}>{fmtTime(item.clockInAt)} – {fmtTime(item.clockOutAt)}</Text>
          </View>
          <StatusPill status={item.status} />
        </View>
      )}
    />
  );
}

function StatusPill({ status }: { status: AttendanceLog["status"] }) {
  const color = status === "approved" ? "#2E7D4F" : status === "rejected" ? "#A33B3B" : "#A8660A";
  const bg = status === "approved" ? "#E5F3EA" : status === "rejected" ? "#F8E9E9" : "#FBF0DE";
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color }]}>{status}</Text>
    </View>
  );
}

function LivePanel() {
  const [stats, setStats] = useState<LiveAttendanceStats | null>(null);

  useEffect(() => { getLiveAttendance().then(setStats).catch(() => setStats(null)); }, []);

  if (stats === null) return <View style={styles.center}><ActivityIndicator /></View>;

  return (
    <FlatList
      style={styles.panel}
      ListHeaderComponent={
        <View style={styles.kpiRow}>
          <Kpi label="In Now" value={stats.currentlyInCount} />
          <Kpi label="Out Today" value={stats.clockedOutToday} />
          <Kpi label="Not In" value={stats.notYetIn} />
        </View>
      }
      data={stats.currentlyIn}
      keyExtractor={(p) => p.logId}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{item.name}</Text>
            <Text style={styles.rowSub}>{item.position || item.department || "—"} · in since {fmtTime(item.clockInAt)}</Text>
          </View>
          {item.offSite && <View style={[styles.pill, { backgroundColor: "#F8E9E9" }]}><Text style={[styles.pillText, { color: "#A33B3B" }]}>off-site</Text></View>}
        </View>
      )}
      ListEmptyComponent={<Text style={styles.hint}>Nobody is currently clocked in.</Text>}
    />
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F6F6" },
  segments: { flexDirection: "row", backgroundColor: "#E5EBEA", borderRadius: 10, padding: 4, margin: 16, marginBottom: 8 },
  segmentBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: "center" },
  segmentBtnActive: { backgroundColor: "#FFFFFF" },
  segmentText: { fontSize: 13, fontWeight: "600", color: "#5B6D6B" },
  segmentTextActive: { color: "#0C6B62" },
  panel: { flex: 1, paddingHorizontal: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  cameraWrap: { height: 320, borderRadius: 12, overflow: "hidden", marginBottom: 16 },
  cancelBtn: { position: "absolute", bottom: 12, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  button: { backgroundColor: "#0C6B62", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  hint: { fontSize: 12, color: "#8A9997", marginTop: 12, textAlign: "center", lineHeight: 18 },
  error: { color: "#A33B3B", backgroundColor: "#F8E9E9", padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13, textAlign: "center" },
  resultBox: { backgroundColor: "#E5F3EA", borderRadius: 10, padding: 14, marginBottom: 16 },
  resultTitle: { color: "#2E7D4F", fontWeight: "700", fontSize: 14 },
  resultSub: { color: "#2E7D4F", fontSize: 12, marginTop: 2 },
  resultWarn: { color: "#A8660A", fontSize: 12, marginTop: 6 },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E1", padding: 14, marginBottom: 8 },
  rowTitle: { fontSize: 14, fontWeight: "600", color: "#14201F" },
  rowSub: { fontSize: 12, color: "#8A9997", marginTop: 2 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100 },
  pillText: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  kpiRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  kpi: { flex: 1, backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E1", padding: 12, alignItems: "center" },
  kpiValue: { fontSize: 22, fontWeight: "700", color: "#14201F" },
  kpiLabel: { fontSize: 10, color: "#8A9997", textTransform: "uppercase", marginTop: 2 },
});
