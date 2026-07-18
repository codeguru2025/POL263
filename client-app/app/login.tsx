import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";
import { useAuth } from "../src/context/AuthContext";
import { getNeutralBranding, type NeutralBranding } from "../src/api/branding";
import { API_BASE } from "../src/config";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [branding, setBranding] = useState<NeutralBranding | null>(null);
  const [policyNumber, setPolicyNumber] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { getNeutralBranding().then(setBranding); }, []);

  const submit = async () => {
    setError("");
    if (!policyNumber.trim() || !password) {
      setError("Policy number and password are required");
      return;
    }
    setBusy(true);
    try {
      await signIn(policyNumber, password);
    } catch (err: any) {
      setError(err?.message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  const logoUri = branding?.logoUrl?.startsWith("http") ? branding.logoUrl : `${API_BASE}${branding?.logoUrl ?? ""}`;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        {branding && <Image source={{ uri: logoUri }} style={styles.logo} resizeMode="contain" />}
        <Text style={styles.title}>{branding?.name ?? "POL263"}</Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.form}>
        <Text style={styles.label}>Policy number</Text>
        <TextInput
          style={styles.input}
          value={policyNumber}
          onChangeText={setPolicyNumber}
          autoCapitalize="characters"
          placeholder="e.g. POL-000123"
          editable={!busy}
        />
        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
          editable={!busy}
        />
        <Pressable style={styles.button} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
        </Pressable>

        <View style={styles.linksRow}>
          <Link href="/enroll" asChild>
            <Pressable><Text style={styles.link}>Activate my policy</Text></Pressable>
          </Link>
          <Link href="/forgot-password" asChild>
            <Pressable><Text style={styles.link}>Forgot password?</Text></Pressable>
          </Link>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F6F6", padding: 24, justifyContent: "center" },
  header: { alignItems: "center", marginBottom: 32 },
  logo: { width: 96, height: 96, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: "700", color: "#14201F" },
  form: { gap: 4 },
  label: { fontSize: 13, fontWeight: "600", color: "#5B6D6B", marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, backgroundColor: "#FFFFFF" },
  button: { backgroundColor: "#0C6B62", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginTop: 18 },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  error: { color: "#A33B3B", backgroundColor: "#F8E9E9", padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13, textAlign: "center" },
  linksRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 20 },
  link: { color: "#0C6B62", fontSize: 13, fontWeight: "600" },
});
