import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Linking, Image } from "react-native";
import { colors, spacing, fontSize } from "../theme";

interface Props {
  downloadUrl: string;
  currentVersion?: string;
  minVersion?: string;
  releaseNotes?: string | null;
}

export default function ForceUpdateScreen({ downloadUrl, currentVersion, minVersion, releaseNotes }: Props) {
  return (
    <View style={styles.container}>
      <Image source={require("../../assets/logo.png")} style={styles.logo} resizeMode="contain" />
      <Text style={styles.title}>Update Required</Text>
      <Text style={styles.subtitle}>
        Your app version is no longer supported.{"\n"}Please update to continue.
      </Text>
      {currentVersion && minVersion && (
        <View style={styles.versionBox}>
          <Text style={styles.versionText}>Required version: <Text style={styles.bold}>{minVersion}+</Text></Text>
          <Text style={styles.versionText}>Latest version: <Text style={styles.bold}>{currentVersion}</Text></Text>
        </View>
      )}
      {releaseNotes ? (
        <View style={styles.notesBox}>
          <Text style={styles.notesTitle}>What's new</Text>
          <Text style={styles.notesText}>{releaseNotes}</Text>
        </View>
      ) : null}
      <TouchableOpacity style={styles.button} onPress={() => Linking.openURL(downloadUrl)}>
        <Text style={styles.buttonText}>Download Update</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: colors.background,
    alignItems: "center", justifyContent: "center",
    padding: spacing.xl,
  },
  logo: { width: 140, height: 44, marginBottom: spacing.xl },
  title: {
    fontSize: fontSize.xl, fontWeight: "800",
    color: colors.text, marginBottom: spacing.sm, textAlign: "center",
  },
  subtitle: {
    fontSize: fontSize.md, color: colors.textSecondary,
    textAlign: "center", lineHeight: 22, marginBottom: spacing.lg,
  },
  versionBox: {
    backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md,
    width: "100%", marginBottom: spacing.md, gap: 4,
    borderWidth: 1, borderColor: colors.border,
  },
  versionText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: "center" },
  bold: { fontWeight: "700", color: colors.text },
  notesBox: {
    backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md,
    width: "100%", marginBottom: spacing.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  notesTitle: { fontSize: fontSize.sm, fontWeight: "700", color: colors.text, marginBottom: spacing.xs },
  notesText: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20 },
  button: {
    backgroundColor: colors.primary, borderRadius: 12,
    paddingVertical: spacing.md, paddingHorizontal: spacing.xl,
    width: "100%", alignItems: "center",
  },
  buttonText: { color: "#fff", fontSize: fontSize.md, fontWeight: "700" },
});
