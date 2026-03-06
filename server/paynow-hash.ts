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

  const allKeys = Object.keys(postedFields).filter((k) => k.toLowerCase() !== "hash");
  const decodeValue = (raw: string) => {
    try { return decodeURIComponent(String(raw).replace(/\+/g, " ")); }
    catch { return raw; }
  };
  const computeHash = (keys: string[]) => {
    const concatenated = keys.map((k) => decodeValue(postedFields[k])).join("");
    return crypto.createHash("sha512").update(concatenated + key).digest("hex").toUpperCase();
  };
  const upperReceived = receivedHash.toUpperCase();

  // Paynow uses order-of-appearance for hashing; try insertion order first, then alphabetical as fallback
  if (computeHash(allKeys) === upperReceived) return true;
  const sorted = [...allKeys].sort();
  return computeHash(sorted) === upperReceived;
}

/**
 * Generate hash for outbound Paynow request.
 * PayNow docs: concatenate values in the ORDER they appear in the message (id, reference, amount, ...), then append Integration Key, SHA512, uppercase hex.
 * Do NOT use alphabetical order.
 * @param params - key-value pairs (values will be URL-encoded in request; pass raw values here)
 * @param keyOrder - order of keys for hash (excluding "hash" itself). If omitted, uses alphabetical (for backward compat / validation).
 */
export function generatePaynowHash(params: Record<string, string>, keyOrder?: string[]): string {
  const key = getPaynowIntegrationKey();
  if (!key) return "";

  const keys = keyOrder ?? Object.keys(params).sort();
  const concatenated = keys
    .filter((k) => k.toLowerCase() !== "hash")
    .map((k) => String(params[k] ?? ""))
    .join("");
  const toHash = concatenated + key;
  return crypto.createHash("sha512").update(toHash).digest("hex").toUpperCase();
}
