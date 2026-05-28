import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, RefreshControl, ActivityIndicator, Modal, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNetwork } from "../context/NetworkContext";
import { colors, spacing, fontSize } from "../theme";
import { API_BASE } from "../config";

interface Group {
  id: string;
  name: string;
  description?: string;
  status: string;
  memberCount?: number;
  totalPremium?: string;
  currency?: string;
  createdAt: string;
}

interface GroupPolicy {
  id: string;
  policyNumber: string;
  status: string;
  premiumAmount: string;
  currency: string;
  clientFirstName?: string;
  clientLastName?: string;
}

export default function GroupsScreen() {
  const { isOnline } = useNetwork();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [groupPolicies, setGroupPolicies] = useState<GroupPolicy[]>([]);
  const [loadingPolicies, setLoadingPolicies] = useState(false);

  const fetchGroups = useCallback(async () => {
    if (!isOnline) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/groups`, { credentials: "include" });
      if (res.ok) setGroups(await res.json());
    } catch {} finally { setLoading(false); }
  }, [isOnline]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const onRefresh = async () => { setRefreshing(true); await fetchGroups(); setRefreshing(false); };

  const openGroup = async (group: Group) => {
    setSelectedGroup(group);
    setLoadingPolicies(true);
    try {
      const res = await fetch(`${API_BASE}/api/groups/${group.id}/policies`, { credentials: "include" });
      if (res.ok) setGroupPolicies(await res.json());
    } catch {} finally { setLoadingPolicies(false); }
  };

  const filtered = groups.filter(g =>
    `${g.name} ${g.description || ""}`.toLowerCase().includes(search.toLowerCase())
  );

  const statusColor = (s: string) =>
    s === "active" ? colors.success : s === "inactive" ? colors.danger : colors.warning;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search} placeholder="Search groups…" placeholderTextColor={colors.textMuted}
          value={search} onChangeText={setSearch}
        />
      </View>

      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>📶 Offline — groups require connectivity</Text>
        </View>
      )}

      {loading && !refreshing ? (
        <ActivityIndicator style={{ margin: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={g => g.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={filtered.length === 0 ? styles.emptyWrap : { padding: spacing.md }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>👨‍👩‍👧‍👦</Text>
              <Text style={styles.emptyTitle}>No groups found</Text>
              <Text style={styles.emptySub}>{isOnline ? "No group policies yet." : "Go online to view groups."}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => openGroup(item)}>
              <View style={styles.cardTop}>
                <Text style={styles.groupName}>{item.name}</Text>
                <View style={[styles.badge, { backgroundColor: statusColor(item.status) + "20" }]}>
                  <Text style={[styles.badgeText, { color: statusColor(item.status) }]}>
                    {item.status?.toUpperCase()}
                  </Text>
                </View>
              </View>
              {item.description && <Text style={styles.desc}>{item.description}</Text>}
              <View style={styles.cardRow}>
                {item.memberCount !== undefined && (
                  <Text style={styles.meta}>👥 {item.memberCount} members</Text>
                )}
                {item.totalPremium && (
                  <Text style={styles.meta}>💵 {item.currency} {parseFloat(item.totalPremium).toLocaleString()}</Text>
                )}
              </View>
              <Text style={styles.meta}>Since {new Date(item.createdAt).toLocaleDateString()}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Group Detail Modal */}
      <Modal visible={!!selectedGroup} animationType="slide" onRequestClose={() => setSelectedGroup(null)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{selectedGroup?.name}</Text>
            <TouchableOpacity onPress={() => setSelectedGroup(null)}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>
          {loadingPolicies ? (
            <ActivityIndicator style={{ margin: 40 }} color={colors.primary} />
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.md }}>
              <Text style={styles.sectionTitle}>Group Policies ({groupPolicies.length})</Text>
              {groupPolicies.length === 0 ? (
                <Text style={styles.noPolicies}>No policies in this group</Text>
              ) : (
                groupPolicies.map(p => (
                  <View key={p.id} style={styles.policyRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.polNum}>{p.policyNumber}</Text>
                      <Text style={styles.polClient}>
                        {p.clientFirstName} {p.clientLastName}
                      </Text>
                    </View>
                    <View style={styles.polRight}>
                      <Text style={styles.polPremium}>{p.currency} {parseFloat(p.premiumAmount || "0").toLocaleString()}</Text>
                      <Text style={[styles.polStatus, { color: p.status === "active" ? colors.success : colors.danger }]}>
                        {p.status?.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  searchRow: { padding: spacing.md },
  search: {
    backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm, fontSize: fontSize.md, color: colors.text,
    borderWidth: 1, borderColor: colors.border,
  },
  offlineBanner: { backgroundColor: "#fef3c7", padding: spacing.sm, alignItems: "center" },
  offlineText: { fontSize: fontSize.sm, color: "#92400e" },
  emptyWrap: { flex: 1, justifyContent: "center" },
  empty: { alignItems: "center", paddingVertical: 60 },
  emptyEmoji: { fontSize: 48, marginBottom: spacing.md },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text },
  emptySub: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: spacing.xs },
  card: {
    backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xs },
  groupName: { fontSize: fontSize.md, fontWeight: "700", color: colors.text, flex: 1 },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 6, marginLeft: spacing.sm },
  badgeText: { fontSize: fontSize.xs, fontWeight: "700" },
  desc: { fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: spacing.xs },
  cardRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xs },
  meta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  modal: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  modalTitle: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text, flex: 1 },
  closeBtn: { fontSize: 20, color: colors.textSecondary, padding: spacing.sm },
  sectionTitle: { fontSize: fontSize.md, fontWeight: "700", color: colors.text, marginBottom: spacing.md },
  noPolicies: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: "center", padding: spacing.xl },
  policyRow: {
    flexDirection: "row", backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  polNum: { fontSize: fontSize.sm, fontWeight: "700", color: colors.primary },
  polClient: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  polRight: { alignItems: "flex-end" },
  polPremium: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text },
  polStatus: { fontSize: fontSize.xs, fontWeight: "700", marginTop: 2 },
});
