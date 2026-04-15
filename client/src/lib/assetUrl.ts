import { getApiBase } from "./queryClient";

/** Default POL263 logo URL with cache-bust so updates apply after deploy. */
export function getDefaultLogoUrl(): string {
  return `/assets/logo.png?v=${typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "2"}`;
}

/**
 * Resolve a tenant/org asset URL (logo, signature) for use in img src.
 * - Absolute URLs (http/https) are returned as-is.
 * - Relative paths (e.g. /uploads/xxx) are prefixed with the API base so images
 *   load correctly when the app and API are on different origins (e.g. dev proxy, separate API host).
 */
export function resolveAssetUrl(url: string | null | undefined): string {
  if (!url || !url.trim()) return "";
  const u = url.trim();
  if (u.startsWith("//")) return `https:${u}`;
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  const base = getApiBase();
  return base ? `${base.replace(/\/$/, "")}${u.startsWith("/") ? u : `/${u}`}` : u;
}

/** Format receipt number for display (e.g. "42" -> "RCP-00042"). */
export function formatReceiptNumber(receiptNumber: string | null | undefined): string {
  if (!receiptNumber || !String(receiptNumber).trim()) return "—";
  const num = String(receiptNumber).replace(/\D/g, "") || "0";
  return `RCP-${num.padStart(5, "0")}`;
}
