import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  createLead, effectiveStage, getLeads, moveLeadStage, updateLead,
  PIPELINE_STAGES, type Lead, type StageKey,
} from "../../src/api/leads";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "2-digit" });
}

export default function LeadsScreen() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [stageFilter, setStageFilter] = useState<StageKey>("new");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Lead | null>(null);

  const load = useCallback(() => {
    getLeads().then(setLeads).catch(() => setLeads([]));
  }, []);

  useEffect(load, [load]);

  const counts = useMemo(() => {
    const c: Record<StageKey, number> = { new: 0, contacted: 0, qualified: 0, quoted: 0, converted: 0, lost: 0 };
    for (const l of leads ?? []) c[effectiveStage(l)]++;
    return c;
  }, [leads]);

  const filtered = useMemo(() => (leads ?? []).filter((l) => effectiveStage(l) === stageFilter), [leads, stageFilter]);

  if (leads === null) return <View style={styles.center}><ActivityIndicator /></View>;

  return (
    <View style={styles.screen}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stageBar} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {PIPELINE_STAGES.map((s) => (
          <Pressable
            key={s.key}
            style={[styles.stageChip, stageFilter === s.key && styles.stageChipActive]}
            onPress={() => setStageFilter(s.key)}
          >
            <Text style={[styles.stageChipText, stageFilter === s.key && styles.stageChipTextActive]}>
              {s.label} ({counts[s.key]})
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <FlatList
        style={styles.list}
        data={filtered}
        keyExtractor={(l) => l.id}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => setSelected(item)}>
            <Text style={styles.cardName}>{[item.firstName, item.lastName].filter(Boolean).join(" ") || "—"}</Text>
            {item.phone ? <Text style={styles.cardSub}>{item.phone}</Text> : null}
            {item.productInterest ? <Text style={styles.cardSub}>{item.productInterest}</Text> : null}
            <Text style={styles.cardDate}>{fmtDate(item.createdAt)}</Text>
          </Pressable>
        )}
        ListEmptyComponent={<View style={styles.center}><Text style={styles.hint}>No leads in this stage.</Text></View>}
        contentContainerStyle={{ padding: 16, flexGrow: 1 }}
      />

      <Pressable style={styles.fab} onPress={() => setCreating(true)}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      <Modal visible={creating} animationType="slide" onRequestClose={() => setCreating(false)}>
        <CreateLeadForm onDone={() => { setCreating(false); load(); }} onCancel={() => setCreating(false)} />
      </Modal>

      <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}>
        {selected && (
          <LeadDetail
            lead={selected}
            onClose={() => setSelected(null)}
            onChanged={(updated) => { setSelected(updated); load(); }}
          />
        )}
      </Modal>
    </View>
  );
}

function CreateLeadForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [productInterest, setProductInterest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!firstName.trim()) { setError("First name is required"); return; }
    setBusy(true);
    setError("");
    try {
      await createLead({ firstName, lastName, phone, productInterest });
      onDone();
    } catch (err: any) {
      setError(err?.message || "Could not create lead");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.formScreen}>
      <View style={styles.formHeader}>
        <Pressable onPress={onCancel}><Text style={styles.link}>Cancel</Text></Pressable>
        <Text style={styles.formTitle}>New Lead</Text>
        <Pressable onPress={submit} disabled={busy}>{busy ? <ActivityIndicator /> : <Text style={styles.linkBold}>Save</Text>}</Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Field label="First name" value={firstName} onChangeText={setFirstName} />
      <Field label="Last name" value={lastName} onChangeText={setLastName} />
      <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label="Product interest" value={productInterest} onChangeText={setProductInterest} />
    </View>
  );
}

