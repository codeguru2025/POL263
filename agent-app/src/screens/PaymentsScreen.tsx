import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, RefreshControl,
} from "react-native";
import { getDb } from "../db/schema";
import { useNetwork } from "../context/NetworkContext";
import { fullSync } from "../sync/engine";
import { colors, spacing, fontSize } from "../theme";

interface Payment {
  id: string;
  amount: string;
  currency: string;
  status: string;
  paymentMethod: string;
  reference?: string;
  policyNumber?: string;
  clientName?: string;
  receivedAt?: string;
}

export default function PaymentsScreen() {
  const { isOnline } = useNetwork();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [totalReceived, setTotalReceived] = useState("0.00");

  const load = useCallback(async () => {
    const db = await getDb();
    const cached = await db.getAllAsync<{ id: string; data: string }>(
      "SELECT * FROM cache_my_payments ORDER BY updated_at DESC"
    );
    const items: Payment[] = cached.map(c => {
      const d = JSON.parse(c.data);
      return {
        id: c.id,
        amount: d.amount || "0",
        currency: d.currency || "USD",
        status: d.status || "pending",
        paymentMethod: d.paymentMethod || "unknown",
        reference: d.reference || d.paynowReference,
        policyNumber: d.policyNumber || d.policy?.policyNumber,
        clientName: d.clientName || (d.client ? `${d.client.firstName} ${d.client.lastName}` : undefined),
        receivedAt: d.receivedAt,
      };
    });
    setPayments(items);
    const total = items
      .filter(p => p.status === "cleared" || p.status === "posted")
      .reduce((sum, p) => sum + parseFloat(p.amount || "0"), 0);
    setTotalReceived(total.toFixed(2));
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (isOnline) { try { await fullSync(); } catch {} }
    await load();
    setRefreshing(false);
  }, [isOnline, load]);

  const statusColor = (s: string) => {
    if (s === "cleared" || s === "posted") return colors.success;
    if (s === "pending") return colors.warning;
    if (s === "failed" || s === "reversed") return colors.danger;
    return colors.textMuted;
  };

  return (
    <View style={styles.container}>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>Total Received</Text>
        <Text style={styles.summaryValue}>USD {totalReceived}</Text>
        <Text style={styles.summaryCount}>{payments.length} payment(s)</Text>
      </View>

      <FlatList
        data={payments}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={payments.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No payments yet</Text>
            <Text style={styles.emptySubtext}>Payments on your policies will appear here</Text>
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
            <Text style={styles.detail}>{item.paymentMethod.replace(/_/g, " ")}</Text>
            {item.policyNumber && <Text style={styles.detail}>Policy: {item.policyNumber}</Text>}
            {item.clientName && <Text style={styles.detail}>Client: {item.clientName}</Text>}
            {item.reference && <Text style={styles.ref}>Ref: {item.reference}</Text>}
            {item.receivedAt && (
              <Text style={styles.date}>{new Date(item.receivedAt).toLocaleDateString()}</Text>
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
    backgroundColor: "#059669", margin: spacing.md, borderRadius: 12,
    padding: spacing.lg, alignItems: "center",
  },
  summaryLabel: { fontSize: fontSize.sm, color: "rgba(255,255,255,0.7)" },
  summaryValue: { fontSize: fontSize.xxl, fontWeight: "800", color: "#fff", marginTop: spacing.xs },
  summaryCount: { fontSize: fontSize.sm, color: "rgba(255,255,255,0.7)", marginTop: spacing.xs },
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
  detail: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2, textTransform: "capitalize" },
  ref: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs, fontFamily: "monospace" },
  date: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
});
