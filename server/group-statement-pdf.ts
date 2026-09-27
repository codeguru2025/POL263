/**
 * Group scheme statement — a formatted A4 PDF for a scheme/society administrator: the officers,
 * the roster headcount, and the group ledger for a period (opening balance, credits in, debits
 * out, closing balance) with the ledger lines. Reuses the letterhead / table helpers from
 * financial-statement-pdf.ts. The "pool society" voluntary-contribution system is separate and
 * not included here — this is the premium-in / claim-out ledger only.
 */
import type { Response } from "express";
import { storage } from "./storage";
import { resolveImage } from "./object-storage";
import { CREDIT_ENTRY_TYPES, computeGroupLedgerBalance } from "./group-ledger";
import {
  makeDoc, newPage, sectionBand, kv, drawTable, finish, fmtDate, money, ensureSpace, M, COL,
} from "./financial-statement-pdf";

const ENTRY_LABELS: Record<string, string> = {
  premium_credit: "Premium received",
  claim_debit: "Claim paid",
  adjustment_credit: "Adjustment (credit)",
  adjustment_debit: "Adjustment (debit)",
  historical_import: "Historical import",
};

export async function streamGroupStatementPdf(
  orgId: string,
  groupId: string,
  from: string,
  to: string,
  res: Response,
  opts?: { attachment?: boolean },
) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }
  const group = await storage.getGroup(groupId, orgId);
  if (!group) { res.status(404).json({ message: "Group not found" }); return; }

  const [logoData, allEntries, members] = await Promise.all([
    resolveImage(org.logoUrl),
    storage.getGroupLedgerEntries(orgId, groupId),
    storage.getGroupMembers(orgId, groupId).catch(() => []),
  ]);

  const inPeriod = allEntries.filter((e: any) => {
    const d = e.createdAt ? new Date(e.createdAt).toISOString().slice(0, 10) : "";
    return d >= from && d <= to;
  });
  const before = allEntries.filter((e: any) => {
    const d = e.createdAt ? new Date(e.createdAt).toISOString().slice(0, 10) : "";
    return d < from;
  });

  const opening = computeGroupLedgerBalance(before as any);
  const closing = computeGroupLedgerBalance(allEntries.filter((e: any) => {
    const d = e.createdAt ? new Date(e.createdAt).toISOString().slice(0, 10) : "";
    return d <= to;
  }) as any);
  const creditsIn: Record<string, number> = {};
  const debitsOut: Record<string, number> = {};
  for (const e of inPeriod as any[]) {
    const amt = parseFloat(String(e.amount)) || 0;
    if (CREDIT_ENTRY_TYPES.has(e.entryType)) creditsIn[e.currency] = (creditsIn[e.currency] || 0) + amt;
    else debitsOut[e.currency] = (debitsOut[e.currency] || 0) + amt;
  }
  const lines = (m: Record<string, number>) => {
    const parts = Object.entries(m).filter(([, v]) => Math.abs(v) > 0.004).map(([c, v]) => `${c} ${money(v)}`);
    return parts.length ? parts.join("   ·   ") : "—";
  };

  const activeMembers = (members as any[]).filter((m) => m.status === "active").length;
  const inactiveMembers = (members as any[]).length - activeMembers;

  const ctx = makeDoc(org, logoData, "Group Scheme Statement",
    `${group.name}  ·  Period: ${fmtDate(from)} to ${fmtDate(to)}  ·  Generated: ${new Date().toLocaleString("en-ZA")}`);
  newPage(ctx);

  sectionBand(ctx, "Scheme");
  kv(ctx, "Scheme name", group.name);
  if (group.type) kv(ctx, "Type", String(group.type));
  if (group.chairpersonName) kv(ctx, "Chairperson", `${group.chairpersonName}${group.chairpersonPhone ? ` · ${group.chairpersonPhone}` : ""}`);
  if (group.secretaryName) kv(ctx, "Secretary", `${group.secretaryName}${group.secretaryPhone ? ` · ${group.secretaryPhone}` : ""}`);
  if (group.treasurerName) kv(ctx, "Treasurer", `${group.treasurerName}${group.treasurerPhone ? ` · ${group.treasurerPhone}` : ""}`);
  kv(ctx, "Roster", `${activeMembers} active${inactiveMembers ? `, ${inactiveMembers} inactive` : ""}`);

  sectionBand(ctx, "Ledger movement");
  kv(ctx, "Opening balance", lines(opening));
  kv(ctx, "Premiums / credits received", lines(creditsIn), "#15803d");
  kv(ctx, "Claims / debits paid", lines(debitsOut), "#b91c1c");
  kv(ctx, "Closing balance", lines(closing));

  sectionBand(ctx, `Ledger lines (${inPeriod.length})`);
  drawTable(ctx, [
    { header: "Date", width: 70, getter: (r: any) => (r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : "—") },
    { header: "Type", width: 130, getter: (r: any) => ENTRY_LABELS[r.entryType] || r.entryType },
    { header: "Description", width: COL - 340, getter: (r: any) => r.description || "—" },
    { header: "Direction", width: 60, getter: (r: any) => (CREDIT_ENTRY_TYPES.has(r.entryType) ? "Credit" : "Debit") },
    { header: "Amount", width: 80, align: "right", getter: (r: any) => `${r.currency} ${money(r.amount)}` },
  ], inPeriod, "No ledger activity in this period.");

  ensureSpace(ctx, 20);
  ctx.doc.font("Helvetica-Oblique").fontSize(7).fillColor("#6b7280")
    .text("The group ledger is credited by group premium receipts and debited by approved group-service claims. Voluntary member contributions (pool society) are tracked separately and not shown here.", M, ctx.y, { width: COL });
  ctx.y += 16;

  finish(ctx, res, `group-statement-${group.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${from}-to-${to}.pdf`, !!opts?.attachment);
}
