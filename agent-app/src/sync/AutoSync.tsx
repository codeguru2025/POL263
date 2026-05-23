import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useNetwork } from "../context/NetworkContext";
import { useAuth } from "../context/AuthContext";
import { fullSync, getSyncStatus } from "./engine";
import { SYNC_INTERVAL_MS } from "../config";

/**
 * Invisible component that auto-syncs when:
 * 1. The app comes back online
 * 2. The app comes to foreground
 * 3. Periodically while online (every SYNC_INTERVAL_MS)
 */
export default function AutoSync() {
  const { isOnline } = useNetwork();
  const { user } = useAuth();
  const wasOffline = useRef(!isOnline);
  const syncingRef = useRef(false);

  const doSync = async () => {
    if (syncingRef.current || !user) return;
    syncingRef.current = true;
    try {
      const status = await getSyncStatus();
      if (status.pendingClients > 0 || status.pendingPolicies > 0) {
        await fullSync();
      }
    } catch {
      // silent — will retry
    } finally {
      syncingRef.current = false;
    }
  };

  // Sync when coming back online
  useEffect(() => {
    if (isOnline && wasOffline.current) {
      doSync();
    }
    wasOffline.current = !isOnline;
  }, [isOnline]);

  // Sync when app comes to foreground
  useEffect(() => {
    const handler = (nextState: AppStateStatus) => {
      if (nextState === "active" && isOnline) {
        doSync();
      }
    };
    const sub = AppState.addEventListener("change", handler);
    return () => sub.remove();
  }, [isOnline]);

  // Periodic sync
  useEffect(() => {
    if (!isOnline || !user) return;
    const interval = setInterval(doSync, SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isOnline, user]);

  return null;
}
