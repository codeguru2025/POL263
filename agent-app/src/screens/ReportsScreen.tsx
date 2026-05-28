import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNetwork } from "../context/NetworkContext";
import { colors, spacing, fontSize } from "../theme";
import { API_BASE } from "../config";

interface DashboardStats {
  totalPolicies: number;
  activePolicies: number;
  totalClients: number;
  totalClaims: number;
  pendingClaims: number;
  totalPremium?: string;
  currency?: string;
  newPoliciesThisMonth?: number;
  newClientsThisMonth?: number;
  lapsedPolicies?: number;
}

interface CommissionSummary {
  totalEarned: string;
  pendingPayment: string;
  paidOut: string;
  currency: string;
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <View style={[statStyles.card, color ? { borderLeftColor: color, borderLeftWidth: 4 } : {}]}>
      <Text style={statStyles.value}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
      {sub && <Text style={statStyles.sub}>{sub}</Text>}
    </View>
  );
}

const statStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md,
    flex: 1, minWidth: "45%", borderWidth: 1, borderColor: colors.border,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  value: { fontSize: fontSize.xxl, fontWeight: "800", color: colors.text, marginBottom: 4 },
  label: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: "600" },
  sub: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
});

export default function ReportsScreen() {
  const { isOnline } = useNetwork();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [commission, setCommission] = useState<CommissionSummary | null>(null);
  const [agentStats, setAgentStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!isOnline) return;
    setLoading(true);
    try {
      const [dashRes, commRes, agentRes] = await Promise.allSettled([
        fetch(`${API_BASE}/api/dashboard`, { credentials: "include" }),
        fetch(`${API_BASE}/api/commissions/summary`, { credentials: "include" }),
        fetch(`${API_BASE}/api/agent/stats`, { credentials: "include" }),
      ]);

      if (dashRes.status === "fulfilled" && dashRes.value.ok) {
        setStats(await dashRes.value.json());
      }
      if (commRes.status === "fulfilled" && commRes.value.ok) {
        setCommission(await commRes.value.json());
      }
      if (agentRes.status === "fulfilled" && agentRes.value.ok) {
        setAgentStats(await agentRes.value.json());
      }
    } catch {} finally { setLoading(false); }
  }, [isOnline]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  if (!isOnline) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}>
          <Text style={styles.offlineEmoji}>📶</Text>
          <Text style={styles.offlineTitle}>Offline</Text>
          <Text style={styles.offlineSub}>Reports require an internet connection</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {loading && !refreshing && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />}

        {/* Policy Stats */}
        <Text style={styles.sectionTitle}>📋 Policy Overview</Text>
        <View style={styles.grid}>
          <StatCard label="Total Policies" value={stats?.totalPolicies ?? "—"} color={colors.primary} />
          <StatCard label="Active" value={stats?.activePolicies ?? "—"} color={colors.success} />
          <StatCard label="New This Month" value={stats?.newPoliciesThisMonth ?? "—"} color="#2563eb" />
          <StatCard label="Lapsed" value={stats?.lapsedPolicies ?? "—"} color={colors.danger} />
        </View>

        {/* Client Stats */}
        <Text style={styles.sectionTitle}>👥 Clients</Text>
        <View style={styles.grid}>
          <StatCard label="Total Clients" value={stats?.totalClients ?? "—"} color={colors.primary} />
          <StatCard label="New This Month" value={stats?.newClientsThisMonth ?? "—"} color={colors.success} />
        </View>

        {/* Claims */}
        <Text style={styles.sectionTitle}>🏥 Claims</Text>
        <View style={styles.grid}>
          <StatCard label="Total Claims" value={stats?.totalClaims ?? "—"} color={colors.primary} />
          <StatCard label="Pending Review" value={stats?.pendingClaims ?? "—"} color={colors.warning} />
        </View>

        {/* Premium */}
        {stats?.totalPremium && (
          <>
            <Text style={styles.sectionTitle}>💵 Premium</Text>
            <View style={[styles.fullCard, { borderLeftColor: "#7c3aed", borderLeftWidth: 4 }]}>
              <Text style={styles.bigNum}>{stats.currency || "USD"} {parseFloat(stats.totalPremium).toLocaleString()}</Text>
              <Text style={styles.fullCardLabel}>Total Premium Under Management</Text>
            </View>
          </>
        )}

        {/* Commissions */}
        {commission && (
          <>
            <Text style={styles.sectionTitle}>💰 My Commissions</Text>
            <View style={styles.grid}>
              <StatCard label="Total Earned" value={`${commission.currency} ${parseFloat(commission.totalEarned || "0").toLocaleString()}`} color={colors.success} />
              <StatCard label="Pending Payment" value={`${commission.currency} ${parseFloat(commission.pendingPayment || "0").toLocaleString()}`} color={colors.warning} />
              <StatCard label="Paid Out" value={`${commission.currency} ${parseFloat(commission.paidOut || "0").toLocaleString()}`} color={colors.primary} />
            </View>
          </>
        )}

        {/* Agent Stats */}
        {agentStats && (
          <>
            <Text style={styles.sectionTitle}>🎯 My Performance</Text>
            <View style={styles.grid}>
              {agentStats.policiesIssued !== undefined && (
                <StatCard label="Policies Issued" value={agentStats.policiesIssued} color={colors.primary} />
              )}
              {agentStats.clientsOnboarded !== undefined && (
                <StatCard label="Clients Onboarded" value={agentStats.clientsOnboarded} color={colors.success} />
              )}
              {agentStats.leadsConverted !== undefined && (
                <StatCard label="Leads Converted" value={agentStats.leadsConverted} color="#2563eb" />
              )}
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  offlineEmoji: { fontSize: 48, marginBottom: spacing.md },
  offlineTitle: { fontSize: fontSize.xl, fontWeight: "700", color: colors.text },
  offlineSub: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: spacing.xs, textAlign: "center" },
  sectionTitle: { fontSize: fontSize.md, fontWeight: "700", color: colors.text, marginBottom: spacing.sm, marginTop: spacing.lg },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  fullCard: {
    backgroundColor: colors.surface, borderRadius: 12, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
  },
  bigNum: { fontSize: fontSize.xxl, fontWeight: "800", color: colors.text },
  fullCardLabel: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 4, fontWeight: "600" },
});
