/**
 * S3-compatible object storage (DigitalOcean Spaces / Cloudflare R2).
 *
 * Reads DO_SPACES_* env vars (canonical). Falls back to R2_* for legacy compatibility.
 * When neither is configured, falls back to local disk (uploads/ directory).
 *
 * DO Spaces env vars:
 *   DO_SPACES_ENDPOINT  — e.g. https://nyc3.digitaloceanspaces.com
 *   DO_SPACES_REGION    — e.g. nyc3  (used to build public URL when CDN_URL not set)
 *   DO_SPACES_BUCKET    — your bucket name
 *   DO_SPACES_KEY       — Spaces access key
 *   DO_SPACES_SECRET    — Spaces secret key
 *   DO_SPACES_CDN_URL   — optional CDN endpoint (e.g. https://mybucket.nyc3.cdn.digitaloceanspaces.com)
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { structuredLog } from "./logger";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import dns from "dns/promises";

// Resolve config — DO_SPACES_* first, then R2_* legacy
const ENDPOINT =
  process.env.DO_SPACES_ENDPOINT?.replace(/\/$/, "") ||
  process.env.R2_ENDPOINT?.replace(/\/$/, "");

const ACCESS_KEY =
  process.env.DO_SPACES_KEY ||
  process.env.R2_ACCESS_KEY_ID ||
  process.env.AWS_ACCESS_KEY_ID;

const SECRET_KEY =
  process.env.DO_SPACES_SECRET ||
  process.env.R2_SECRET_ACCESS_KEY ||
  process.env.AWS_SECRET_ACCESS_KEY;

const BUCKET =
  process.env.DO_SPACES_BUCKET ||
  process.env.R2_BUCKET ||
  process.env.AWS_S3_BUCKET;

const REGION =
  process.env.DO_SPACES_REGION ||
  process.env.AWS_REGION ||
  "us-east-1";

// Public URL for generated file links.
// Prefer explicit CDN URL, then explicit public URL, then derive from bucket + endpoint.
function buildPublicUrl(): string {
  if (process.env.DO_SPACES_CDN_URL) return process.env.DO_SPACES_CDN_URL.replace(/\/$/, "");
  if (process.env.DO_SPACES_PUBLIC_URL) return process.env.DO_SPACES_PUBLIC_URL.replace(/\/$/, "");
  if (process.env.R2_PUBLIC_URL) return process.env.R2_PUBLIC_URL.replace(/\/$/, "");
  if (BUCKET && ENDPOINT) {
    // DO Spaces virtual-hosted style: https://{bucket}.{region}.digitaloceanspaces.com
    // Build from endpoint: https://nyc3.digitaloceanspaces.com → https://{bucket}.nyc3.digitaloceanspaces.com
    try {
      const u = new URL(ENDPOINT);
      return `${u.protocol}//${BUCKET}.${u.host}`;
    } catch {
      return `${ENDPOINT}/${BUCKET}`;
    }
  }
  return "";
}

export const isObjectStorageEnabled =
  !!ENDPOINT && !!ACCESS_KEY && !!SECRET_KEY && !!BUCKET;

const PUBLIC_URL = buildPublicUrl();

let s3: S3Client | null = null;

function getClient(): S3Client {
  if (!s3) {
    s3 = new S3Client({
      endpoint: ENDPOINT!,
      region: REGION,
      credentials: {
        accessKeyId: ACCESS_KEY!,
        secretAccessKey: SECRET_KEY!,
      },
      forcePathStyle: false, // DO Spaces uses virtual-hosted style
    });
  }
  return s3;
}

if (isObjectStorageEnabled) {
  structuredLog("info", "Object storage enabled", { endpoint: ENDPOINT, bucket: BUCKET, publicUrl: PUBLIC_URL });
} else {
  structuredLog("warn", "Object storage not configured — using local disk (uploads/)");
}

function generateKey(originalName: string, prefix = ""): string {
  const ext = path.extname(originalName).replace(/[^a-zA-Z0-9.]/g, "").slice(0, 10);
  const hash = crypto.randomBytes(12).toString("hex");
  const ts = Date.now();
  const key = prefix ? `${prefix}/${ts}-${hash}${ext}` : `${ts}-${hash}${ext}`;
  return key;
}

/**
 * Upload a file buffer to object storage and return the public URL.
 * Falls back to local disk when object storage is not configured.
 *
 * @param publicAccess  When true, sets ACL=public-read so the CDN URL is directly
 *                      accessible by the browser (logos, signatures, advert images).
 *                      Leave false for private documents served via authenticated proxy.
 */
