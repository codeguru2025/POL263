/**
 * API base URL: fixed per build, mirrors the web app's VITE_API_BASE pattern
 * (client/src/lib/queryClient.ts) — set via EXPO_PUBLIC_API_BASE at build time.
 * No same-origin fallback here (unlike web): a native app never shares an origin
 * with the API, so this must always point somewhere real.
 */
export const API_BASE = process.env.EXPO_PUBLIC_API_BASE || "http://192.168.9.138:5000";

/** Must match capacitor's old scheme and the server's existing OAuth deep-link handoff
 *  (server/auth.ts redirects to `${DEEP_LINK_SCHEME}://auth/callback?token=...`). */
export const DEEP_LINK_SCHEME = "pol263";
