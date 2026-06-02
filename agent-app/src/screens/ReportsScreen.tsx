import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNetwork } from "../context/NetworkContext";
import { colors, spacing, fontSize } from "../theme";
import { apiGet } from "../api";

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

interface CommissionEntry {
  id: string;
  amount: string;
  currency: string;
  type: string;
  status: string;
  policyNumber?: string;
  createdAt: string;
}

const PERIODS = [
  { label: "This Month", value: "month" },
  { label: "Last Month", value: "last_month" },
  { label: "This Year", value: "year" },
  { label: "All Time", value: "all" },
];

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
  const [period, setPeriod] = useState("month");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [commission, setCommission] = useState<CommissionSummary | null>(null);
  const [commissionList, setCommissionList] = useState<CommissionEntry[]>([]);
  const [agentStats, setAgentStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (p = period) => {
    if (!isOnline) return;
    setLoading(true);
    try {
      const q = `?period=${p}`;
      const [dashRes, commRes, commListRes, agentRes] = await Promise.allSettled([
        apiGet<DashboardStats>(`/api/dashboard${q}`),
        apiGet<CommissionSummary>(`/api/commissions/summary${q}`),
        apiGet<any>(`/api/commissions${q}&limit=20`),
        apiGet<any>(`/api/agent-stats${q}`),
      ]);
      if (dashRes.status === "fulfilled") setStats(dashRes.value);
      if (commRes.status === "fulfilled") setCommission(commRes.value);
      if (commListRes.status === "fulfilled") {
        const data = commListRes.value;
        setCommissionList(Array.isArray(data) ? data : (data.commissions ?? []));
      }
      if (agentRes.status === "fulfilled") setAgentStats(agentRes.value);
    } catch {} finally { setLoading(false); }
  }, [isOnline, period]);

  useEffect(() => { fetchData(period); }, [period, isOnline]);

  const onRefresh = async () => { setRefreshing(true); await fetchData(period); setRefreshing(false); };

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
        {/* Period Filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.periodRow} contentContainerStyle={{ gap: spacing.sm }}>
          {PERIODS.map(p => (
            <TouchableOpacity
              key={p.value}
              style={[styles.periodChip, period === p.value && styles.periodChipActive]}
              onPress={() => setPeriod(p.value)}
            >
              <Text style={[styles.periodChipText, period === p.value && styles.periodChipTextActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loading && !refreshing && <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />}

        {/* Policy Stats */}
        <Text style={styles.sectionTitle}>📋 Policy Overview</Text>
        <View style={styles.grid}>
          <StatCard label="Total Policies" value={stats?.totalPolicies ?? "—"} color={colors.primary} />
          <StatCard label="Active" value={stats?.activePolicies ?? "—"} color={colors.success} />
          <StatCard label="New This Period" value={stats?.newPoliciesThisMonth ?? "—"} color="#2563eb" />
          <StatCard label="Lapsed" value={stats?.lapsedPolicies ?? "—"} color={colors.danger} />
        </View>

        {/* Client Stats */}
        <Text style={styles.sectionTitle}>👥 Clients</Text>
        <View style={styles.grid}>
          <StatCard label="Total Clients" value={stats?.totalClients ?? "—"} color={colors.primary} />
          <StatCard label="New This Period" value={stats?.newClientsThisMonth ?? "—"} color={colors.success} />
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

        {/* Commission Summary */}
        {commission && (
          <>
            <Text style={styles.sectionTitle}>💰 My Commissions</Text>
            <View style={styles.grid}>
              <StatCard label="Total Earned" value={`${commission.currency} ${parseFloat(commission.totalEarned || "0").toLocaleString()}`} color={colors.success} />
              <StatCard label="Pending" value={`${commission.currency} ${parseFloat(commission.pendingPayment || "0").toLocaleString()}`} color={colors.warning} />
              <StatCard label="Paid Out" value={`${commission.currency} ${parseFloat(commission.paidOut || "0").toLocaleString()}`} color={colors.primary} />
            </View>
          </>
        )}

        {/* Commission Transactions */}
        {commissionList.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>🧾 Commission Transactions</Text>
            <View style={styles.tableCard}>
              {commissionList.map((c, i) => (
                <View key={c.id} style={[styles.commRow, i === commissionList.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.commAmount}>{c.currency} {parseFloat(c.amount || "0").toLocaleString()}</Text>
                    <Text style={styles.commMeta}>{c.type?.replace(/_/g, " ")} · {c.policyNumber || "—"}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <View style={[styles.commStatus, { backgroundColor: c.status === "paid" ? "#dcfce7" : "#fef3c7" }]}>
                      <Text style={[styles.commStatusText, { color: c.status === "paid" ? "#166534" : "#92400e" }]}>
                        {c.status?.toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.commDate}>{new Date(c.createdAt).toLocaleDateString()}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Agent Performance */}
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
              {agentStats.conversionRate !== undefined && (
                <StatCard label="Conversion Rate" value={`${agentStats.conversionRate}%`} color="#7c3aed" />
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
  periodRow: { marginBottom: spacing.sm, maxHeight: 50 },
  periodChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: 20, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  periodChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  periodChipText: { fontSize: fontSize.sm, fontWeight: "600", color: colors.textSecondary },
  periodChipTextActive: { color: "#fff" },
  sectionTitle: { fontSize: fontSize.md, fontWeight: "700", color: colors.text, marginBottom: spacing.sm, marginTop: spacing.lg },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  fullCard: {
    backgroundColor: colors.surface, borderRadius: 12, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
  },
  bigNum: { fontSize: fontSize.xxl, fontWeight: "800", color: colors.text },
  fullCardLabel: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 4, fontWeight: "600" },
  tableCard: {
    backgroundColor: colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, overflow: "hidden",
  },
  commRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  commAmount: { fontSize: fontSize.md, fontWeight: "700", color: colors.text },
  commMeta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2, textTransform: "capitalize" },
  commStatus: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 6 },
  commStatusText: { fontSize: fontSize.xs, fontWeight: "700" },
  commDate: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
});
