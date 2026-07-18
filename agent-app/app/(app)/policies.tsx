import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { getPolicies, createPolicy, type Policy, type Beneficiary } from "../../src/api/policies";
import { getProducts, getProductVersions, getAddOns, type Product, type ProductVersion, type AddOn } from "../../src/api/products";
import { getClients, type Client } from "../../src/api/clients";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "2-digit" });
}

export default function PoliciesScreen() {
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const load = useCallback(() => {
    getPolicies().then(setPolicies).catch(() => setPolicies([]));
  }, []);

  useEffect(load, [load]);

  return (
    <View style={styles.screen}>
      {policies === null ? (
        <View style={styles.center}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={policies}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{item.policyNumber}</Text>
                <Text style={styles.cardSub}>{item.currency} {item.premiumAmount} / {item.paymentSchedule}</Text>
              </View>
              <StatusPill status={item.status} />
              <Text style={styles.cardDate}>{fmtDate(item.createdAt)}</Text>
            </View>
          )}
          ListEmptyComponent={<View style={styles.center}><Text style={styles.hint}>No policies yet.</Text></View>}
          contentContainerStyle={{ padding: 16, flexGrow: 1 }}
        />
      )}

      <Pressable style={styles.fab} onPress={() => setWizardOpen(true)}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      <Modal visible={wizardOpen} animationType="slide" onRequestClose={() => setWizardOpen(false)}>
        <CreatePolicyWizard onDone={() => { setWizardOpen(false); load(); }} onCancel={() => setWizardOpen(false)} />
      </Modal>
    </View>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    active: ["#2E7D4F", "#E5F3EA"], inactive: ["#8A9997", "#EDF1F0"],
    lapsed: ["#A8660A", "#FBF0DE"], cancelled: ["#A33B3B", "#F8E9E9"],
  };
  const [color, bg] = map[status] ?? map.inactive;
  return <View style={[styles.pill, { backgroundColor: bg }]}><Text style={[styles.pillText, { color }]}>{status}</Text></View>;
}

// ─── Wizard ─────────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3 | 4;

