/**
 * Legacy data import engine — parsing, field specs, and row validation for the
 * control-panel-only bulk import tool (see plan: legacy data import from POL360/Easipol/etc).
 * Entity coverage is added incrementally; only "client" is implemented so far.
 */
import { parse as parseCsvSync } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { randomUUID } from "crypto";
import { eq, and, inArray, count, isNull, isNotNull } from "drizzle-orm";
import { normalizeNationalId, toUpperTrim, normalizeCurrency, parsePositiveAmount, type SupportedCurrency } from "../shared/validation";
import {
  products, productVersions, importRecords, policies, paymentReceipts, claims, policyMembers,
  POLICY_STATUSES, type PolicyStatus, CLAIM_STATUSES, type ClaimStatus, type ImportEntityType,
} from "../shared/schema";

export const MAX_IMPORT_ROWS = 5000;

/** Short-lived server-side cache bridging the multipart upload step to the JSON preview step —
 *  avoids resubmitting up to 5,000 parsed rows as a JSON body (past Express's global body-size
 *  limit) and avoids re-parsing the file twice. Single-operator control-panel tool, so an
 *  in-memory Map (not Redis) is adequate; entries expire on their own. */
interface CachedUpload extends ParsedFile {
  fileName: string;
  organizationId: string;
  expiresAt: number;
}
const UPLOAD_CACHE_TTL_MS = 30 * 60 * 1000;
const uploadCache = new Map<string, CachedUpload>();

function cleanupExpiredUploads(): void {
  const now = Date.now();
  for (const [token, entry] of Array.from(uploadCache)) {
    if (entry.expiresAt < now) uploadCache.delete(token);
  }
}

export function cacheParsedUpload(organizationId: string, fileName: string, parsed: ParsedFile): string {
  cleanupExpiredUploads();
  const token = randomUUID();
  uploadCache.set(token, { ...parsed, fileName, organizationId, expiresAt: Date.now() + UPLOAD_CACHE_TTL_MS });
  return token;
}

export function getCachedUpload(token: string, organizationId: string): CachedUpload | undefined {
  const entry = uploadCache.get(token);
  if (!entry || entry.expiresAt < Date.now() || entry.organizationId !== organizationId) return undefined;
  return entry;
}

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
}

export async function parseUploadedFile(buffer: Buffer, fileName: string): Promise<ParsedFile> {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "csv") return parseCsvBuffer(buffer);
  if (ext === "xlsx" || ext === "xls") return parseExcelBuffer(buffer);
  throw new Error(`Unsupported file type: .${ext || "unknown"}. Upload a .csv or .xlsx file.`);
}

function parseCsvBuffer(buffer: Buffer): ParsedFile {
  const records = parseCsvSync(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[];
  const headers = records.length > 0 ? Object.keys(records[0]) : [];
  return { headers, rows: records };
}

async function parseExcelBuffer(buffer: Buffer): Promise<ParsedFile> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value ?? "").trim();
  });

  const rows: Record<string, string>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((header, idx) => {
      if (!header) return;
      const value = cellValueToString(row.getCell(idx + 1).value);
      if (value) hasValue = true;
      record[header] = value;
    });
    if (hasValue) rows.push(record);
  });

  return { headers: headers.filter(Boolean), rows };
}

function cellValueToString(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const asAny = value as any;
    if (typeof asAny.text === "string") return asAny.text;
    if (asAny.result != null) return String(asAny.result);
    if (asAny.richText) return asAny.richText.map((r: any) => r.text).join("");
  }
  return String(value);
}

/** Parses a date string that may be ISO, day-first (DD/MM/YYYY — the regional default here), or
 *  an ISO datetime string (as produced by cellValueToString for Excel date cells). Returns
 *  YYYY-MM-DD or null if unparseable. */
export function parseFlexibleDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(trimmed);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

export interface ImportFieldSpec {
  field: string;
  label: string;
  required: boolean;
  type: "text" | "date" | "number" | "enum";
}

