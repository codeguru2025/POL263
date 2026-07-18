import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import {
  getApprovalSummary, getApprovalRequests, resolveApprovalRequest, isForbidden,
  type ApprovalSummary, type ApprovalRequest,
} from "../../src/api/approvals";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "2-digit" });
}

function requestLabel(a: ApprovalRequest): string {
  const kind = a.requestType.replace(/_/g, " ");
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

export default function ApprovalsScreen() {
  const [summary, setSummary] = useState<ApprovalSummary | null>(null);
  const [requests, setRequests] = useState<ApprovalRequest[] | null>(null);
  const [gated, setGated] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<ApprovalRequest | null>(null);

  const load = useCallback(async () => {
    getApprovalSummary().then(setSummary).catch(() => setSummary(null));
    try {
      const list = await getApprovalRequests("pending");
      setRequests(list);
      setGated(false);
    } catch (err) {
      if (isForbidden(err)) { setGated(true); setRequests([]); }
      else setRequests([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const onResolved = () => { setSelected(null); load(); };

  return (
    <View style={styles.screen}>
      {requests === null ? (
        <View style={styles.center}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(a) => a.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListHeaderComponent={
            <>
              {summary && summary.categories.length > 0 && (
                <View style={styles.summaryRow}>
                  {summary.categories.map((c) => (
                    <View key={c.key} style={styles.summaryCard}>
                      <Text style={styles.summaryCount}>{c.count}</Text>
                      <Text style={styles.summaryLabel}>{c.label}</Text>
                    </View>
                  ))}
                </View>
              )}
              {gated ? (
                <Text style={styles.hint}>
                  You can see approval totals above, but resolving generic requests needs the
                  "approve:requests" permission. Waivers, settlements, receipts, and
                  requisitions are still managed on the web app for now.
                </Text>
              ) : (
                <Text style={styles.sectionLabel}>Pending requests</Text>
              )}
            </>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => setSelected(item)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{requestLabel(item)}</Text>
                <Text style={styles.cardSub}>{item.entityType} · {fmtDate(item.createdAt)}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            gated ? null : <View style={styles.center}><Text style={styles.hint}>No pending requests.</Text></View>
          }
          contentContainerStyle={{ padding: 16, flexGrow: 1 }}
        />
      )}

      <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}>
        {selected && <ResolveRequestForm request={selected} onDone={onResolved} onCancel={() => setSelected(null)} />}
      </Modal>
    </View>
  );
}

function ResolveRequestForm({ request, onDone, onCancel }: {
  request: ApprovalRequest; onDone: () => void; onCancel: () => void;
}) {
  const [rejectionReason, setRejectionReason] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState("");

  const resolve = async (action: "approve" | "reject") => {
    if (action === "reject" && !rejectionReason.trim()) {
      setError("A reason is required to reject a request");
      return;
    }
    setBusy(action);
    setError("");
    try {
      await resolveApprovalRequest(request.id, action, rejectionReason || undefined);
      onDone();
    } catch (err: any) {
      // Server enforces maker-checker (can't approve your own request) — surface as-is.
      setError(err?.message || "Could not resolve request");
      setBusy(null);
    }
  };

  return (
    <View style={styles.formScreen}>
      <View style={styles.formHeader}>
        <Pressable onPress={onCancel}><Text style={styles.link}>Cancel</Text></Pressable>
        <Text style={styles.formTitle}>{requestLabel(request)}</Text>
        <View style={{ width: 44 }} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <DetailRow label="Entity" value={`${request.entityType} · ${request.entityId}`} />
      <DetailRow label="Requested" value={fmtDate(request.createdAt)} />
      {request.requestData && Object.keys(request.requestData).length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Details</Text>
          {Object.entries(request.requestData).map(([k, v]) => (
            <DetailRow key={k} label={k} value={String(v)} />
          ))}
        </>
      )}

      <Text style={styles.sectionLabel}>Rejection reason (required to reject)</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="Why is this being rejected?"
        value={rejectionReason}
        onChangeText={setRejectionReason}
        multiline
      />

      <View style={styles.buttonRow}>
        <Pressable style={[styles.button, styles.rejectButton]} onPress={() => resolve("reject")} disabled={!!busy}>
          {busy === "reject" ? <ActivityIndicator color="#A33B3B" /> : <Text style={styles.rejectButtonText}>Reject</Text>}
        </Pressable>
        <Pressable style={[styles.button, styles.approveButton]} onPress={() => resolve("approve")} disabled={!!busy}>
          {busy === "approve" ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Approve</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value || "—"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F6F6" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  summaryCard: { flexGrow: 1, minWidth: "30%", backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E1", padding: 12, alignItems: "center" },
  summaryCount: { fontSize: 20, fontWeight: "800", color: "#0C6B62" },
  summaryLabel: { fontSize: 11, color: "#5B6D6B", marginTop: 2, textAlign: "center" },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: "#8A9997", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 8, marginBottom: 10 },
  hint: { fontSize: 12, color: "#8A9997", lineHeight: 18, marginTop: 8 },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E1", padding: 14, marginBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#14201F" },
  cardSub: { fontSize: 12, color: "#5B6D6B", marginTop: 2 },
  chevron: { fontSize: 20, color: "#8A9997" },
  formScreen: { flex: 1, backgroundColor: "#F4F6F6", padding: 20, paddingTop: 60 },
  formHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  formTitle: { fontSize: 16, fontWeight: "700", color: "#14201F" },
  link: { color: "#5B6D6B", fontSize: 15 },
  input: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, backgroundColor: "#FFFFFF" },
  textArea: { minHeight: 90, textAlignVertical: "top" },
  error: { color: "#A33B3B", backgroundColor: "#F8E9E9", padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13, textAlign: "center" },
  detailRow: { marginBottom: 14 },
  detailLabel: { fontSize: 11, fontWeight: "700", color: "#8A9997", textTransform: "uppercase", letterSpacing: 0.5 },
  detailValue: { fontSize: 15, color: "#14201F", marginTop: 2 },
  buttonRow: { flexDirection: "row", gap: 12, marginTop: 24 },
  button: { flex: 1, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  approveButton: { backgroundColor: "#0C6B62" },
  rejectButton: { backgroundColor: "#F8E9E9", borderWidth: 1, borderColor: "#A33B3B" },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  rejectButtonText: { color: "#A33B3B", fontSize: 15, fontWeight: "700" },
});
