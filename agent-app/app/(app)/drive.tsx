import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import {
  getAvailableVehicles, getMyCheckout, checkoutVehicle, returnMyVehicle, submitPings,
  type DriveVehicle, type MyCheckout, type PingInput,
} from "../../src/api/drive";

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function DriveScreen() {
  const [checkout, setCheckout] = useState<MyCheckout | null | undefined>(undefined);

  const load = useCallback(() => {
    getMyCheckout().then(setCheckout).catch(() => setCheckout(null));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (checkout === undefined) {
    return <View style={styles.center}><ActivityIndicator /></View>;
  }

  return checkout
    ? <TripScreen checkout={checkout} onReturned={load} />
    : <CheckoutPicker onCheckedOut={load} />;
}

function CheckoutPicker({ onCheckedOut }: { onCheckedOut: () => void }) {
  const [vehicles, setVehicles] = useState<DriveVehicle[] | null>(null);
  const [selected, setSelected] = useState<DriveVehicle | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { getAvailableVehicles().then(setVehicles).catch(() => setVehicles([])); }, []);

  const confirm = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await checkoutVehicle(selected.id, notes.trim() || undefined);
      onCheckedOut();
    } catch (err: any) {
      // Server rejects if not clocked in yet, or if the vehicle/driver already has an
      // active checkout — surfaced verbatim since it explains exactly what to do next.
      setError(err?.message || "Could not check out this vehicle");
    } finally {
      setBusy(false);
    }
  };

  if (vehicles === null) return <View style={styles.center}><ActivityIndicator /></View>;

  return (
    <View style={styles.screen}>
      {selected ? (
        <View style={styles.panel}>
          <Text style={styles.sectionLabel}>Check out {selected.registration}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Purpose of trip (optional)"
            value={notes}
            onChangeText={setNotes}
            multiline
          />
          <Pressable style={styles.button} onPress={confirm} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Confirm checkout</Text>}
          </Pressable>
          <Pressable style={styles.linkButton} onPress={() => setSelected(null)} disabled={busy}>
            <Text style={styles.linkButtonText}>Choose a different vehicle</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={vehicles}
          keyExtractor={(v) => v.id}
          ListHeaderComponent={<Text style={styles.sectionLabel}>Available vehicles</Text>}
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => setSelected(item)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{item.registration}</Text>
                <Text style={styles.cardSub}>{[item.make, item.model, item.year].filter(Boolean).join(" ") || "—"}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )}
          ListEmptyComponent={<View style={styles.center}><Text style={styles.hint}>No vehicles available for checkout right now.</Text></View>}
          contentContainerStyle={{ padding: 16, flexGrow: 1 }}
        />
      )}
    </View>
  );
}

const PING_FLUSH_INTERVAL_MS = 30_000;