export function getFieldSpec(entityType: ImportEntityType): ImportFieldSpec[] {
  switch (entityType) {
    case "client":
      return [
        { field: "externalKey", label: "Legacy client ID / number", required: true, type: "text" },
        { field: "firstName", label: "First name", required: true, type: "text" },
        { field: "lastName", label: "Last name", required: true, type: "text" },
        { field: "nationalId", label: "National ID", required: false, type: "text" },
        { field: "dateOfBirth", label: "Date of birth", required: false, type: "date" },
        { field: "gender", label: "Gender", required: false, type: "text" },
        { field: "phone", label: "Phone", required: false, type: "text" },
        { field: "email", label: "Email", required: false, type: "text" },
        { field: "physicalAddress", label: "Physical address", required: false, type: "text" },
      ];
    case "policy":
      return [
        { field: "externalKey", label: "Legacy policy ID / number", required: true, type: "text" },
        { field: "clientExternalKey", label: "Legacy client ID (must match a client already imported)", required: true, type: "text" },
        { field: "policyNumber", label: "Policy number", required: true, type: "text" },
        { field: "planName", label: "Plan / product name", required: false, type: "text" },
        { field: "premiumAmount", label: "Premium amount", required: true, type: "number" },
        { field: "currency", label: "Currency (USD/ZAR/ZIG)", required: false, type: "text" },
        { field: "paymentSchedule", label: "Payment schedule (monthly/weekly/biweekly/yearly)", required: false, type: "text" },
        { field: "status", label: "Status (active/grace/lapsed/cancelled/inactive) — defaults to inactive if left unmapped", required: false, type: "text" },
        { field: "effectiveDate", label: "Effective date", required: false, type: "date" },
        { field: "inceptionDate", label: "Inception date", required: false, type: "date" },
        { field: "beneficiaryFirstName", label: "Beneficiary first name", required: false, type: "text" },
        { field: "beneficiaryLastName", label: "Beneficiary last name", required: false, type: "text" },
        { field: "beneficiaryRelationship", label: "Beneficiary relationship", required: false, type: "text" },
        { field: "beneficiaryPhone", label: "Beneficiary phone", required: false, type: "text" },
        { field: "agentEmail", label: "Agent email (must match an existing staff/agent user) — optional", required: false, type: "text" },
      ];
    case "payment":
      // No "period covered" fields — commit replays each policy's payments through the same
      // cycle engine a live payment uses (advancePolicyCycle), which computes the covered
      // period itself; a manually mapped one would just be silently overridden.
      return [
        { field: "externalKey", label: "Legacy payment/receipt ID", required: true, type: "text" },
        { field: "policyExternalKey", label: "Legacy policy ID (must match a policy already imported)", required: true, type: "text" },
        { field: "receiptNumber", label: "Receipt number", required: true, type: "text" },
        { field: "amount", label: "Amount", required: true, type: "number" },
        { field: "currency", label: "Currency (USD/ZAR/ZIG)", required: false, type: "text" },
        { field: "paymentChannel", label: "Payment channel (cash/paynow_ecocash/paynow_card/other)", required: false, type: "text" },
        { field: "paymentDate", label: "Payment date", required: true, type: "date" },
      ];
    case "claim":
      return [
        { field: "externalKey", label: "Legacy claim ID", required: true, type: "text" },
        { field: "policyExternalKey", label: "Legacy policy ID (must match a policy already imported)", required: true, type: "text" },
        { field: "claimNumber", label: "Claim number", required: true, type: "text" },
        { field: "claimType", label: "Claim type (death/accidental_death/disability/repatriation/cash_in_lieu/hospital_cash)", required: true, type: "text" },
        { field: "status", label: "Status (submitted/verified/approved/scheduled/payable/completed/paid/closed/rejected)", required: false, type: "text" },
        { field: "deceasedName", label: "Deceased name", required: false, type: "text" },
        { field: "deceasedRelationship", label: "Deceased relationship", required: false, type: "text" },
        { field: "dateOfDeath", label: "Date of death", required: false, type: "date" },
        { field: "causeOfDeath", label: "Cause of death", required: false, type: "text" },
        { field: "cashInLieuAmount", label: "Cash-in-lieu amount", required: false, type: "number" },
        { field: "currency", label: "Currency (USD/ZAR/ZIG)", required: false, type: "text" },
      ];
    case "dependent":
      // Covered family members on a policy — distinct from the free-text beneficiary fields on
      // "policy" (those are just a payout-instruction record, not a person with their own
      // policy_members/member-card row). Requires both a client and a policy already imported:
      // the dependent belongs to the client's household, and is added onto one specific policy.
      return [
        { field: "externalKey", label: "Legacy dependant ID", required: true, type: "text" },
        { field: "clientExternalKey", label: "Legacy client ID (must match a client already imported)", required: true, type: "text" },
        { field: "policyExternalKey", label: "Legacy policy ID (must match a policy already imported)", required: true, type: "text" },
        { field: "firstName", label: "First name", required: true, type: "text" },
        { field: "lastName", label: "Last name", required: true, type: "text" },
        { field: "relationship", label: "Relationship to policyholder (e.g. spouse, child, parent)", required: true, type: "text" },
        { field: "nationalId", label: "National ID", required: false, type: "text" },
        { field: "dateOfBirth", label: "Date of birth", required: false, type: "date" },
        { field: "gender", label: "Gender", required: false, type: "text" },
      ];
    default:
      throw new Error(`No field spec implemented yet for entity type: ${entityType}`);
  }
}

