import { getApiBase } from "./queryClient";

/**
 * Resolve a tenant/org asset URL (logo, signature) for use in img src.
 * - Absolute URLs (http/https) are returned as-is.
 * - Relative paths (e.g. /uploads/xxx) are prefixed with the API base so images
 *   load correctly when the app and API are on different origins (e.g. dev proxy, separate API host).
 */
export function resolveAssetUrl(url: string | null | undefined): string {
  if (!url || !url.trim()) return "";
  const u = url.trim();
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  const base = getApiBase();
  return base ? `${base.replace(/\/$/, "")}${u.startsWith("/") ? u : `/${u}`}` : u;
}
