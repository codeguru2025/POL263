import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "../src/context/AuthContext";
import { getNeutralBranding, type Branding } from "../src/api/branding";
import { API_BASE } from "../src/config";

export default function LoginScreen() {
  const { signInAgent, signInWithGoogle } = useAuth();
  const [branding, setBranding] = useState<Branding | null>(null);
  const [mode, setMode] = useState<"agent" | "staff">("agent");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getNeutralBranding().then(setBranding);
  }, []);

  const submitAgent = async () => {
    setError("");
    if (!email.trim() || !password) {
      setError("Email and password are required");
      return;
    }
    setBusy(true);
    try {
      await signInAgent(email, password);
    } catch (err: any) {
      setError(err?.message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  const submitGoogle = async () => {
    setError("");
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setError(err?.message || "Sign-in failed");
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

      <View style={styles.tabs}>
        <Pressable style={[styles.tab, mode === "agent" && styles.tabActive]} onPress={() => setMode("agent")}>
          <Text style={[styles.tabText, mode === "agent" && styles.tabTextActive]}>Agent</Text>
        </Pressable>
        <Pressable style={[styles.tab, mode === "staff" && styles.tabActive]} onPress={() => setMode("staff")}>
          <Text style={[styles.tabText, mode === "staff" && styles.tabTextActive]}>Staff</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {mode === "agent" ? (
        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="you@example.com"
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
          <Pressable style={styles.button} onPress={submitAgent} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
          </Pressable>
          <Text style={styles.hint}>Sign in with the email and password set by your administrator.</Text>
        </View>
      ) : (
        <View style={styles.form}>
          <Pressable style={styles.button} onPress={submitGoogle} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in with Google</Text>}
          </Pressable>
          <Text style={styles.hint}>Staff sign in with the Google account tied to their organization.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F6F6", padding: 24, justifyContent: "center" },
  header: { alignItems: "center", marginBottom: 32 },
  logo: { width: 96, height: 96, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: "700", color: "#14201F" },
  tabs: { flexDirection: "row", backgroundColor: "#E5EBEA", borderRadius: 10, padding: 4, marginBottom: 20 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  tabActive: { backgroundColor: "#FFFFFF" },
  tabText: { fontSize: 14, fontWeight: "600", color: "#5B6D6B" },
  tabTextActive: { color: "#0C6B62" },
  form: { gap: 4 },
  label: { fontSize: 13, fontWeight: "600", color: "#5B6D6B", marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, backgroundColor: "#FFFFFF" },
  button: { backgroundColor: "#0C6B62", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginTop: 18 },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  hint: { fontSize: 12, color: "#8A9997", marginTop: 12, textAlign: "center" },
  error: { color: "#A33B3B", backgroundColor: "#F8E9E9", padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13, textAlign: "center" },
});