const PAYMENT_SCHEDULES = ["monthly", "weekly", "biweekly", "yearly"] as const;
const PAYMENT_CHANNELS = ["paynow_ecocash", "paynow_card", "cash", "other"] as const;

function normalizeEnum<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  const upper = value.trim().toLowerCase();
  return (allowed as readonly string[]).includes(upper) ? (upper as T) : fallback;
}

export interface RowError {
  rowIndex: number;
  field: string;
  message: string;
}

export interface TransformResult<T> {
  value?: T;
  errors: RowError[];
}

export interface TransformedClientRow {
  externalKey: string;
  firstName: string;
  lastName: string;
  nationalId: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  physicalAddress: string | null;
}

function mappedValue(rawRow: Record<string, string>, columnMapping: Record<string, string>, field: string): string {
  const sourceHeader = columnMapping[field];
  if (!sourceHeader) return "";
  return (rawRow[sourceHeader] ?? "").toString().trim();
}

export function transformAndValidateRow(
  entityType: ImportEntityType,
  rawRow: Record<string, string>,
  rowIndex: number,
  columnMapping: Record<string, string>
): TransformResult<any> {
  switch (entityType) {
    case "client":
      return transformClientRow(rawRow, rowIndex, columnMapping);
    case "policy":
      return transformPolicyRow(rawRow, rowIndex, columnMapping);
    case "payment":
      return transformPaymentRow(rawRow, rowIndex, columnMapping);
    case "claim":
      return transformClaimRow(rawRow, rowIndex, columnMapping);
    case "dependent":
      return transformDependentRow(rawRow, rowIndex, columnMapping);
    default:
      return { errors: [{ rowIndex, field: "_row", message: `Import not yet supported for: ${entityType}` }] };
  }
}

function transformClientRow(
  rawRow: Record<string, string>,
  rowIndex: number,
  columnMapping: Record<string, string>
): TransformResult<TransformedClientRow> {
  const errors: RowError[] = [];

  const externalKey = mappedValue(rawRow, columnMapping, "externalKey");
  if (!externalKey) errors.push({ rowIndex, field: "externalKey", message: "Legacy client ID is required" });

  const firstName = mappedValue(rawRow, columnMapping, "firstName");
  if (!firstName) errors.push({ rowIndex, field: "firstName", message: "First name is required" });

  const lastName = mappedValue(rawRow, columnMapping, "lastName");
  if (!lastName) errors.push({ rowIndex, field: "lastName", message: "Last name is required" });

  const dobRaw = mappedValue(rawRow, columnMapping, "dateOfBirth");
  let dateOfBirth: string | null = null;
  if (dobRaw) {
    dateOfBirth = parseFlexibleDate(dobRaw);
    if (!dateOfBirth) errors.push({ rowIndex, field: "dateOfBirth", message: `Could not parse date: "${dobRaw}"` });
  }

  if (errors.length > 0) return { errors };

  const nationalIdRaw = mappedValue(rawRow, columnMapping, "nationalId");

  return {
    errors: [],
    value: {
      externalKey,
      firstName: toUpperTrim(firstName, false)!,
      lastName: toUpperTrim(lastName, false)!,
      nationalId: nationalIdRaw ? normalizeNationalId(nationalIdRaw) : null,
      dateOfBirth,
      gender: mappedValue(rawRow, columnMapping, "gender") || null,
      phone: mappedValue(rawRow, columnMapping, "phone") || null,
      email: mappedValue(rawRow, columnMapping, "email") || null,
      physicalAddress: mappedValue(rawRow, columnMapping, "physicalAddress") || null,
    },
  };
}

