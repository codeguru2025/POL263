import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import { getDb } from "../db/schema";
import { useNetwork } from "../context/NetworkContext";
import { fullSync } from "../sync/engine";
import { colors, spacing, fontSize } from "../theme";
import { API_BASE } from "../config";

interface PolicyItem {
  local_id: string;
  server_id: string | null;
  client_name: string;
  product_name: string | null;
  premium_amount: string | null;
  currency: string;
  payment_schedule: string;
  policy_number: string | null;
  status: string;
  synced: number;
  effective_date: string | null;
}

export default function PoliciesScreen({ navigation }: any) {
  const { isOnline } = useNetwork();
  const [policies, setPolicies] = useState<PolicyItem[]>([]);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const loadPolicies = useCallback(async () => {
    const db = await getDb();

    // Local policies with client names
    const local = await db.getAllAsync<{
      local_id: string; server_id: string | null; client_local_id: string;
      product_name: string | null; premium_amount: string | null; currency: string;
      payment_schedule: string; policy_number: string | null; status: string;
      synced: number; effective_date: string | null;
    }>("SELECT * FROM policies ORDER BY created_at DESC");

    const items: PolicyItem[] = [];

    for (const p of local) {
      const client = await db.getFirstAsync<{ first_name: string; last_name: string }>(
        "SELECT first_name, last_name FROM clients WHERE local_id = ?", p.client_local_id
      );
      items.push({
        local_id: p.local_id,
        server_id: p.server_id,
        client_name: client ? `${client.first_name} ${client.last_name}` : "Unknown",
        product_name: p.product_name,
        premium_amount: p.premium_amount,
        currency: p.currency,
        payment_schedule: p.payment_schedule,
        policy_number: p.policy_number,
        status: p.status,
        synced: p.synced,
        effective_date: p.effective_date,
      });
    }

    // Add cached server policies not in local
    const localServerIds = new Set(local.filter(p => p.server_id).map(p => p.server_id));
    const cached = await db.getAllAsync<{ id: string; data: string }>("SELECT * FROM cache_my_policies");
    for (const c of cached) {
      if (localServerIds.has(c.id)) continue;
      const d = JSON.parse(c.data);
      items.push({
        local_id: c.id,
        server_id: c.id,
        client_name: `${d.clientFirstName || ""} ${d.clientLastName || ""}`.trim() || "Client",
        product_name: d.productName || null,
        premium_amount: d.premiumAmount || null,
        currency: d.currency || "USD",
        payment_schedule: d.paymentSchedule || "monthly",
        policy_number: d.policyNumber || null,
        status: d.status || "unknown",
        synced: 1,
        effective_date: d.effectiveDate || null,
      });
    }

    setPolicies(items);
  }, []);

  useEffect(() => { loadPolicies(); }, [loadPolicies]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (isOnline) { try { await fullSync(); } catch {} }
    await loadPolicies();
    setRefreshing(false);
  }, [isOnline, loadPolicies]);

  const filtered = search
    ? policies.filter(p =>
        `${p.client_name} ${p.policy_number || ""} ${p.product_name || ""}`.toLowerCase().includes(search.toLowerCase())
      )
    : policies;

  const statusColor = (status: string) => {
    if (status === "active" || status === "grace") return colors.success;
    if (status === "pending_sync") return colors.warning;
    if (status === "lapsed" || status === "cancelled") return colors.danger;
    return colors.textMuted;
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TextInput
          style={styles.search}
          placeholder="Search policies…"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => navigation.navigate("CreatePolicy")}
        >
          <Text style={styles.addButtonText}>+ Issue</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.local_id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No policies yet</Text>
            <Text style={styles.emptySubtext}>Issue a new policy to get started</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.policyCard}>
            <View style={styles.policyTop}>
              <Text style={styles.policyNumber}>
                {item.policy_number || "Pending…"}
              </Text>
              <View style={[styles.statusBadge, { backgroundColor: statusColor(item.status) + "20" }]}>
                <Text style={[styles.statusText, { color: statusColor(item.status) }]}>
                  {item.status === "pending_sync" ? "⏳ Pending Sync" : item.status.toUpperCase()}
                </Text>
              </View>
            </View>
            <Text style={styles.clientName}>{item.client_name}</Text>
            <View style={styles.policyDetails}>
              <Text style={styles.detailText}>{item.product_name || "—"}</Text>
              <Text style={styles.detailText}>
                {item.currency} {item.premium_amount || "0"}/{item.payment_schedule}
              </Text>
            </View>
            {item.effective_date && (
              <Text style={styles.dateText}>Effective: {item.effective_date}</Text>
            )}
            {item.server_id && isOnline && (
              <TouchableOpacity
                style={styles.viewDocBtn}
                onPress={() => WebBrowser.openBrowserAsync(
                  `${API_BASE}/api/policies/${item.server_id}/document`,
                  { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET, toolbarColor: colors.primary, controlsColor: "#fff" }
                )}
              >
                <Text style={styles.viewDocBtnText}>🗂 View Policy Document</Text>
              </TouchableOpacity>
            )}
            {!item.synced && (
              <View style={styles.syncNote}>
                <Text style={styles.syncNoteText}>
                  Will sync when online — policy number assigned on sync
                </Text>
              </View>
            )}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", padding: spacing.md, gap: spacing.sm },
  search: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 10,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: fontSize.md, color: colors.text, borderWidth: 1, borderColor: colors.border,
  },
  addButton: {
    backgroundColor: colors.success, borderRadius: 10,
    paddingHorizontal: spacing.md, justifyContent: "center",
  },
  addButtonText: { color: "#fff", fontWeight: "700", fontSize: fontSize.sm },
  emptyContainer: { flex: 1, justifyContent: "center" },
  empty: { alignItems: "center", padding: spacing.xl },
  emptyText: { fontSize: fontSize.lg, fontWeight: "600", color: colors.textSecondary },
  emptySubtext: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.xs },
  policyCard: {
    backgroundColor: colors.surface, marginHorizontal: spacing.md, marginBottom: spacing.sm,
    borderRadius: 12, padding: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  policyTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  policyNumber: { fontSize: fontSize.md, fontWeight: "700", color: colors.primary, fontFamily: "monospace" },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 6 },
  statusText: { fontSize: fontSize.xs, fontWeight: "700" },
  clientName: { fontSize: fontSize.md, fontWeight: "500", color: colors.text, marginTop: spacing.xs },
  policyDetails: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.xs },
  detailText: { fontSize: fontSize.sm, color: colors.textSecondary },
  dateText: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  viewDocBtn: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#eff6ff",
    borderRadius: 8, padding: spacing.sm, marginTop: spacing.sm,
    borderWidth: 1, borderColor: "#bfdbfe",
  },
  viewDocBtnText: { fontSize: fontSize.xs, fontWeight: "700", color: colors.primary },
  syncNote: {
    backgroundColor: "#fef3c7", borderRadius: 6, padding: spacing.sm, marginTop: spacing.sm,
  },
  syncNoteText: { fontSize: fontSize.xs, color: "#92400e" },
});
