/**
 * Paynow hash verification (inbound) and generation (outbound).
 * Per Paynow docs: values (excluding hash) URL-decoded, concatenated, append Integration Key, SHA512, uppercase hex.
 * NEVER log the integration key.
 */

import crypto from "crypto";
import { getPaynowIntegrationKey } from "./paynow-config";

/**
 * Validate hash on an inbound Paynow message (e.g. result URL POST).
 * @param postedFields - key-value pairs as received (e.g. from req.body)
 * @returns true if hash matches
 */
export function verifyPaynowHash(postedFields: Record<string, string>): boolean {
  const receivedHash = postedFields.hash;
  if (!receivedHash) return false;

  const key = getPaynowIntegrationKey();
  if (!key) return false;

  const sortedKeys = Object.keys(postedFields)
    .filter((k) => k.toLowerCase() !== "hash")
    .sort();

  const concatenated = sortedKeys
    .map((k) => {
      const raw = postedFields[k];
      try {
        return decodeURIComponent(String(raw).replace(/\+/g, " "));
      } catch {
        return raw;
      }
    })
    .join("");

  const toHash = concatenated + key;
  const computedHash = crypto.createHash("sha512").update(toHash).digest("hex").toUpperCase();
  return computedHash === receivedHash.toUpperCase();
}

/**
 * Generate hash for outbound Paynow request.
 * @param params - key-value pairs (values will be URL-encoded in request; pass raw values here)
 */
export function generatePaynowHash(params: Record<string, string>): string {
  const key = getPaynowIntegrationKey();
  if (!key) return "";

  const sortedKeys = Object.keys(params).sort();
  const concatenated = sortedKeys.map((k) => String(params[k] ?? "")).join("");
  const toHash = concatenated + key;
  return crypto.createHash("sha512").update(toHash).digest("hex").toUpperCase();
}