export interface TransformedPolicyRow {
  externalKey: string;
  clientExternalKey: string;
  policyNumber: string;
  planName: string | null;
  premiumAmount: string;
  currency: SupportedCurrency;
  paymentSchedule: (typeof PAYMENT_SCHEDULES)[number];
  status: PolicyStatus;
  effectiveDate: string | null;
  inceptionDate: string | null;
  beneficiaryFirstName: string | null;
  beneficiaryLastName: string | null;
  beneficiaryRelationship: string | null;
  beneficiaryPhone: string | null;
  agentEmail: string | null;
}

function transformPolicyRow(
  rawRow: Record<string, string>,
  rowIndex: number,
  columnMapping: Record<string, string>
): TransformResult<TransformedPolicyRow> {
  const errors: RowError[] = [];

  const externalKey = mappedValue(rawRow, columnMapping, "externalKey");
  if (!externalKey) errors.push({ rowIndex, field: "externalKey", message: "Legacy policy ID is required" });

  const clientExternalKey = mappedValue(rawRow, columnMapping, "clientExternalKey");
  if (!clientExternalKey) errors.push({ rowIndex, field: "clientExternalKey", message: "Legacy client ID is required" });

  const policyNumber = mappedValue(rawRow, columnMapping, "policyNumber");
  if (!policyNumber) errors.push({ rowIndex, field: "policyNumber", message: "Policy number is required" });

  const premiumRaw = mappedValue(rawRow, columnMapping, "premiumAmount");
  const premium = premiumRaw ? parsePositiveAmount(premiumRaw) : null;
  if (!premium) errors.push({ rowIndex, field: "premiumAmount", message: `Premium amount must be a positive number, got "${premiumRaw}"` });

  const effectiveDateRaw = mappedValue(rawRow, columnMapping, "effectiveDate");
  let effectiveDate: string | null = null;
  if (effectiveDateRaw) {
    effectiveDate = parseFlexibleDate(effectiveDateRaw);
    if (!effectiveDate) errors.push({ rowIndex, field: "effectiveDate", message: `Could not parse date: "${effectiveDateRaw}"` });
  }

  const inceptionDateRaw = mappedValue(rawRow, columnMapping, "inceptionDate");
  let inceptionDate: string | null = null;
  if (inceptionDateRaw) {
    inceptionDate = parseFlexibleDate(inceptionDateRaw);
    if (!inceptionDate) errors.push({ rowIndex, field: "inceptionDate", message: `Could not parse date: "${inceptionDateRaw}"` });
  }

  if (errors.length > 0) return { errors };

  return {
    errors: [],
    value: {
      externalKey,
      clientExternalKey,
      policyNumber,
      planName: mappedValue(rawRow, columnMapping, "planName") || null,
      premiumAmount: premium!.toFixed(2),
      currency: normalizeCurrency(mappedValue(rawRow, columnMapping, "currency")),
      paymentSchedule: normalizeEnum(mappedValue(rawRow, columnMapping, "paymentSchedule") || "monthly", PAYMENT_SCHEDULES, "monthly"),
      // Defaults to "inactive" (a fresh, unpaid policy), NOT "active": if payment history is also
      // imported, applyPolicyStatusForClearedPayment correctly drives inactive→active with the
      // real inception date from the first replayed payment. Pre-marking it "active" here would
      // make that function a no-op ("if (fromStatus === 'active') return false"), so it would
      // never pick up the correct inception date. Only bites if no status column is mapped AND no
      // payment history is imported — then it stays "inactive" until a payment is recorded.
      status: normalizeEnum(mappedValue(rawRow, columnMapping, "status") || "inactive", POLICY_STATUSES, "inactive"),
      effectiveDate,
      inceptionDate,
      beneficiaryFirstName: mappedValue(rawRow, columnMapping, "beneficiaryFirstName") || null,
      beneficiaryLastName: mappedValue(rawRow, columnMapping, "beneficiaryLastName") || null,
      beneficiaryRelationship: mappedValue(rawRow, columnMapping, "beneficiaryRelationship") || null,
      beneficiaryPhone: mappedValue(rawRow, columnMapping, "beneficiaryPhone") || null,
      agentEmail: (mappedValue(rawRow, columnMapping, "agentEmail") || null)?.toLowerCase() ?? null,
    },
  };
}

