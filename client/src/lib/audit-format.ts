/**
 * Turns raw audit-log rows (SNAKE_CASE action codes, CamelCase entity types, raw before/after
 * JSON) into plain-English sentences a non-technical reader can follow — without needing a
 * hand-written description for every action code. Two generic transforms do the work: splitting
 * SNAKE_CASE into a verb phrase (with a small past-tense/acronym lookup for the common cases),
 * and diffing before/after into a short list of "field: old → new" changes. The raw action code,
 * entity id, request id, and full JSON diff stay available in the UI's expandable details — this
 * is a second, readable layer on top of that, not a replacement for it.
 */

const ACRONYMS = new Set([
  "mfa", "kyc", "sla", "pii", "ifrs", "pdf", "csv", "id", "url", "api", "otp",
  "aml", "fiu", "crm", "sms", "vat", "paa", "gmm", "vfa",
]);

const IRREGULAR_VERBS: Record<string, string> = {
  send: "sent",
  cancel: "cancelled",
  submit: "submitted",
  reset: "reset",
  set: "set",
  put: "put",
  read: "read",
  cut: "cut",
  begin: "began",
  run: "ran",
  spend: "spent",
  become: "became",
};

function pastTense(word: string): string {
  const lower = word.toLowerCase();
  if (IRREGULAR_VERBS[lower]) return IRREGULAR_VERBS[lower];
  if (lower.endsWith("e")) return `${lower}d`;
  if (/[^aeiou][y]$/.test(lower)) return `${lower.slice(0, -1)}ied`;
  if (/[^aeiou][aeiou][^aeiouwxy]$/.test(lower) && lower.length <= 5) return `${lower}${lower.slice(-1)}ed`;
  return `${lower}ed`;
}

/** Lowercases only the first character — preserves any acronym elsewhere in the string (unlike
 *  a blanket .toLowerCase(), which would also flatten "MFA" down to "mfa"). */
function decapitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toLowerCase() + s.slice(1);
}

function titleCaseWord(word: string): string {
  const lower = word.toLowerCase();
  if (ACRONYMS.has(lower)) return lower.toUpperCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** "RECORD_CASE_SERVICE_CHARGE_PAYMENT" -> "Recorded case service charge payment" */
export function humanizeAction(action: string | null | undefined): string {
  if (!action) return "Did something";
  const words = action.split("_").filter(Boolean);
  if (words.length === 0) return action;
  const [verb, ...rest] = words;
  const verbOut = titleCaseWord(pastTense(verb));
  const restOut = rest
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.toLowerCase()))
    .join(" ");
  return restOut ? `${verbOut} ${restOut}` : verbOut;
}

/** "CaseServiceCharge" -> "Case Service Charge" */
export function humanizeEntityType(entityType: string | null | undefined): string {
  if (!entityType) return "";
  return entityType
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(" ")
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w))
    .join(" ");
}

/** "storageFeeStatus" -> "Storage fee status" */
function humanizeFieldName(field: string): string {
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  const words = spaced.split(" ");
  return words
    .map((w, i) => (ACRONYMS.has(w) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Technical/internal fields that mean nothing to a reader — never shown in the diff summary.
const SKIP_FIELDS = new Set([
  "id", "organizationId", "createdAt", "updatedAt", "deletedAt", "version",
  "requestId", "ipAddress", "actorId", "actorEmail",
]);

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length === 0 ? "—" : `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") return "(details)";
  const str = String(value);
  // ISO date/datetime strings render as a locale date rather than raw "2026-08-26T13:15:00.000Z".
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/.test(str)) {
    const d = new Date(str);
    if (!Number.isNaN(d.getTime())) return str.includes("T") ? d.toLocaleString() : d.toLocaleDateString();
  }
  return str.length > 60 ? `${str.slice(0, 57)}…` : str;
}

export interface FieldChange {
  field: string;
  from: string;
  to: string;
}

/** Up to `limit` human-readable field changes between before/after — skips technical/internal
 *  fields and fields that didn't actually change. Empty array for a create (before is null) or
 *  delete (after is null), since "everything changed" isn't a useful list to a reader. */
export function summarizeChanges(before: unknown, after: unknown, limit = 4): FieldChange[] {
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return [];
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const changes: FieldChange[] = [];
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
  for (const key of keys) {
    if (SKIP_FIELDS.has(key)) continue;
    const fromVal = b[key];
    const toVal = a[key];
    if (JSON.stringify(fromVal) === JSON.stringify(toVal)) continue;
    changes.push({ field: humanizeFieldName(key), from: formatValue(fromVal), to: formatValue(toVal) });
    if (changes.length >= limit) break;
  }
  return changes;
}

/**
 * The one-sentence, plain-English summary shown as the primary content of an audit row.
 * Deliberately doesn't fold the entity type into this sentence — action names are usually
 * already descriptive on their own (e.g. "recorded case service charge payment"), and
 * concatenating "— Case Service Charge" on top reads as redundant. The entity type/id renders
 * as its own smaller line in the UI instead.
 */
export function summarizeAuditEntry(log: {
  action?: string | null;
  entityType?: string | null;
  actorEmail?: string | null;
  before?: unknown;
  after?: unknown;
}): string {
  const actor = log.actorEmail || "The system";
  // Only the first character is lowercased for mid-sentence placement — a blanket .toLowerCase()
  // would also flatten any preserved acronym (e.g. "Disabled MFA" -> "disabled mfa").
  const entity = decapitalize(humanizeEntityType(log.entityType));
  const isCreate = !log.before && !!log.after;
  const isDelete = !!log.before && !log.after;
  if (isCreate) return `${actor} created a new ${entity || "record"}.`;
  if (isDelete) return `${actor} deleted a ${entity || "record"}.`;
  return `${actor} ${decapitalize(humanizeAction(log.action))}.`;
}
