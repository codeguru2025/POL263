import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  RefreshControl, Modal, ScrollView, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import { useNetwork } from "../context/NetworkContext";
import { colors, spacing, fontSize } from "../theme";
import { API_BASE } from "../config";
import { apiGet, apiPost, apiPatch } from "../api";
import { getDb } from "../db/schema";
import DateField from "../components/DateField";

interface FuneralCase {
  id: string;
  caseNumber: string;
  status: string;
  deceasedName: string;
  dateOfDeath?: string;
  causeOfDeath?: string;
  placeOfDeath?: string;
  informantName?: string;
  informantPhone?: string;
  informantRelationship?: string;
  serviceType?: string;   // "cash" | "claim"
  funeralDate?: string;   // date of burial
  funeralLocation?: string;
  removalLocation?: string;
  notes?: string;
  createdAt: string;
}

type CaseForm = {
  deceasedName: string;
  dateOfDeath: string;
  causeOfDeath: string;
  placeOfDeath: string;
  informantName: string;
  informantPhone: string;
  informantRelationship: string;
  serviceType: string;
  policyNumber: string;
  funeralDate: string;
  funeralLocation: string;
  removalLocation: string;
  notes: string;
};

const BLANK_FORM: CaseForm = {
  deceasedName: "", dateOfDeath: "", causeOfDeath: "", placeOfDeath: "",
  informantName: "", informantPhone: "", informantRelationship: "",
  serviceType: "", policyNumber: "",
  funeralDate: "", funeralLocation: "", removalLocation: "", notes: "",
};

const STATUS_COLOR: Record<string, string> = {
  open: "#d97706", in_progress: "#2563eb", completed: "#16a34a", cancelled: "#6b7280",
};

const RELATIONSHIPS = ["Spouse", "Son", "Daughter", "Father", "Mother", "Brother", "Sister", "Grandparent", "Other"];
const SERVICE_TYPES = [{ value: "cash", label: "Cash Service" }, { value: "claim", label: "Policy Claim" }];

