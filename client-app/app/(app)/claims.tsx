import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { getMyClaims, submitClaim, CLAIM_TYPES, type Claim, type ClaimType } from "../../src/api/claims";
import { getMyPolicies, type ClientPolicy } from "../../src/api/policies";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "2-digit" });
}

function label(v: string): string {
  const s = v.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const STATUS_COLORS: Record<string, [string, string]> = {
  submitted: ["#A8660A", "#FBF0DE"],
  approved: ["#2E7D4F", "#E5F3EA"],
  paid: ["#2E7D4F", "#E5F3EA"],
  rejected: ["#A33B3B", "#F8E9E9"],
};

function StatusPill({ status }: { status: string }) {
  const [color, bg] = STATUS_COLORS[status] ?? ["#5B6D6B", "#EDF1F0"];
  return <View style={[styles.pill, { backgroundColor: bg }]}><Text style={[styles.pillText, { color }]}>{label(status)}</Text></View>;
}

export default function ClaimsScreen() {
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => { getMyClaims().then(setClaims).catch(() => setClaims([])); }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <View style={styles.screen}>
      {claims === null ? (
        <View style={styles.center}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={claims}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{item.claimNumber}</Text>
                <Text style={styles.cardSub}>{label(item.claimType)} · {fmtDate(item.createdAt)}</Text>
              </View>
              <StatusPill status={item.status} />
            </View>
          )}
          ListEmptyComponent={<View style={styles.center}><Text style={styles.hint}>No claims submitted yet.</Text></View>}
          contentContainerStyle={{ padding: 16, flexGrow: 1 }}
        />
      )}

      <Pressable style={styles.fab} onPress={() => setCreating(true)}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      <Modal visible={creating} animationType="slide" onRequestClose={() => setCreating(false)}>
        <NewClaimForm onDone={() => { setCreating(false); load(); }} onCancel={() => setCreating(false)} />
      </Modal>
    </View>
  );
}

function NewClaimForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [policies, setPolicies] = useState<ClientPolicy[]>([]);
  const [policyId, setPolicyId] = useState("");
  const [claimType, setClaimType] = useState<ClaimType | null>(null);
  const [deceasedName, setDeceasedName] = useState("");
  const [deceasedRelationship, setDeceasedRelationship] = useState("");
  const [dateOfDeath, setDateOfDeath] = useState("");
  const [causeOfDeath, setCauseOfDeath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { getMyPolicies().then(setPolicies).catch(() => {}); }, []);

  const submit = async () => {
    if (!policyId || !claimType) { setError("Policy and claim type are required"); return; }
    setBusy(true);
    setError("");
    try {
      await submitClaim({
        policyId, claimType,
        deceasedName: deceasedName.trim() || undefined,
        deceasedRelationship: deceasedRelationship.trim() || undefined,
        dateOfDeath: dateOfDeath.trim() || undefined,
        causeOfDeath: causeOfDeath.trim() || undefined,
      });
      onDone();
    } catch (err: any) {
      setError(err?.message || "Could not submit claim");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.formScreen}>
      <View style={styles.formHeader}>
        <Pressable onPress={onCancel}><Text style={styles.link}>Cancel</Text></Pressable>
        <Text style={styles.formTitle}>New Claim</Text>
        <View style={{ width: 44 }} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.sectionLabel}>Policy</Text>
      {policies.map((p) => (
        <Pressable key={p.id} style={[styles.pickRow, policyId === p.id && styles.pickRowActive]} onPress={() => setPolicyId(p.id)}>
          <Text style={styles.pickRowTitle}>{p.policyNumber}</Text>
        </Pressable>
      ))}

      <Text style={styles.sectionLabel}>Claim type</Text>
      <View style={styles.chipRow}>
        {CLAIM_TYPES.map((t) => (
          <Pressable key={t} style={[styles.chip, claimType === t && styles.chipActive]} onPress={() => setClaimType(t)}>
            <Text style={[styles.chipText, claimType === t && styles.chipTextActive]}>{label(t)}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Deceased details (if applicable)</Text>
      <Field label="Deceased name" value={deceasedName} onChangeText={setDeceasedName} />
      <Field label="Relationship to policyholder" value={deceasedRelationship} onChangeText={setDeceasedRelationship} />
      <Field label="Date of death (YYYY-MM-DD)" value={dateOfDeath} onChangeText={setDateOfDeath} />
      <Field label="Cause of death" value={causeOfDeath} onChangeText={setCauseOfDeath} />

      <Pressable style={styles.button} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Submit claim</Text>}
      </Pressable>
    </View>
  );
}

function Field(props: { label: string } & React.ComponentProps<typeof TextInput>) {
  const { label: l, ...rest } = props;
  return (
    <View style={{ marginBottom: 4 }}>
      <Text style={styles.fieldLabel}>{l}</Text>
      <TextInput style={styles.input} {...rest} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F6F6" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E1", padding: 14, marginBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#14201F" },
  cardSub: { fontSize: 12, color: "#5B6D6B", marginTop: 2 },
  hint: { fontSize: 13, color: "#8A9997" },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100 },
  pillText: { fontSize: 11, fontWeight: "700" },
  fab: { position: "absolute", right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: "#0C6B62", alignItems: "center", justifyContent: "center", elevation: 4 },
  fabText: { color: "#FFFFFF", fontSize: 28, lineHeight: 30, fontWeight: "300" },
  formScreen: { flex: 1, backgroundColor: "#F4F6F6", padding: 20, paddingTop: 60 },
  formHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  formTitle: { fontSize: 16, fontWeight: "700", color: "#14201F" },
  link: { color: "#5B6D6B", fontSize: 15 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: "#8A9997", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 14, marginBottom: 10 },
  pickRow: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 8, padding: 12, marginBottom: 8, backgroundColor: "#FFFFFF" },
  pickRowActive: { borderColor: "#0C6B62", backgroundColor: "#E3EEEC" },
  pickRowTitle: { fontSize: 14, fontWeight: "600", color: "#14201F" },
  chipRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 100, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#FFFFFF" },
  chipActive: { backgroundColor: "#0C6B62", borderColor: "#0C6B62" },
  chipText: { fontSize: 13, fontWeight: "600", color: "#5B6D6B" },
  chipTextActive: { color: "#FFFFFF" },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: "#5B6D6B", marginTop: 10, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, backgroundColor: "#FFFFFF" },
  button: { backgroundColor: "#0C6B62", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginTop: 20 },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  error: { color: "#A33B3B", backgroundColor: "#F8E9E9", padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13, textAlign: "center" },
});
