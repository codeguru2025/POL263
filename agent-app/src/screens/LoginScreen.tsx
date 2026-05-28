import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
  ScrollView, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../context/AuthContext";
import { colors, spacing, fontSize } from "../theme";

type Mode = "agent" | "client";

export default function LoginScreen() {
  const { login, loginAsClient, loading } = useAuth();
  const [mode, setMode] = useState<Mode>("agent");
  // Agent fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Client fields
  const [policyNumber, setPolicyNumber] = useState("");
  const [clientPassword, setClientPassword] = useState("");

  const handleAgentLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert("Error", "Please enter your email and password");
      return;
    }
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (e: any) {
      Alert.alert("Login Failed", e.message || "Check your credentials");
    }
  };

  const handleClientLogin = async () => {
    if (!policyNumber.trim() || !clientPassword) {
      Alert.alert("Error", "Please enter your policy number and password");
      return;
    }
    try {
      await loginAsClient(policyNumber.trim(), clientPassword);
    } catch (e: any) {
      Alert.alert("Login Failed", e.message || "Invalid policy number or password");
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.kvContainer}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          {/* Brand header */}
          <View style={styles.brandSection}>
            <Image
              source={require("../../assets/logo.png")}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.tagline}>Insurance Management Platform</Text>
          </View>

          {/* Card */}
          <View style={styles.card}>
            {/* Mode tabs */}
            <View style={styles.modeRow}>
              <TouchableOpacity
                style={[styles.modeTab, mode === "agent" && styles.modeTabActive]}
                onPress={() => setMode("agent")}
              >
                <Text style={[styles.modeTabText, mode === "agent" && styles.modeTabTextActive]}>
                  🏢 Agent / Staff
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeTab, mode === "client" && styles.modeTabActive]}
                onPress={() => setMode("client")}
              >
                <Text style={[styles.modeTabText, mode === "client" && styles.modeTabTextActive]}>
                  👤 Client
                </Text>
              </TouchableOpacity>
            </View>

            {mode === "agent" ? (
              <View style={styles.form}>
                <Text style={styles.formTitle}>Agent / Staff Sign In</Text>
                <Text style={styles.label}>Email Address</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="agent@company.com"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoCorrect={false}
                  returnKeyType="next"
                />
                <Text style={styles.label}>Password</Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                  returnKeyType="done"
                  onSubmitEditing={handleAgentLogin}
                />
                <TouchableOpacity
                  style={[styles.button, loading && styles.buttonDisabled]}
                  onPress={handleAgentLogin}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>Sign In</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.form}>
                <Text style={styles.formTitle}>Client Self-Service Sign In</Text>
                <Text style={styles.hint}>Use your policy number and the password set during enrollment.</Text>
                <Text style={styles.label}>Policy Number</Text>
                <TextInput
                  style={styles.input}
                  value={policyNumber}
                  onChangeText={setPolicyNumber}
                  placeholder="e.g. POL-2024-001234"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="next"
                />
                <Text style={styles.label}>Password</Text>
                <TextInput
                  style={styles.input}
                  value={clientPassword}
                  onChangeText={setClientPassword}
                  placeholder="••••••••"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                  returnKeyType="done"
                  onSubmitEditing={handleClientLogin}
                />
                <TouchableOpacity
                  style={[styles.button, styles.clientButton, loading && styles.buttonDisabled]}
                  onPress={handleClientLogin}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>Sign In as Client</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>

          <Text style={styles.footer}>POL263 · Secure Insurance Platform</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.primary },
  kvContainer: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.lg,
    paddingVertical: spacing.xl,
  },
  brandSection: {
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  logo: {
    width: 180,
    height: 60,
    marginBottom: spacing.sm,
  },
  tagline: {
    fontSize: fontSize.sm,
    color: "rgba(255,255,255,0.75)",
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 12,
  },
  modeRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modeTab: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
  },
  modeTabActive: {
    backgroundColor: colors.surface,
    borderBottomWidth: 3,
    borderBottomColor: colors.primary,
  },
  modeTabText: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  modeTabTextActive: {
    color: colors.primary,
  },
  form: {
    padding: spacing.lg,
    gap: spacing.xs,
  },
  formTitle: {
    fontSize: fontSize.lg,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  hint: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    lineHeight: 20,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.text,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    padding: spacing.md,
    fontSize: fontSize.md,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    padding: spacing.md,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  clientButton: {
    backgroundColor: "#059669",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: fontSize.md,
    fontWeight: "700",
  },
  footer: {
    textAlign: "center",
    color: "rgba(255,255,255,0.5)",
    fontSize: fontSize.xs,
    marginTop: spacing.xl,
  },
});
