import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, RefreshControl, Modal, ScrollView, Alert,
} from "react-native";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/schema";
import { useNetwork } from "../context/NetworkContext";
import { apiPost } from "../api";
import { fullSync } from "../sync/engine";
import { colors, spacing, fontSize } from "../theme";

interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  stage: string;
  notes?: string;
  createdAt?: string;
}

const STAGES = ["new", "contacted", "quoted", "negotiating", "won", "lost"];

export default function LeadsScreen() {
  const { isOnline } = useNetwork();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", email: "", notes: "" });

  const load = useCallback(async () => {
    const db = await getDb();
    const cached = await db.getAllAsync<{ id: string; data: string }>(
      "SELECT * FROM cache_my_leads ORDER BY updated_at DESC"
    );
    setLeads(cached.map(c => {
      const d = JSON.parse(c.data);
      return {
        id: c.id,
        firstName: d.firstName || "",
        lastName: d.lastName || "",
        phone: d.phone,
        email: d.email,
        stage: d.stage || "new",
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
      Alert.alert("Offline", "Lead creation requires an internet connection. Leads are synced from the server.");
      return;
    }
    try {
      await apiPost("/api/leads", {
        firstName: form.firstName.trim().toUpperCase(),
        lastName: form.lastName.trim().toUpperCase(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        notes: form.notes.trim() || undefined,
        stage: "new",
      });
      setForm({ firstName: "", lastName: "", phone: "", email: "", notes: "" });
      setShowCreate(false);
      await fullSync();
      await load();
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  };

  const stageColor = (stage: string) => {
    if (stage === "won") return colors.success;
    if (stage === "lost") return colors.danger;
    if (stage === "quoted" || stage === "negotiating") return "#3b82f6";
    if (stage === "contacted") return colors.warning;
    return colors.textMuted;
  };

  const filtered = search
    ? leads.filter(l => `${l.firstName} ${l.lastName} ${l.phone || ""}`.toLowerCase().includes(search.toLowerCase()))
    : leads;

  return (
    <View style={styles.container}>
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

      {/* Pipeline summary */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pipeline}>
        {STAGES.map(s => {
          const count = leads.filter(l => l.stage === s).length;
          return (
            <View key={s} style={[styles.pipeChip, { borderColor: stageColor(s) }]}>
              <Text style={[styles.pipeCount, { color: stageColor(s) }]}>{count}</Text>
              <Text style={styles.pipeLabel}>{s}</Text>
            </View>
          );
        })}
      </ScrollView>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No leads yet</Text>
            <Text style={styles.emptySubtext}>Create quotations to start your pipeline</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.name}>{item.firstName} {item.lastName}</Text>
              <View style={[styles.stageBadge, { backgroundColor: stageColor(item.stage) + "20" }]}>
                <Text style={[styles.stageText, { color: stageColor(item.stage) }]}>{item.stage.toUpperCase()}</Text>
              </View>
            </View>
            {item.phone && <Text style={styles.detail}>📱 {item.phone}</Text>}
            {item.email && <Text style={styles.detail}>✉️ {item.email}</Text>}
            {item.notes && <Text style={styles.notes}>{item.notes}</Text>}
          </View>
        )}
      />

      <Modal visible={showCreate} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowCreate(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>New Lead</Text>
            <TouchableOpacity onPress={handleCreate}>
              <Text style={styles.saveText}>Save</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalBody}>
            <Text style={styles.label}>First Name *</Text>
            <TextInput style={styles.input} value={form.firstName} onChangeText={v => setForm(f => ({ ...f, firstName: v }))} autoCapitalize="characters" />
            <Text style={styles.label}>Last Name *</Text>
            <TextInput style={styles.input} value={form.lastName} onChangeText={v => setForm(f => ({ ...f, lastName: v }))} autoCapitalize="characters" />
            <Text style={styles.label}>Phone</Text>
            <TextInput style={styles.input} value={form.phone} onChangeText={v => setForm(f => ({ ...f, phone: v }))} keyboardType="phone-pad" />
            <Text style={styles.label}>Email</Text>
            <TextInput style={styles.input} value={form.email} onChangeText={v => setForm(f => ({ ...f, email: v }))} keyboardType="email-address" autoCapitalize="none" />
            <Text style={styles.label}>Notes</Text>
            <TextInput style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]} value={form.notes} onChangeText={v => setForm(f => ({ ...f, notes: v }))} multiline />
          </ScrollView>
        </View>
      </Modal>
    </View>
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
  pipeline: { paddingHorizontal: spacing.md, marginBottom: spacing.sm, maxHeight: 56 },
  pipeChip: {
    borderWidth: 1.5, borderRadius: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    marginRight: spacing.sm, alignItems: "center", backgroundColor: colors.surface,
  },
  pipeCount: { fontSize: fontSize.lg, fontWeight: "700" },
  pipeLabel: { fontSize: fontSize.xs, color: colors.textMuted, textTransform: "capitalize" },
  emptyContainer: { flex: 1, justifyContent: "center" },
  empty: { alignItems: "center", padding: spacing.xl },
  emptyText: { fontSize: fontSize.lg, fontWeight: "600", color: colors.textSecondary },
  emptySubtext: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.xs },
  card: {
    backgroundColor: colors.surface, marginHorizontal: spacing.md, marginBottom: spacing.sm,
    borderRadius: 10, padding: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { fontSize: fontSize.md, fontWeight: "600", color: colors.text },
  stageBadge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 6 },
  stageText: { fontSize: fontSize.xs, fontWeight: "700" },
  detail: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  notes: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.xs, fontStyle: "italic" },
  modalContainer: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  modalTitle: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text },
  cancelText: { fontSize: fontSize.md, color: colors.danger },
  saveText: { fontSize: fontSize.md, color: colors.accent, fontWeight: "700" },
  modalBody: { padding: spacing.md },
  label: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text, marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md,
    fontSize: fontSize.md, color: colors.text, borderWidth: 1, borderColor: colors.border,
  },
});