export interface TransformedPaymentRow {
  externalKey: string;
  policyExternalKey: string;
  receiptNumber: string;
  amount: string;
  currency: SupportedCurrency;
  paymentChannel: (typeof PAYMENT_CHANNELS)[number];
  paymentDate: string;
}

function transformPaymentRow(
  rawRow: Record<string, string>,
  rowIndex: number,
  columnMapping: Record<string, string>
): TransformResult<TransformedPaymentRow> {
  const errors: RowError[] = [];

  const externalKey = mappedValue(rawRow, columnMapping, "externalKey");
  if (!externalKey) errors.push({ rowIndex, field: "externalKey", message: "Legacy payment ID is required" });

  const policyExternalKey = mappedValue(rawRow, columnMapping, "policyExternalKey");
  if (!policyExternalKey) errors.push({ rowIndex, field: "policyExternalKey", message: "Legacy policy ID is required" });

  const receiptNumber = mappedValue(rawRow, columnMapping, "receiptNumber");
  if (!receiptNumber) errors.push({ rowIndex, field: "receiptNumber", message: "Receipt number is required" });

  const amountRaw = mappedValue(rawRow, columnMapping, "amount");
  const amount = amountRaw ? parsePositiveAmount(amountRaw) : null;
  if (!amount) errors.push({ rowIndex, field: "amount", message: `Amount must be a positive number, got "${amountRaw}"` });

  const paymentDateRaw = mappedValue(rawRow, columnMapping, "paymentDate");
  let paymentDate: string | null = null;
  if (!paymentDateRaw) {
    errors.push({ rowIndex, field: "paymentDate", message: "Payment date is required" });
  } else {
    paymentDate = parseFlexibleDate(paymentDateRaw);
    if (!paymentDate) errors.push({ rowIndex, field: "paymentDate", message: `Could not parse date: "${paymentDateRaw}"` });
  }

  if (errors.length > 0) return { errors };

  return {
    errors: [],
    value: {
      externalKey,
      policyExternalKey,
      receiptNumber,
      amount: amount!.toFixed(2),
      currency: normalizeCurrency(mappedValue(rawRow, columnMapping, "currency")),
      paymentChannel: normalizeEnum(mappedValue(rawRow, columnMapping, "paymentChannel") || "other", PAYMENT_CHANNELS, "other"),
      paymentDate: paymentDate!,
    },
  };
}

export interface TransformedClaimRow {
  externalKey: string;
  policyExternalKey: string;
  claimNumber: string;
  claimType: string;
  status: ClaimStatus;
  deceasedName: string | null;
  deceasedRelationship: string | null;
  dateOfDeath: string | null;
  causeOfDeath: string | null;
  cashInLieuAmount: string | null;
  currency: SupportedCurrency;
}