export default function FuneralsScreen() {
  const { isOnline } = useNetwork();
  const [cases, setCases] = useState<FuneralCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCase, setSelectedCase] = useState<FuneralCase | null>(null);
  const [editCase, setEditCase] = useState<FuneralCase | null>(null);

  const loadCases = useCallback(async () => {
    setLoading(true);
    try {
      if (isOnline) {
        const data = await apiGet<FuneralCase[]>("/api/funeral-cases?limit=200");
        setCases(Array.isArray(data) ? data : []);
        const db = await getDb();
        await db.runAsync("DELETE FROM cache_my_funeral_cases");
        for (const fc of (Array.isArray(data) ? data : [])) {
          await db.runAsync(
            "INSERT OR REPLACE INTO cache_my_funeral_cases (id, data, updated_at) VALUES (?, ?, datetime('now'))",
            fc.id, JSON.stringify(fc)
          );
        }
      } else {
        const db = await getDb();
        const rows = await db.getAllAsync<{ data: string }>(
          "SELECT data FROM cache_my_funeral_cases ORDER BY updated_at DESC"
        );
        setCases(rows.map(r => JSON.parse(r.data)));
      }
    } catch {} finally { setLoading(false); }
  }, [isOnline]);

  useEffect(() => { loadCases(); }, [loadCases]);
  const onRefresh = async () => { setRefreshing(true); await loadCases(); setRefreshing(false); };

  const handleCreate = async (form: CaseForm) => {
    try {
      const payload: Record<string, string | null> = {
        deceasedName: form.deceasedName,
        dateOfDeath: form.dateOfDeath || null,
        causeOfDeath: form.causeOfDeath || null,
        placeOfDeath: form.placeOfDeath || null,
        informantName: form.informantName || null,
        informantPhone: form.informantPhone || null,
        informantRelationship: form.informantRelationship || null,
        serviceType: form.serviceType || null,
        funeralDate: form.funeralDate || null,
        funeralLocation: form.funeralLocation || null,
        removalLocation: form.removalLocation || null,
        notes: form.notes || null,
      };
      await apiPost("/api/funeral-cases", payload);
      setShowCreate(false);
      await loadCases();
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to create case");
    }
  };

  const handleUpdate = async (id: string, form: CaseForm) => {
    try {
      const payload: Record<string, string | null> = {
        deceasedName: form.deceasedName,
        dateOfDeath: form.dateOfDeath || null,
        causeOfDeath: form.causeOfDeath || null,
        placeOfDeath: form.placeOfDeath || null,
        informantName: form.informantName || null,
        informantPhone: form.informantPhone || null,
        informantRelationship: form.informantRelationship || null,
        serviceType: form.serviceType || null,
        funeralDate: form.funeralDate || null,
        funeralLocation: form.funeralLocation || null,
        removalLocation: form.removalLocation || null,
        notes: form.notes || null,
      };
      const updated = await apiPatch<FuneralCase>(`/api/funeral-cases/${id}`, payload);
      setEditCase(null);
      setSelectedCase(updated);
      await loadCases();
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to update case");
    }
  };

  const openDocument = (fc: FuneralCase) => {
    if (!isOnline) { Alert.alert("Offline", "Document requires an internet connection"); return; }
    WebBrowser.openBrowserAsync(
      `${API_BASE}/api/funeral-cases/${fc.id}/document`,
      { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET, toolbarColor: colors.primary, controlsColor: "#fff" }
    );
  };

  const filtered = cases.filter(c =>
    `${c.caseNumber} ${c.deceasedName} ${c.funeralLocation || ""}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerRow}>
        <TextInput
          style={styles.search} placeholder="Search cases…" placeholderTextColor={colors.textMuted}
          value={search} onChangeText={setSearch}
        />
        {isOnline && (
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowCreate(true)}>
            <Text style={styles.addBtnText}>+ New</Text>
          </TouchableOpacity>
        )}
      </View>

      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>📶 Offline — showing cached cases</Text>
        </View>
      )}

      {loading && !refreshing ? (
        <ActivityIndicator style={{ margin: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={c => c.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={filtered.length === 0 ? styles.emptyWrap : { padding: spacing.md }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>⚰️</Text>
              <Text style={styles.emptyTitle}>No funeral cases</Text>
              <Text style={styles.emptySub}>{isOnline ? "Tap + New to create a case." : "Go online to load cases."}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => setSelectedCase(item)} activeOpacity={0.75}>
              <View style={styles.cardTop}>
                <Text style={styles.caseNum}>{item.caseNumber}</Text>
                <View style={[styles.badge, { backgroundColor: (STATUS_COLOR[item.status] || "#6b7280") + "20" }]}>
                  <Text style={[styles.badgeText, { color: STATUS_COLOR[item.status] || "#6b7280" }]}>
                    {item.status?.replace("_", " ").toUpperCase()}
                  </Text>
                </View>
              </View>
              <Text style={styles.deceasedName}>{item.deceasedName}</Text>
              {item.serviceType && (
                <Text style={styles.sub}>
                  {item.serviceType === "claim" ? "📋 Policy Claim" : "💵 Cash Service"}
                </Text>
              )}
              <View style={styles.cardRow}>
                {item.funeralDate && <Text style={styles.sub}>Burial: {item.funeralDate}</Text>}
                {item.funeralLocation && <Text style={styles.sub}>{item.funeralLocation}</Text>}
              </View>
              <Text style={styles.time}>{new Date(item.createdAt).toLocaleDateString()}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* ── Create Case Modal ── */}
      <CaseFormModal
        visible={showCreate}
        title="New Funeral Case"
        initial={BLANK_FORM}
        onClose={() => setShowCreate(false)}
        onSubmit={handleCreate}
      />

      {/* ── Edit Modal ── */}
      {editCase && (
        <CaseFormModal
          visible
          title="Edit Case"
          initial={{
            deceasedName: editCase.deceasedName ?? "",
            dateOfDeath: editCase.dateOfDeath ?? "",
            causeOfDeath: editCase.causeOfDeath ?? "",
            placeOfDeath: editCase.placeOfDeath ?? "",
            informantName: editCase.informantName ?? "",
            informantPhone: editCase.informantPhone ?? "",
            informantRelationship: editCase.informantRelationship ?? "",
            serviceType: editCase.serviceType ?? "",
            policyNumber: "",
            funeralDate: editCase.funeralDate ?? "",
            funeralLocation: editCase.funeralLocation ?? "",
            removalLocation: editCase.removalLocation ?? "",
            notes: editCase.notes ?? "",
          }}
          onClose={() => setEditCase(null)}
          onSubmit={(form) => handleUpdate(editCase.id, form)}
        />
      )}

      {/* ── Case Detail Modal ── */}
      {selectedCase && (
        <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelectedCase(null)}>
          <SafeAreaView style={styles.detailSafe} edges={["top"]}>
            <View style={styles.detailHeader}>
              <TouchableOpacity onPress={() => setSelectedCase(null)}>
                <Text style={styles.backBtn}>← Back</Text>
              </TouchableOpacity>
              <Text style={styles.detailTitle} numberOfLines={1}>{selectedCase.caseNumber}</Text>
              {isOnline && (
                <TouchableOpacity onPress={() => { setSelectedCase(null); setEditCase(selectedCase); }}>
                  <Text style={styles.editBtn}>Edit</Text>
                </TouchableOpacity>
              )}
            </View>
            <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}>
              {/* Status + service type */}
              <View style={styles.detailBadgeRow}>
                <View style={[styles.badge, { backgroundColor: (STATUS_COLOR[selectedCase.status] || "#6b7280") + "20" }]}>
                  <Text style={[styles.badgeText, { color: STATUS_COLOR[selectedCase.status] || "#6b7280" }]}>
                    {selectedCase.status?.replace("_", " ").toUpperCase()}
                  </Text>
                </View>
                {selectedCase.serviceType && (
                  <View style={[styles.badge, { backgroundColor: "#0f766e20" }]}>
                    <Text style={[styles.badgeText, { color: "#0f766e" }]}>
                      {selectedCase.serviceType === "claim" ? "POLICY CLAIM" : "CASH SERVICE"}
                    </Text>
                  </View>
                )}
              </View>

              <DetailSection title="Deceased">
                <DetailRow label="Name" value={selectedCase.deceasedName} />
                <DetailRow label="Date of Death" value={selectedCase.dateOfDeath} />
                <DetailRow label="Cause of Death" value={selectedCase.causeOfDeath} />
                <DetailRow label="Place of Death" value={selectedCase.placeOfDeath} />
              </DetailSection>

              {(selectedCase.informantName || selectedCase.informantPhone) && (
                <DetailSection title="Informant (Next of Kin)">
                  <DetailRow label="Name" value={selectedCase.informantName} />
                  <DetailRow label="Phone" value={selectedCase.informantPhone} />
                  <DetailRow label="Relationship" value={selectedCase.informantRelationship} />
                </DetailSection>
              )}

              <DetailSection title="Service Details">
                <DetailRow label="Date of Burial" value={selectedCase.funeralDate} />
                <DetailRow label="Place of Burial" value={selectedCase.funeralLocation} />
                <DetailRow label="Removal Location" value={selectedCase.removalLocation} />
              </DetailSection>

              {selectedCase.notes && (
                <DetailSection title="Notes">
                  <Text style={styles.notesText}>{selectedCase.notes}</Text>
                </DetailSection>
              )}

              {/* Actions */}
              <TouchableOpacity style={styles.docBtn} onPress={() => openDocument(selectedCase)}>
                <Text style={styles.docBtnText}>📄 View / Share Funeral Notification PDF</Text>
              </TouchableOpacity>
            </ScrollView>
          </SafeAreaView>
        </Modal>
      )}
    </SafeAreaView>
  );
}

// ─── Reusable detail helpers ─────────────────────────────────────────────────

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={sStyles.section}>
      <Text style={sStyles.heading}>{title}</Text>
      {children}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View style={sStyles.row}>
      <Text style={sStyles.label}>{label}</Text>
      <Text style={sStyles.value}>{value}</Text>
    </View>
  );
}

const sStyles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  heading: {
    fontSize: fontSize.md, fontWeight: "700", color: colors.primary,
    marginBottom: spacing.sm, paddingBottom: spacing.xs,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  row: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
    paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  label: { fontSize: fontSize.sm, color: colors.textSecondary, flex: 1 },
  value: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text, flex: 2, textAlign: "right" },
});

// ─── Case Form Modal ─────────────────────────────────────────────────────────

function CaseFormModal({
  visible, title, initial, onClose, onSubmit,
}: {
  visible: boolean;
  title: string;
  initial: CaseForm;
  onClose: () => void;
  onSubmit: (form: CaseForm) => Promise<void>;
}) {
  const [form, setForm] = useState<CaseForm>(initial);
  const [submitting, setSubmitting] = useState(false);
  // Policy claim lookup
  const [policySearching, setPolicySearching] = useState(false);
  const [foundPolicyNum, setFoundPolicyNum] = useState("");
  const [policyMembers, setPolicyMembers] = useState<{ name: string; role: string }[]>([]);
  const [policyLookupError, setPolicyLookupError] = useState("");

  const set = (k: keyof CaseForm) => (v: string) => setForm(f => ({ ...f, [k]: v }));

  const lookupPolicy = async () => {
    if (!form.policyNumber.trim()) return;
    setPolicySearching(true);
    setPolicyLookupError("");
    setFoundPolicyNum("");
    setPolicyMembers([]);
    try {
      const data = await apiGet<any[]>(`/api/policies?q=${encodeURIComponent(form.policyNumber.trim())}&limit=5`);
      const policies = Array.isArray(data) ? data : [];
      const exact = policies.find((p: any) => p.policyNumber?.toLowerCase() === form.policyNumber.trim().toLowerCase()) || policies[0];
      if (!exact) { setPolicyLookupError("No policy found"); return; }
      setFoundPolicyNum(exact.policyNumber);
      const members = await apiGet<any[]>(`/api/policies/${exact.id}/members`);
      const memberList = (Array.isArray(members) ? members : []).map((m: any) => ({
        name: m.name || `${m.firstName || ""} ${m.lastName || ""}`.trim() || "Member",
        role: m.role || "member",
      }));
      setPolicyMembers(memberList);
    } catch { setPolicyLookupError("Failed to look up policy"); }
    finally { setPolicySearching(false); }
  };

  const handleSubmit = async () => {
    if (!form.deceasedName.trim()) { Alert.alert("Required", "Deceased name is required"); return; }
    setSubmitting(true);
    try { await onSubmit(form); } finally { setSubmitting(false); }
  };

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <View style={fStyles.field}>
      <Text style={fStyles.label}>{label}</Text>
      {children}
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <SafeAreaView style={fStyles.safe}>
          <View style={fStyles.header}>
            <Text style={fStyles.headerTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose}><Text style={fStyles.closeBtn}>✕</Text></TouchableOpacity>
          </View>

          <ScrollView style={fStyles.body} keyboardShouldPersistTaps="handled">

            {/* ── Deceased ── */}
            <Text style={fStyles.sectionLabel}>DECEASED DETAILS</Text>
            <Field label="Full Name *">
              <TextInput style={fStyles.input} value={form.deceasedName} onChangeText={set("deceasedName")} autoCapitalize="words" placeholder="Full name of deceased" placeholderTextColor={colors.textMuted} />
            </Field>
            <View style={fStyles.row2}>
              <View style={{ flex: 1 }}>
                <Field label="Date of Death">
                  <DateField value={form.dateOfDeath} onChange={set("dateOfDeath")} placeholder="Select date" maxYear={new Date().getFullYear()} />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Cause of Death">
                  <TextInput style={fStyles.input} value={form.causeOfDeath} onChangeText={set("causeOfDeath")} placeholder="e.g. Natural" placeholderTextColor={colors.textMuted} />
                </Field>
              </View>
            </View>
            <Field label="Place of Death">
              <TextInput style={fStyles.input} value={form.placeOfDeath} onChangeText={set("placeOfDeath")} placeholder="Hospital, home address…" placeholderTextColor={colors.textMuted} />
            </Field>

            {/* ── Informant ── */}
            <Text style={fStyles.sectionLabel}>INFORMANT (NEXT OF KIN)</Text>
            <View style={fStyles.row2}>
              <View style={{ flex: 1 }}>
                <Field label="Name">
                  <TextInput style={fStyles.input} value={form.informantName} onChangeText={set("informantName")} autoCapitalize="words" placeholder="Full name" placeholderTextColor={colors.textMuted} />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Phone">
                  <TextInput style={fStyles.input} value={form.informantPhone} onChangeText={set("informantPhone")} keyboardType="phone-pad" placeholder="+263 77…" placeholderTextColor={colors.textMuted} />
                </Field>
              </View>
            </View>
            <Field label="Relationship">
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={fStyles.chipRow}>
                  {RELATIONSHIPS.map(r => (
                    <TouchableOpacity key={r} style={[fStyles.chip, form.informantRelationship === r && fStyles.chipActive]} onPress={() => set("informantRelationship")(r)}>
                      <Text style={[fStyles.chipText, form.informantRelationship === r && fStyles.chipTextActive]}>{r}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </Field>

            {/* ── Service ── */}
            <Text style={fStyles.sectionLabel}>SERVICE DETAILS</Text>
            <Field label="Service Type">
              <View style={fStyles.chipRow}>
                {SERVICE_TYPES.map(st => (
                  <TouchableOpacity key={st.value} style={[fStyles.chip, form.serviceType === st.value && fStyles.chipActive]} onPress={() => { set("serviceType")(st.value); if (st.value !== "claim") { setFoundPolicyNum(""); setPolicyMembers([]); setPolicyLookupError(""); setForm(f => ({ ...f, policyNumber: "" })); } }}>
                    <Text style={[fStyles.chipText, form.serviceType === st.value && fStyles.chipTextActive]}>{st.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Field>

            {/* Policy claim lookup */}
            {form.serviceType === "claim" && (
              <View style={fStyles.claimBox}>
                <Text style={fStyles.claimTitle}>Policy Claim — Enter policy number to link and select deceased member</Text>
                <View style={fStyles.policySearchRow}>
                  <TextInput
                    style={[fStyles.input, { flex: 1 }]}
                    value={form.policyNumber}
                    onChangeText={set("policyNumber")}
                    placeholder="e.g. FLK00123"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="characters"
                    onSubmitEditing={lookupPolicy}
                    returnKeyType="search"
                  />
                  <TouchableOpacity style={fStyles.findBtn} onPress={lookupPolicy} disabled={policySearching}>
                    {policySearching ? <ActivityIndicator size="small" color="#fff" /> : <Text style={fStyles.findBtnText}>Find</Text>}
                  </TouchableOpacity>
                </View>
                {policyLookupError ? <Text style={fStyles.lookupError}>{policyLookupError}</Text> : null}
                {foundPolicyNum ? (
                  <View style={fStyles.foundPolicy}>
                    <Text style={fStyles.foundPolicyText}>✓ Found: {foundPolicyNum}</Text>
                    {policyMembers.length > 0 && (
                      <>
                        <Text style={fStyles.membersLabel}>Select Deceased Member:</Text>
                        <View style={fStyles.chipRow}>
                          {policyMembers.map((m, i) => (
                            <TouchableOpacity key={i} style={[fStyles.chip, form.deceasedName === m.name && fStyles.chipActive]} onPress={() => set("deceasedName")(m.name)}>
                              <Text style={[fStyles.chipText, form.deceasedName === m.name && fStyles.chipTextActive]}>
                                {m.name} ({m.role.replace("_", " ")})
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </>
                    )}
                  </View>
                ) : null}
              </View>
            )}

            <View style={fStyles.row2}>
              <View style={{ flex: 1 }}>
                <Field label="Date of Burial">
                  <DateField value={form.funeralDate} onChange={set("funeralDate")} placeholder="Select date" />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Place of Burial">
                  <TextInput style={fStyles.input} value={form.funeralLocation} onChangeText={set("funeralLocation")} placeholder="Cemetery…" placeholderTextColor={colors.textMuted} />
                </Field>
              </View>
            </View>

            <Field label="Removal Location">
              <TextInput style={fStyles.input} value={form.removalLocation} onChangeText={set("removalLocation")} placeholder="Where body is collected from" placeholderTextColor={colors.textMuted} />
            </Field>

            <Field label="Notes">
              <TextInput style={[fStyles.input, { minHeight: 70 }]} value={form.notes} onChangeText={set("notes")} multiline placeholder="Any additional information…" placeholderTextColor={colors.textMuted} />
            </Field>

            <TouchableOpacity
              style={[fStyles.submitBtn, submitting && fStyles.submitDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={fStyles.submitText}>{title === "Edit Case" ? "Save Changes" : "Create Case"}</Text>}
            </TouchableOpacity>
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: "row", padding: spacing.md, gap: spacing.sm },
  search: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 10,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: fontSize.md, color: colors.text, borderWidth: 1, borderColor: colors.border,
  },
  addBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: spacing.md, justifyContent: "center" },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: fontSize.sm },
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
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xs },
  caseNum: { fontSize: fontSize.md, fontWeight: "700", color: colors.primary },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: fontSize.xs, fontWeight: "700" },
  deceasedName: { fontSize: fontSize.md, fontWeight: "500", color: colors.text, marginBottom: spacing.xs },
  cardRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.xs },
  sub: { fontSize: fontSize.sm, color: colors.textSecondary },
  time: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  // Detail modal
  detailSafe: { flex: 1, backgroundColor: colors.background },
  detailHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  backBtn: { fontSize: fontSize.md, color: colors.primary, fontWeight: "600", minWidth: 60 },
  detailTitle: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text, flex: 1, textAlign: "center" },
  editBtn: { fontSize: fontSize.md, color: colors.primary, fontWeight: "600", minWidth: 40, textAlign: "right" },
  detailBadgeRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  notesText: { fontSize: fontSize.sm, color: colors.text, lineHeight: 20 },
  docBtn: { backgroundColor: "#eff6ff", borderRadius: 12, padding: spacing.md, alignItems: "center", borderWidth: 1, borderColor: "#bfdbfe", marginTop: spacing.sm },
  docBtnText: { fontSize: fontSize.md, fontWeight: "700", color: colors.primary },
});

const fStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  headerTitle: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text },
  closeBtn: { fontSize: 20, color: colors.textSecondary, padding: spacing.sm },
  body: { flex: 1, padding: spacing.md },
  sectionLabel: {
    fontSize: fontSize.xs, fontWeight: "700", color: colors.textMuted,
    letterSpacing: 0.8, marginTop: spacing.md, marginBottom: spacing.xs,
  },
  field: { marginBottom: spacing.sm },
  label: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surfaceAlt, borderRadius: 10, padding: spacing.md,
    fontSize: fontSize.md, color: colors.text, borderWidth: 1, borderColor: colors.border,
  },
  row2: { flexDirection: "row", gap: spacing.sm },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 20,
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.xs,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.sm, color: colors.text },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  claimBox: {
    backgroundColor: "#eff6ff", borderRadius: 12, padding: spacing.md,
    borderWidth: 1, borderColor: "#bfdbfe", marginBottom: spacing.sm,
  },
  claimTitle: { fontSize: fontSize.xs, fontWeight: "600", color: colors.primary, marginBottom: spacing.sm },
  policySearchRow: { flexDirection: "row", gap: spacing.sm },
  findBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: spacing.md, justifyContent: "center", paddingVertical: spacing.sm },
  findBtnText: { color: "#fff", fontWeight: "700", fontSize: fontSize.sm },
  lookupError: { fontSize: fontSize.xs, color: colors.danger, marginTop: spacing.xs },
  foundPolicy: { marginTop: spacing.sm },
  foundPolicyText: { fontSize: fontSize.sm, fontWeight: "700", color: colors.success, marginBottom: spacing.xs },
  membersLabel: { fontSize: fontSize.xs, fontWeight: "600", color: colors.text, marginBottom: spacing.xs, marginTop: spacing.xs },
  submitBtn: { backgroundColor: colors.primary, borderRadius: 12, padding: spacing.md, alignItems: "center", marginTop: spacing.xl },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: "#fff", fontSize: fontSize.md, fontWeight: "700" },
});
