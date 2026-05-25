import { useEffect, useState } from "react";
import * as Updates from "expo-updates";
import { Alert, Linking } from "react-native";
import { API_BASE } from "../config";

const APP_VERSION = "1.0.0";   // keep in sync with app.json version
const APP_BUILD   = 1;          // keep in sync with EAS build number (auto-incremented)

export interface AppInfo {
  available: boolean;
  version?: string;
  buildNumber?: number;
  minVersion?: string;
  minBuildNumber?: number;
  downloadUrl?: string;
  releaseNotes?: string;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function useAppVersion() {
  const [forceUpdate, setForceUpdate] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [otaChecked, setOtaChecked] = useState(false);

  useEffect(() => {
    async function checkVersion() {
      try {
        const res = await fetch(`${API_BASE}/api/app-info`, { credentials: "include" });
        if (!res.ok) return;
        const info: AppInfo = await res.json();
        setAppInfo(info);
        if (!info.available) return;

        const belowMin =
          (info.minBuildNumber && APP_BUILD < info.minBuildNumber) ||
          compareVersions(APP_VERSION, info.minVersion || "1.0.0") < 0;

        if (belowMin) {
          setForceUpdate(true);
          return;
        }

        const newer =
          (info.buildNumber && APP_BUILD < info.buildNumber) ||
          compareVersions(APP_VERSION, info.version || APP_VERSION) < 0;

        if (newer) setUpdateAvailable(true);
      } catch {
        // no-op: offline or server unreachable
      }
    }

    async function checkOta() {
      if (__DEV__) { setOtaChecked(true); return; }
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
        }
      } catch {
        // no-op
      } finally {
        setOtaChecked(true);
      }
    }

    checkOta();
    checkVersion();
  }, []);

  const promptUpdate = (downloadUrl: string) => {
    Alert.alert(
      "Update Available",
      `A newer version of the app is available. Would you like to update now?`,
      [
        { text: "Later", style: "cancel" },
        { text: "Update", onPress: () => Linking.openURL(downloadUrl) },
      ]
    );
  };

  return { forceUpdate, updateAvailable, appInfo, otaChecked, promptUpdate };
}