function TripScreen({ checkout, onReturned }: { checkout: MyCheckout; onReturned: () => void }) {
  const [tracking, setTracking] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [lastPing, setLastPing] = useState<PingInput | null>(null);
  const [returning, setReturning] = useState(false);
  const bufferRef = useRef<PingInput[]>([]);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);

  const flush = useCallback(async () => {
    if (bufferRef.current.length === 0) return;
    const batch = bufferRef.current;
    bufferRef.current = [];
    try {
      await submitPings(checkout.id, batch);
    } catch {
      // Best-effort — dropped pings don't block the trip; the next flush picks up
      // wherever GPS is by then. Not worth queuing/retrying for a location trail.
    }
  }, [checkout.id]);

  const startTracking = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") { setPermissionDenied(true); return; }
    setPermissionDenied(false);
    setTracking(true);
    subscriptionRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 15_000, distanceInterval: 25 },
      (pos) => {
        const ping: PingInput = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          speedKmh: pos.coords.speed != null && pos.coords.speed >= 0 ? pos.coords.speed * 3.6 : undefined,
          recordedAt: new Date(pos.timestamp).toISOString(),
        };
        bufferRef.current.push(ping);
        setLastPing(ping);
      }
    );
  }, []);

  const stopTracking = useCallback(() => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    setTracking(false);
  }, []);

  useEffect(() => {
    startTracking();
    const interval = setInterval(flush, PING_FLUSH_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      stopTracking();
      flush();
    };
    // Trip-lifetime effect: intentionally does not re-run on flush/startTracking identity
    // changes (both are stable via useCallback with the checkout id as the only real dep).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkout.id]);

  const confirmReturn = () => {
    Alert.alert("Return vehicle", `End your trip in ${checkout.vehicle.registration}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Return", style: "destructive", onPress: async () => {
          setReturning(true);
          stopTracking();
          await flush();
          try {
            await returnMyVehicle(checkout.id);
            onReturned();
          } catch (err: any) {
            Alert.alert("Could not return vehicle", err?.message || "Please try again.");
            setReturning(false);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.tripCard}>
        <Text style={styles.tripVehicle}>{checkout.vehicle.registration}</Text>
        <Text style={styles.tripSub}>{[checkout.vehicle.make, checkout.vehicle.model].filter(Boolean).join(" ") || "—"}</Text>
        <Text style={styles.tripSub}>Checked out {fmtDateTime(checkout.startDate)}</Text>
        {checkout.notes ? <Text style={styles.tripNotes}>"{checkout.notes}"</Text> : null}
      </View>

      <View style={styles.trackingCard}>
        {permissionDenied ? (
          <>
            <Text style={styles.hint}>Location access is needed to log this trip. Your position is only used while the app is open — not tracked in the background.</Text>
            <Pressable style={styles.button} onPress={startTracking}>
              <Text style={styles.buttonText}>Grant location access</Text>
            </Pressable>
          </>
        ) : tracking ? (
          <>
            <View style={styles.trackingRow}>
              <View style={styles.dot} />
              <Text style={styles.trackingText}>Tracking this trip</Text>
            </View>
            {lastPing && (
              <Text style={styles.cardSub}>
                Last point {Number(lastPing.latitude).toFixed(4)}, {Number(lastPing.longitude).toFixed(4)}
                {lastPing.speedKmh ? ` · ${lastPing.speedKmh.toFixed(0)} km/h` : ""}
              </Text>
            )}
            <Text style={styles.hint}>Tracking pauses if you leave this screen or close the app.</Text>
          </>
        ) : (
          <ActivityIndicator />
        )}
      </View>

      <Pressable style={[styles.button, styles.returnButton]} onPress={confirmReturn} disabled={returning}>
        {returning ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Return vehicle</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F6F6", padding: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  panel: { flex: 1 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: "#8A9997", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  hint: { fontSize: 12, color: "#8A9997", lineHeight: 18, textAlign: "center", marginTop: 8 },
  error: { color: "#A33B3B", backgroundColor: "#F8E9E9", padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13, textAlign: "center" },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E1", padding: 14, marginBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#14201F" },
  cardSub: { fontSize: 12, color: "#5B6D6B", marginTop: 2 },
  chevron: { fontSize: 20, color: "#8A9997" },
  input: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, backgroundColor: "#FFFFFF" },
  textArea: { minHeight: 80, textAlignVertical: "top", marginBottom: 16 },
  button: { backgroundColor: "#0C6B62", borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  linkButton: { alignItems: "center", marginTop: 14 },
  linkButtonText: { color: "#5B6D6B", fontSize: 14 },
  tripCard: { backgroundColor: "#FFFFFF", borderRadius: 12, borderWidth: 1, borderColor: "#DCE3E1", padding: 18, marginBottom: 16 },
  tripVehicle: { fontSize: 20, fontWeight: "800", color: "#14201F" },
  tripSub: { fontSize: 13, color: "#5B6D6B", marginTop: 4 },
  tripNotes: { fontSize: 12, color: "#8A9997", marginTop: 8, fontStyle: "italic" },
  trackingCard: { backgroundColor: "#FFFFFF", borderRadius: 12, borderWidth: 1, borderColor: "#DCE3E1", padding: 18, marginBottom: 16, flex: 1, justifyContent: "center" },
  trackingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#2E7D4F" },
  trackingText: { fontSize: 15, fontWeight: "700", color: "#2E7D4F" },
  returnButton: { backgroundColor: "#A33B3B" },
});
