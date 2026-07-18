import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { getMyPnl, getMyCommissionLedger, type AgentPnl, type CommissionLedgerEntry } from "../../src/api/commissions";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "2-digit" });
}

function fmtMoneyMap(m: Record<string, number>): string {
  const entries = Object.entries(m).filter(([, v]) => v !== 0);
  if (entries.length === 0) return "—";
  return entries.map(([c, v]) => `${c} ${v.toFixed(2)}`).join(" · ");
}

function entryLabel(entryType: string): string {
  const kind = entryType.replace(/_/g, " ");
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

const STATUS_COLORS: Record<string, [string, string]> = {
  paid: ["#2E7D4F", "#E5F3EA"],
  earned: ["#A8660A", "#FBF0DE"],
  pending: ["#A8660A", "#FBF0DE"],
};

function StatusPill({ status }: { status: string }) {
  const [color, bg] = STATUS_COLORS[status] ?? ["#5B6D6B", "#EDF1F0"];
  return <View style={[styles.pill, { backgroundColor: bg }]}><Text style={[styles.pillText, { color }]}>{status}</Text></View>;
}

export default function CommissionsScreen() {
  const [pnl, setPnl] = useState<AgentPnl | null>(null);
  const [ledger, setLedger] = useState<CommissionLedgerEntry[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    getMyPnl().then(setPnl).catch(() => setPnl(null));
    getMyCommissionLedger().then(setLedger).catch(() => setLedger([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([getMyPnl().then(setPnl), getMyCommissionLedger().then(setLedger)]);
    setRefreshing(false);
  };

  return (
    <View style={styles.screen}>
      {ledger === null ? (
        <View style={styles.center}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={ledger}
          keyExtractor={(e) => e.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListHeaderComponent={
            <>
              {pnl && (
                <>
                  <View style={styles.summaryRow}>
                    <SummaryCard label="Earned" value={fmtMoneyMap(pnl.commissions.earned)} accent="#0C6B62" />
                    <SummaryCard label="Paid" value={fmtMoneyMap(pnl.commissions.paid)} accent="#2E7D4F" />
                    <SummaryCard label="Outstanding" value={fmtMoneyMap(pnl.commissions.outstanding)} accent="#A8660A" />
                  </View>
                  <View style={styles.lifetimeCard}>
                    <Text style={styles.lifetimeLabel}>Lifetime outstanding</Text>
                    <Text style={styles.lifetimeValue}>{fmtMoneyMap(pnl.lifetimeOutstanding)}</Text>
                  </View>
                  <View style={styles.portfolioRow}>
                    <PortfolioStat label="Policies" value={pnl.portfolio.totalPolicies} />
                    <PortfolioStat label="Active" value={pnl.portfolio.activePolicies} />
                    <PortfolioStat label="Grace" value={pnl.portfolio.gracePolicies} />
                    <PortfolioStat label="Lapsed" value={pnl.portfolio.lapsedPolicies} />
                    <PortfolioStat label="Retention" value={`${pnl.portfolio.retentionRate}%`} />
                  </View>
                  <Text style={styles.periodNote}>
                    Period {fmtDate(pnl.period.from)} – {fmtDate(pnl.period.to)} · {pnl.portfolio.newInPeriod} new policies this period
                  </Text>
                </>
              )}
              <Text style={styles.sectionLabel}>Ledger</Text>
            </>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{entryLabel(item.entryType)}</Text>
                <Text style={styles.cardSub}>
                  {item.policyNumber ? `${item.policyNumber} · ` : ""}
                  {[item.clientFirstName, item.clientLastName].filter(Boolean).join(" ") || "—"}
                </Text>
                <Text style={styles.cardDate}>{fmtDate(item.createdAt)}</Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 6 }}>
                <Text style={[styles.amount, Number(item.amount) < 0 && styles.amountNegative]}>
                  {item.currency} {Number(item.amount).toFixed(2)}
                </Text>
                <StatusPill status={item.status} />
              </View>
            </View>
          )}
          ListEmptyComponent={<View style={styles.center}><Text style={styles.hint}>No commission entries yet.</Text></View>}
          contentContainerStyle={{ padding: 16, flexGrow: 1 }}
        />
      )}
    </View>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, { color: accent }]}>{value}</Text>
    </View>
  );
}

function PortfolioStat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.portfolioStat}>
      <Text style={styles.portfolioValue}>{value}</Text>
      <Text style={styles.portfolioLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F6F6" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  summaryRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  summaryCard: { flex: 1, backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E1", padding: 12 },
  summaryLabel: { fontSize: 11, fontWeight: "700", color: "#8A9997", textTransform: "uppercase", letterSpacing: 0.5 },
  summaryValue: { fontSize: 14, fontWeight: "800", marginTop: 6 },
  lifetimeCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#E3EEEC", borderRadius: 10, padding: 14, marginBottom: 10 },
  lifetimeLabel: { fontSize: 13, fontWeight: "600", color: "#0C6B62" },
  lifetimeValue: { fontSize: 15, fontWeight: "800", color: "#0C6B62" },
  portfolioRow: { flexDirection: "row", backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E1", paddingVertical: 12, marginBottom: 6 },
  portfolioStat: { flex: 1, alignItems: "center" },
  portfolioValue: { fontSize: 16, fontWeight: "800", color: "#14201F" },
  portfolioLabel: { fontSize: 10, color: "#8A9997", marginTop: 2 },
  periodNote: { fontSize: 11, color: "#8A9997", marginBottom: 16, textAlign: "center" },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: "#8A9997", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E1", padding: 14, marginBottom: 8, gap: 8 },
  cardTitle: { fontSize: 14, fontWeight: "700", color: "#14201F" },
  cardSub: { fontSize: 12, color: "#5B6D6B", marginTop: 2 },
  cardDate: { fontSize: 11, color: "#8A9997", marginTop: 2 },
  amount: { fontSize: 14, fontWeight: "800", color: "#2E7D4F" },
  amountNegative: { color: "#A33B3B" },
  hint: { fontSize: 13, color: "#8A9997" },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 100 },
  pillText: { fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
});
