/**
 * Per-agent commission statement — a formatted A4 PDF an agent can be handed: the ledger lines
 * for a period (policy, client, entry type, amount, date), a totals block (earned, clawback,
 * other, net) and a year-to-date figure. Reuses the letterhead / table helpers from
 * financial-statement-pdf.ts.
 */
import type { Response } from "express";
import { storage } from "./storage";
import { resolveImage } from "./object-storage";
import {
  makeDoc, newPage, sectionBand, kv, drawTable, finish, fmtDate, money, ensureSpace, M, COL,
} from "./financial-statement-pdf";

const EARN_TYPES = new Set(["joining", "renewal", "trail", "override", "bonus", "commission"]);

export async function streamCommissionStatementPdf(
  orgId: string,
  agentId: string,
  from: string,
  to: string,
  res: Response,
  opts?: { attachment?: boolean },
) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }
  const agent = await storage.getUser(agentId, orgId).catch(() => undefined);
  const logoData = await resolveImage(org.logoUrl);
  const allLines = await storage.getCommissionLedgerDetailedByOrg(orgId, agentId);

  const inPeriod = allLines.filter((l: any) => {
    const d = l.createdAt ? new Date(l.createdAt).toISOString().slice(0, 10) : "";
    return d >= from && d <= to;
  });
  const ytdStart = `${to.slice(0, 4)}-01-01`;
  const ytd = allLines.filter((l: any) => {
    const d = l.createdAt ? new Date(l.createdAt).toISOString().slice(0, 10) : "";
    return d >= ytdStart && d <= to;
  });

  const sumBy = (lines: any[], pred: (t: string) => boolean) =>
    lines.reduce((acc: Record<string, number>, l: any) => {
      const t = String(l.entryType || "").toLowerCase();
      if (!pred(t)) return acc;
      const c = (l.currency || "USD").toUpperCase();
      acc[c] = (acc[c] || 0) + (parseFloat(String(l.amount ?? 0)) || 0);
      return acc;
    }, {});
  const asLines = (m: Record<string, number>) => {
    const parts = Object.entries(m).filter(([, v]) => Math.abs(v) > 0.004).map(([c, v]) => `${c} ${money(v)}`);
    return parts.length ? parts.join("   ·   ") : "—";
  };

  const earned = sumBy(inPeriod, (t) => EARN_TYPES.has(t) || (!t.includes("clawback") && !t.includes("advance") && !t.includes("deduction")));
  const clawback = sumBy(inPeriod, (t) => t.includes("clawback"));
  const other = sumBy(inPeriod, (t) => t.includes("advance") || t.includes("deduction") || t.includes("adjustment"));
  const net: Record<string, number> = {};
  for (const m of [earned, clawback, other]) for (const [c, v] of Object.entries(m)) net[c] = (net[c] || 0) + v;
  const ytdNet = sumBy(ytd, () => true);

  const agentName = agent ? (agent.displayName || agent.email || agentId) : agentId;
  const ctx = makeDoc(org, logoData, "Agent Commission Statement",
    `${agentName}  ·  Period: ${fmtDate(from)} to ${fmtDate(to)}  ·  Generated: ${new Date().toLocaleString("en-ZA")}`);
  newPage(ctx);

  sectionBand(ctx, "Summary");
  kv(ctx, "Commission earned", asLines(earned));
  kv(ctx, "Clawbacks", asLines(clawback));
  kv(ctx, "Advances / deductions / adjustments", asLines(other));
  kv(ctx, "Net this period", asLines(net));
  kv(ctx, `Year to date (${ytdStart} to ${to})`, asLines(ytdNet));

  sectionBand(ctx, `Ledger lines (${inPeriod.length})`);
  drawTable(ctx, [
    { header: "Date", width: 62, getter: (r) => (r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : "—") },
    { header: "Policy", width: 72, getter: (r) => r.policyNumber || "—" },
    { header: "Client", width: 120, getter: (r) => `${r.clientFirstName || ""} ${r.clientLastName || ""}`.trim() || "—" },
    { header: "Type", width: 78, getter: (r) => String(r.entryType || "—") },
    { header: "Status", width: 60, getter: (r) => r.status || "—" },
    { header: "Description", width: COL - 492, getter: (r) => r.description || "—" },
    { header: "Amount", width: 100, align: "right", getter: (r) => `${(r.currency || "USD")} ${money(r.amount)}` },
  ], inPeriod, "No commission ledger activity in this period.");

  ensureSpace(ctx, 20);
  ctx.doc.font("Helvetica-Oblique").fontSize(7).fillColor("#6b7280")
    .text("This statement is generated from the commission ledger. Payroll items with no system source (PAYE, medical aid, etc.) are handled separately in payroll.", M, ctx.y, { width: COL });
  ctx.y += 16;

  finish(ctx, res, `commission-statement-${agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${from}-to-${to}.pdf`, !!opts?.attachment);
}