function transformClaimRow(
  rawRow: Record<string, string>,
  rowIndex: number,
  columnMapping: Record<string, string>
): TransformResult<TransformedClaimRow> {
  const errors: RowError[] = [];

  const externalKey = mappedValue(rawRow, columnMapping, "externalKey");
  if (!externalKey) errors.push({ rowIndex, field: "externalKey", message: "Legacy claim ID is required" });

  const policyExternalKey = mappedValue(rawRow, columnMapping, "policyExternalKey");
  if (!policyExternalKey) errors.push({ rowIndex, field: "policyExternalKey", message: "Legacy policy ID is required" });

  const claimNumber = mappedValue(rawRow, columnMapping, "claimNumber");
  if (!claimNumber) errors.push({ rowIndex, field: "claimNumber", message: "Claim number is required" });

  const claimTypeRaw = mappedValue(rawRow, columnMapping, "claimType");
  if (!claimTypeRaw) errors.push({ rowIndex, field: "claimType", message: "Claim type is required" });

  const dateOfDeathRaw = mappedValue(rawRow, columnMapping, "dateOfDeath");
  let dateOfDeath: string | null = null;
  if (dateOfDeathRaw) {
    dateOfDeath = parseFlexibleDate(dateOfDeathRaw);
    if (!dateOfDeath) errors.push({ rowIndex, field: "dateOfDeath", message: `Could not parse date: "${dateOfDeathRaw}"` });
  }

  const cashInLieuRaw = mappedValue(rawRow, columnMapping, "cashInLieuAmount");
  let cashInLieuAmount: string | null = null;
  if (cashInLieuRaw) {
    const parsed = parsePositiveAmount(cashInLieuRaw);
    if (!parsed) errors.push({ rowIndex, field: "cashInLieuAmount", message: `Cash-in-lieu amount must be a positive number, got "${cashInLieuRaw}"` });
    else cashInLieuAmount = parsed.toFixed(2);
  }

  if (errors.length > 0) return { errors };

  return {
    errors: [],
    value: {
      externalKey,
      policyExternalKey,
      claimNumber,
      // Not validated against a closed enum — legacy classification schemes vary, and some real
      // claim types (e.g. "hospital_cash") live outside the client-portal's own CLAIM_TYPES list.
      claimType: claimTypeRaw.trim().toLowerCase().replace(/\s+/g, "_"),
      // Defaults to "closed" (not the schema's own "submitted" default) — an unspecified status on
      // a historical claim being migrated almost always means "already resolved," and defaulting
      // to "submitted" would wrongly surface years-old claims in today's pending-claims queue.
      status: normalizeEnum(mappedValue(rawRow, columnMapping, "status") || "closed", CLAIM_STATUSES, "closed"),
      deceasedName: mappedValue(rawRow, columnMapping, "deceasedName") || null,
      deceasedRelationship: mappedValue(rawRow, columnMapping, "deceasedRelationship") || null,
      dateOfDeath,
      causeOfDeath: mappedValue(rawRow, columnMapping, "causeOfDeath") || null,
      cashInLieuAmount,
      currency: normalizeCurrency(mappedValue(rawRow, columnMapping, "currency")),
    },
  };
}

export interface TransformedDependentRow {
  externalKey: string;
  clientExternalKey: string;
  policyExternalKey: string;
  firstName: string;
  lastName: string;
  relationship: string;
  nationalId: string | null;
  dateOfBirth: string | null;
  gender: string | null;
}

