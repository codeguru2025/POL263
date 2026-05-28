import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  RefreshControl, Modal, ScrollView, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNetwork } from "../context/NetworkContext";
import { colors, spacing, fontSize } from "../theme";
import { API_BASE } from "../config";
import { getDb } from "../db/schema";

interface Claim {
  id: string;
  claimNumber: string;
  status: string;
  claimType: string;
  deceasedName?: string;
  deceasedRelationship?: string;
  dateOfDeath?: string;
  causeOfDeath?: string;
  createdAt: string;
  policyNumber?: string;
  clientName?: string;
  amount?: string;
}

interface Policy { id: string; policyNumber: string; clientFirstName: string; clientLastName: string; }

const STATUS_COLOR: Record<string, string> = {
  submitted: "#d97706", under_review: "#2563eb", approved: "#16a34a",
  rejected: "#dc2626", paid: "#7c3aed", closed: "#6b7280",
};

const CLAIM_TYPES = ["death", "disability", "funeral", "retrenchment", "other"];

export default function ClaimsScreen() {
  const { isOnline } = useNetwork();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [form, setForm] = useState({
    policyId: "", claimType: "", deceasedName: "", deceasedRelationship: "",
    dateOfDeath: "", causeOfDeath: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchClaims = useCallback(async () => {
    setLoading(true);
    try {
      if (isOnline) {
        const res = await fetch(`${API_BASE}/api/claims`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setClaims(data);
          const db = await getDb();
          await db.runAsync("DELETE FROM cache_my_claims");
          for (const c of data) {
            await db.runAsync("INSERT OR REPLACE INTO cache_my_claims (id, data, updated_at) VALUES (?, ?, datetime('now'))", c.id, JSON.stringify(c));
          }
        }
      } else {
        const db = await getDb();
        const rows = await db.getAllAsync<{ data: string }>("SELECT data FROM cache_my_claims ORDER BY updated_at DESC");
        setClaims(rows.map(r => JSON.parse(r.data)));
      }
    } catch {} finally { setLoading(false); }
  }, [isOnline]);

  const fetchPolicies = useCallback(async () => {
    if (!isOnline) return;
    try {
      const res = await fetch(`${API_BASE}/api/policies?limit=200`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.policies || []);
        setPolicies(list.map((p: any) => ({
          id: p.id, policyNumber: p.policyNumber,
          clientFirstName: p.clientFirstName || "", clientLastName: p.clientLastName || "",
        })));
      }
    } catch {}
  }, [isOnline]);

  useEffect(() => { fetchClaims(); fetchPolicies(); }, [fetchClaims, fetchPolicies]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchClaims();
    setRefreshing(false);
  };

  const handleSubmit = async () => {
    if (!form.policyId || !form.claimType) {
      Alert.alert("Error", "Policy and claim type are required"); return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/claims`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyId: form.policyId,
          claimType: form.claimType,
          deceasedName: form.deceasedName || undefined,
          deceasedRelationship: form.deceasedRelationship || undefined,
          dateOfDeath: form.dateOfDeath || undefined,
          causeOfDeath: form.causeOfDeath || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to submit claim");
      }
      Alert.alert("Success", "Claim submitted successfully");
      setShowCreate(false);
      setForm({ policyId: "", claimType: "", deceasedName: "", deceasedRelationship: "", dateOfDeath: "", causeOfDeath: "" });
      await fetchClaims();
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to submit");
    } finally { setSubmitting(false); }
  };

  const filtered = claims.filter(c =>
    `${c.claimNumber} ${c.clientName || ""} ${c.policyNumber || ""} ${c.claimType}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Header */}
      <View style={styles.headerRow}>
        <TextInput
          style={styles.search} placeholder="Search claims…" placeholderTextColor={colors.textMuted}
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
          <Text style={styles.offlineText}>📶 Offline — claims require connectivity</Text>
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
              <Text style={styles.emptyEmoji}>🏥</Text>
              <Text style={styles.emptyTitle}>No claims found</Text>
              <Text style={styles.emptySub}>{isOnline ? "Submit a new claim above." : "Go online to view claims."}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.claimNum}>{item.claimNumber}</Text>
                <View style={[styles.badge, { backgroundColor: (STATUS_COLOR[item.status] || "#6b7280") + "20" }]}>
                  <Text style={[styles.badgeText, { color: STATUS_COLOR[item.status] || "#6b7280" }]}>
                    {item.status?.replace("_", " ").toUpperCase()}
                  </Text>
                </View>
              </View>
              {item.clientName && <Text style={styles.clientName}>{item.clientName}</Text>}
              {item.policyNumber && <Text style={styles.sub}>Policy: {item.policyNumber}</Text>}
              <View style={styles.cardRow}>
                <Text style={styles.sub}>Type: <Text style={styles.subVal}>{item.claimType}</Text></Text>
                <Text style={styles.sub}>{new Date(item.createdAt).toLocaleDateString()}</Text>
              </View>
              {item.deceasedName && <Text style={styles.sub}>Deceased: {item.deceasedName} ({item.deceasedRelationship})</Text>}
            </View>
          )}
        />
      )}

      {/* Create Claim Modal */}
      <Modal visible={showCreate} animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Submit Claim</Text>
            <TouchableOpacity onPress={() => setShowCreate(false)}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Policy *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
              {policies.map(p => (
                <TouchableOpacity key={p.id}
                  style={[styles.chip, form.policyId === p.id && styles.chipActive]}
                  onPress={() => setForm(f => ({ ...f, policyId: p.id }))}>
                  <Text style={[styles.chipText, form.policyId === p.id && styles.chipTextActive]}>
                    {p.policyNumber}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>Claim Type *</Text>
            <View style={styles.chipRow}>
              {CLAIM_TYPES.map(t => (
                <TouchableOpacity key={t}
                  style={[styles.chip, form.claimType === t && styles.chipActive]}
                  onPress={() => setForm(f => ({ ...f, claimType: t }))}>
                  <Text style={[styles.chipText, form.claimType === t && styles.chipTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {(form.claimType === "death" || form.claimType === "funeral") && (
              <>
                <Text style={styles.label}>Deceased Name</Text>
                <TextInput style={styles.input} value={form.deceasedName}
                  onChangeText={v => setForm(f => ({ ...f, deceasedName: v }))} autoCapitalize="words" />

                <Text style={styles.label}>Relationship to Insured</Text>
                <TextInput style={styles.input} value={form.deceasedRelationship}
                  onChangeText={v => setForm(f => ({ ...f, deceasedRelationship: v }))} />

                <Text style={styles.label}>Date of Death (YYYY-MM-DD)</Text>
                <TextInput style={styles.input} value={form.dateOfDeath}
                  onChangeText={v => setForm(f => ({ ...f, dateOfDeath: v }))}
                  placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} />

                <Text style={styles.label}>Cause of Death</Text>
                <TextInput style={[styles.input, { minHeight: 60 }]} value={form.causeOfDeath}
                  onChangeText={v => setForm(f => ({ ...f, causeOfDeath: v }))} multiline />
              </>
            )}

            <TouchableOpacity
              style={[styles.submitBtn, submitting && styles.submitDisabled]}
              onPress={handleSubmit} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Submit Claim</Text>}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

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
  claimNum: { fontSize: fontSize.md, fontWeight: "700", color: colors.primary },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: fontSize.xs, fontWeight: "700" },
  clientName: { fontSize: fontSize.md, fontWeight: "500", color: colors.text, marginBottom: spacing.xs },
  cardRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.xs },
  sub: { fontSize: fontSize.sm, color: colors.textSecondary },
  subVal: { color: colors.text, fontWeight: "600" },
  modal: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  modalTitle: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text },
  closeBtn: { fontSize: 20, color: colors.textSecondary, padding: spacing.sm },
  modalBody: { padding: spacing.md },
  label: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text, marginBottom: spacing.xs, marginTop: spacing.md },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 20,
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, marginRight: spacing.xs, marginBottom: spacing.xs,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.sm, color: colors.text },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  input: {
    backgroundColor: colors.surfaceAlt, borderRadius: 10, padding: spacing.md,
    fontSize: fontSize.md, color: colors.text, borderWidth: 1, borderColor: colors.border,
  },
  submitBtn: {
    backgroundColor: colors.primary, borderRadius: 12, padding: spacing.md,
    alignItems: "center", marginTop: spacing.xl, marginBottom: spacing.xl,
  },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: "#fff", fontSize: fontSize.md, fontWeight: "700" },
});
