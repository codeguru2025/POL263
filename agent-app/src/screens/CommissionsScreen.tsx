import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, RefreshControl,
} from "react-native";
import { getDb } from "../db/schema";
import { useNetwork } from "../context/NetworkContext";
import { fullSync } from "../sync/engine";
import { colors, spacing, fontSize } from "../theme";

interface CommissionEntry {
  id: string;
  policyNumber?: string;
  clientName?: string;
  amount: string;
  currency: string;
  status: string;
  createdAt: string;
  description?: string;
}

export default function CommissionsScreen() {
  const { isOnline } = useNetwork();
  const [entries, setEntries] = useState<CommissionEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [totalEarned, setTotalEarned] = useState("0.00");

  const load = useCallback(async () => {
    const db = await getDb();
    const cached = await db.getAllAsync<{ id: string; data: string }>(
      "SELECT * FROM cache_my_commissions ORDER BY updated_at DESC"
    );
    const items: CommissionEntry[] = cached.map(c => {
      const d = JSON.parse(c.data);
      return {
        id: c.id,
        policyNumber: d.policyNumber || d.policy?.policyNumber,
        clientName: d.clientName || (d.client ? `${d.client.firstName} ${d.client.lastName}` : undefined),
        amount: d.amount || "0",
        currency: d.currency || "USD",
        status: d.status || "pending",
        createdAt: d.createdAt || "",
        description: d.description,
      };
    });
    setEntries(items);
    const total = items
      .filter(e => e.status === "paid" || e.status === "approved")
      .reduce((sum, e) => sum + parseFloat(e.amount || "0"), 0);
    setTotalEarned(total.toFixed(2));
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (isOnline) { try { await fullSync(); } catch {} }
    await load();
    setRefreshing(false);
  }, [isOnline, load]);

  const statusColor = (s: string) => {
    if (s === "paid") return colors.success;
    if (s === "approved") return "#3b82f6";
    if (s === "pending") return colors.warning;
    return colors.textMuted;
  };

  return (
    <View style={styles.container}>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>Total Earned</Text>
        <Text style={styles.summaryValue}>USD {totalEarned}</Text>
      </View>

      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={entries.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No commission entries yet</Text>
            <Text style={styles.emptySubtext}>Commissions appear when your policies receive payments</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.amount}>{item.currency} {item.amount}</Text>
              <View style={[styles.statusBadge, { backgroundColor: statusColor(item.status) + "20" }]}>
                <Text style={[styles.statusText, { color: statusColor(item.status) }]}>
                  {item.status.toUpperCase()}
                </Text>
              </View>
            </View>
            {item.policyNumber && <Text style={styles.detail}>Policy: {item.policyNumber}</Text>}
            {item.clientName && <Text style={styles.detail}>Client: {item.clientName}</Text>}
            {item.description && <Text style={styles.detail}>{item.description}</Text>}
            {item.createdAt && (
              <Text style={styles.date}>{new Date(item.createdAt).toLocaleDateString()}</Text>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  summaryCard: {
    backgroundColor: colors.primary, margin: spacing.md, borderRadius: 12,
    padding: spacing.lg, alignItems: "center",
  },
  summaryLabel: { fontSize: fontSize.sm, color: "rgba(255,255,255,0.7)" },
  summaryValue: { fontSize: fontSize.xxl, fontWeight: "800", color: "#fff", marginTop: spacing.xs },
  emptyContainer: { flex: 1, justifyContent: "center" },
  empty: { alignItems: "center", padding: spacing.xl },
  emptyText: { fontSize: fontSize.lg, fontWeight: "600", color: colors.textSecondary },
  emptySubtext: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.xs, textAlign: "center" },
  card: {
    backgroundColor: colors.surface, marginHorizontal: spacing.md, marginBottom: spacing.sm,
    borderRadius: 10, padding: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  amount: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 6 },
  statusText: { fontSize: fontSize.xs, fontWeight: "700" },
  detail: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  date: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
});
