import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, RefreshControl, Modal, ScrollView, Alert,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getDb } from "../db/schema";
import { useNetwork } from "../context/NetworkContext";
import { apiPost, apiPatch } from "../api";
import { fullSync, refreshCache } from "../sync/engine";
import { colors, spacing, fontSize } from "../theme";

interface Lead {
  id: string;
  clientId?: string | null;
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  source?: string;
  stage: string;
  notes?: string;
  createdAt?: string;
}

// Server-canonical stage pipeline
const STAGES = [
  "lead", "captured", "contacted", "quote_generated",
  "application_started", "submitted", "approved", "agreed_to_pay", "activated", "lost",
];

const STAGE_LABELS: Record<string, string> = {
  lead: "Lead",
  captured: "Captured",
  contacted: "Contacted",
  quote_generated: "Quoted",
  application_started: "Application",
  submitted: "Submitted",
  approved: "Approved",
  agreed_to_pay: "Agreed",
  activated: "Activated",
  lost: "Lost",
};

const SOURCES = [
  { value: "walk_in", label: "Walk-in" },
  { value: "agent_link", label: "Agent Link" },
  { value: "campaign", label: "Campaign" },
  { value: "website", label: "Website" },
];

function nextStage(current: string): string | null {
  const idx = STAGES.indexOf(current);
  if (idx < 0 || idx >= STAGES.length - 2) return null; // can't advance from lost or activated
  return STAGES[idx + 1]!;
}

