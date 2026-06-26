import { getApiBase } from "./queryClient";

/** Default POL263 logo URL with cache-bust so updates apply after deploy. */
export function getDefaultLogoUrl(): string {
  return `/assets/logo.png?v=${typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "2"}`;
}

/**
 * Resolve a tenant/org asset URL (logo, signature) for use in img src.
 *
 * Old records stored full CDN/Spaces URLs (https://…digitaloceanspaces.com/…).
 * New uploads return /uploads/<key> proxy paths.
 *
 * Both are routed through our /uploads/* proxy so the bucket can stay private
 * and the browser never needs direct S3 credentials or public ACLs.
 */
export function resolveAssetUrl(url: string | null | undefined): string {
  if (!url || !url.trim()) return "";
  const u = url.trim();
  if (u.startsWith("//")) return `https:${u}`;
  const base = getApiBase()?.replace(/\/$/, "") ?? "";

  if (u.startsWith("http://") || u.startsWith("https://")) {
    // Convert old DO Spaces CDN URLs to our proxy path.
    // CDN format:  https://<bucket>.<region>.cdn.digitaloceanspaces.com/<key>
    // Direct format: https://<region>.digitaloceanspaces.com/<bucket>/<key>
    const cdnMatch = u.match(/https?:\/\/[^/]+\.cdn\.digitaloceanspaces\.com\/(.+)/);
    if (cdnMatch) return `${base}/uploads/${cdnMatch[1]}`;
    const directMatch = u.match(/https?:\/\/[^/]+\.digitaloceanspaces\.com\/[^/]+\/(.+)/);
    if (directMatch) return `${base}/uploads/${directMatch[1]}`;
    // Non-Spaces absolute URL (external images) — return as-is
    return u;
  }

  return `${base}${u.startsWith("/") ? u : `/${u}`}`;
}

/** Format receipt number for display (e.g. "42" -> "RCP-00042"). */
export function formatReceiptNumber(receiptNumber: string | null | undefined): string {
  if (!receiptNumber || !String(receiptNumber).trim()) return "—";
  const num = String(receiptNumber).replace(/\D/g, "") || "0";
  return `RCP-${num.padStart(5, "0")}`;
}
