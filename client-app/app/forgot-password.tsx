import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { resetPassword } from "../src/api/auth";

export default function ForgotPasswordScreen() {
  const [policyNumber, setPolicyNumber] = useState("");
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (newPassword.length < 8 || newPassword !== confirmPassword) {
      setError(newPassword.length < 8 ? "Password must be at least 8 characters" : "Passwords do not match");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await resetPassword(policyNumber.trim().toUpperCase(), securityAnswer.trim(), newPassword);
      setDone(true);
    } catch (err: any) {
      setError(err?.message || "Reset failed");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Password reset</Text>
        <Text style={styles.subtitle}>Your password has been reset. You can now sign in with your new password.</Text>
        <Pressable style={styles.button} onPress={() => router.replace("/login")}>
          <Text style={styles.buttonText}>Sign in</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Reset password</Text>
      <Text style={styles.subtitle}>Enter your policy number and the answer to your security question to set a new password.</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.form}>
        <Field label="Policy number" value={policyNumber} onChangeText={setPolicyNumber} autoCapitalize="characters" />
        <Field label="Answer to your security question" value={securityAnswer} onChangeText={setSecurityAnswer} />
        <Field label="New password (min 8 characters)" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
        <Field label="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />
        <Pressable style={styles.button} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Reset password</Text>}
        </Pressable>
      </View>

      <Pressable style={styles.linkButton} onPress={() => router.replace("/login")}>
        <Text style={styles.link}>Back to sign in</Text>
      </Pressable>
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
  button: { backgroundColor: "#0C6B62", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginTop: 18 },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  error: { color: "#A33B3B", backgroundColor: "#F8E9E9", padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13, textAlign: "center" },
  linkButton: { alignItems: "center", marginTop: 20 },
  link: { color: "#0C6B62", fontSize: 13, fontWeight: "600" },
});
