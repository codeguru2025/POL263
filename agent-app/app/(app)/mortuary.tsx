import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useAuth } from "../../src/context/AuthContext";
import {
  getMortuaryIntakes, getBodyWash, saveBodyWash, getBelongings, addBelonging,
  getPostMortemMovements, recordPostMortemOut, recordPostMortemReturn,
  type MortuaryIntake, type BodyWashRequirement, type Belonging, type PostMortemMovement,
} from "../../src/api/mortuary";

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const STATUS_FILTERS = [
  { key: undefined, label: "All" },
  { key: "in_storage", label: "In storage" },
  { key: "dispatched", label: "Dispatched" },
] as const;

const STATUS_COLORS: Record<string, [string, string]> = {
  in_storage: ["#A8660A", "#FBF0DE"],
  dispatched: ["#2E7D4F", "#E5F3EA"],
  out_for_post_mortem: ["#A33B3B", "#F8E9E9"],
};

function StatusPill({ status }: { status: string }) {
  const [color, bg] = STATUS_COLORS[status] ?? ["#5B6D6B", "#EDF1F0"];
  return <View style={[styles.pill, { backgroundColor: bg }]}><Text style={[styles.pillText, { color }]}>{status.replace(/_/g, " ")}</Text></View>;
}

export default function MortuaryScreen() {
  const { permissions } = useAuth();
  const canWrite = permissions.includes("write:funeral_ops");
  const [statusFilter, setStatusFilter] = useState<string | undefined>("in_storage");
  const [intakes, setIntakes] = useState<MortuaryIntake[] | null>(null);
  const [selected, setSelected] = useState<MortuaryIntake | null>(null);

  const load = useCallback(() => {
    getMortuaryIntakes(statusFilter).then(setIntakes).catch(() => setIntakes([]));
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={styles.screen}>
      <View style={styles.chipRow}>
        {STATUS_FILTERS.map((f) => (
          <Pressable key={f.label} style={[styles.chip, statusFilter === f.key && styles.chipActive]} onPress={() => setStatusFilter(f.key)}>
            <Text style={[styles.chipText, statusFilter === f.key && styles.chipTextActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      {intakes === null ? (
        <View style={styles.center}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={intakes}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => setSelected(item)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{item.deceasedName}</Text>
                <Text style={styles.cardSub}>{item.intakeNumber} · {item.serviceScope.replace(/_/g, " ")}</Text>
              </View>
              <StatusPill status={item.status} />
            </Pressable>
          )}
          ListEmptyComponent={<View style={styles.center}><Text style={styles.hint}>No intakes in this view.</Text></View>}
          contentContainerStyle={{ padding: 16, flexGrow: 1 }}
        />
      )}

      <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}>
        {selected && <IntakeDetail intake={selected} canWrite={canWrite} onClose={() => { setSelected(null); load(); }} />}
      </Modal>
    </View>
  );
}

function IntakeDetail({ intake, canWrite, onClose }: { intake: MortuaryIntake; canWrite: boolean; onClose: () => void }) {
  return (
    <View style={styles.formScreen}>
      <View style={styles.formHeader}>
        <Pressable onPress={onClose}><Text style={styles.link}>Close</Text></Pressable>
        <Text style={styles.formTitle}>{intake.deceasedName}</Text>
        <View style={{ width: 44 }} />
      </View>
      <ScrollView>
        <View style={styles.summaryCard}>
          <DetailRow label="Intake #" value={intake.intakeNumber} />
          <DetailRow label="Status" value={intake.status.replace(/_/g, " ")} />
          <DetailRow label="Service scope" value={intake.serviceScope.replace(/_/g, " ")} />
          <DetailRow label="Deceased" value={[intake.deceasedGender, intake.deceasedAge ? `${intake.deceasedAge}y` : null].filter(Boolean).join(", ") || "—"} />
          <DetailRow label="Removed from" value={intake.removalLocation || "—"} />
          <DetailRow label="Received" value={fmtDateTime(intake.receivedAt)} />
          {intake.partnerParlourId && <DetailRow label="Storage fee" value={(intake.storageFeeStatus || "unpaid").replace(/_/g, " ")} />}
        </View>

        <BodyWashSection intakeId={intake.id} canWrite={canWrite} />
        <BelongingsSection intakeId={intake.id} canWrite={canWrite} />
        <PostMortemSection intakeId={intake.id} canWrite={canWrite} />
      </ScrollView>
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

function BodyWashSection({ intakeId, canWrite }: { intakeId: string; canWrite: boolean }) {
  const [bw, setBw] = useState<BodyWashRequirement | null | undefined>(undefined);
  const [clothes, setClothes] = useState(false);
  const [blanket, setBlanket] = useState(false);
  const [wreath, setWreath] = useState(false);
  const [otherItems, setOtherItems] = useState("");
  const [washedByName, setWashedByName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getBodyWash(intakeId).then((r) => {
      setBw(r);
      if (r) {
        setClothes(r.clothesProvided); setBlanket(r.blanketProvided); setWreath(r.wreathProvided);
        setOtherItems(r.otherItems || ""); setWashedByName(r.washedByName || "");
      }
    }).catch(() => setBw(null));
  }, [intakeId]);

  const save = async (markCompleted: boolean) => {
    setSaving(true);
    setError("");
    try {
      const updated = await saveBodyWash(intakeId, { clothesProvided: clothes, blanketProvided: blanket, wreathProvided: wreath, otherItems, washedByName, markCompleted });
      setBw(updated);
    } catch (err: any) {
      setError(err?.message || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  if (bw === undefined) return <SectionShell title="Body wash"><ActivityIndicator /></SectionShell>;

  return (
    <SectionShell title="Body wash">
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {bw?.completedAt && <Text style={styles.completedNote}>Completed {fmtDateTime(bw.completedAt)}{bw.washedByName ? ` by ${bw.washedByName}` : ""}</Text>}
      <ToggleRow label="Clothes provided" value={clothes} onChange={setClothes} disabled={!canWrite} />
      <ToggleRow label="Blanket provided" value={blanket} onChange={setBlanket} disabled={!canWrite} />
      <ToggleRow label="Wreath provided" value={wreath} onChange={setWreath} disabled={!canWrite} />
      {canWrite && (
        <>
          <Field label="Other items" value={otherItems} onChangeText={setOtherItems} />
          <Field label="Washed by" value={washedByName} onChangeText={setWashedByName} />
          <View style={styles.buttonRow}>
            <Pressable style={[styles.smallButton, styles.outlineButton]} onPress={() => save(false)} disabled={saving}>
              <Text style={styles.outlineButtonText}>Save</Text>
            </Pressable>
            <Pressable style={styles.smallButton} onPress={() => save(true)} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.smallButtonText}>Mark completed</Text>}
            </Pressable>
          </View>
        </>
      )}
    </SectionShell>
  );
}

function ToggleRow({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: "#0C6B62" }} />
    </View>
  );
}

function BelongingsSection({ intakeId, canWrite }: { intakeId: string; canWrite: boolean }) {
  const [items, setItems] = useState<Belonging[] | null>(null);
  const [description, setDescription] = useState("");
  const [submittedBy, setSubmittedBy] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => { getBelongings(intakeId).then(setItems).catch(() => setItems([])); }, [intakeId]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!description.trim()) { setError("Item description is required"); return; }
    setSaving(true);
    setError("");
    try {
      await addBelonging(intakeId, description.trim(), 1, submittedBy.trim() || undefined);
      setDescription(""); setSubmittedBy("");
      load();
    } catch (err: any) {
      setError(err?.message || "Could not add item");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionShell title="Belongings">
      {items === null ? <ActivityIndicator /> : items.length === 0 ? (
        <Text style={styles.hint}>No belongings logged.</Text>
      ) : items.map((it) => (
        <View key={it.id} style={styles.belongingRow}>
          <Text style={styles.belongingText}>{it.itemDescription}{it.quantity > 1 ? ` ×${it.quantity}` : ""}</Text>
          {it.submittedByName ? <Text style={styles.cardSub}>from {it.submittedByName}</Text> : null}
        </View>
      ))}
      {canWrite && (
        <>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Field label="Item description" value={description} onChangeText={setDescription} />
          <Field label="Submitted by (optional)" value={submittedBy} onChangeText={setSubmittedBy} />
          <Pressable style={styles.smallButton} onPress={submit} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.smallButtonText}>Add item</Text>}
          </Pressable>
        </>
      )}
    </SectionShell>
  );
}