function LeadDetail({ lead, onClose, onChanged }: { lead: Lead; onClose: () => void; onChanged: (l: Lead) => void }) {
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [busy, setBusy] = useState(false);
  const current = effectiveStage(lead);

  const move = async (stage: StageKey) => {
    setBusy(true);
    try {
      const updated = await moveLeadStage(lead.id, stage);
      onChanged(updated);
    } finally {
      setBusy(false);
    }
  };

  const saveNotes = async () => {
    setBusy(true);
    try {
      const updated = await updateLead(lead.id, { notes });
      onChanged(updated);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.formScreen}>
      <View style={styles.formHeader}>
        <Pressable onPress={onClose}><Text style={styles.link}>Close</Text></Pressable>
        <Text style={styles.formTitle}>{[lead.firstName, lead.lastName].filter(Boolean).join(" ")}</Text>
        <View style={{ width: 44 }} />
      </View>

      {lead.phone ? <Text style={styles.detailLine}>{lead.phone}</Text> : null}
      {lead.email ? <Text style={styles.detailLine}>{lead.email}</Text> : null}
      {lead.productInterest ? <Text style={styles.detailLine}>{lead.productInterest}</Text> : null}

      <Text style={styles.sectionLabel}>Move to stage</Text>
      <View style={styles.stageMoveRow}>
        {PIPELINE_STAGES.map((s) => (
          <Pressable
            key={s.key}
            style={[styles.stageMoveChip, s.key === current && styles.stageMoveChipCurrent]}
            onPress={() => move(s.key)}
            disabled={busy || s.key === current}
          >
            <Text style={[styles.stageMoveChipText, s.key === current && styles.stageMoveChipTextCurrent]}>{s.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Notes</Text>
      <TextInput style={styles.textarea} value={notes} onChangeText={setNotes} multiline numberOfLines={4} />
      <Pressable style={styles.button} onPress={saveNotes} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save Notes</Text>}
      </Pressable>
    </View>
  );
}

function Field(props: { label: string } & React.ComponentProps<typeof TextInput>) {
  const { label, ...rest } = props;
  return (
    <View style={{ marginBottom: 4 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} {...rest} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F6F6" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  stageBar: { flexGrow: 0, paddingVertical: 12 },
  stageChip: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 100, paddingHorizontal: 14, paddingVertical: 8 },
  stageChipActive: { backgroundColor: "#0C6B62", borderColor: "#0C6B62" },
  stageChipText: { fontSize: 12, fontWeight: "600", color: "#5B6D6B" },
  stageChipTextActive: { color: "#FFFFFF" },
  list: { flex: 1 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E1", padding: 14, marginBottom: 8 },
  cardName: { fontSize: 15, fontWeight: "700", color: "#14201F" },
  cardSub: { fontSize: 12, color: "#5B6D6B", marginTop: 2 },
  cardDate: { fontSize: 11, color: "#8A9997", marginTop: 6 },
  hint: { fontSize: 13, color: "#8A9997" },
  fab: { position: "absolute", right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: "#0C6B62", alignItems: "center", justifyContent: "center", elevation: 4 },
  fabText: { color: "#FFFFFF", fontSize: 28, lineHeight: 30, fontWeight: "300" },
  formScreen: { flex: 1, backgroundColor: "#F4F6F6", padding: 20, paddingTop: 60 },
  formHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  formTitle: { fontSize: 16, fontWeight: "700", color: "#14201F" },
  link: { color: "#5B6D6B", fontSize: 15 },
  linkBold: { color: "#0C6B62", fontSize: 15, fontWeight: "700" },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: "#5B6D6B", marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, backgroundColor: "#FFFFFF" },
  textarea: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 8, padding: 12, fontSize: 14, backgroundColor: "#FFFFFF", minHeight: 90, textAlignVertical: "top" },
  button: { backgroundColor: "#0C6B62", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginTop: 16 },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  error: { color: "#A33B3B", backgroundColor: "#F8E9E9", padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13, textAlign: "center" },
  detailLine: { fontSize: 14, color: "#5B6D6B", marginBottom: 4 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: "#8A9997", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 20, marginBottom: 10 },
  stageMoveRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stageMoveChip: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 100, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: "#FFFFFF" },
  stageMoveChipCurrent: { backgroundColor: "#E5EBEA", borderColor: "#E5EBEA" },
  stageMoveChipText: { fontSize: 12, fontWeight: "600", color: "#0C6B62" },
  stageMoveChipTextCurrent: { color: "#8A9997" },
});
