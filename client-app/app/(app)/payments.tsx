import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { getMyPolicies, type ClientPolicy } from "../../src/api/policies";
import { createPaymentIntent, initiatePayment, getPaymentStatus, getPaynowConfig, type PaymentIntent, type PaynowMethod } from "../../src/api/payments";

const METHODS: { key: PaynowMethod; label: string; needsPhone: boolean; needsEmail: boolean }[] = [
  { key: "ecocash", label: "EcoCash", needsPhone: true, needsEmail: false },
  { key: "onemoney", label: "OneMoney", needsPhone: true, needsEmail: false },
  { key: "visa_mastercard", label: "Card", needsPhone: false, needsEmail: true },
];

const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;

type Phase = "form" | "polling" | "success" | "failed";

export default function PaymentsScreen() {
  const [policies, setPolicies] = useState<ClientPolicy[] | null>(null);
  const [paynowEnabled, setPaynowEnabled] = useState<boolean | null>(null);
  const [selectedPolicy, setSelectedPolicy] = useState<ClientPolicy | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaynowMethod>("ecocash");
  const [payerPhone, setPayerPhone] = useState("");
  const [payerEmail, setPayerEmail] = useState("");
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getMyPolicies().then(setPolicies).catch(() => setPolicies([]));
    getPaynowConfig().then((c) => setPaynowEnabled(c.enabled)).catch(() => setPaynowEnabled(false));
  }, []);

  useEffect(() => {
    if (selectedPolicy) setAmount(selectedPolicy.premiumAmount);
  }, [selectedPolicy]);

  useEffect(() => {
    if (phase !== "polling" || !intent) return;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    const interval = setInterval(async () => {
      try {
        const status = await getPaymentStatus(intent.id);
        if (status.paid) { setPhase("success"); clearInterval(interval); return; }
        if (status.error || Date.now() > deadline) { setError(status.error || "Payment timed out"); setPhase("failed"); clearInterval(interval); }
      } catch {
        // transient poll failure — keep trying until the deadline
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [phase, intent]);

  const startOver = () => {
    setSelectedPolicy(null); setIntent(null); setPhase("form"); setError("");
    setPayerPhone(""); setPayerEmail("");
  };

  const submit = async () => {
    if (!selectedPolicy) return;
    const amountNum = parseFloat(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) { setError("Enter a valid amount"); return; }
    const cfg = METHODS.find((m) => m.key === method)!;
    if (cfg.needsPhone && !payerPhone.trim()) { setError("Phone number is required for this method"); return; }
    if (cfg.needsEmail && !payerEmail.trim()) { setError("Email is required for card payments"); return; }

    setBusy(true);
    setError("");
    try {
      const created = await createPaymentIntent(selectedPolicy.id, amount);
      if (created.message) { setError(created.message); setBusy(false); return; }
      setIntent(created.intent);

      const result = await initiatePayment(created.intent.id, method, payerPhone.trim() || undefined, payerEmail.trim() || undefined);
      if (result.message) { setError(result.message); setBusy(false); return; }

      if (result.redirectUrl) {
        await WebBrowser.openBrowserAsync(result.redirectUrl);
      }
      setPhase("polling");
    } catch (err: any) {
      setError(err?.message || "Could not start payment");
    } finally {
      setBusy(false);
    }
  };

  if (policies === null || paynowEnabled === null) return <View style={styles.center}><ActivityIndicator /></View>;

  if (paynowEnabled === false) {
    return <View style={styles.center}><Text style={styles.hint}>Online payments aren't available for your organization right now.</Text></View>;
  }

  if (phase === "success") {
    return (
      <View style={styles.center}>
        <Text style={styles.successTitle}>Payment received</Text>
        <Text style={styles.hint}>Your payment has been applied. A receipt will appear in your payment history shortly.</Text>
        <Pressable style={styles.button} onPress={startOver}><Text style={styles.buttonText}>Make another payment</Text></Pressable>
      </View>
    );
  }

  if (phase === "polling") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={styles.pollingTitle}>Waiting for payment confirmation…</Text>
        <Text style={styles.hint}>
          {method === "visa_mastercard" ? "Complete your card payment in the browser, then return here." : "Check your phone for a payment prompt and approve it."}
        </Text>
      </View>
    );
  }

  if (phase === "failed") {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error || "Payment could not be completed"}</Text>
        <Pressable style={styles.button} onPress={startOver}><Text style={styles.buttonText}>Try again</Text></Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 16 }}>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.sectionLabel}>Select policy</Text>
      {policies.map((p) => (
        <Pressable key={p.id} style={[styles.pickRow, selectedPolicy?.id === p.id && styles.pickRowActive]} onPress={() => setSelectedPolicy(p)}>
          <Text style={styles.pickRowTitle}>{p.policyNumber}</Text>
          <Text style={styles.cardSub}>{p.currency} {p.premiumAmount} / {p.paymentSchedule}</Text>
        </Pressable>
      ))}

      {selectedPolicy && (
        <>
          <Text style={styles.sectionLabel}>Amount</Text>
          <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />

          <Text style={styles.sectionLabel}>Payment method</Text>
          <View style={styles.chipRow}>
            {METHODS.map((m) => (
              <Pressable key={m.key} style={[styles.chip, method === m.key && styles.chipActive]} onPress={() => setMethod(m.key)}>
                <Text style={[styles.chipText, method === m.key && styles.chipTextActive]}>{m.label}</Text>
              </Pressable>
            ))}
          </View>

          {METHODS.find((m) => m.key === method)?.needsPhone && (
            <TextInput style={styles.input} placeholder="Phone number (e.g. 07XXXXXXXX)" value={payerPhone} onChangeText={setPayerPhone} keyboardType="phone-pad" />
          )}
          {METHODS.find((m) => m.key === method)?.needsEmail && (
            <TextInput style={styles.input} placeholder="Email address" value={payerEmail} onChangeText={setPayerEmail} keyboardType="email-address" autoCapitalize="none" />
          )}

          <Pressable style={styles.button} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Pay {selectedPolicy.currency} {amount || "0"}</Text>}
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F6F6" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: "#8A9997", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 16, marginBottom: 10 },
  pickRow: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 8, padding: 12, marginBottom: 8, backgroundColor: "#FFFFFF" },
  pickRowActive: { borderColor: "#0C6B62", backgroundColor: "#E3EEEC" },
  pickRowTitle: { fontSize: 14, fontWeight: "700", color: "#14201F" },
  cardSub: { fontSize: 12, color: "#5B6D6B", marginTop: 2 },
  input: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, backgroundColor: "#FFFFFF", marginBottom: 10 },
  chipRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 100, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#FFFFFF" },
  chipActive: { backgroundColor: "#0C6B62", borderColor: "#0C6B62" },
  chipText: { fontSize: 13, fontWeight: "600", color: "#5B6D6B" },
  chipTextActive: { color: "#FFFFFF" },
  button: { backgroundColor: "#0C6B62", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginTop: 20 },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  error: { color: "#A33B3B", backgroundColor: "#F8E9E9", padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13, textAlign: "center" },
  hint: { fontSize: 13, color: "#8A9997", textAlign: "center", lineHeight: 18 },
  successTitle: { fontSize: 18, fontWeight: "700", color: "#2E7D4F" },
  pollingTitle: { fontSize: 15, fontWeight: "600", color: "#14201F", marginTop: 8 },
});
