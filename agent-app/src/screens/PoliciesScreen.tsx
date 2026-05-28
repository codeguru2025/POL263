import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, RefreshControl, Modal, ScrollView, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import { getDb } from "../db/schema";
import { useNetwork } from "../context/NetworkContext";
import { fullSync } from "../sync/engine";
import { colors, spacing, fontSize } from "../theme";
import { API_BASE } from "../config";
import { policyDocumentUrl } from "../api";

interface PolicyDetail {
  id: string;
  policyNumber: string | null;
  status: string;
  currency: string;
  premiumAmount: string | null;
  paymentSchedule: string;
  effectiveDate: string | null;
  inceptionDate: string | null;
  waitingPeriodEndDate: string | null;
  beneficiaryFirstName: string | null;
  beneficiaryLastName: string | null;
  beneficiaryRelationship: string | null;
  beneficiaryNationalId: string | null;
  beneficiaryPhone: string | null;
  client?: { firstName: string; lastName: string; phone?: string; email?: string };
  members?: Array<{ id: string; firstName: string; lastName: string; role: string; memberNumber: string | null }>;
  payments?: Array<{ id: string; amount: string; currency: string; paymentMethod: string; status: string; receivedAt: string }>;
  receipts?: Array<{ id: string; receiptNumber: string; amount: string; paymentChannel: string; createdAt: string }>;
}

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
  const [selectedPolicy, setSelectedPolicy] = useState<{ local: PolicyItem; detail: PolicyDetail | null } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
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

  const fetchPolicyDetail = useCallback(async (policy: PolicyItem) => {
    setSelectedPolicy({ local: policy, detail: null });
    if (!policy.server_id || !isOnline) return;
    setLoadingDetail(true);
    try {
      const [polRes, membersRes, paymentsRes, receiptsRes] = await Promise.allSettled([
        fetch(`${API_BASE}/api/policies/${policy.server_id}`, { credentials: "include" }),
        fetch(`${API_BASE}/api/policies/${policy.server_id}/members`, { credentials: "include" }),
        fetch(`${API_BASE}/api/policies/${policy.server_id}/payments`, { credentials: "include" }),
        fetch(`${API_BASE}/api/policies/${policy.server_id}/receipts`, { credentials: "include" }),
      ]);
      let detail: PolicyDetail | null = null as PolicyDetail | null;
      if (polRes.status === "fulfilled" && polRes.value.ok) {
        detail = await polRes.value.json();
      }
      if (detail) {
        if (membersRes.status === "fulfilled" && membersRes.value.ok) {
          detail.members = await membersRes.value.json();
        }
        if (paymentsRes.status === "fulfilled" && paymentsRes.value.ok) {
          detail.payments = await paymentsRes.value.json();
        }
        if (receiptsRes.status === "fulfilled" && receiptsRes.value.ok) {
          detail.receipts = await receiptsRes.value.json();
        }
        setSelectedPolicy({ local: policy, detail });
      }
    } catch {}
    finally { setLoadingDetail(false); }
  }, [isOnline]);

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
          <TouchableOpacity style={styles.policyCard} onPress={() => fetchPolicyDetail(item)} activeOpacity={0.75}>
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
                  policyDocumentUrl(item.server_id!),
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
          </TouchableOpacity>
        )}
      />

      {/* ── Policy Detail Modal ── */}
      {selectedPolicy && (
        <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelectedPolicy(null)}>
          <SafeAreaView style={styles.detailContainer} edges={["top"]}>
            <View style={styles.detailHeader}>
              <TouchableOpacity onPress={() => setSelectedPolicy(null)}>
                <Text style={styles.backText}>← Back</Text>
              </TouchableOpacity>
              <Text style={styles.detailTitle} numberOfLines={1}>
                {selectedPolicy.local.policy_number || "Pending Policy"}
              </Text>
              <View style={{ width: 60 }} />
            </View>

            {loadingDetail && !selectedPolicy.detail ? (
              <View style={styles.detailLoading}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.detailLoadingText}>Loading details…</Text>
              </View>
            ) : (
              <ScrollView style={{ flex: 1 }}>
                {/* Summary card */}
                <View style={styles.detailSection}>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Status</Text>
                    <View style={[styles.statusBadge, { backgroundColor: statusColor(selectedPolicy.local.status) + "20" }]}>
                      <Text style={[styles.statusText, { color: statusColor(selectedPolicy.local.status) }]}>
                        {selectedPolicy.local.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Client</Text>
                    <Text style={styles.detailValue}>{selectedPolicy.local.client_name}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Product</Text>
                    <Text style={styles.detailValue}>{selectedPolicy.local.product_name || "—"}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Premium</Text>
                    <Text style={styles.detailValue}>
                      {selectedPolicy.local.currency} {selectedPolicy.local.premium_amount || "0"} / {selectedPolicy.local.payment_schedule}
                    </Text>
                  </View>
                  {!!selectedPolicy.local.effective_date && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Effective Date</Text>
                      <Text style={styles.detailValue}>{selectedPolicy.local.effective_date}</Text>
                    </View>
                  )}
                  {selectedPolicy.detail?.inceptionDate && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Inception Date</Text>
                      <Text style={styles.detailValue}>{selectedPolicy.detail.inceptionDate.split("T")[0]}</Text>
                    </View>
                  )}
                  {selectedPolicy.detail?.waitingPeriodEndDate && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Waiting Period End</Text>
                      <Text style={styles.detailValue}>{selectedPolicy.detail.waitingPeriodEndDate.split("T")[0]}</Text>
                    </View>
                  )}
                </View>

                {/* Beneficiary */}
                {selectedPolicy.detail?.beneficiaryFirstName && (
                  <View style={styles.detailSection}>
                    <Text style={styles.sectionHeading}>Beneficiary</Text>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Name</Text>
                      <Text style={styles.detailValue}>
                        {selectedPolicy.detail.beneficiaryFirstName} {selectedPolicy.detail.beneficiaryLastName}
                      </Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Relationship</Text>
                      <Text style={styles.detailValue}>{selectedPolicy.detail.beneficiaryRelationship || "—"}</Text>
                    </View>
                    {!!selectedPolicy.detail.beneficiaryNationalId && (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>National ID</Text>
                        <Text style={styles.detailValue}>{selectedPolicy.detail.beneficiaryNationalId}</Text>
                      </View>
                    )}
                    {!!selectedPolicy.detail.beneficiaryPhone && (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Phone</Text>
                        <Text style={styles.detailValue}>{selectedPolicy.detail.beneficiaryPhone}</Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Members */}
                {(selectedPolicy.detail?.members?.length ?? 0) > 0 && (
                  <View style={styles.detailSection}>
                    <Text style={styles.sectionHeading}>Policy Members</Text>
                    {selectedPolicy.detail!.members!.map(m => (
                      <View key={m.id} style={styles.memberRow}>
                        <Text style={styles.memberName}>{m.firstName} {m.lastName}</Text>
                        <Text style={styles.memberMeta}>{m.role}{m.memberNumber ? ` · ${m.memberNumber}` : ""}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Payments */}
                {(selectedPolicy.detail?.payments?.length ?? 0) > 0 && (
                  <View style={styles.detailSection}>
                    <Text style={styles.sectionHeading}>Payment History</Text>
                    {selectedPolicy.detail!.payments!.map(p => (
                      <View key={p.id} style={styles.paymentRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.paymentAmount}>{p.currency} {p.amount}</Text>
                          <Text style={styles.paymentMeta}>{p.paymentMethod} · {p.status}</Text>
                        </View>
                        <Text style={styles.paymentDate}>{new Date(p.receivedAt).toLocaleDateString()}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Receipts */}
                {(selectedPolicy.detail?.receipts?.length ?? 0) > 0 && (
                  <View style={styles.detailSection}>
                    <Text style={styles.sectionHeading}>Receipts</Text>
                    {selectedPolicy.detail!.receipts!.map(r => (
                      <View key={r.id} style={styles.paymentRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.paymentAmount}>{r.receiptNumber}</Text>
                          <Text style={styles.paymentMeta}>{r.paymentChannel} · {r.amount}</Text>
                        </View>
                        <Text style={styles.paymentDate}>{new Date(r.createdAt).toLocaleDateString()}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Document */}
                {selectedPolicy.local.server_id && isOnline && (
                  <TouchableOpacity
                    style={styles.docBtn}
                    onPress={() => WebBrowser.openBrowserAsync(
                      policyDocumentUrl(selectedPolicy.local.server_id!, "en"),
                      { toolbarColor: colors.primary, controlsColor: "#fff" }
                    )}
                  >
                    <Text style={styles.docBtnText}>📄 View Policy Document</Text>
                  </TouchableOpacity>
                )}

                {!selectedPolicy.local.synced && (
                  <View style={[styles.syncNote, { margin: spacing.md }]}>
                    <Text style={styles.syncNoteText}>Pending sync — policy number will be assigned on sync</Text>
                  </View>
                )}
                <View style={{ height: 40 }} />
              </ScrollView>
            )}
          </SafeAreaView>
        </Modal>
      )}
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
  // Detail modal
  detailContainer: { flex: 1, backgroundColor: colors.background },
  detailHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  backText: { fontSize: fontSize.md, color: colors.accent, fontWeight: "600", minWidth: 60 },
  detailTitle: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text, flex: 1, textAlign: "center" },
  detailLoading: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  detailLoadingText: { fontSize: fontSize.md, color: colors.textSecondary },
  detailSection: {
    backgroundColor: colors.surface, margin: spacing.md, borderRadius: 12,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  sectionHeading: {
    fontSize: fontSize.md, fontWeight: "700", color: colors.primary,
    marginBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border,
    paddingBottom: spacing.xs,
  },
  detailRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  detailLabel: { fontSize: fontSize.sm, color: colors.textSecondary, flex: 1 },
  detailValue: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text, flex: 2, textAlign: "right" },
  memberRow: { paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  memberName: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text },
  memberMeta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 1, textTransform: "capitalize" },
  paymentRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  paymentAmount: { fontSize: fontSize.sm, fontWeight: "700", color: colors.text },
  paymentMeta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 1, textTransform: "capitalize" },
  paymentDate: { fontSize: fontSize.xs, color: colors.textMuted },
  docBtn: {
    backgroundColor: "#eff6ff", borderRadius: 10, margin: spacing.md,
    padding: spacing.md, alignItems: "center", borderWidth: 1, borderColor: "#bfdbfe",
  },
  docBtnText: { fontSize: fontSize.md, fontWeight: "700", color: colors.primary },
});
