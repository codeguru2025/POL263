/**
 * Paynow hash verification (inbound) and generation (outbound).
 * Per Paynow docs: values (excluding hash) URL-decoded, concatenated, append Integration Key, SHA512, uppercase hex.
 * NEVER log the integration key.
 */

import crypto from "crypto";
import { getPaynowIntegrationKey } from "./paynow-config";

function computeHash(fields: Record<string, string>, keys: string[], key: string): string {
  const decodeValue = (raw: string) => {
    try { return decodeURIComponent(String(raw).replace(/\+/g, " ")); }
    catch { return raw; }
  };
  const concatenated = keys.map((k) => decodeValue(fields[k])).join("");
  return crypto.createHash("sha512").update(concatenated + key).digest("hex").toUpperCase();
}

/**
 * Validate hash on an inbound Paynow message (e.g. result URL POST).
 * Pass `integrationKey` to use a per-org key; omit to fall back to env var.
 */
export function verifyPaynowHash(postedFields: Record<string, string>, integrationKey?: string): boolean {
  const receivedHash = postedFields.hash;
  if (!receivedHash) return false;

  const key = integrationKey || getPaynowIntegrationKey();
  if (!key) return false;

  const allKeys = Object.keys(postedFields).filter((k) => k.toLowerCase() !== "hash");
  const upperReceived = receivedHash.toUpperCase();

  const matches = (computed: string) => {
    if (computed.length !== upperReceived.length) return false;
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(upperReceived));
  };

  // Paynow uses order-of-appearance; try insertion order first, then alphabetical as fallback
  if (matches(computeHash(postedFields, allKeys, key))) return true;
  const sorted = [...allKeys].sort();
  return matches(computeHash(postedFields, sorted, key));
}

/**
 * Generate hash for outbound Paynow request.
 * Pass `integrationKey` to use a per-org key; omit to fall back to env var.
 */
export function generatePaynowHash(params: Record<string, string>, keyOrder?: string[], integrationKey?: string): string {
  const key = integrationKey || getPaynowIntegrationKey();
  if (!key) return "";

  const keys = (keyOrder ?? Object.keys(params).sort()).filter((k) => k.toLowerCase() !== "hash");
  const concatenated = keys.map((k) => String(params[k] ?? "")).join("");
  return crypto.createHash("sha512").update(concatenated + key).digest("hex").toUpperCase();
}