function transformDependentRow(
  rawRow: Record<string, string>,
  rowIndex: number,
  columnMapping: Record<string, string>
): TransformResult<TransformedDependentRow> {
  const errors: RowError[] = [];

  const externalKey = mappedValue(rawRow, columnMapping, "externalKey");
  if (!externalKey) errors.push({ rowIndex, field: "externalKey", message: "Legacy dependant ID is required" });

  const clientExternalKey = mappedValue(rawRow, columnMapping, "clientExternalKey");
  if (!clientExternalKey) errors.push({ rowIndex, field: "clientExternalKey", message: "Legacy client ID is required" });

  const policyExternalKey = mappedValue(rawRow, columnMapping, "policyExternalKey");
  if (!policyExternalKey) errors.push({ rowIndex, field: "policyExternalKey", message: "Legacy policy ID is required" });

  const firstName = mappedValue(rawRow, columnMapping, "firstName");
  if (!firstName) errors.push({ rowIndex, field: "firstName", message: "First name is required" });

  const lastName = mappedValue(rawRow, columnMapping, "lastName");
  if (!lastName) errors.push({ rowIndex, field: "lastName", message: "Last name is required" });

  const relationship = mappedValue(rawRow, columnMapping, "relationship");
  if (!relationship) errors.push({ rowIndex, field: "relationship", message: "Relationship is required" });

  const dobRaw = mappedValue(rawRow, columnMapping, "dateOfBirth");
  let dateOfBirth: string | null = null;
  if (dobRaw) {
    dateOfBirth = parseFlexibleDate(dobRaw);
    if (!dateOfBirth) errors.push({ rowIndex, field: "dateOfBirth", message: `Could not parse date: "${dobRaw}"` });
  }

  if (errors.length > 0) return { errors };

  const nationalIdRaw = mappedValue(rawRow, columnMapping, "nationalId");

  return {
    errors: [],
    value: {
      externalKey,
      clientExternalKey,
      policyExternalKey,
      firstName: toUpperTrim(firstName, false)!,
      lastName: toUpperTrim(lastName, false)!,
      relationship: relationship.trim().toLowerCase(),
      nationalId: nationalIdRaw ? normalizeNationalId(nationalIdRaw) : null,
      dateOfBirth,
      gender: mappedValue(rawRow, columnMapping, "gender") || null,
    },
  };
}

/** Resolves a legacy external key to the POL263 row created for it (via import_records) —
 *  used at commit time, inside the same transaction, to turn e.g. a policy row's
 *  `clientExternalKey` into a real `clientId`. */
export async function resolveExternalRef(
  orgId: string,
  entityType: ImportEntityType,
  externalKey: string,
  tx: any
): Promise<string | undefined> {
  const [row] = await tx
    .select({ entityId: importRecords.entityId })
    .from(importRecords)
    .where(and(eq(importRecords.organizationId, orgId), eq(importRecords.entityType, entityType), eq(importRecords.externalKey, externalKey)));
  return row?.entityId;
}

/** Get-or-create a synthetic "Legacy Import" product + minimal product version for `orgId`,
 *  used as the default productVersionId for imported policies that aren't value-mapped to a
 *  real product version (see decision #1: productVersions requires premium-table/rules fields
 *  no legacy export will have, and policies.premiumAmount is stored directly regardless). */
export async function getOrCreateLegacyProductVersion(orgId: string, tx: any): Promise<string> {
  let [product] = await tx.select().from(products).where(and(eq(products.organizationId, orgId), eq(products.code, "LEGACY_IMPORT")));
  if (!product) {
    [product] = await tx
      .insert(products)
      .values({
        organizationId: orgId,
        name: "Legacy Import",
        code: "LEGACY_IMPORT",
        description: "Placeholder product for policies imported from a legacy system. Premiums are stored directly on each policy — reassign to a real product/version when convenient.",
        isActive: true,
      })
      .returning();
  }
  const [existingVersion] = await tx
    .select()
    .from(productVersions)
    .where(and(eq(productVersions.productId, product.id), eq(productVersions.organizationId, orgId)));
  if (existingVersion) return existingVersion.id;

  const [version] = await tx
    .insert(productVersions)
    .values({
      productId: product.id,
      organizationId: orgId,
      version: 1,
      effectiveFrom: "1900-01-01",
    })
    .returning();
  return version.id;
}

/** The app's general audit convention uses PascalCase entity kind names ("Client", "Policy",
 *  "PaymentReceipt") — distinct from `ImportEntityType`, which is this feature's own internal
 *  bookkeeping enum (import_records.entityType, batch.entityType, field-spec dispatch). Keeps
 *  synthesized audit rows consistent with every other audit_logs entry for the same entities. */
export const AUDIT_ENTITY_TYPE_LABEL: Record<ImportEntityType, string> = {
  client: "Client",
  policy: "Policy",
  payment: "PaymentReceipt",
  claim: "Claim",
  dependent: "Dependent",
};

/** Whether a batch's imported rows still have live references pointing at them from outside the
 *  batch — from a later import, or from normal tenant-staff activity (e.g. a real new policy
 *  written for an imported client). Checked fresh at rollback time rather than trusting import
 *  history alone, since either source of a live reference must block the rollback. */
