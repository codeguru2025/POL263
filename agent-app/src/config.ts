// Change this to your production URL when deploying
export const API_BASE = __DEV__
  ? "http://10.0.2.2:5000" // Android emulator localhost alias
  : "https://falakhe.pol263.com";

export const APP_NAME = "POL263 Agent";
export const SYNC_INTERVAL_MS = 30_000; // 30 seconds when online