function CreatePolicyWizard({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [step, setStep] = useState<WizardStep>(1);
  const [products, setProducts] = useState<Product[]>([]);
  const [versions, setVersions] = useState<ProductVersion[]>([]);
  const [addOns, setAddOns] = useState<AddOn[]>([]);

  // Selections
  const [client, setClient] = useState<Client | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<"USD" | "ZAR" | "ZIG">("USD");
  const [schedule, setSchedule] = useState<"monthly" | "weekly" | "biweekly">("monthly");
  const [selectedAddOnIds, setSelectedAddOnIds] = useState<Set<string>>(new Set());
  const [beneficiary, setBeneficiary] = useState<Beneficiary>({ firstName: "", lastName: "", relationship: "", nationalId: "", phone: "" });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Policy | null>(null);

  useEffect(() => {
    Promise.all([getProducts(), getProductVersions(), getAddOns()])
      .then(([p, v, a]) => { setProducts(p); setVersions(v); setAddOns(a.filter((x) => x.isActive)); })
      .catch(() => {});
  }, []);

  const versionsForProduct = useMemo(() => versions.filter((v) => v.productId === productId), [versions, productId]);
  const selectedVersion = useMemo(() => versions.find((v) => v.id === versionId) ?? null, [versions, versionId]);

  const priceFor = (v: ProductVersion | null): string => {
    if (!v) return "—";
    const key = `premium${schedule[0].toUpperCase()}${schedule.slice(1)}${currency === "USD" ? "Usd" : "Zar"}` as keyof ProductVersion;
    // ZIG has no dedicated column on product_versions in this pass — falls back to USD pricing.
    const val = currency === "ZIG" ? v[`premium${schedule[0].toUpperCase()}${schedule.slice(1)}Usd` as keyof ProductVersion] : v[key];
    return val ? String(val) : "—";
  };

  const canNext =
    (step === 1 && !!client) ||
    (step === 2 && !!versionId) ||
    (step === 3 && beneficiary.firstName.trim() && beneficiary.lastName.trim() && beneficiary.relationship.trim());

  const submit = async () => {
    if (!client || !versionId) return;
    setBusy(true);
    setError("");
    try {
      const created = await createPolicy({
        clientId: client.id,
        productVersionId: versionId,
        currency,
        paymentSchedule: schedule,
        addOnIds: Array.from(selectedAddOnIds),
        beneficiary,
      });
      setResult(created);
    } catch (err: any) {
      setError(err?.message || "Could not create policy");
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <View style={styles.formScreen}>
        <View style={styles.center}>
          <Text style={styles.successTitle}>Policy issued</Text>
          <Text style={styles.successNumber}>{result.policyNumber}</Text>
          <Text style={styles.cardSub}>{result.currency} {result.premiumAmount} / {result.paymentSchedule}</Text>
          <Pressable style={[styles.button, { marginTop: 24 }]} onPress={onDone}>
            <Text style={styles.buttonText}>Done</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.formScreen}>
      <View style={styles.formHeader}>
        <Pressable onPress={step === 1 ? onCancel : () => setStep((s) => (s - 1) as WizardStep)}>
          <Text style={styles.link}>{step === 1 ? "Cancel" : "Back"}</Text>
        </Pressable>
        <Text style={styles.formTitle}>New Policy · Step {step}/4</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.stepDots}>
        {[1, 2, 3, 4].map((n) => <View key={n} style={[styles.dot, n === step && styles.dotActive, n < step && styles.dotDone]} />)}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <ScrollView style={{ flex: 1 }}>
        {step === 1 && <ClientStep selected={client} onSelect={setClient} />}
        {step === 2 && (
          <ProductStep
            products={products}
            versionsForProduct={versionsForProduct}
            productId={productId} setProductId={(id) => { setProductId(id); setVersionId(null); }}
            versionId={versionId} setVersionId={setVersionId}
            currency={currency} setCurrency={setCurrency}
            schedule={schedule} setSchedule={setSchedule}
            priceFor={priceFor}
          />
        )}
        {step === 3 && (
          <AddOnsBeneficiaryStep
            addOns={addOns} selectedAddOnIds={selectedAddOnIds} setSelectedAddOnIds={setSelectedAddOnIds}
            beneficiary={beneficiary} setBeneficiary={setBeneficiary}
          />
        )}
        {step === 4 && (
          <ReviewStep client={client} product={products.find((p) => p.id === productId) ?? null}
            version={selectedVersion} currency={currency} schedule={schedule}
            addOnCount={selectedAddOnIds.size} beneficiary={beneficiary} price={priceFor(selectedVersion)} />
        )}
      </ScrollView>

      <Pressable
        style={[styles.button, !(step === 4 || canNext) && styles.buttonDisabled]}
        onPress={step === 4 ? submit : () => setStep((s) => (s + 1) as WizardStep)}
        disabled={step === 4 ? busy : !canNext}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{step === 4 ? "Submit" : "Next"}</Text>}
      </Pressable>
    </View>
  );
}