export async function checkRollbackBlockers(
  orgId: string,
  entityType: ImportEntityType,
  entityIds: string[],
  tx: any
): Promise<{ blocked: boolean; reason?: string }> {
  if (entityIds.length === 0) return { blocked: false };

  if (entityType === "client") {
    // Soft-deleted (already rolled-back) policies don't count as a live reference.
    const [row] = await tx.select({ c: count() }).from(policies)
      .where(and(eq(policies.organizationId, orgId), inArray(policies.clientId, entityIds), isNull(policies.deletedAt)));
    const cnt = row?.c ?? 0;
    if (cnt > 0) return { blocked: true, reason: `${cnt} polic${cnt === 1 ? "y" : "ies"} still reference these clients — cannot roll back.` };
    return { blocked: false };
  }

  if (entityType === "policy") {
    const [receiptRow] = await tx.select({ c: count() }).from(paymentReceipts)
      .where(and(eq(paymentReceipts.organizationId, orgId), inArray(paymentReceipts.policyId, entityIds), isNull(paymentReceipts.deletedAt)));
    const [claimRow] = await tx.select({ c: count() }).from(claims)
      .where(and(eq(claims.organizationId, orgId), inArray(claims.policyId, entityIds)));
    // A policy row's cascade delete would take its policy_members rows down with it — including
    // any imported dependant's membership — but not the dependents row itself (only referenced
    // via that membership), leaving an orphaned dependant with no policy link. Roll back the
    // dependant import first instead.
    const [depMemberRow] = await tx.select({ c: count() }).from(policyMembers)
      .where(and(eq(policyMembers.organizationId, orgId), inArray(policyMembers.policyId, entityIds), isNotNull(policyMembers.dependentId)));
    const receiptCnt = receiptRow?.c ?? 0;
    const claimCnt = claimRow?.c ?? 0;
    const depCnt = depMemberRow?.c ?? 0;
    if (receiptCnt > 0 || claimCnt > 0 || depCnt > 0) {
      const parts: string[] = [];
      if (receiptCnt > 0) parts.push(`${receiptCnt} payment receipt(s)`);
      if (claimCnt > 0) parts.push(`${claimCnt} claim(s)`);
      if (depCnt > 0) parts.push(`${depCnt} dependant(s) (roll back the dependant import first)`);
      return { blocked: true, reason: `${parts.join(" and ")} still reference these policies — cannot roll back.` };
    }
    return { blocked: false };
  }

  return { blocked: false }; // claim: no downstream FK dependents in v1 scope.
  // ("payment" and "dependent" never reach this function — server/storage.ts special-cases both:
  // payment-batch rollback into rollbackPaymentReplay's snapshot-compare, since replay mutates
  // policy state rather than just inserting rows a simple reference-count check could reason
  // about; dependent-batch rollback deletes its own policy_members row first, then relies on the
  // dependents→policy_members FK to naturally block if the dependent was added to another policy
  // since import — see the outer catch in rollbackImportBatch.)
}

/** Builds a synthesized historical audit_log row for one imported record. Deliberately bypasses
 *  the normal auditLog()/createAuditLog() helper (whose Zod insert type omits `timestamp`) since
 *  legacy history needs a backdated timestamp — see docs on this feature for why this is a
 *  narrow, scoped exception rather than a general change to audit logging. */
export function buildLegacyAuditLogRow(params: {
  organizationId: string;
  entityType: string;
  entityId: string;
  after: unknown;
  historicalDate: Date | null;
  sourceSystemLabel: string | null;
}) {
  return {
    organizationId: params.organizationId,
    actorId: null as string | null,
    actorEmail: `import:${params.sourceSystemLabel || "unknown"}`,
    action: "legacy_migrated_create",
    entityType: params.entityType,
    entityId: params.entityId,
    before: null as unknown,
    after: params.after as any,
    requestId: null as string | null,
    ipAddress: null as string | null,
    timestamp: params.historicalDate ?? new Date(),
  };
}
