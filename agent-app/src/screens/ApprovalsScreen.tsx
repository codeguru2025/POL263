import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNetwork } from "../context/NetworkContext";
import { colors, spacing, fontSize } from "../theme";
import { API_BASE } from "../config";

interface Approval {
  id: string;
  type: string;
  status: string;
  requestedBy?: string;
  createdAt: string;
  metadata?: any;
  description?: string;
  policyNumber?: string;
  clientName?: string;
  amount?: string;
  currency?: string;
}

const TYPE_EMOJI: Record<string, string> = {
  policy_cancellation: "🚫", policy_reinstatement: "🔄", claim_payout: "💰",
  premium_override: "💵", lapse_override: "⚠️", default: "📝",
};

export default function ApprovalsScreen() {
  const { isOnline } = useNetwork();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  const fetchApprovals = useCallback(async () => {
    if (!isOnline) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/approvals?status=pending`, { credentials: "include" });
      if (res.ok) setApprovals(await res.json());
    } catch {} finally { setLoading(false); }
  }, [isOnline]);

  useEffect(() => { fetchApprovals(); }, [fetchApprovals]);

  const onRefresh = async () => { setRefreshing(true); await fetchApprovals(); setRefreshing(false); };

  const handleAction = async (id: string, action: "approve" | "reject") => {
    Alert.alert(
      action === "approve" ? "Approve" : "Reject",
      `Are you sure you want to ${action} this request?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: action === "approve" ? "Approve" : "Reject",
          style: action === "reject" ? "destructive" : "default",
          onPress: async () => {
            setActing(id);
            try {
              const res = await fetch(`${API_BASE}/api/approvals/${id}/${action}`, {
                method: "POST", credentials: "include",
                headers: { "Content-Type": "application/json" },
              });
              if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || "Failed");
              }
              setApprovals(prev => prev.filter(a => a.id !== id));
              Alert.alert("Done", `Request ${action === "approve" ? "approved" : "rejected"}`);
            } catch (e: any) {
              Alert.alert("Error", e.message || "Action failed");
            } finally { setActing(null); }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Pending Approvals</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{approvals.length}</Text>
        </View>
      </View>

      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>📶 Offline — approvals require connectivity</Text>
        </View>
      )}

      {loading && !refreshing ? (
        <ActivityIndicator style={{ margin: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={approvals}
          keyExtractor={a => a.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={approvals.length === 0 ? styles.emptyWrap : { padding: spacing.md }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>✅</Text>
              <Text style={styles.emptyTitle}>All clear!</Text>
              <Text style={styles.emptySub}>No pending approvals</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.typeEmoji}>{TYPE_EMOJI[item.type] || TYPE_EMOJI.default}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.typeLabel}>{item.type?.replace(/_/g, " ").toUpperCase()}</Text>
                  {item.policyNumber && <Text style={styles.sub}>Policy: {item.policyNumber}</Text>}
                  {item.clientName && <Text style={styles.sub}>Client: {item.clientName}</Text>}
                  {item.amount && <Text style={styles.sub}>Amount: {item.currency} {item.amount}</Text>}
                  {item.description && <Text style={styles.desc}>{item.description}</Text>}
                  <Text style={styles.time}>{new Date(item.createdAt).toLocaleString()}</Text>
                </View>
              </View>
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.rejectBtn, acting === item.id && styles.disabled]}
                  onPress={() => handleAction(item.id, "reject")}
                  disabled={acting === item.id}
                >
                  {acting === item.id ? <ActivityIndicator size="small" color={colors.danger} /> : <Text style={styles.rejectText}>✕ Reject</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.approveBtn, acting === item.id && styles.disabled]}
                  onPress={() => handleAction(item.id, "approve")}
                  disabled={acting === item.id}
                >
                  {acting === item.id ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.approveText}>✓ Approve</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  headerRow: {
    flexDirection: "row", alignItems: "center", padding: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  title: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text, flex: 1 },
  countBadge: { backgroundColor: colors.danger, borderRadius: 12, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  countText: { color: "#fff", fontSize: fontSize.xs, fontWeight: "700" },
  offlineBanner: { backgroundColor: "#fef3c7", padding: spacing.sm, alignItems: "center" },
  offlineText: { fontSize: fontSize.sm, color: "#92400e" },
  emptyWrap: { flex: 1, justifyContent: "center" },
  empty: { alignItems: "center", paddingVertical: 60 },
  emptyEmoji: { fontSize: 48, marginBottom: spacing.md },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text },
  emptySub: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: spacing.xs },
  card: {
    backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  cardTop: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  typeEmoji: { fontSize: 28, width: 40 },
  typeLabel: { fontSize: fontSize.sm, fontWeight: "700", color: colors.text, marginBottom: 2 },
  sub: { fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: 2 },
  desc: { fontSize: fontSize.sm, color: colors.text, marginTop: spacing.xs, lineHeight: 18 },
  time: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  actionRow: { flexDirection: "row", gap: spacing.sm },
  rejectBtn: {
    flex: 1, padding: spacing.sm, borderRadius: 10, alignItems: "center",
    borderWidth: 1.5, borderColor: colors.danger, backgroundColor: "#fee2e2",
  },
  rejectText: { color: colors.danger, fontWeight: "700", fontSize: fontSize.sm },
  approveBtn: {
    flex: 1, padding: spacing.sm, borderRadius: 10, alignItems: "center",
    backgroundColor: colors.success,
  },
  approveText: { color: "#fff", fontWeight: "700", fontSize: fontSize.sm },
  disabled: { opacity: 0.5 },
});