export async function uploadFile(
  buffer: Buffer,
  originalName: string,
  contentType: string,
  prefix = "",
  publicAccess = false,
): Promise<{ url: string; key: string }> {
  if (!isObjectStorageEnabled) {
    return uploadLocal(buffer, originalName, prefix);
  }

  const key = generateKey(originalName, prefix);
  const client = getClient();

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET!,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ...(publicAccess ? { ACL: "public-read" } : {}),
    }),
  );

  const url = PUBLIC_URL ? `${PUBLIC_URL}/${key}` : `${ENDPOINT}/${BUCKET}/${key}`;

  structuredLog("info", "Uploaded file to object storage", { key, contentType, size: buffer.length, public: publicAccess });
  return { url, key };
}

/**
 * Delete a file from object storage by key.
 */
export async function deleteFile(key: string): Promise<void> {
  if (!isObjectStorageEnabled) return;
  try {
    const client = getClient();
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET!, Key: key }));
    structuredLog("info", "Deleted file from object storage", { key });
  } catch (err: any) {
    structuredLog("error", "Failed to delete from object storage", { key, error: err.message });
  }
}

/**
 * Fetch a file from object storage as a Buffer.
 */
export async function fetchFile(key: string): Promise<Buffer | null> {
  if (!isObjectStorageEnabled) return null;
  try {
    const client = getClient();
    const res = await client.send(new GetObjectCommand({ Bucket: BUCKET!, Key: key }));
    if (!res.Body) return null;
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as any) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

// Fix 2: SSRF guard — block requests to private/loopback/link-local IP ranges.
// Covers: 10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x (metadata service), ::1, fc00::/7
const PRIVATE_IP_RE =
  /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.|0\.0\.0\.0|::1$|fd[0-9a-f]{2}:|fc[0-9a-f]{2}:)/i;

async function isSsrfSafeUrl(rawUrl: string): Promise<boolean> {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return false; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname;
  if (PRIVATE_IP_RE.test(host)) return false;
  // Resolve hostname and verify the resulting IP is not private
  try {
    const addrs = await dns.lookup(host, { all: true });
    for (const { address } of addrs) {
      if (PRIVATE_IP_RE.test(address)) return false;
    }
  } catch {
    return false; // unresolvable host — refuse
  }
  return true;
}

/**
 * Resolve any image URL/path to a Buffer for PDF embedding.
 * Handles: full https URLs, Spaces public URLs, /uploads/... relative paths.
 */
export async function resolveImage(url: string | null | undefined): Promise<Buffer | null> {
  if (!url || !url.trim()) return null;
  const u = url.trim();

  if (u.startsWith("http://") || u.startsWith("https://")) {
    // For our own object storage URLs use the authenticated S3 client so private
    // bucket ACLs don't block the fetch (e.g. receipt advert / logo images).
    if (isObjectStorageEnabled && PUBLIC_URL && u.startsWith(PUBLIC_URL + "/")) {
      const key = u.slice(PUBLIC_URL.length + 1);
      const buf = await fetchFile(key);
      if (buf) return buf;
      // Fall through to direct public fetch if S3 fetch fails
    }
    // Fix 2: Validate URL against SSRF targets before fetching
    if (!(await isSsrfSafeUrl(u))) {
      structuredLog("warn", "resolveImage: blocked SSRF-risky URL", { url: u });
      return null;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(u, { headers: { "User-Agent": "POL263" }, signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  if (isObjectStorageEnabled) {
    const key = u.replace(/^\/?(uploads\/)?/, "");
    const buf = await fetchFile(key);
    if (buf) return buf;
  }

  const relativePath = u.replace(/^\/+/, "");
  const bases = [
    { base: path.join(process.cwd(), "uploads"), subPath: relativePath.startsWith("uploads/") ? relativePath.slice(8) : relativePath },
    { base: path.join(process.cwd(), "public", "uploads"), subPath: relativePath.startsWith("uploads/") ? relativePath.slice(8) : relativePath },
    { base: path.join(process.cwd(), "dist", "public"), subPath: relativePath },
    { base: path.join(process.cwd(), "client", "public"), subPath: relativePath },
    { base: process.cwd(), subPath: relativePath },
  ];
  for (const { base, subPath } of bases) {
    const localPath = path.resolve(base, subPath);
    if (fs.existsSync(localPath)) {
      try {
        return fs.readFileSync(localPath);
      } catch {
        continue;
      }
    }
  }

  const appBase = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  if (appBase) {
    try {
      const fullUrl = `${appBase}${u.startsWith("/") ? u : `/${u}`}`;
      const res = await fetch(fullUrl, { headers: { "User-Agent": "POL263" } });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch {}
  }

  return null;
}

/** Local disk fallback */
function uploadLocal(
  buffer: Buffer,
  originalName: string,
  prefix: string,
): { url: string; key: string } {
  const dir = prefix
    ? path.resolve(process.cwd(), "uploads", prefix)
    : path.resolve(process.cwd(), "uploads");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const ext = path.extname(originalName).replace(/[^a-zA-Z0-9.]/g, "").slice(0, 10);
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, buffer);

  const key = prefix ? `${prefix}/${filename}` : filename;
  const url = `/uploads/${key}`;
  return { url, key };
}
