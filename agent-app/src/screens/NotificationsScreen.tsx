import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNetwork } from "../context/NetworkContext";
import { useNotifications } from "../context/NotificationContext";
import { colors, spacing, fontSize } from "../theme";
import { getDb } from "../db/schema";
import { apiGet, apiPatch } from "../api";
import { clearBadge } from "../services/pushService";

interface Notification {
  id: string;
  type: string;
  title: string;
  /** Server returns 'body'; 'message' kept for backward compat with local cache. */
  body?: string;
  message?: string;
  isRead: boolean;
  createdAt: string;
  metadata?: any;
}

export default function NotificationsScreen() {
  const { isOnline } = useNetwork();
  const { refresh: refreshCount } = useNotifications();
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      if (isOnline) {
        const data = await apiGet<any>("/api/notifications");
        const raw: any[] = Array.isArray(data) ? data : (data.notifications ?? []);
        // Normalise: server uses 'body', local cache used 'message'
        const items: Notification[] = raw.map((n) => ({ ...n, message: n.body ?? n.message ?? "" }));
        setNotifs(items);
        const db = await getDb();
        await db.runAsync("DELETE FROM cache_my_notifications");
        for (const n of items) {
          await db.runAsync("INSERT OR REPLACE INTO cache_my_notifications (id, data, updated_at) VALUES (?, ?, datetime('now'))", n.id, JSON.stringify(n));
        }
      } else {
        const db = await getDb();
        const rows = await db.getAllAsync<{ data: string }>("SELECT data FROM cache_my_notifications ORDER BY updated_at DESC");
        setNotifs(rows.map(r => JSON.parse(r.data)));
      }
    } catch {} finally { setLoading(false); }
  }, [isOnline]);

  // Clear badge when user opens this screen
  useEffect(() => {
    fetch_();
    clearBadge().catch(() => {});
  }, [fetch_]);

  const onRefresh = async () => { setRefreshing(true); await fetch_(); setRefreshing(false); };

  const markRead = async (id: string) => {
    try {
      await apiPatch(`/api/notifications/${id}/read`);
      setNotifs(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    } catch {}
  };

  const markAllRead = async () => {
    try {
      await apiPatch("/api/notifications/mark-all-read");
      setNotifs(prev => prev.map(n => ({ ...n, isRead: true })));
      refreshCount();
      clearBadge().catch(() => {});
    } catch {}
  };

  const typeEmoji: Record<string, string> = {
    TRIP_ASSIGNED: "🚗", CLAIM_SUBMITTED: "🏥", CLAIM_STATUS: "📝",
    APPROVAL_NEEDED: "✅", APPROVAL_RESOLVED: "📋", PAYMENT_RECEIVED: "💰",
    COMMISSION_EARNED: "💵", POLICY_ISSUED: "📄", ATTENDANCE_RESOLVED: "🕐",
    // legacy client-side keys
    policy_created: "📋", payment_received: "💰", claim_submitted: "🏥",
    claim_updated: "📝", policy_lapsed: "⚠️", premium_due: "📅",
    default: "🔔",
  };

  const unreadCount = notifs.filter(n => !n.isRead).length;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Notifications {unreadCount > 0 && `(${unreadCount} unread)`}</Text>
        {unreadCount > 0 && isOnline && (
          <TouchableOpacity onPress={markAllRead} style={styles.markAllBtn}>
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>📶 Offline — showing cached notifications</Text>
        </View>
      )}

      {loading && !refreshing ? (
        <ActivityIndicator style={{ margin: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={notifs}
          keyExtractor={n => n.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={notifs.length === 0 ? styles.emptyWrap : { padding: spacing.md }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>🔔</Text>
              <Text style={styles.emptyTitle}>No notifications</Text>
              <Text style={styles.emptySub}>You're all caught up!</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.card, !item.isRead && styles.cardUnread]}
              onPress={() => !item.isRead && markRead(item.id)}
              activeOpacity={item.isRead ? 1 : 0.7}
            >
              <View style={styles.cardLeft}>
                <Text style={styles.emoji}>{typeEmoji[item.type] || typeEmoji.default}</Text>
                {!item.isRead && <View style={styles.dot} />}
              </View>
              <View style={styles.cardBody}>
                <Text style={[styles.notifTitle, !item.isRead && styles.notifTitleUnread]}>
                  {item.title}
                </Text>
                <Text style={styles.notifMessage} numberOfLines={2}>{item.message}</Text>
                <Text style={styles.notifTime}>{new Date(item.createdAt).toLocaleString()}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  headerRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text },
  markAllBtn: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  markAllText: { fontSize: fontSize.sm, color: colors.primary, fontWeight: "600" },
  offlineBanner: { backgroundColor: "#fef3c7", padding: spacing.sm, alignItems: "center" },
  offlineText: { fontSize: fontSize.sm, color: "#92400e" },
  emptyWrap: { flex: 1, justifyContent: "center" },
  empty: { alignItems: "center", paddingVertical: 60 },
  emptyEmoji: { fontSize: 48, marginBottom: spacing.md },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text },
  emptySub: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: spacing.xs },
  card: {
    flexDirection: "row", backgroundColor: colors.surface, borderRadius: 12,
    padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  cardUnread: { borderColor: colors.primary, backgroundColor: "#eff6ff" },
  cardLeft: { alignItems: "center", marginRight: spacing.md, width: 36 },
  emoji: { fontSize: 24 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: spacing.xs },
  cardBody: { flex: 1 },
  notifTitle: { fontSize: fontSize.sm, fontWeight: "600", color: colors.textSecondary, marginBottom: 2 },
  notifTitleUnread: { color: colors.text, fontWeight: "700" },
  notifMessage: { fontSize: fontSize.sm, color: colors.text, lineHeight: 18, marginBottom: spacing.xs },
  notifTime: { fontSize: fontSize.xs, color: colors.textMuted },
});
