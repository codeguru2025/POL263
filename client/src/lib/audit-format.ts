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

/** Lowercases every word for mid-sentence placement, except a word that's already all-uppercase
 *  (an acronym like "MFA") — a blanket .toLowerCase() would flatten those too. Word-by-word,
 *  not just the first character: humanizeEntityType title-cases every word of a multi-word
 *  entity type ("Policy Member"), so only fixing the first character left "policy Member" —
 *  correct on the first word, wrong on every word after it. */
function decapitalize(s: string): string {
  return s
    .split(" ")
    .map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.charAt(0).toLowerCase() + w.slice(1)))
    .join(" ");
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

/** "storageFeeStatus" -> "Storage fee status". Trailing "Id"/"By" is stripped first — a resolved
 *  reference reads as "Removal driver: Tendai Moyo", not the jargon-y "Removal driver ID: Tendai
 *  Moyo" (the "ID"/"By" was only ever there to describe the raw UUID it used to hold). */
function humanizeFieldName(field: string): string {
  const stripped = field.replace(/(Id|By)$/, "") || field;
  const spaced = stripped.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  const words = spaced.split(" ");
  return words
    .map((w, i) => (ACRONYMS.has(w) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Swaps a raw UUID for its resolved label (see server/audit-ref-resolver.ts) when one was sent
 *  back for this value; otherwise falls through unchanged. */
function resolveRef(value: unknown, refs: Record<string, string>): unknown {
  return typeof value === "string" && refs[value] ? refs[value] : value;
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
  /** "diff" = a field changed value (from -> to); "snapshot" = a create/delete, `to` is the
   *  record's value at that moment. Both shapes render the same "from → to" way (see
   *  renderChange) — for a create the "from" side is just "—" (nothing yet). */
  kind: "diff" | "snapshot";
  from: string;
  to: string;
}

/** One-line "old → new" rendering of a change. The reader explicitly wants both sides shown
 *  even for a brand-new record, so a snapshot renders as "— → new value" rather than the value
 *  alone. */
export function renderChange(c: FieldChange): string {
  const from = c.kind === "diff" ? c.from : "—";
  return `${from} → ${c.to}`;
}

/**
 * Up to `limit` human-readable fields describing what happened to a record — a diff (field: old
 * -> new) for an update, or a full snapshot of the record's own fields for a create/delete
 * (before was previously left blank here entirely: "created a new dependant" with zero detail on
 * WHICH dependant or what their details were is not enough to reconstruct what happened from the
 * trail alone). `refs` (see server/audit-ref-resolver.ts) swaps any raw foreign-key UUID for its
 * resolved human label.
 */
export function summarizeChanges(
  before: unknown,
  after: unknown,
  refs: Record<string, string> = {},
  limit = 8
): FieldChange[] {
  const b = before && typeof before === "object" ? (before as Record<string, unknown>) : null;
  const a = after && typeof after === "object" ? (after as Record<string, unknown>) : null;
  if (!b && !a) return [];

  // Create or delete: no diff to compute, just show the record's own fields as a snapshot.
  if (!b !== !a) {
    const snapshot = (b ?? a)!;
    const changes: FieldChange[] = [];
    for (const key of Object.keys(snapshot)) {
      if (SKIP_FIELDS.has(key)) continue;
      const val = resolveRef(snapshot[key], refs);
      const formatted = formatValue(val);
      if (formatted === "—") continue; // an unset field on the created/deleted record isn't worth a line
      changes.push({ field: humanizeFieldName(key), kind: "snapshot", from: "", to: formatted });
      if (changes.length >= limit) break;
    }
    return changes;
  }

  const changes: FieldChange[] = [];
  const keys = Array.from(new Set([...Object.keys(b!), ...Object.keys(a!)]));
  for (const key of keys) {
    if (SKIP_FIELDS.has(key)) continue;
    const fromVal = b![key];
    const toVal = a![key];
    if (JSON.stringify(fromVal) === JSON.stringify(toVal)) continue;
    changes.push({
      field: humanizeFieldName(key),
      kind: "diff",
      from: formatValue(resolveRef(fromVal, refs)),
      to: formatValue(resolveRef(toVal, refs)),
    });
    if (changes.length >= limit) break;
  }
  return changes;
}

// Checked in priority order against a created/deleted record's own fields to name it inline —
// e.g. "created a new policy member (Jane Moyo)" instead of just "created a new policy member",
// which forces a reader to open the field list below just to know WHICH record this was.
const LABEL_FIELD_PRIORITY = [
  "policyNumber", "memberName", "deceasedName", "receiptNumber", "claimNumber",
  "name", "clientName", "groupName", "email",
];

function guessRecordLabel(payload: Record<string, unknown> | null, refs: Record<string, string>): string | null {
  if (!payload) return null;
  for (const field of LABEL_FIELD_PRIORITY) {
    const val = resolveRef(payload[field], refs);
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  if (typeof payload.firstName === "string" || typeof payload.lastName === "string") {
    const full = [payload.firstName, payload.lastName].filter(Boolean).join(" ").trim();
    if (full) return full;
  }
  return null;
}

/**
 * The one-sentence, plain-English summary shown as the primary content of an audit row.
 * Deliberately doesn't fold the entity type into this sentence — action names are usually
 * already descriptive on their own (e.g. "recorded case service charge payment"), and
 * concatenating "— Case Service Charge" on top reads as redundant. The entity type/id renders
 * as its own smaller line in the UI instead. A create/delete sentence names the specific record
 * inline (see guessRecordLabel) when a recognizable identifying field is present — the full field
 * list from summarizeChanges is still shown underneath for everything else.
 */
export function summarizeAuditEntry(log: {
  action?: string | null;
  entityType?: string | null;
  actorEmail?: string | null;
  before?: unknown;
  after?: unknown;
}, refs: Record<string, string> = {}): string {
  const actor = log.actorEmail || "The system";
  // Only the first character is lowercased for mid-sentence placement — a blanket .toLowerCase()
  // would also flatten any preserved acronym (e.g. "Disabled MFA" -> "disabled mfa").
  const entity = decapitalize(humanizeEntityType(log.entityType));
  const isCreate = !log.before && !!log.after;
  const isDelete = !!log.before && !log.after;
  if (isCreate) {
    const label = guessRecordLabel(log.after as Record<string, unknown>, refs);
    return `${actor} created a new ${entity || "record"}${label ? ` (${label})` : ""}.`;
  }
  if (isDelete) {
    const label = guessRecordLabel(log.before as Record<string, unknown>, refs);
    return `${actor} deleted a ${entity || "record"}${label ? ` (${label})` : ""}.`;
  }
  return `${actor} ${decapitalize(humanizeAction(log.action))}.`;
}