function PostMortemSection({ intakeId, canWrite }: { intakeId: string; canWrite: boolean }) {
  const [movements, setMovements] = useState<PostMortemMovement[] | null>(null);
  const [takenTo, setTakenTo] = useState("");
  const [authorizedBy, setAuthorizedBy] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => { getPostMortemMovements(intakeId).then(setMovements).catch(() => setMovements([])); }, [intakeId]);
  useEffect(() => { load(); }, [load]);

  const openMovement = movements?.find((m) => !m.returnedAt) ?? null;

  const sendOut = async () => {
    if (!takenTo.trim()) { setError("Destination is required"); return; }
    setSaving(true);
    setError("");
    try {
      await recordPostMortemOut(intakeId, takenTo.trim(), authorizedBy.trim() || undefined);
      setTakenTo(""); setAuthorizedBy("");
      load();
    } catch (err: any) {
      setError(err?.message || "Could not record");
    } finally {
      setSaving(false);
    }
  };

  const recordReturn = async (movementId: string) => {
    setSaving(true);
    setError("");
    try {
      await recordPostMortemReturn(movementId);
      load();
    } catch (err: any) {
      setError(err?.message || "Could not record return");
    } finally {
      setSaving(false);
    }
  };

  if (movements === null) return <SectionShell title="Post-mortem"><ActivityIndicator /></SectionShell>;

  return (
    <SectionShell title="Post-mortem">
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {movements.filter((m) => m.returnedAt).map((m) => (
        <View key={m.id} style={styles.belongingRow}>
          <Text style={styles.belongingText}>{fmtDateTime(m.takenOutAt)} → {fmtDateTime(m.returnedAt)}</Text>
          <Text style={styles.cardSub}>{m.takenToLocation || "—"}</Text>
        </View>
      ))}
      {openMovement ? (
        <View style={styles.outBanner}>
          <Text style={styles.outBannerText}>Out since {fmtDateTime(openMovement.takenOutAt)} · {openMovement.takenToLocation || "—"}</Text>
          {canWrite && (
            <Pressable style={styles.smallButton} onPress={() => recordReturn(openMovement.id)} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.smallButtonText}>Record return</Text>}
            </Pressable>
          )}
        </View>
      ) : canWrite ? (
        <>
          <Field label="Taken to" value={takenTo} onChangeText={setTakenTo} />
          <Field label="Authorized by (optional)" value={authorizedBy} onChangeText={setAuthorizedBy} />
          <Pressable style={styles.smallButton} onPress={sendOut} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.smallButtonText}>Send out for post-mortem</Text>}
          </Pressable>
        </>
      ) : (
        <Text style={styles.hint}>Not currently out for post-mortem.</Text>
      )}
    </SectionShell>
  );
}

function SectionShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {children}
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
  chipRow: { flexDirection: "row", gap: 8, padding: 16, paddingBottom: 8 },
  chip: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 100, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#FFFFFF" },
  chipActive: { backgroundColor: "#0C6B62", borderColor: "#0C6B62" },
  chipText: { fontSize: 13, fontWeight: "600", color: "#5B6D6B" },
  chipTextActive: { color: "#FFFFFF" },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E1", padding: 14, marginBottom: 8, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#14201F" },
  cardSub: { fontSize: 12, color: "#5B6D6B", marginTop: 2 },
  hint: { fontSize: 12, color: "#8A9997", marginTop: 4 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100 },
  pillText: { fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
  formScreen: { flex: 1, backgroundColor: "#F4F6F6", padding: 20, paddingTop: 60 },
  formHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  formTitle: { fontSize: 16, fontWeight: "700", color: "#14201F", flex: 1, textAlign: "center" },
  link: { color: "#5B6D6B", fontSize: 15 },
  summaryCard: { backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E1", padding: 14, marginBottom: 12 },
  detailRow: { marginBottom: 10 },
  detailLabel: { fontSize: 11, fontWeight: "700", color: "#8A9997", textTransform: "uppercase", letterSpacing: 0.5 },
  detailValue: { fontSize: 14, color: "#14201F", marginTop: 2, textTransform: "capitalize" },
  sectionCard: { backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E1", padding: 14, marginBottom: 12 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: "#8A9997", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: "#5B6D6B", marginTop: 8, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, backgroundColor: "#FFFFFF" },
  error: { color: "#A33B3B", backgroundColor: "#F8E9E9", padding: 8, borderRadius: 8, marginBottom: 8, fontSize: 12, textAlign: "center" },
  completedNote: { color: "#2E7D4F", fontSize: 12, marginBottom: 8, fontWeight: "600" },
  toggleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  toggleLabel: { fontSize: 13, color: "#14201F" },
  buttonRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  smallButton: { backgroundColor: "#0C6B62", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center", flex: 1, marginTop: 12 },
  smallButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  outlineButton: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#0C6B62" },
  outlineButtonText: { color: "#0C6B62", fontSize: 13, fontWeight: "700" },
  belongingRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#EDF1F0" },
  belongingText: { fontSize: 13, color: "#14201F", fontWeight: "600" },
  outBanner: { backgroundColor: "#FBF0DE", borderRadius: 8, padding: 12 },
  outBannerText: { color: "#A8660A", fontSize: 13, fontWeight: "600", marginBottom: 4 },
});
