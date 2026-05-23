import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl, Image,
} from "react-native";
import { useAuth } from "../context/AuthContext";
import { useNetwork } from "../context/NetworkContext";
import { getSyncStatus, fullSync, type SyncStatus } from "../sync/engine";
import { getDb } from "../db/schema";
import { colors, spacing, fontSize } from "../theme";
import { API_BASE } from "../config";

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const { isOnline } = useNetwork();
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadStatus = useCallback(async () => {
    const status = await getSyncStatus();
    setSyncStatus(status);
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadStatus();
    setRefreshing(false);
  }, [loadStatus]);

  const handleSync = async () => {
    if (!isOnline) {
      Alert.alert("Offline", "Connect to the internet to sync.");
      return;
    }
    setRefreshing(true);
    try {
      const result = await fullSync();
      await loadStatus();
      Alert.alert("Sync Complete", `Synced ${result.synced} items.${result.errors.length ? `\n\nErrors:\n${result.errors.join("\n")}` : ""}`);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
    setRefreshing(false);
  };

  const handleClearCache = () => {
    Alert.alert(
      "Clear Local Data",
      "This will delete all cached server data (not your pending uploads). Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear", style: "destructive", onPress: async () => {
            const db = await getDb();
            await db.runAsync("DELETE FROM cache_products");
            await db.runAsync("DELETE FROM cache_product_versions");
            await db.runAsync("DELETE FROM cache_add_ons");
            await db.runAsync("DELETE FROM cache_my_policies");
            await db.runAsync("DELETE FROM cache_my_clients");
            Alert.alert("Cleared", "Cache cleared. Pull fresh data on next sync.");
          },
        },
      ]
    );
  };

  const handleLogout = () => {
    const pending = (syncStatus?.pendingClients ?? 0) + (syncStatus?.pendingPolicies ?? 0);
    if (pending > 0) {
      Alert.alert(
        "Pending Data",
        `You have ${pending} unsynced item(s). Logging out will NOT delete them — they'll sync on next login. Continue?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Logout", style: "destructive", onPress: logout },
        ]
      );
    } else {
      logout();
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Profile */}
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(user?.firstName?.[0] || "")}{(user?.lastName?.[0] || "")}
          </Text>
        </View>
        <Text style={styles.name}>{user?.firstName} {user?.lastName}</Text>
        <Text style={styles.email}>{user?.email}</Text>
      </View>

      {/* Sync Status */}
      <Text style={styles.sectionTitle}>Sync Status</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Connection</Text>
          <View style={[styles.dot, isOnline ? styles.dotOnline : styles.dotOffline]} />
          <Text style={styles.rowValue}>{isOnline ? "Online" : "Offline"}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Pending Clients</Text>
          <Text style={styles.rowValue}>{syncStatus?.pendingClients ?? 0}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Pending Policies</Text>
          <Text style={styles.rowValue}>{syncStatus?.pendingPolicies ?? 0}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Last Sync</Text>
          <Text style={styles.rowValue}>{syncStatus?.lastSync || "Never"}</Text>
        </View>

        <TouchableOpacity
          style={[styles.syncButton, (!isOnline || refreshing) && styles.buttonDisabled]}
          onPress={handleSync}
          disabled={!isOnline || refreshing}
        >
          <Text style={styles.syncButtonText}>{refreshing ? "Syncing…" : "Sync Now"}</Text>
        </TouchableOpacity>
      </View>

      {/* Server */}
      <Text style={styles.sectionTitle}>Server</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>API</Text>
          <Text style={[styles.rowValue, { fontSize: fontSize.xs }]}>{API_BASE}</Text>
        </View>
      </View>

      {/* Actions */}
      <Text style={styles.sectionTitle}>Data</Text>
      <TouchableOpacity style={styles.actionButton} onPress={handleClearCache}>
        <Text style={styles.actionText}>Clear Cached Data</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.actionButton, styles.logoutButton]} onPress={handleLogout}>
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>

      <Image source={require("../../assets/logo.png")} style={styles.footerLogo} resizeMode="contain" />
      <Text style={styles.version}>POL263 Agent v1.0.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: 40 },
  card: {
    backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  avatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary,
    alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: spacing.sm,
  },
  avatarText: { color: "#fff", fontSize: fontSize.xl, fontWeight: "700" },
  name: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text, textAlign: "center" },
  email: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: "center" },
  sectionTitle: {
    fontSize: fontSize.sm, fontWeight: "700", color: colors.textSecondary,
    textTransform: "uppercase", letterSpacing: 1, marginBottom: spacing.sm, marginTop: spacing.sm,
  },
  row: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  rowLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  rowValue: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.xs },
  dotOnline: { backgroundColor: colors.success },
  dotOffline: { backgroundColor: colors.warning },
  syncButton: {
    backgroundColor: colors.primary, borderRadius: 8, padding: spacing.sm,
    alignItems: "center", marginTop: spacing.md,
  },
  syncButtonText: { color: "#fff", fontWeight: "600", fontSize: fontSize.sm },
  buttonDisabled: { opacity: 0.5 },
  actionButton: {
    backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border, alignItems: "center",
  },
  actionText: { fontSize: fontSize.md, fontWeight: "500", color: colors.text },
  logoutButton: { borderColor: colors.danger },
  logoutText: { fontSize: fontSize.md, fontWeight: "600", color: colors.danger },
  footerLogo: { width: 120, height: 36, alignSelf: "center", marginTop: spacing.lg },
  version: { fontSize: fontSize.xs, color: colors.textMuted, textAlign: "center", marginTop: spacing.sm },
});