export default function LeadsScreen() {
  const { isOnline } = useNetwork();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", email: "", source: "walk_in", notes: "" });
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [advancing, setAdvancing] = useState(false);

  const load = useCallback(async () => {
    const db = await getDb();
    const cached = await db.getAllAsync<{ id: string; data: string }>(
      "SELECT * FROM cache_my_leads ORDER BY updated_at DESC"
    );
    setLeads(cached.map(c => {
      const d = JSON.parse(c.data);
      return {
        id: c.id,
        clientId: d.clientId || null,
        firstName: d.firstName || "",
        lastName: d.lastName || "",
        phone: d.phone,
        email: d.email,
        source: d.source,
        stage: d.stage || "lead",
        notes: d.notes,
        createdAt: d.createdAt,
      };
    }));
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (isOnline) { try { await fullSync(); } catch {} }
    await load();
    setRefreshing(false);
  }, [isOnline, load]);

  const handleCreate = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      Alert.alert("Error", "First name and last name required");
      return;
    }
    if (!isOnline) {
      Alert.alert("Offline", "Lead creation requires an internet connection.");
      return;
    }
    setCreating(true);
    try {
      await apiPost("/api/leads", {
        firstName: form.firstName.trim().toUpperCase(),
        lastName: form.lastName.trim().toUpperCase(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        source: form.source || "walk_in",
        notes: form.notes.trim() || undefined,
        stage: "lead",
      });
      setForm({ firstName: "", lastName: "", phone: "", email: "", source: "walk_in", notes: "" });
      setShowCreate(false);
      await refreshCache("leads");
      await load();
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleAdvanceStage = async (lead: Lead) => {
    const next = nextStage(lead.stage);
    if (!next) { Alert.alert("Info", "Lead is already at the final stage."); return; }
    if (!isOnline) { Alert.alert("Offline", "Requires internet connection."); return; }
    setAdvancing(true);
    try {
      await apiPatch(`/api/leads/${lead.id}`, { stage: next });
      await refreshCache("leads");
      await load();
      setSelectedLead(prev => prev?.id === lead.id ? { ...prev, stage: next } : prev);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setAdvancing(false);
    }
  };

  const handleMarkLost = async (lead: Lead) => {
    if (!isOnline) { Alert.alert("Offline", "Requires internet connection."); return; }
    Alert.alert("Mark Lost", "Mark this lead as lost?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Mark Lost", style: "destructive",
        onPress: async () => {
          setAdvancing(true);
          try {
            await apiPatch(`/api/leads/${lead.id}`, { stage: "lost" });
            await refreshCache("leads");
            await load();
            setSelectedLead(prev => prev?.id === lead.id ? { ...prev, stage: "lost" } : prev);
          } catch (e: any) {
            Alert.alert("Error", e.message);
          } finally {
            setAdvancing(false);
          }
        },
      },
    ]);
  };

  const stageColor = (stage: string) => {
    if (stage === "activated") return colors.success;
    if (stage === "lost") return colors.danger;
    if (stage === "approved" || stage === "agreed_to_pay") return "#8b5cf6";
    if (stage === "quote_generated" || stage === "application_started" || stage === "submitted") return "#3b82f6";
    if (stage === "contacted" || stage === "captured") return colors.warning;
    return colors.textMuted;
  };

  const filtered = (stageFilter ? leads.filter(l => l.stage === stageFilter) : leads)
    .filter(l => !search || `${l.firstName} ${l.lastName} ${l.phone || ""}`.toLowerCase().includes(search.toLowerCase()));

  const canIssuePolicyFromLead = (lead: Lead) =>
    (lead.stage === "approved" || lead.stage === "agreed_to_pay") && !!lead.clientId;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TextInput
          style={styles.search}
          placeholder="Search leads…"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
        <TouchableOpacity style={styles.addButton} onPress={() => setShowCreate(true)}>
          <Text style={styles.addButtonText}>+ New</Text>
        </TouchableOpacity>
      </View>

      {/* Stage filter pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pipeline} contentContainerStyle={{ paddingHorizontal: spacing.md }}>
        <TouchableOpacity
          style={[styles.pipeChip, !stageFilter && styles.pipeChipActive]}
          onPress={() => setStageFilter("")}
        >
          <Text style={[styles.pipeLabel, !stageFilter && { color: "#fff" }]}>All ({leads.length})</Text>
        </TouchableOpacity>
        {STAGES.filter(s => leads.some(l => l.stage === s)).map(s => {
          const count = leads.filter(l => l.stage === s).length;
          const active = stageFilter === s;
          return (
            <TouchableOpacity
              key={s}
              style={[styles.pipeChip, { borderColor: stageColor(s) }, active && { backgroundColor: stageColor(s) }]}
              onPress={() => setStageFilter(active ? "" : s)}
            >
              <Text style={[styles.pipeCount, { color: active ? "#fff" : stageColor(s) }]}>{count}</Text>
              <Text style={[styles.pipeLabel, active && { color: "#fff" }]}>{STAGE_LABELS[s] || s}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : { paddingBottom: 24 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No leads yet</Text>
            <Text style={styles.emptySubtext}>Create quotations to start your pipeline</Text>
          </View>
        }
        renderItem={({ item }) => {
          const next = nextStage(item.stage);
          const showAdvance = next && item.stage !== "lost" && item.stage !== "activated";
          return (
            <TouchableOpacity style={styles.card} onPress={() => setSelectedLead(item)} activeOpacity={0.75}>
              <View style={styles.cardTop}>
                <Text style={styles.name}>{item.firstName} {item.lastName}</Text>
                <View style={[styles.stageBadge, { backgroundColor: stageColor(item.stage) + "22" }]}>
                  <Text style={[styles.stageText, { color: stageColor(item.stage) }]}>
                    {STAGE_LABELS[item.stage] || item.stage}
                  </Text>
                </View>
              </View>
              {item.phone && <Text style={styles.detail}>📞 {item.phone}</Text>}
              {item.email && <Text style={styles.detail}>✉️ {item.email}</Text>}
              <View style={styles.cardFooter}>
                {item.source && <Text style={styles.sourcePill}>{SOURCES.find(s => s.value === item.source)?.label || item.source}</Text>}
                {showAdvance && isOnline && (
                  <TouchableOpacity
                    style={[styles.advanceChip, { borderColor: stageColor(next!) }]}
                    onPress={() => handleAdvanceStage(item)}
                    disabled={advancing}
                  >
                    <Text style={[styles.advanceChipText, { color: stageColor(next!) }]} numberOfLines={1}>
                      → {STAGE_LABELS[next!] || next}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          );
        }}
      />

      {/* ── Lead Detail Modal ── */}
      {selectedLead && (
        <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelectedLead(null)}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setSelectedLead(null)}>
                <Text style={styles.cancelText}>← Back</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle} numberOfLines={1}>{selectedLead.firstName} {selectedLead.lastName}</Text>
              <View style={{ width: 60 }} />
            </View>
            <ScrollView style={styles.modalBody}>
              {/* Stage badge */}
              <View style={[styles.stageBanner, { backgroundColor: stageColor(selectedLead.stage) + "18", borderColor: stageColor(selectedLead.stage) }]}>
                <Text style={[styles.stageBannerText, { color: stageColor(selectedLead.stage) }]}>
                  Pipeline Stage: {STAGE_LABELS[selectedLead.stage] || selectedLead.stage}
                </Text>
              </View>

              {/* Info */}
              {!!selectedLead.phone && <Text style={styles.detailRow}>📞 {selectedLead.phone}</Text>}
              {!!selectedLead.email && <Text style={styles.detailRow}>✉️ {selectedLead.email}</Text>}
              {!!selectedLead.source && <Text style={styles.detailRow}>🎯 Source: {SOURCES.find(s => s.value === selectedLead.source)?.label || selectedLead.source}</Text>}
              {!!selectedLead.notes && (
                <View style={styles.notesBox}>
                  <Text style={styles.notesBoxText}>{selectedLead.notes}</Text>
                </View>
              )}

              {/* Actions */}
              <View style={styles.actionsSection}>
                {/* Advance stage */}
                {nextStage(selectedLead.stage) && selectedLead.stage !== "lost" && (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionBtnPrimary, advancing && { opacity: 0.6 }]}
                    onPress={() => handleAdvanceStage(selectedLead)}
                    disabled={advancing}
                  >
                    {advancing
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={styles.actionBtnText}>➡️ Advance to “{STAGE_LABELS[nextStage(selectedLead.stage)!] || nextStage(selectedLead.stage)}”</Text>}
                  </TouchableOpacity>
                )}

                {/* Issue Policy — visible when approved/agreed_to_pay AND clientId exists */}
                {canIssuePolicyFromLead(selectedLead) && (
                  <View style={[styles.actionBtn, { backgroundColor: "#f0fdf4", borderColor: colors.success, borderWidth: 1 }]}>
                    <Text style={[styles.actionBtnText, { color: colors.success }]}>
                      📄 Issue Policy available — go to Policies → Issue
                    </Text>
                  </View>
                )}

                {/* Mark Lost */}
                {selectedLead.stage !== "lost" && selectedLead.stage !== "activated" && (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionBtnDanger, advancing && { opacity: 0.6 }]}
                    onPress={() => handleMarkLost(selectedLead)}
                    disabled={advancing}
                  >
                    <Text style={[styles.actionBtnText, { color: colors.danger }]}>❌ Mark as Lost</Text>
                  </TouchableOpacity>
                )}
              </View>
            </ScrollView>
          </View>
        </Modal>
      )}

      {/* ── Create Lead Modal ── */}
      <Modal visible={showCreate} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <SafeAreaView style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => { setShowCreate(false); setForm({ firstName: "", lastName: "", phone: "", email: "", source: "walk_in", notes: "" }); }}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>New Lead</Text>
              <TouchableOpacity onPress={handleCreate} disabled={creating}>
                {creating
                  ? <ActivityIndicator size="small" color={colors.accent} />
                  : <Text style={styles.saveText}>Save</Text>}
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>First Name *</Text>
              <TextInput style={styles.input} value={form.firstName} onChangeText={v => setForm(f => ({ ...f, firstName: v }))} autoCapitalize="characters" />
              <Text style={styles.label}>Last Name *</Text>
              <TextInput style={styles.input} value={form.lastName} onChangeText={v => setForm(f => ({ ...f, lastName: v }))} autoCapitalize="characters" />
              <Text style={styles.label}>Phone</Text>
              <TextInput style={styles.input} value={form.phone} onChangeText={v => setForm(f => ({ ...f, phone: v }))} keyboardType="phone-pad" />
              <Text style={styles.label}>Email</Text>
              <TextInput style={styles.input} value={form.email} onChangeText={v => setForm(f => ({ ...f, email: v }))} keyboardType="email-address" autoCapitalize="none" />
              <Text style={styles.label}>Source</Text>
              <View style={styles.chipRow}>
                {SOURCES.map(s => (
                  <TouchableOpacity
                    key={s.value}
                    style={[styles.chip, form.source === s.value && styles.chipSelected]}
                    onPress={() => setForm(f => ({ ...f, source: s.value }))}
                  >
                    <Text style={[styles.chipText, form.source === s.value && styles.chipTextSelected]}>{s.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>Notes</Text>
              <TextInput style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]} value={form.notes} onChangeText={v => setForm(f => ({ ...f, notes: v }))} multiline />
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
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
    backgroundColor: colors.primary, borderRadius: 10,
    paddingHorizontal: spacing.md, justifyContent: "center",
  },
  addButtonText: { color: "#fff", fontWeight: "700", fontSize: fontSize.sm },
  pipeline: { marginBottom: spacing.sm, maxHeight: 60 },
  pipeChip: {
    borderWidth: 1.5, borderRadius: 8, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    marginRight: spacing.sm, alignItems: "center", backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  pipeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pipeCount: { fontSize: fontSize.md, fontWeight: "700" },
  pipeLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  emptyContainer: { flex: 1, justifyContent: "center" },
  empty: { alignItems: "center", padding: spacing.xl },
  emptyText: { fontSize: fontSize.lg, fontWeight: "600", color: colors.textSecondary },
  emptySubtext: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.xs },
  card: {
    backgroundColor: colors.surface, marginHorizontal: spacing.md, marginBottom: spacing.sm,
    borderRadius: 10, padding: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { fontSize: fontSize.md, fontWeight: "600", color: colors.text, flex: 1 },
  stageBadge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 6, marginLeft: spacing.sm },
  stageText: { fontSize: fontSize.xs, fontWeight: "700" },
  detail: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  cardFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs },
  sourcePill: { fontSize: fontSize.xs, color: colors.textMuted, fontStyle: "italic", flex: 1 },
  advanceChip: {
    borderWidth: 1.5, borderRadius: 16, paddingHorizontal: spacing.sm, paddingVertical: 4,
    backgroundColor: colors.surface, maxWidth: 160,
  },
  advanceChipText: { fontSize: fontSize.xs, fontWeight: "700" },
  // Detail modal
  modalContainer: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  modalTitle: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text, flex: 1, textAlign: "center" },
  cancelText: { fontSize: fontSize.md, color: colors.danger },
  saveText: { fontSize: fontSize.md, color: colors.accent, fontWeight: "700" },
  modalBody: { padding: spacing.md },
  stageBanner: {
    borderRadius: 10, borderWidth: 1.5, padding: spacing.md, marginBottom: spacing.md, alignItems: "center",
  },
  stageBannerText: { fontSize: fontSize.md, fontWeight: "700" },
  detailRow: { fontSize: fontSize.md, color: colors.text, marginBottom: spacing.sm },
  notesBox: {
    backgroundColor: colors.surfaceAlt, borderRadius: 8, padding: spacing.md,
    marginVertical: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  notesBoxText: { fontSize: fontSize.sm, color: colors.textSecondary, fontStyle: "italic" },
  actionsSection: { marginTop: spacing.lg, gap: spacing.sm },
  actionBtn: {
    borderRadius: 10, padding: spacing.md, alignItems: "center",
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  actionBtnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  actionBtnDanger: { backgroundColor: "#fff1f2", borderColor: "#fecdd3" },
  actionBtnText: { fontSize: fontSize.md, fontWeight: "700", color: "#fff" },
  // Create form
  label: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text, marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md,
    fontSize: fontSize.md, color: colors.text, borderWidth: 1, borderColor: colors.border,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 8,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text },
  chipTextSelected: { color: "#fff" },
});
