import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native";
import MapView, { Marker, type Region } from "react-native-maps";
import { getVehicles, getActiveCheckouts, returnVehicle, type Vehicle, type ActiveCheckout } from "../../src/api/fleet";

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

const STATUS_COLORS: Record<string, [string, string]> = {
  available: ["#2E7D4F", "#E5F3EA"],
  checked_out: ["#A8660A", "#FBF0DE"],
  maintenance: ["#A33B3B", "#F8E9E9"],
};

function StatusPill({ status }: { status: string }) {
  const [color, bg] = STATUS_COLORS[status] ?? ["#5B6D6B", "#EDF1F0"];
  return <View style={[styles.pill, { backgroundColor: bg }]}><Text style={[styles.pillText, { color }]}>{status.replace(/_/g, " ")}</Text></View>;
}

type Tab = "active" | "vehicles" | "map";

const MAP_POLL_INTERVAL_MS = 20_000;

export default function FleetScreen() {
  const [tab, setTab] = useState<Tab>("active");
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [checkouts, setCheckouts] = useState<ActiveCheckout[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [returningId, setReturningId] = useState<string | null>(null);

  const load = useCallback(() => {
    getVehicles().then(setVehicles).catch(() => setVehicles([]));
    getActiveCheckouts().then(setCheckouts).catch(() => setCheckouts([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live-ish dispatcher map: pings arrive from drivers roughly every 15-30s (src/app/(app)/
  // drive.tsx), so polling on a similar cadence while this tab is open is close enough --
  // no websocket/push infra exists in this app to do better.
  useEffect(() => {
    if (tab !== "map") return;
    const interval = setInterval(() => { getActiveCheckouts().then(setCheckouts).catch(() => {}); }, MAP_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [tab]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([getVehicles().then(setVehicles), getActiveCheckouts().then(setCheckouts)]);
    setRefreshing(false);
  };

  const confirmReturn = (checkout: ActiveCheckout) => {
    Alert.alert(
      "Return vehicle",
      "Mark this vehicle as returned? This ends the current trip.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Return", style: "destructive", onPress: async () => {
            setReturningId(checkout.id);
            try {
              await returnVehicle(checkout.id);
              load();
            } catch (err: any) {
              Alert.alert("Could not return vehicle", err?.message || "Please try again.");
            } finally {
              setReturningId(null);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.tabRow}>
        <Pressable style={[styles.tab, tab === "active" && styles.tabActive]} onPress={() => setTab("active")}>
          <Text style={[styles.tabText, tab === "active" && styles.tabTextActive]}>Active checkouts</Text>
        </Pressable>
        <Pressable style={[styles.tab, tab === "vehicles" && styles.tabActive]} onPress={() => setTab("vehicles")}>
          <Text style={[styles.tabText, tab === "vehicles" && styles.tabTextActive]}>Vehicles</Text>
        </Pressable>
        <Pressable style={[styles.tab, tab === "map" && styles.tabActive]} onPress={() => setTab("map")}>
          <Text style={[styles.tabText, tab === "map" && styles.tabTextActive]}>Map</Text>
        </Pressable>
      </View>

      {tab === "active" ? (
        checkouts === null ? (
          <View style={styles.center}><ActivityIndicator /></View>
        ) : (
          <FlatList
            data={checkouts}
            keyExtractor={(c) => c.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>Driver {item.driverId.slice(0, 8)}</Text>
                  <Text style={styles.cardSub}>Out since {fmtDateTime(item.startDate)}</Text>
                  {item.latestPing ? (
                    <Text style={styles.cardSub}>
                      Last seen {timeAgo(item.latestPing.recordedAt)} · {Number(item.latestPing.latitude).toFixed(4)}, {Number(item.latestPing.longitude).toFixed(4)}
                      {item.latestPing.speedKmh ? ` · ${Number(item.latestPing.speedKmh).toFixed(0)} km/h` : ""}
                    </Text>
                  ) : (
                    <Text style={styles.cardSub}>No GPS pings yet</Text>
                  )}
                  {item.notes ? <Text style={styles.notes}>"{item.notes}"</Text> : null}
                </View>
                <Pressable style={styles.returnButton} onPress={() => confirmReturn(item)} disabled={returningId === item.id}>
                  {returningId === item.id ? <ActivityIndicator color="#0C6B62" size="small" /> : <Text style={styles.returnButtonText}>Return</Text>}
                </Pressable>
              </View>
            )}
            ListEmptyComponent={<View style={styles.center}><Text style={styles.hint}>No vehicles currently checked out.</Text></View>}
            contentContainerStyle={{ padding: 16, flexGrow: 1 }}
          />
        )
      ) : tab === "vehicles" ? (
        vehicles === null ? (
          <View style={styles.center}><ActivityIndicator /></View>
        ) : (
          <FlatList
            data={vehicles}
            keyExtractor={(v) => v.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{item.registration}</Text>
                  <Text style={styles.cardSub}>{[item.make, item.model, item.year].filter(Boolean).join(" ") || "—"}</Text>
                  {item.currentMileage != null && <Text style={styles.cardSub}>{item.currentMileage.toLocaleString()} km</Text>}
                </View>
                <StatusPill status={item.status} />
              </View>
            )}
            ListEmptyComponent={<View style={styles.center}><Text style={styles.hint}>No vehicles registered.</Text></View>}
            contentContainerStyle={{ padding: 16, flexGrow: 1 }}
          />
        )
      ) : (
        <DispatcherMap checkouts={checkouts} vehicles={vehicles} />
      )}
    </View>
  );
}

const HARARE_REGION: Region = { latitude: -17.8252, longitude: 31.0335, latitudeDelta: 0.2, longitudeDelta: 0.2 };

/** Live positions of every checked-out vehicle, joined against the vehicle roster for a
 *  readable label (the checkout record itself only carries vehicleId). Vehicles with no
 *  ping yet (just checked out, GPS not acquired) are omitted from the map rather than
 *  plotted at a stale/default location. */
function DispatcherMap({ checkouts, vehicles }: { checkouts: ActiveCheckout[] | null; vehicles: Vehicle[] | null }) {
  const mapRef = useRef<MapView>(null);

  const points = useMemo(() => {
    if (!checkouts) return [];
    const byId = new Map((vehicles ?? []).map((v) => [v.id, v]));
    return checkouts
      .filter((c) => c.latestPing)
      .map((c) => ({ checkout: c, vehicle: byId.get(c.vehicleId) ?? null, ping: c.latestPing! }));
  }, [checkouts, vehicles]);

  useEffect(() => {
    if (points.length === 0 || !mapRef.current) return;
    mapRef.current.fitToCoordinates(
      points.map((p) => ({ latitude: Number(p.ping.latitude), longitude: Number(p.ping.longitude) })),
      { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true }
    );
  }, [points]);

  if (checkouts === null) return <View style={styles.center}><ActivityIndicator /></View>;

  return (
    <View style={{ flex: 1 }}>
      <MapView ref={mapRef} style={{ flex: 1 }} initialRegion={HARARE_REGION}>
        {points.map(({ checkout, vehicle, ping }) => (
          <Marker
            key={checkout.id}
            coordinate={{ latitude: Number(ping.latitude), longitude: Number(ping.longitude) }}
            title={vehicle?.registration || "Vehicle"}
            description={`${timeAgo(ping.recordedAt)}${ping.speedKmh ? ` · ${Number(ping.speedKmh).toFixed(0)} km/h` : ""}`}
          />
        ))}
      </MapView>
      {points.length === 0 && (
        <View style={styles.mapEmptyBanner}>
          <Text style={styles.hint}>No active vehicles have reported a GPS position yet.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F6F6" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  tabRow: { flexDirection: "row", padding: 16, paddingBottom: 0, gap: 8 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DCE3E1" },
  tabActive: { backgroundColor: "#0C6B62", borderColor: "#0C6B62" },
  tabText: { fontSize: 13, fontWeight: "600", color: "#5B6D6B" },
  tabTextActive: { color: "#FFFFFF" },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E1", padding: 14, marginBottom: 8, gap: 10 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#14201F" },
  cardSub: { fontSize: 12, color: "#5B6D6B", marginTop: 2 },
  notes: { fontSize: 12, color: "#8A9997", marginTop: 4, fontStyle: "italic" },
  hint: { fontSize: 13, color: "#8A9997" },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100 },
  pillText: { fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
  returnButton: { borderWidth: 1, borderColor: "#0C6B62", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  returnButtonText: { color: "#0C6B62", fontSize: 13, fontWeight: "700" },
  mapEmptyBanner: { position: "absolute", bottom: 16, left: 16, right: 16, backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E1", padding: 12, alignItems: "center" },
});
