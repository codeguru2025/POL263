/**
 * S3-compatible object storage (DigitalOcean Spaces / Cloudflare R2).
 *
 * When R2_ENDPOINT + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY + R2_BUCKET are
 * set the module uploads to the remote bucket and returns public URLs.
 * Otherwise it falls back to local disk (uploads/ directory).
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { structuredLog } from "./logger";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const R2_ENDPOINT = process.env.R2_ENDPOINT?.replace(/\/$/, "");
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL?.replace(/\/$/, "");

export const isObjectStorageEnabled =
  !!R2_ENDPOINT && !!R2_ACCESS_KEY_ID && !!R2_SECRET_ACCESS_KEY && !!R2_BUCKET;

let s3: S3Client | null = null;

function getClient(): S3Client {
  if (!s3) {
    s3 = new S3Client({
      endpoint: R2_ENDPOINT!,
      region: "us-east-1",
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID!,
        secretAccessKey: R2_SECRET_ACCESS_KEY!,
      },
      forcePathStyle: false,
    });
  }
  return s3;
}

if (isObjectStorageEnabled) {
  structuredLog("info", "Object storage enabled", { endpoint: R2_ENDPOINT, bucket: R2_BUCKET });
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
 */
export async function uploadFile(
  buffer: Buffer,
  originalName: string,
  contentType: string,
  prefix = "",
): Promise<{ url: string; key: string }> {
  if (!isObjectStorageEnabled) {
    return uploadLocal(buffer, originalName, prefix);
  }

  const key = generateKey(originalName, prefix);
  const client = getClient();

  await client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET!,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ACL: "public-read",
    }),
  );

  const url = R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${key}` : `${R2_ENDPOINT}/${R2_BUCKET}/${key}`;

  structuredLog("info", "Uploaded file to object storage", { key, contentType, size: buffer.length });
  return { url, key };
}

/**
 * Delete a file from object storage by key.
 */
export async function deleteFile(key: string): Promise<void> {
  if (!isObjectStorageEnabled) return;
  try {
    const client = getClient();
    await client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET!, Key: key }));
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
    const res = await client.send(new GetObjectCommand({ Bucket: R2_BUCKET!, Key: key }));
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

/**
 * Resolve any image URL/path to a Buffer for PDF embedding.
 * Handles: full https URLs, Spaces public URLs, /uploads/... relative paths.
 */
export async function resolveImage(url: string | null | undefined): Promise<Buffer | null> {
  if (!url || !url.trim()) return null;
  const u = url.trim();

  if (u.startsWith("http://") || u.startsWith("https://")) {
    try {
      const res = await fetch(u, { headers: { "User-Agent": "POL263" } });
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
