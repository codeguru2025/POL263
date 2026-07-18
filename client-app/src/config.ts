/**
 * API base URL: fixed per build, mirrors agent-app/src/config.ts and the web app's
 * VITE_API_BASE pattern — set via EXPO_PUBLIC_API_BASE at build time. No same-origin
 * fallback (unlike web): a native app never shares an origin with the API.
 */
export const API_BASE = process.env.EXPO_PUBLIC_API_BASE || "http://192.168.9.138:5000";

export const DEEP_LINK_SCHEME = "pol263client";
