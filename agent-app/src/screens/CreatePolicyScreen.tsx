import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/schema";
import { useNetwork } from "../context/NetworkContext";
import { fullSync } from "../sync/engine";
import { colors, spacing, fontSize } from "../theme";

const RELATIONSHIPS = ["Spouse","Son","Daughter","Father","Mother","Brother","Sister","Grandparent","In-law","Other"];

interface Dependent {
  firstName: string;
  lastName: string;
  relationship: string;
  nationalId: string;
  dateOfBirth: string;
}

const emptyDep: Dependent = { firstName: "", lastName: "", relationship: "Spouse", nationalId: "", dateOfBirth: "" };
const emptyBeneficiary = { firstName: "", lastName: "", relationship: "Spouse", nationalId: "", phone: "" };

interface LocalClient {
  local_id: string;
  server_id: string | null;
  first_name: string;
  last_name: string;
  phone: string | null;
  national_id: string | null;
  synced: number;
}

interface Product {
  id: string;
  name: string;
  versions: { id: string; versionLabel: string; premiumMonthlyUsd?: string; premiumWeeklyUsd?: string }[];
}

interface AddOn {
  id: string;
  name: string;
  priceMonthly?: string;
}

export default function CreatePolicyScreen({ navigation }: any) {
  const { isOnline } = useNetwork();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // Client selection
  const [clients, setClients] = useState<LocalClient[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState<LocalClient | null>(null);

  // Product selection
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<any>(null);

  // Add-ons
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [selectedAddOns, setSelectedAddOns] = useState<Set<string>>(new Set());

  // Policy details
  const [paymentSchedule, setPaymentSchedule] = useState("monthly");
  const [currency, setCurrency] = useState("USD");
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentProvider, setPaymentProvider] = useState("ecocash");
  const [mobileNumber, setMobileNumber] = useState("");

  // Dependents
  const [dependents, setDependents] = useState<Dependent[]>([]);
  const [showAddDep, setShowAddDep] = useState(false);
  const [newDep, setNewDep] = useState<Dependent>({ ...emptyDep });

  // Beneficiary (required — parity with web)
  const [beneficiary, setBeneficiary] = useState({ ...emptyBeneficiary });

  // Load clients
  useEffect(() => {
    (async () => {
      const db = await getDb();
      const local = await db.getAllAsync<LocalClient>("SELECT * FROM clients ORDER BY first_name");
      const cached = await db.getAllAsync<{ id: string; data: string }>("SELECT * FROM cache_my_clients");
      const localServerIds = new Set(local.filter(c => c.server_id).map(c => c.server_id));
      const cachedClients: LocalClient[] = cached
        .map(c => { const d = JSON.parse(c.data); return { local_id: c.id, server_id: c.id, first_name: d.firstName || "", last_name: d.lastName || "", phone: d.phone, national_id: d.nationalId, synced: 1 }; })
        .filter(c => !localServerIds.has(c.server_id));
      setClients([...local, ...cachedClients]);
    })();
  }, []);

  // Load products & add-ons from cache
  useEffect(() => {
    (async () => {
      const db = await getDb();
      const cachedProducts = await db.getAllAsync<{ id: string; data: string }>("SELECT * FROM cache_products");
      const cachedVersions = await db.getAllAsync<{ id: string; product_id: string; data: string }>("SELECT * FROM cache_product_versions");
      const cachedAddOns = await db.getAllAsync<{ id: string; data: string }>("SELECT * FROM cache_add_ons");

      const prods: Product[] = cachedProducts.map(p => {
        const d = JSON.parse(p.data);
        const versions = cachedVersions
          .filter(v => v.product_id === p.id)
          .map(v => JSON.parse(v.data));
        return { id: p.id, name: d.name, versions };
      });
      setProducts(prods);
      setAddOns(cachedAddOns.map(a => JSON.parse(a.data)));
    })();
  }, []);

  const filteredClients = clientSearch
    ? clients.filter(c => `${c.first_name} ${c.last_name} ${c.national_id || ""}`.toLowerCase().includes(clientSearch.toLowerCase()))
    : clients;

  const premiumAmount = selectedVersion
    ? (paymentSchedule === "weekly" ? selectedVersion.premiumWeeklyUsd : selectedVersion.premiumMonthlyUsd) || "0"
    : "0";

  const addDependent = () => {
    if (!newDep.firstName.trim() || !newDep.lastName.trim()) {
      Alert.alert("Error", "First and last name are required");
      return;
    }
    setDependents(prev => [...prev, {
      ...newDep,
      firstName: newDep.firstName.trim().toUpperCase(),
      lastName: newDep.lastName.trim().toUpperCase(),
      nationalId: newDep.nationalId.trim().toUpperCase(),
    }]);
    setNewDep({ ...emptyDep });
    setShowAddDep(false);
  };

  const handleSave = async () => {
    if (!selectedClient) { Alert.alert("Error", "Select a client"); return; }
    if (!selectedVersion) { Alert.alert("Error", "Select a product"); return; }
    if (!beneficiary.firstName.trim() || !beneficiary.lastName.trim()) {
      Alert.alert("Beneficiary Required", "Please go back and enter beneficiary details");
      return;
    }

    setSaving(true);
    try {
      const db = await getDb();
      const localId = uuidv4();
      await db.runAsync(
        `INSERT INTO policies (
          local_id, client_local_id, client_server_id, product_version_id,
          product_name, premium_amount, currency, payment_schedule,
          effective_date, payment_method_type, payment_provider,
          payment_mobile_number, add_on_ids,
          beneficiary_first_name, beneficiary_last_name, beneficiary_relationship,
          beneficiary_national_id, beneficiary_phone,
          synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        localId, selectedClient.local_id, selectedClient.server_id, selectedVersion.id,
        selectedProduct?.name || "", premiumAmount, currency, paymentSchedule,
        effectiveDate, "mobile", paymentProvider, mobileNumber || null,
        JSON.stringify(Array.from(selectedAddOns)),
        beneficiary.firstName.trim().toUpperCase(), beneficiary.lastName.trim().toUpperCase(),
        beneficiary.relationship, beneficiary.nationalId.trim().toUpperCase(),
        beneficiary.phone.trim(),
      );

      for (const dep of dependents) {
        await db.runAsync(
          `INSERT INTO dependents (local_id, policy_local_id, first_name, last_name, relationship, national_id, date_of_birth, synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
          uuidv4(), localId, dep.firstName, dep.lastName,
          dep.relationship, dep.nationalId || null, dep.dateOfBirth || null,
        );
      }

      if (isOnline) { try { await fullSync(); } catch {} }

      Alert.alert(
        "Policy Saved",
        isOnline
          ? "Policy created and synced. A policy number will be assigned shortly."
          : "Policy saved locally. It will sync when you're back online.",
        [{ text: "OK", onPress: () => navigation.goBack() }]
      );
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleAddOn = (id: string) => {
    setSelectedAddOns(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const TOTAL_STEPS = 5;

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom"]}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Step indicators */}
        <View style={styles.steps}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(s => (
            <View key={s} style={[styles.stepDot, step >= s && styles.stepDotActive]}>
              <Text style={[styles.stepText, step >= s && styles.stepTextActive]}>{s}</Text>
            </View>
          ))}
        </View>

        {/* ── Step 1: Select Client ── */}
        {step === 1 && (
          <View>
            <Text style={styles.stepTitle}>Select Client</Text>
            <TextInput
              style={styles.search}
              placeholder="Search by name or ID…"
              placeholderTextColor={colors.textMuted}
              value={clientSearch}
              onChangeText={setClientSearch}
            />
            {filteredClients.slice(0, 20).map(c => (
              <TouchableOpacity
                key={c.local_id}
                style={[styles.optionCard, selectedClient?.local_id === c.local_id && styles.optionSelected]}
                onPress={() => setSelectedClient(c)}
              >
                <Text style={styles.optionTitle}>{c.first_name} {c.last_name}</Text>
                <Text style={styles.optionSub}>{c.national_id || "No ID"} · {c.phone || "No phone"}</Text>
                {!c.synced && <Text style={styles.pendingLabel}>⏳ Not yet synced</Text>}
              </TouchableOpacity>
            ))}
            {filteredClients.length === 0 && (
              <Text style={styles.emptyHint}>No clients found. Create one on the Clients tab first.</Text>
            )}
            <TouchableOpacity
              style={[styles.nextButton, !selectedClient && styles.buttonDisabled]}
              onPress={() => selectedClient && setStep(2)}
              disabled={!selectedClient}
            >
              <Text style={styles.nextButtonText}>Next →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Step 2: Select Product ── */}
        {step === 2 && (
          <View>
            <Text style={styles.stepTitle}>Select Product</Text>
            {products.length === 0 ? (
              <Text style={styles.emptyHint}>No products cached. Please sync while online first.</Text>
            ) : (
              products.map(p => (
                <View key={p.id}>
                  <Text style={styles.sectionLabel}>{p.name}</Text>
                  {p.versions.map(v => (
                    <TouchableOpacity
                      key={v.id}
                      style={[styles.optionCard, selectedVersion?.id === v.id && styles.optionSelected]}
                      onPress={() => { setSelectedProduct(p); setSelectedVersion(v); }}
                    >
                      <Text style={styles.optionTitle}>{v.versionLabel || "Default"}</Text>
                      <Text style={styles.optionSub}>
                        ${v.premiumMonthlyUsd || "0"}/month · ${v.premiumWeeklyUsd || "0"}/week
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ))
            )}
            <View style={styles.navRow}>
              <TouchableOpacity style={styles.backButton} onPress={() => setStep(1)}>
                <Text style={styles.backButtonText}>← Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.nextButton, !selectedVersion && styles.buttonDisabled]}
                onPress={() => selectedVersion && setStep(3)}
                disabled={!selectedVersion}
              >
                <Text style={styles.nextButtonText}>Next →</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Step 3: Add-ons & Payment ── */}
        {step === 3 && (
          <View>
            <Text style={styles.stepTitle}>Add-ons & Payment</Text>

            {addOns.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Add-ons (optional)</Text>
                {addOns.map(a => (
                  <TouchableOpacity
                    key={a.id}
                    style={[styles.optionCard, selectedAddOns.has(a.id) && styles.optionSelected]}
                    onPress={() => toggleAddOn(a.id)}
                  >
                    <Text style={styles.optionTitle}>{a.name}</Text>
                    <Text style={styles.optionSub}>${a.priceMonthly || "0"}/month</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            <Text style={styles.sectionLabel}>Payment Schedule</Text>
            <View style={styles.chipRow}>
              {["monthly", "weekly", "biweekly"].map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.chip, paymentSchedule === s && styles.chipSelected]}
                  onPress={() => setPaymentSchedule(s)}
                >
                  <Text style={[styles.chipText, paymentSchedule === s && styles.chipTextSelected]}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionLabel}>Payment Provider</Text>
            <View style={styles.chipRow}>
              {["ecocash", "onemoney", "innbucks"].map(p => (
                <TouchableOpacity
                  key={p}
                  style={[styles.chip, paymentProvider === p && styles.chipSelected]}
                  onPress={() => setPaymentProvider(p)}
                >
                  <Text style={[styles.chipText, paymentProvider === p && styles.chipTextSelected]}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Mobile Number</Text>
            <TextInput style={styles.input} value={mobileNumber} onChangeText={setMobileNumber}
              placeholder="+263..." placeholderTextColor={colors.textMuted} keyboardType="phone-pad" />

            <Text style={styles.label}>Effective Date</Text>
            <TextInput style={styles.input} value={effectiveDate} onChangeText={setEffectiveDate}
              placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} />

            <View style={styles.navRow}>
              <TouchableOpacity style={styles.backButton} onPress={() => setStep(2)}>
                <Text style={styles.backButtonText}>← Back</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.nextButton} onPress={() => setStep(4)}>
                <Text style={styles.nextButtonText}>Next →</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Step 4: Members & Beneficiary ── */}
        {step === 4 && (
          <View>
            <Text style={styles.stepTitle}>Members & Beneficiary</Text>

            {/* Dependents / Policy Members */}
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionLabel}>Policy Members <Text style={styles.optionalTag}>(optional)</Text></Text>
              <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddDep(v => !v)}>
                <Text style={styles.addBtnText}>{showAddDep ? "Cancel" : "+ Add"}</Text>
              </TouchableOpacity>
            </View>

            {dependents.map((d, i) => (
              <View key={i} style={styles.depRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.depName}>{d.firstName} {d.lastName}</Text>
                  <Text style={styles.depSub}>{d.relationship}{d.nationalId ? ` · ${d.nationalId}` : ""}</Text>
                </View>
                <TouchableOpacity style={styles.removeBtn} onPress={() => setDependents(prev => prev.filter((_, j) => j !== i))}>
                  <Text style={styles.removeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}

            {showAddDep && (
              <View style={styles.inlineForm}>
                <Text style={styles.inlineFormTitle}>Add Member</Text>
                <View style={styles.rowInputs}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>First Name *</Text>
                    <TextInput style={styles.input} value={newDep.firstName} onChangeText={v => setNewDep(d => ({ ...d, firstName: v }))}
                      placeholder="First" placeholderTextColor={colors.textMuted} autoCapitalize="characters" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Last Name *</Text>
                    <TextInput style={styles.input} value={newDep.lastName} onChangeText={v => setNewDep(d => ({ ...d, lastName: v }))}
                      placeholder="Last" placeholderTextColor={colors.textMuted} autoCapitalize="characters" />
                  </View>
                </View>
                <Text style={styles.label}>Relationship</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={[styles.chipRow, { marginBottom: spacing.sm }]}>
                    {["Spouse","Son","Daughter","Father","Mother","Other"].map(r => (
                      <TouchableOpacity key={r} style={[styles.chip, newDep.relationship === r && styles.chipSelected]}
                        onPress={() => setNewDep(d => ({ ...d, relationship: r }))}>
                        <Text style={[styles.chipText, newDep.relationship === r && styles.chipTextSelected]}>{r}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
                <Text style={styles.label}>National ID</Text>
                <TextInput style={styles.input} value={newDep.nationalId} onChangeText={v => setNewDep(d => ({ ...d, nationalId: v }))}
                  placeholder="e.g. 08833089H38" placeholderTextColor={colors.textMuted} autoCapitalize="characters" />
                <Text style={styles.label}>Date of Birth</Text>
                <TextInput style={styles.input} value={newDep.dateOfBirth} onChangeText={v => setNewDep(d => ({ ...d, dateOfBirth: v }))}
                  placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} />
                <TouchableOpacity style={[styles.nextButton, { marginTop: spacing.md }]} onPress={addDependent}>
                  <Text style={styles.nextButtonText}>Add Member</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Beneficiary (required) */}
            <View style={styles.beneficiaryHeader}>
              <Text style={styles.sectionLabel}>Beneficiary <Text style={styles.requiredTag}>*</Text></Text>
            </View>
            <Text style={styles.hintText}>Person who receives payout on a claim (required)</Text>

            <View style={styles.rowInputs}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>First Name *</Text>
                <TextInput style={styles.input} value={beneficiary.firstName} onChangeText={v => setBeneficiary(b => ({ ...b, firstName: v }))}
                  placeholder="First" placeholderTextColor={colors.textMuted} autoCapitalize="characters" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Last Name *</Text>
                <TextInput style={styles.input} value={beneficiary.lastName} onChangeText={v => setBeneficiary(b => ({ ...b, lastName: v }))}
                  placeholder="Last" placeholderTextColor={colors.textMuted} autoCapitalize="characters" />
              </View>
            </View>

            <Text style={styles.label}>Relationship *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={[styles.chipRow, { marginBottom: spacing.sm }]}>
                {RELATIONSHIPS.map(r => (
                  <TouchableOpacity key={r} style={[styles.chip, beneficiary.relationship === r && styles.chipSelected]}
                    onPress={() => setBeneficiary(b => ({ ...b, relationship: r }))}>
                    <Text style={[styles.chipText, beneficiary.relationship === r && styles.chipTextSelected]}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Text style={styles.label}>National ID *</Text>
            <TextInput style={styles.input} value={beneficiary.nationalId} onChangeText={v => setBeneficiary(b => ({ ...b, nationalId: v }))}
              placeholder="e.g. 08833089H38" placeholderTextColor={colors.textMuted} autoCapitalize="characters" />

            <Text style={styles.label}>Phone *</Text>
            <TextInput style={styles.input} value={beneficiary.phone} onChangeText={v => setBeneficiary(b => ({ ...b, phone: v }))}
              placeholder="+263…" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" />

            <View style={styles.navRow}>
              <TouchableOpacity style={styles.backButton} onPress={() => setStep(3)}>
                <Text style={styles.backButtonText}>← Back</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.nextButton} onPress={() => setStep(5)}>
                <Text style={styles.nextButtonText}>Review →</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Step 5: Review & Submit ── */}
        {step === 5 && (
          <View>
            <Text style={styles.stepTitle}>Review Policy</Text>

            <View style={styles.reviewCard}>
              <Text style={styles.reviewLabel}>Client</Text>
              <Text style={styles.reviewValue}>{selectedClient?.first_name} {selectedClient?.last_name}</Text>

              <Text style={styles.reviewLabel}>Product</Text>
              <Text style={styles.reviewValue}>{selectedProduct?.name} — {selectedVersion?.versionLabel || "Default"}</Text>

              <Text style={styles.reviewLabel}>Premium</Text>
              <Text style={styles.reviewValue}>{currency} {premiumAmount} / {paymentSchedule}</Text>

              <Text style={styles.reviewLabel}>Effective Date</Text>
              <Text style={styles.reviewValue}>{effectiveDate}</Text>

              <Text style={styles.reviewLabel}>Payment</Text>
              <Text style={styles.reviewValue}>{paymentProvider} · {mobileNumber || "—"}</Text>

              {selectedAddOns.size > 0 && (
                <>
                  <Text style={styles.reviewLabel}>Add-ons</Text>
                  <Text style={styles.reviewValue}>{addOns.filter(a => selectedAddOns.has(a.id)).map(a => a.name).join(", ")}</Text>
                </>
              )}

              {dependents.length > 0 && (
                <>
                  <Text style={styles.reviewLabel}>Members ({dependents.length})</Text>
                  <Text style={styles.reviewValue}>{dependents.map(d => `${d.firstName} ${d.lastName}`).join(", ")}</Text>
                </>
              )}

              <Text style={styles.reviewLabel}>Beneficiary</Text>
              <Text style={styles.reviewValue}>{beneficiary.firstName} {beneficiary.lastName} ({beneficiary.relationship})</Text>
              <Text style={[styles.reviewValue, styles.reviewValueSub]}>{beneficiary.nationalId} · {beneficiary.phone}</Text>
            </View>

            {!isOnline && (
              <View style={styles.offlineNote}>
                <Text style={styles.offlineNoteText}>
                  📡 Offline — policy saved locally and will sync automatically when connected.
                </Text>
              </View>
            )}

            <View style={styles.navRow}>
              <TouchableOpacity style={styles.backButton} onPress={() => setStep(4)}>
                <Text style={styles.backButtonText}>← Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitButton, saving && styles.buttonDisabled]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Issue Policy</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: 100 },
  steps: { flexDirection: "row", justifyContent: "center", gap: spacing.md, marginBottom: spacing.lg },
  stepDot: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  stepDotActive: { backgroundColor: colors.primary },
  stepText: { fontSize: fontSize.sm, fontWeight: "700", color: colors.textMuted },
  stepTextActive: { color: "#fff" },
  stepTitle: { fontSize: fontSize.xl, fontWeight: "700", color: colors.text, marginBottom: spacing.md },
  sectionLabel: { fontSize: fontSize.sm, fontWeight: "600", color: colors.textSecondary, marginTop: spacing.md, marginBottom: spacing.xs },
  search: {
    backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md,
    fontSize: fontSize.md, color: colors.text, borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.md,
  },
  optionCard: {
    backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1.5, borderColor: colors.border,
  },
  optionSelected: { borderColor: colors.primary, backgroundColor: "#eff6ff" },
  optionTitle: { fontSize: fontSize.md, fontWeight: "600", color: colors.text },
  optionSub: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  pendingLabel: { fontSize: fontSize.xs, color: "#92400e", marginTop: 4 },
  emptyHint: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: "center", padding: spacing.lg },
  chipRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 8,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text },
  chipTextSelected: { color: "#fff" },
  label: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text, marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md,
    fontSize: fontSize.md, color: colors.text, borderWidth: 1, borderColor: colors.border,
  },
  navRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.lg, gap: spacing.md },
  nextButton: {
    flex: 1, backgroundColor: colors.primary, borderRadius: 10,
    padding: spacing.md, alignItems: "center",
  },
  nextButtonText: { color: "#fff", fontWeight: "700", fontSize: fontSize.md },
  backButton: {
    flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: 10,
    padding: spacing.md, alignItems: "center", borderWidth: 1, borderColor: colors.border,
  },
  backButtonText: { color: colors.text, fontWeight: "600", fontSize: fontSize.md },
  buttonDisabled: { opacity: 0.4 },
  submitButton: {
    flex: 1, backgroundColor: colors.success, borderRadius: 10,
    padding: spacing.md, alignItems: "center",
  },
  submitButtonText: { color: "#fff", fontWeight: "700", fontSize: fontSize.md },
  reviewCard: {
    backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  reviewLabel: { fontSize: fontSize.xs, fontWeight: "600", color: colors.textMuted, marginTop: spacing.sm },
  reviewValue: { fontSize: fontSize.md, fontWeight: "600", color: colors.text },
  offlineNote: {
    backgroundColor: "#fef3c7", borderRadius: 8, padding: spacing.md,
    marginTop: spacing.md, borderWidth: 1, borderColor: "#fcd34d",
  },
  offlineNoteText: { fontSize: fontSize.sm, color: "#92400e", lineHeight: 20 },
  reviewValueSub: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: "400" },
  sectionHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.md },
  addBtn: { backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 8 },
  addBtnText: { color: "#fff", fontSize: fontSize.sm, fontWeight: "600" },
  depRow: {
    flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceAlt,
    borderRadius: 8, padding: spacing.sm, marginBottom: spacing.xs,
    borderWidth: 1, borderColor: colors.borderLight,
  },
  depName: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text },
  depSub: { fontSize: fontSize.xs, color: colors.textSecondary },
  removeBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#fee2e2", alignItems: "center", justifyContent: "center" },
  removeBtnText: { color: colors.danger, fontSize: fontSize.sm, fontWeight: "700" },
  inlineForm: {
    backgroundColor: colors.surfaceAlt, borderRadius: 10, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginTop: spacing.sm, marginBottom: spacing.sm,
  },
  inlineFormTitle: { fontSize: fontSize.md, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  rowInputs: { flexDirection: "row", gap: spacing.sm },
  beneficiaryHeader: { marginTop: spacing.lg },
  hintText: { fontSize: fontSize.xs, color: colors.textMuted, marginBottom: spacing.xs },
  optionalTag: { color: colors.textMuted, fontWeight: "400" },
  requiredTag: { color: colors.danger },
});
