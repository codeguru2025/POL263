/**
 * NotificationContext — wraps SSE connection, unread count, and badge.
 *
 * Usage:
 *   const { unreadCount, refresh } = useNotifications();
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { AppState } from "react-native";
import { useAuth } from "./AuthContext";
import { useNetwork } from "./NetworkContext";
import { startSse, stopSse, addSseListener } from "../services/sseClient";
import { setBadgeCount } from "../services/pushService";
import { apiGet } from "../api";

interface NotificationState {
  unreadCount: number;
  refresh: () => Promise<void>;
}

const NotificationContext = createContext<NotificationState>({ unreadCount: 0, refresh: async () => {} });

export function useNotifications() {
  return useContext(NotificationContext);
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { isOnline } = useNetwork();
  const [unreadCount, setUnreadCount] = useState(0);
  const appState = useRef(AppState.currentState);

  const refresh = useCallback(async () => {
    if (!user || user.role === "client" || !isOnline) return;
    try {
      const data = await apiGet<{ unreadCount: number }>("/api/notifications/unread-count");
      const count = data.unreadCount ?? 0;
      setUnreadCount(count);
      setBadgeCount(count).catch(() => {});
    } catch { /* best-effort */ }
  }, [user, isOnline]);

  // Start SSE when staff/agent user logs in
  useEffect(() => {
    if (!user || user.role === "client") {
      stopSse();
      return;
    }
    if (isOnline && user.organizationId) {
      startSse(user.organizationId);
    }
    return () => stopSse();
  }, [user?.id, isOnline]);

  // Listen for incoming SSE notifications — update unread count immediately
  useEffect(() => {
    const remove = addSseListener((event) => {
      if (event.type === "notification") {
        const count = event.unreadCount ?? (unreadCount + 1);
        setUnreadCount(count);
        setBadgeCount(count).catch(() => {});
      }
    });
    return remove;
  }, [unreadCount]);

  // Refresh when app comes back to foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (appState.current.match(/inactive|background/) && next === "active") {
        refresh();
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [refresh]);

  // Initial load
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <NotificationContext.Provider value={{ unreadCount, refresh }}>
      {children}
    </NotificationContext.Provider>
  );
}