function ClientStep({ selected, onSelect }: { selected: Client | null; onSelect: (c: Client) => void }) {
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<Client[]>([]);

  useEffect(() => {
    const t = setTimeout(() => { getClients(query.trim() || undefined).then(setClients).catch(() => {}); }, 350);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <View>
      <Text style={styles.sectionLabel}>Select client</Text>
      <TextInput style={styles.input} placeholder="Search clients…" value={query} onChangeText={setQuery} />
      {selected && (
        <View style={styles.selectedBanner}>
          <Text style={styles.selectedBannerText}>Selected: {selected.firstName} {selected.lastName}</Text>
        </View>
      )}
      {clients.map((c) => (
        <Pressable key={c.id} style={[styles.pickRow, selected?.id === c.id && styles.pickRowActive]} onPress={() => onSelect(c)}>
          <Text style={styles.pickRowTitle}>{c.firstName} {c.lastName}</Text>
          {c.phone ? <Text style={styles.cardSub}>{c.phone}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

function ProductStep(props: {
  products: Product[]; versionsForProduct: ProductVersion[];
  productId: string | null; setProductId: (id: string) => void;
  versionId: string | null; setVersionId: (id: string) => void;
  currency: string; setCurrency: (c: "USD" | "ZAR" | "ZIG") => void;
  schedule: string; setSchedule: (s: "monthly" | "weekly" | "biweekly") => void;
  priceFor: (v: ProductVersion | null) => string;
}) {
  const { products, versionsForProduct, productId, setProductId, versionId, setVersionId, currency, setCurrency, schedule, setSchedule, priceFor } = props;
  return (
    <View>
      <Text style={styles.sectionLabel}>Product</Text>
      {products.map((p) => (
        <Pressable key={p.id} style={[styles.pickRow, productId === p.id && styles.pickRowActive]} onPress={() => setProductId(p.id)}>
          <Text style={styles.pickRowTitle}>{p.name}</Text>
        </Pressable>
      ))}

      {productId && (
        <>
          <Text style={styles.sectionLabel}>Version</Text>
          {versionsForProduct.map((v) => (
            <Pressable key={v.id} style={[styles.pickRow, versionId === v.id && styles.pickRowActive]} onPress={() => setVersionId(v.id)}>
              <Text style={styles.pickRowTitle}>Version {v.version}</Text>
              <Text style={styles.cardSub}>{priceFor(v)} {currency} / {schedule}</Text>
            </Pressable>
          ))}
        </>
      )}

      <Text style={styles.sectionLabel}>Currency</Text>
      <View style={styles.chipRow}>
        {(["USD", "ZAR", "ZIG"] as const).map((c) => (
          <Pressable key={c} style={[styles.chip, currency === c && styles.chipActive]} onPress={() => setCurrency(c)}>
            <Text style={[styles.chipText, currency === c && styles.chipTextActive]}>{c}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Payment schedule</Text>
      <View style={styles.chipRow}>
        {(["monthly", "weekly", "biweekly"] as const).map((s) => (
          <Pressable key={s} style={[styles.chip, schedule === s && styles.chipActive]} onPress={() => setSchedule(s)}>
            <Text style={[styles.chipText, schedule === s && styles.chipTextActive]}>{s}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function AddOnsBeneficiaryStep({ addOns, selectedAddOnIds, setSelectedAddOnIds, beneficiary, setBeneficiary }: {
  addOns: AddOn[]; selectedAddOnIds: Set<string>; setSelectedAddOnIds: (s: Set<string>) => void;
  beneficiary: Beneficiary; setBeneficiary: (b: Beneficiary) => void;
}) {
  const toggle = (id: string) => {
    const next = new Set(selectedAddOnIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedAddOnIds(next);
  };

  return (
    <View>
      <Text style={styles.sectionLabel}>Add-ons (optional)</Text>
      {addOns.length === 0 ? <Text style={styles.hint}>No add-ons available.</Text> : addOns.map((a) => (
        <Pressable key={a.id} style={[styles.pickRow, selectedAddOnIds.has(a.id) && styles.pickRowActive]} onPress={() => toggle(a.id)}>
          <Text style={styles.pickRowTitle}>{a.name}</Text>
        </Pressable>
      ))}

      <Text style={styles.sectionLabel}>Beneficiary</Text>
      <Field label="First name" value={beneficiary.firstName} onChangeText={(v) => setBeneficiary({ ...beneficiary, firstName: v })} />
      <Field label="Last name" value={beneficiary.lastName} onChangeText={(v) => setBeneficiary({ ...beneficiary, lastName: v })} />
      <Field label="Relationship" value={beneficiary.relationship} onChangeText={(v) => setBeneficiary({ ...beneficiary, relationship: v })} />
      <Field label="National ID" value={beneficiary.nationalId} onChangeText={(v) => setBeneficiary({ ...beneficiary, nationalId: v })} />
      <Field label="Phone" value={beneficiary.phone} onChangeText={(v) => setBeneficiary({ ...beneficiary, phone: v })} keyboardType="phone-pad" />
    </View>
  );
}

function ReviewStep({ client, product, version, currency, schedule, addOnCount, beneficiary, price }: {
  client: Client | null; product: Product | null; version: ProductVersion | null;
  currency: string; schedule: string; addOnCount: number; beneficiary: Beneficiary; price: string;
}) {
  return (
    <View>
      <Text style={styles.sectionLabel}>Review</Text>
      <DetailRow label="Client" value={client ? `${client.firstName} ${client.lastName}` : "—"} />
      <DetailRow label="Product" value={product ? `${product.name}${version ? ` (v${version.version})` : ""}` : "—"} />
      <DetailRow label="Premium" value={`${price} ${currency} / ${schedule}`} />
      <DetailRow label="Add-ons" value={String(addOnCount)} />
      <DetailRow label="Beneficiary" value={`${beneficiary.firstName} ${beneficiary.lastName} (${beneficiary.relationship})`} />
      <Text style={styles.hint}>
        The premium shown is calculated from the product's base rate — the final amount is
        confirmed by the server on submit (age-band and add-on adjustments applied there).
      </Text>
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
  card: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E1", padding: 14, marginBottom: 8, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#14201F" },
  cardSub: { fontSize: 12, color: "#5B6D6B", marginTop: 2 },
  cardDate: { fontSize: 11, color: "#8A9997" },
  hint: { fontSize: 12, color: "#8A9997", marginTop: 8, lineHeight: 18 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100 },
  pillText: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  fab: { position: "absolute", right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: "#0C6B62", alignItems: "center", justifyContent: "center", elevation: 4 },
  fabText: { color: "#FFFFFF", fontSize: 28, lineHeight: 30, fontWeight: "300" },
  formScreen: { flex: 1, backgroundColor: "#F4F6F6", padding: 20, paddingTop: 60 },
  formHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  formTitle: { fontSize: 14, fontWeight: "700", color: "#14201F" },
  link: { color: "#5B6D6B", fontSize: 15 },
  stepDots: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 16 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#DCE3E1" },
  dotActive: { backgroundColor: "#0C6B62", width: 20 },
  dotDone: { backgroundColor: "#8FBFB8" },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: "#8A9997", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 16, marginBottom: 10 },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: "#5B6D6B", marginTop: 10, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, backgroundColor: "#FFFFFF" },
  pickRow: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 8, padding: 12, marginBottom: 8, backgroundColor: "#FFFFFF" },
  pickRowActive: { borderColor: "#0C6B62", backgroundColor: "#E3EEEC" },
  pickRowTitle: { fontSize: 14, fontWeight: "600", color: "#14201F" },
  selectedBanner: { backgroundColor: "#E3EEEC", borderRadius: 8, padding: 10, marginTop: 10, marginBottom: 4 },
  selectedBannerText: { color: "#0C6B62", fontWeight: "600", fontSize: 13 },
  chipRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 100, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#FFFFFF" },
  chipActive: { backgroundColor: "#0C6B62", borderColor: "#0C6B62" },
  chipText: { fontSize: 13, fontWeight: "600", color: "#5B6D6B" },
  chipTextActive: { color: "#FFFFFF" },
  button: { backgroundColor: "#0C6B62", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginTop: 16 },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  error: { color: "#A33B3B", backgroundColor: "#F8E9E9", padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13, textAlign: "center" },
  detailRow: { marginBottom: 14 },
  detailLabel: { fontSize: 11, fontWeight: "700", color: "#8A9997", textTransform: "uppercase", letterSpacing: 0.5 },
  detailValue: { fontSize: 15, color: "#14201F", marginTop: 2 },
  successTitle: { fontSize: 18, fontWeight: "700", color: "#2E7D4F" },
  successNumber: { fontSize: 24, fontWeight: "800", color: "#14201F", marginTop: 8, marginBottom: 4 },
});
