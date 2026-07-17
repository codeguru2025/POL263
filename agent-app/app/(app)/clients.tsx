import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { createClient, getClients, type Client } from "../../src/api/clients";

export default function ClientsScreen() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Client | null>(null);

  const load = useCallback((q?: string) => {
    getClients(q).then(setClients).catch(() => setClients([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Debounced server-side search, matching leads/attendance's "server does the filtering" pattern.
  useEffect(() => {
    const t = setTimeout(() => load(query.trim() || undefined), 350);
    return () => clearTimeout(t);
  }, [query, load]);

  return (
    <View style={styles.screen}>
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name, phone, ID…"
          value={query}
          onChangeText={setQuery}
        />
      </View>

      {clients === null ? (
        <View style={styles.center}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={clients}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => setSelected(item)}>
              <Text style={styles.cardName}>{[item.title, item.firstName, item.lastName].filter(Boolean).join(" ")}</Text>
              {item.phone ? <Text style={styles.cardSub}>{item.phone}</Text> : null}
              {!item.isEnrolled && <Text style={styles.notEnrolled}>Not enrolled</Text>}
            </Pressable>
          )}
          ListEmptyComponent={<View style={styles.center}><Text style={styles.hint}>No clients found.</Text></View>}
          contentContainerStyle={{ padding: 16, flexGrow: 1 }}
        />
      )}

      <Pressable style={styles.fab} onPress={() => setCreating(true)}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      <Modal visible={creating} animationType="slide" onRequestClose={() => setCreating(false)}>
        <CreateClientForm onDone={() => { setCreating(false); load(); }} onCancel={() => setCreating(false)} />
      </Modal>

      <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}>
        {selected && <ClientDetail client={selected} onClose={() => setSelected(null)} />}
      </Modal>
    </View>
  );
}

function CreateClientForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const submit = async () => {
    if (!firstName.trim() || !lastName.trim()) { setError("First and last name are required"); return; }
    setBusy(true);
    setError("");
    try {
      const result = await createClient({ firstName, lastName, nationalId, phone, email });
      if (result.kind === "existing") {
        setNotice(result.message);
        setTimeout(onDone, 1200);
      } else {
        onDone();
      }
    } catch (err: any) {
      setError(err?.message || "Could not create client");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.formScreen}>
      <View style={styles.formHeader}>
        <Pressable onPress={onCancel}><Text style={styles.link}>Cancel</Text></Pressable>
        <Text style={styles.formTitle}>New Client</Text>
        <Pressable onPress={submit} disabled={busy}>{busy ? <ActivityIndicator /> : <Text style={styles.linkBold}>Save</Text>}</Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Field label="First name" value={firstName} onChangeText={setFirstName} />
      <Field label="Last name" value={lastName} onChangeText={setLastName} />
      <Field label="National ID" value={nationalId} onChangeText={setNationalId} />
      <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
    </View>
  );
}

function ClientDetail({ client, onClose }: { client: Client; onClose: () => void }) {
  return (
    <View style={styles.formScreen}>
      <View style={styles.formHeader}>
        <Pressable onPress={onClose}><Text style={styles.link}>Close</Text></Pressable>
        <Text style={styles.formTitle}>{[client.title, client.firstName, client.lastName].filter(Boolean).join(" ")}</Text>
        <View style={{ width: 44 }} />
      </View>
      <DetailRow label="National ID" value={client.nationalId} />
      <DetailRow label="Phone" value={client.phone} />
      <DetailRow label="Email" value={client.email} />
      <DetailRow label="Date of birth" value={client.dateOfBirth} />
      <DetailRow label="Address" value={client.address} />
      <DetailRow label="Portal access" value={client.isEnrolled ? "Enrolled" : "Not yet enrolled"} />
      <Text style={styles.deferredNote}>
        Dependents, documents, and enrollment-code sharing aren't in this pass yet.
      </Text>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value || "—"}</Text>
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
  searchWrap: { padding: 16, paddingBottom: 8 },
  searchInput: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, backgroundColor: "#FFFFFF" },
  card: { backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E1", padding: 14, marginBottom: 8 },
  cardName: { fontSize: 15, fontWeight: "700", color: "#14201F" },
  cardSub: { fontSize: 12, color: "#5B6D6B", marginTop: 2 },
  notEnrolled: { fontSize: 11, color: "#A8660A", marginTop: 6, fontWeight: "600" },
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
  error: { color: "#A33B3B", backgroundColor: "#F8E9E9", padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13, textAlign: "center" },
  notice: { color: "#A8660A", backgroundColor: "#FBF0DE", padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13, textAlign: "center" },
  detailRow: { marginBottom: 14 },
  detailLabel: { fontSize: 11, fontWeight: "700", color: "#8A9997", textTransform: "uppercase", letterSpacing: 0.5 },
  detailValue: { fontSize: 15, color: "#14201F", marginTop: 2 },
  deferredNote: { fontSize: 12, color: "#8A9997", marginTop: 20, textAlign: "center", lineHeight: 18 },
});
