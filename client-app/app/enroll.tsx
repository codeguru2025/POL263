import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { claimPolicy, enrollClient, type SecurityQuestion } from "../src/api/auth";

const FALLBACK_QUESTIONS: SecurityQuestion[] = [
  { id: "q1", question: "What was the name of your first pet?" },
  { id: "q2", question: "In what city were you born?" },
  { id: "q3", question: "What is your mother's maiden name?" },
  { id: "q4", question: "What high school did you attend?" },
];

type Step = 1 | 2 | 3;

export default function EnrollScreen() {
  const [step, setStep] = useState<Step>(1);
  const [policyNumber, setPolicyNumber] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [clientId, setClientId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [questions, setQuestions] = useState<SecurityQuestion[]>([]);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [securityQuestionId, setSecurityQuestionId] = useState("");
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const verify = async () => {
    if (!policyNumber.trim() || !activationCode.trim()) {
      setError("Policy number and activation code are required");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await claimPolicy(activationCode.trim().toUpperCase(), policyNumber.trim().toUpperCase());
      setClientId(res.clientId);
      setFirstName(res.firstName);
      setQuestions(res.securityQuestions?.length ? res.securityQuestions : FALLBACK_QUESTIONS);
      setStep(2);
    } catch {
      setError("Invalid activation code or policy number");
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (newPassword.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (newPassword !== confirmPassword) { setError("Passwords do not match"); return; }
    if (!securityQuestionId || !securityAnswer.trim()) { setError("Select a security question and provide an answer"); return; }
    setBusy(true);
    setError("");
    try {
      await enrollClient({ clientId, password: newPassword, securityQuestionId, securityAnswer: securityAnswer.trim() });
      setStep(3);
    } catch (err: any) {
      setError(err?.message || "Enrollment failed. Please check your details and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Activate your policy</Text>
      <Text style={styles.subtitle}>
        {step === 1 ? "Verify your identity using your policy number and activation code."
          : step === 2 ? `Welcome ${firstName}! Set up your password and security question.`
          : "Your account is ready."}
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {step === 1 && (
        <View style={styles.form}>
          <Field label="Policy number" value={policyNumber} onChangeText={setPolicyNumber} autoCapitalize="characters" placeholder="e.g. POL-12345678" />
          <Field label="Activation code" value={activationCode} onChangeText={setActivationCode} autoCapitalize="characters" placeholder="Provided by your agent" />
          <Text style={styles.hint}>If you don't have an activation code, contact your agent or branch office.</Text>
          <Pressable style={styles.button} onPress={verify} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify identity</Text>}
          </Pressable>
        </View>
      )}

      {step === 2 && (
        <View style={styles.form}>
          <Field label="New password (min 8 characters)" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
          <Field label="Confirm password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />
          <Text style={styles.label}>Security question</Text>
          {questions.map((q) => (
            <Pressable key={q.id} style={[styles.pickRow, securityQuestionId === q.id && styles.pickRowActive]} onPress={() => setSecurityQuestionId(q.id)}>
              <Text style={styles.pickRowText}>{q.question}</Text>
            </Pressable>
          ))}
          <Field label="Your answer" value={securityAnswer} onChangeText={setSecurityAnswer} />
          <Pressable style={styles.button} onPress={complete} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Complete setup</Text>}
          </Pressable>
        </View>
      )}

      {step === 3 && (
        <View style={styles.form}>
          <Pressable style={styles.button} onPress={() => router.replace("/login")}>
            <Text style={styles.buttonText}>Sign in now</Text>
          </Pressable>
        </View>
      )}

      {step < 3 && (
        <Pressable style={styles.linkButton} onPress={() => router.replace("/login")}>
          <Text style={styles.link}>Already claimed your account? Sign in</Text>
        </Pressable>
      )}
    </View>
  );
}

function Field(props: { label: string } & React.ComponentProps<typeof TextInput>) {
  const { label, ...rest } = props;
  return (
    <View style={{ marginBottom: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} {...rest} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F6F6", padding: 24, paddingTop: 60 },
  title: { fontSize: 22, fontWeight: "700", color: "#14201F", textAlign: "center" },
  subtitle: { fontSize: 13, color: "#5B6D6B", textAlign: "center", marginTop: 8, marginBottom: 20, lineHeight: 18 },
  form: { gap: 4 },
  label: { fontSize: 13, fontWeight: "600", color: "#5B6D6B", marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, backgroundColor: "#FFFFFF" },
  hint: { fontSize: 11, color: "#8A9997", marginTop: 6 },
  pickRow: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 8, padding: 12, marginBottom: 8, backgroundColor: "#FFFFFF" },
  pickRowActive: { borderColor: "#0C6B62", backgroundColor: "#E3EEEC" },
  pickRowText: { fontSize: 13, color: "#14201F" },
  button: { backgroundColor: "#0C6B62", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginTop: 18 },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  error: { color: "#A33B3B", backgroundColor: "#F8E9E9", padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13, textAlign: "center" },
  linkButton: { alignItems: "center", marginTop: 20 },
  link: { color: "#0C6B62", fontSize: 13, fontWeight: "600" },
});
