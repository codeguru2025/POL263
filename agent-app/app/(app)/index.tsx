import { useEffect, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../../src/context/AuthContext";
import { getOrgBranding, type Branding } from "../../src/api/branding";
import { API_BASE } from "../../src/config";

export default function HomeScreen() {
  const { user, roles, permissions, isAgent } = useAuth();
  const [branding, setBranding] = useState<Branding | null>(null);

  useEffect(() => {
    if (user?.organizationId) getOrgBranding(user.organizationId).then(setBranding);
  }, [user?.organizationId]);

  const logoUri = branding?.logoUrl?.startsWith("http") ? branding.logoUrl : `${API_BASE}${branding?.logoUrl ?? ""}`;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {branding && <Image source={{ uri: logoUri }} style={styles.logo} resizeMode="contain" />}
      <Text style={styles.orgName}>{branding?.name ?? "…"}</Text>
      <Text style={styles.welcome}>Welcome back, {user?.displayName ?? user?.email}</Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Signed in as</Text>
        <Text style={styles.cardValue}>{roles.map((r) => r.name).join(", ") || "no roles"}</Text>
        <Text style={styles.cardLabel}>View</Text>
        <Text style={styles.cardValue}>{isAgent ? "Agent" : "Staff"}</Text>
        <Text style={styles.cardLabel}>Permissions</Text>
        <Text style={styles.cardValueSmall}>{permissions.join(", ") || "none"}</Text>
      </View>

      <Text style={styles.note}>
        Bootstrap milestone: auth + role-resolved navigation only. Screen-by-screen features
        (leads, policies, clients, attendance…) come next.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F6F6" },
  content: { padding: 24, alignItems: "center" },
  logo: { width: 72, height: 72, marginBottom: 8 },
  orgName: { fontSize: 18, fontWeight: "700", color: "#14201F", marginBottom: 4 },
  welcome: { fontSize: 14, color: "#5B6D6B", marginBottom: 24 },
  card: { width: "100%", backgroundColor: "#FFFFFF", borderRadius: 12, borderWidth: 1, borderColor: "#DCE3E1", padding: 18, gap: 2 },
  cardLabel: { fontSize: 11, fontWeight: "600", color: "#8A9997", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 10 },
  cardValue: { fontSize: 15, color: "#14201F", fontWeight: "600" },
  cardValueSmall: { fontSize: 12, color: "#5B6D6B", lineHeight: 18 },
  note: { fontSize: 12, color: "#8A9997", textAlign: "center", marginTop: 28, lineHeight: 18 },
});
