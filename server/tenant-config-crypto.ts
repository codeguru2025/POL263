/**
 * AES-256-GCM encryption for sensitive fields in control_plane.tenant_integrations.config
 * (Paynow keys, and any future per-tenant integration secret). Never use this for anything
 * that also needs to be queried/filtered in SQL — encrypted values are opaque blobs.
 *
 * TENANT_CONFIG_ENCRYPTION_KEY must be a 32-byte key, hex-encoded (64 hex chars) — generate
 * with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended IV size for GCM

function getKey(): Buffer {
  const raw = process.env.TENANT_CONFIG_ENCRYPTION_KEY;
  if (!raw) throw new Error("TENANT_CONFIG_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error("TENANT_CONFIG_ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex characters)");
  }
  return key;
}

/** Encrypts a single string value. Output format: base64(iv):base64(authTag):base64(ciphertext). */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

/** Decrypts a value produced by encryptSecret(). Throws if the value is malformed or the tag doesn't verify. */
export function decryptSecret(stored: string): string {
  const key = getKey();
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("Malformed encrypted value (expected iv:authTag:ciphertext)");
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

/** True if the value looks like our encrypted format (iv:tag:data, all base64) — used to
 * distinguish already-encrypted values from legacy plaintext during a migration window. */
export function looksEncrypted(value: string | null | undefined): boolean {
  if (!value) return false;
  const parts = value.split(":");
  return parts.length === 3 && parts.every((p) => /^[A-Za-z0-9+/]+=*$/.test(p) && p.length > 0);
}

/** Encrypts the given keys of a plain object, leaving null/empty values untouched. */
export function encryptFields<T extends Record<string, any>>(obj: T, keys: (keyof T)[]): T {
  const result: T = { ...obj };
  for (const k of keys) {
    const v = result[k];
    if (v != null && v !== "") result[k] = encryptSecret(String(v)) as any;
  }
  return result;
}

/** Decrypts the given keys of a plain object. Leaves a value untouched if it doesn't look
 * encrypted (safety net, not a supported long-term path) rather than throwing on legacy data. */
export function decryptFields<T extends Record<string, any>>(obj: T, keys: (keyof T)[]): T {
  const result: T = { ...obj };
  for (const k of keys) {
    const v = result[k];
    if (typeof v === "string" && looksEncrypted(v)) {
      result[k] = decryptSecret(v) as any;
    }
  }
  return result;
}
