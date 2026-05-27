import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  TouchableOpacity, Alert, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../context/AuthContext";
import { useNetwork } from "../context/NetworkContext";
import { getSyncStatus, fullSync, type SyncStatus } from "../sync/engine";
import { getDb } from "../db/schema";
import { colors, spacing, fontSize } from "../theme";

export default function DashboardScreen() {
  const { user } = useAuth();
  const { isOnline } = useNetwork();
  const [refreshing, setRefreshing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [stats, setStats] = useState({ clients: 0, policies: 0, leads: 0, commissions: 0, pendingSync: 0 });

  const loadStats = useCallback(async () => {
    const db = await getDb();
    const clientCount = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM clients"
    );
    const cachedClientCount = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM cache_my_clients"
    );
    const policyCount = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM policies"
    );
    const cachedPolicyCount = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM cache_my_policies"
    );
    const pending = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM clients WHERE synced = 0"
    );
    const pendingPolicies = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM policies WHERE synced = 0"
    );
    const leadCount = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM cache_my_leads"
    ).catch(() => ({ count: 0 }));
    const commissionCount = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM cache_my_commissions"
    ).catch(() => ({ count: 0 }));
    setStats({
      clients: Math.max(clientCount?.count ?? 0, cachedClientCount?.count ?? 0),
      policies: Math.max(policyCount?.count ?? 0, cachedPolicyCount?.count ?? 0),
      leads: leadCount?.count ?? 0,
      commissions: commissionCount?.count ?? 0,
      pendingSync: (pending?.count ?? 0) + (pendingPolicies?.count ?? 0),
    });
    const status = await getSyncStatus();
    setSyncStatus(status);
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (isOnline) {
      try {
        const result = await fullSync();
        if (result.errors.length > 0) {
          Alert.alert("Sync Issues", result.errors.join("\n"));
        }
      } catch (e: any) {
        Alert.alert("Sync Error", e.message);
      }
    }
    await loadStats();
    setRefreshing(false);
  }, [isOnline, loadStats]);

  const handleSync = async () => {
    if (!isOnline) {
      Alert.alert("Offline", "You need an internet connection to sync.");
      return;
    }
    setRefreshing(true);
    try {
      const result = await fullSync();
      if (result.errors.length > 0) {
        Alert.alert("Sync Complete", `Synced ${result.synced} items.\n\nIssues:\n${result.errors.join("\n")}`);
      } else {
        Alert.alert("Sync Complete", `Successfully synced ${result.synced} items.`);
      }
    } catch (e: any) {
      Alert.alert("Sync Error", e.message);
    }
    await loadStats();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Online/Offline banner */}
      <View style={[styles.statusBanner, isOnline ? styles.bannerOnline : styles.bannerOffline]}>
        <View style={[styles.statusDot, isOnline ? styles.dotOnline : styles.dotOffline]} />
        <Text style={styles.statusText}>
          {isOnline ? "Online" : "Offline — changes will sync when connected"}
        </Text>
      </View>

      <View style={styles.brandRow}>
        <Image source={require("../../assets/logo.png")} style={styles.headerLogo} resizeMode="contain" />
      </View>

      <Text style={styles.greeting}>
        Hello, {user?.displayName?.split(" ")[0] || user?.firstName || "Agent"} 👋
      </Text>

      <View style={styles.cardRow}>
        <View style={[styles.card, { backgroundColor: "#eff6ff" }]}>
          <Text style={styles.cardValue}>{stats.clients}</Text>
          <Text style={styles.cardLabel}>My Clients</Text>
        </View>
        <View style={[styles.card, { backgroundColor: "#f0fdf4" }]}>
          <Text style={styles.cardValue}>{stats.policies}</Text>
          <Text style={styles.cardLabel}>My Policies</Text>
        </View>
      </View>
      <View style={styles.cardRow}>
        <View style={[styles.card, { backgroundColor: "#fefce8" }]}>
          <Text style={styles.cardValue}>{stats.leads}</Text>
          <Text style={styles.cardLabel}>My Leads</Text>
        </View>
        <View style={[styles.card, { backgroundColor: "#fdf2f8" }]}>
          <Text style={styles.cardValue}>{stats.commissions}</Text>
          <Text style={styles.cardLabel}>Commissions</Text>
        </View>
      </View>

      {stats.pendingSync > 0 && (
        <View style={styles.pendingCard}>
          <Text style={styles.pendingTitle}>⏳ Pending Sync</Text>
          <Text style={styles.pendingCount}>{stats.pendingSync} item(s) waiting to upload</Text>
          <TouchableOpacity
            style={[styles.syncButton, !isOnline && styles.syncButtonDisabled]}
            onPress={handleSync}
            disabled={!isOnline || refreshing}
          >
            <Text style={styles.syncButtonText}>
              {refreshing ? "Syncing…" : "Sync Now"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {syncStatus?.lastSync && (
        <Text style={styles.lastSync}>Last sync: {syncStatus.lastSync}</Text>
      )}
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.sm,
    borderRadius: 8,
    marginBottom: spacing.md,
  },
  bannerOnline: { backgroundColor: "#dcfce7" },
  bannerOffline: { backgroundColor: "#fef3c7" },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm },
  dotOnline: { backgroundColor: colors.success },
  dotOffline: { backgroundColor: colors.warning },
  statusText: { fontSize: fontSize.sm, color: colors.text, fontWeight: "500" },
  brandRow: {
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  headerLogo: {
    width: 160,
    height: 44,
  },
  greeting: {
    fontSize: fontSize.xl,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.md,
  },
  cardRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  card: {
    flex: 1,
    padding: spacing.md,
    borderRadius: 12,
    alignItems: "center",
  },
  cardValue: {
    fontSize: fontSize.xxl,
    fontWeight: "800",
    color: colors.primary,
  },
  cardLabel: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  pendingCard: {
    backgroundColor: "#fff7ed",
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "#fed7aa",
    marginBottom: spacing.md,
  },
  pendingTitle: {
    fontSize: fontSize.md,
    fontWeight: "700",
    color: "#9a3412",
    marginBottom: spacing.xs,
  },
  pendingCount: {
    fontSize: fontSize.sm,
    color: "#c2410c",
    marginBottom: spacing.sm,
  },
  syncButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    padding: spacing.sm,
    alignItems: "center",
  },
  syncButtonDisabled: { opacity: 0.5 },
  syncButtonText: { color: "#fff", fontWeight: "600", fontSize: fontSize.sm },
  lastSync: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.md,
  },
});
