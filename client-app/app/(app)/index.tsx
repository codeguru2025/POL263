import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "../../src/context/AuthContext";
import {
  getMyPolicies, getPolicyMembers, getBeneficiary, setBeneficiary, removeBeneficiary,
  type ClientPolicy, type PolicyMember, type Beneficiary,
} from "../../src/api/policies";

const STATUS_COLORS: Record<string, [string, string]> = {
  active: ["#2E7D4F", "#E5F3EA"],
  grace: ["#A8660A", "#FBF0DE"],
  lapsed: ["#A33B3B", "#F8E9E9"],
  cancelled: ["#5B6D6B", "#EDF1F0"],
};

function StatusPill({ status }: { status: string }) {
  const [color, bg] = STATUS_COLORS[status] ?? ["#5B6D6B", "#EDF1F0"];
  return <View style={[styles.pill, { backgroundColor: bg }]}><Text style={[styles.pillText, { color }]}>{status}</Text></View>;
}

export default function HomeScreen() {
  const { client } = useAuth();
  const [policies, setPolicies] = useState<ClientPolicy[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<ClientPolicy | null>(null);

  const load = useCallback(() => {
    getMyPolicies().then(setPolicies).catch(() => setPolicies([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await getMyPolicies().then(setPolicies).catch(() => {});
    setRefreshing(false);
  };

  return (
    <View style={styles.screen}>
      {policies === null ? (
        <View style={styles.center}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={policies}
          keyExtractor={(p) => p.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListHeaderComponent={<Text style={styles.greeting}>Hi, {client?.firstName}</Text>}
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => setSelected(item)}>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle}>{item.policyNumber}</Text>
                <StatusPill status={item.status} />
              </View>
              <Text style={styles.cardSub}>{item.currency} {item.premiumAmount} / {item.paymentSchedule}</Text>
              <View style={styles.balanceRow}>
                <Text style={Number(item.balance) < 0 ? styles.balanceOwing : styles.balanceOk}>
                  {Number(item.balance) < 0 ? `${item.currency} ${item.outstanding} outstanding` : "Up to date"}
                </Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={<View style={styles.center}><Text style={styles.hint}>No policies found on your account.</Text></View>}
          contentContainerStyle={{ padding: 16, flexGrow: 1 }}
        />
      )}

      <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}>
        {selected && <PolicyDetail policy={selected} onClose={() => setSelected(null)} />}
      </Modal>
    </View>
  );
}

function PolicyDetail({ policy, onClose }: { policy: ClientPolicy; onClose: () => void }) {
  const [members, setMembers] = useState<PolicyMember[] | null>(null);
  const [beneficiary, setBeneficiaryState] = useState<Beneficiary | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    getPolicyMembers(policy.id).then(setMembers).catch(() => setMembers([]));
    getBeneficiary(policy.id).then(setBeneficiaryState).catch(() => setBeneficiaryState(null));
  }, [policy.id]);

  return (
    <View style={styles.formScreen}>
      <View style={styles.formHeader}>
        <Pressable onPress={onClose}><Text style={styles.link}>Close</Text></Pressable>
        <Text style={styles.formTitle}>{policy.policyNumber}</Text>
        <View style={{ width: 44 }} />
      </View>
      <ScrollView>
        <View style={styles.summaryCard}>
          <DetailRow label="Status" value={policy.status} />
          <DetailRow label="Premium" value={`${policy.currency} ${policy.premiumAmount} / ${policy.paymentSchedule}`} />
          <DetailRow label="Total paid" value={`${policy.currency} ${policy.totalPaid}`} />
          <DetailRow label="Balance" value={`${policy.currency} ${policy.balance}`} />
          {Number(policy.outstanding) > 0 && <DetailRow label="Outstanding" value={`${policy.currency} ${policy.outstanding}`} />}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>Members</Text>
          {members === null ? <ActivityIndicator /> : members.length === 0 ? (
            <Text style={styles.hint}>No members on this policy.</Text>
          ) : members.map((m) => (
            <View key={m.id} style={styles.memberRow}>
              <Text style={styles.memberText}>{m.firstName} {m.lastName}</Text>
              <Text style={styles.cardSub}>{m.relationship}</Text>
            </View>
          ))}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>Beneficiary</Text>
          {beneficiary === undefined ? <ActivityIndicator /> : editing ? (
            <BeneficiaryForm
              policyId={policy.id}
              initial={beneficiary}
              onSaved={(b) => { setBeneficiaryState(b); setEditing(false); }}
              onCancel={() => setEditing(false)}
            />
          ) : beneficiary ? (
            <>
              <Text style={styles.memberText}>{beneficiary.firstName} {beneficiary.lastName}</Text>
              <Text style={styles.cardSub}>{beneficiary.relationship || "—"}</Text>
              <Pressable style={styles.smallButton} onPress={() => setEditing(true)}>
                <Text style={styles.smallButtonText}>Edit</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.hint}>No beneficiary set for this policy.</Text>
              <Pressable style={styles.smallButton} onPress={() => setEditing(true)}>
                <Text style={styles.smallButtonText}>Set beneficiary</Text>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function BeneficiaryForm({ policyId, initial, onSaved, onCancel }: {
  policyId: string; initial: Beneficiary | null; onSaved: (b: Beneficiary) => void; onCancel: () => void;
}) {
  const [firstName, setFirstName] = useState(initial?.firstName ?? "");
  const [lastName, setLastName] = useState(initial?.lastName ?? "");
  const [relationship, setRelationship] = useState(initial?.relationship ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!firstName.trim() || !lastName.trim()) { setError("First and last name are required"); return; }
    setSaving(true);
    setError("");
    try {
      await setBeneficiary(policyId, { firstName: firstName.trim(), lastName: lastName.trim(), relationship: relationship.trim() || undefined, phone: phone.trim() || undefined });
      onSaved({ firstName: firstName.trim(), lastName: lastName.trim(), relationship: relationship.trim() || null, phone: phone.trim() || null, nationalId: initial?.nationalId ?? null, dependentId: null });
    } catch (err: any) {
      setError(err?.message || "Could not save beneficiary");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Field label="First name" value={firstName} onChangeText={setFirstName} />
      <Field label="Last name" value={lastName} onChangeText={setLastName} />
      <Field label="Relationship" value={relationship} onChangeText={setRelationship} />
      <Field label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <View style={styles.buttonRow}>
        <Pressable style={[styles.smallButton, styles.outlineButton]} onPress={onCancel} disabled={saving}>
          <Text style={styles.outlineButtonText}>Cancel</Text>
        </Pressable>
        <Pressable style={styles.smallButton} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.smallButtonText}>Save</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
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
  greeting: { fontSize: 20, fontWeight: "700", color: "#14201F", marginBottom: 16 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E1", padding: 14, marginBottom: 8 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#14201F" },
  cardSub: { fontSize: 12, color: "#5B6D6B", marginTop: 2 },
  balanceRow: { marginTop: 8 },
  balanceOk: { fontSize: 12, color: "#2E7D4F", fontWeight: "600" },
  balanceOwing: { fontSize: 12, color: "#A33B3B", fontWeight: "600" },
  hint: { fontSize: 13, color: "#8A9997" },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100 },
  pillText: { fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
  formScreen: { flex: 1, backgroundColor: "#F4F6F6", padding: 20, paddingTop: 60 },
  formHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  formTitle: { fontSize: 16, fontWeight: "700", color: "#14201F" },
  link: { color: "#5B6D6B", fontSize: 15 },
  summaryCard: { backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E1", padding: 14, marginBottom: 12 },
  sectionCard: { backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E1", padding: 14, marginBottom: 12 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: "#8A9997", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  detailRow: { marginBottom: 10 },
  detailLabel: { fontSize: 11, fontWeight: "700", color: "#8A9997", textTransform: "uppercase", letterSpacing: 0.5 },
  detailValue: { fontSize: 14, color: "#14201F", marginTop: 2, textTransform: "capitalize" },
  memberRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#EDF1F0" },
  memberText: { fontSize: 13, color: "#14201F", fontWeight: "600" },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: "#5B6D6B", marginTop: 8, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, backgroundColor: "#FFFFFF" },
  error: { color: "#A33B3B", backgroundColor: "#F8E9E9", padding: 8, borderRadius: 8, marginBottom: 8, fontSize: 12, textAlign: "center" },
  buttonRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  smallButton: { backgroundColor: "#0C6B62", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center", flex: 1, marginTop: 8 },
  smallButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  outlineButton: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#0C6B62" },
  outlineButtonText: { color: "#0C6B62", fontSize: 13, fontWeight: "700" },
});
