/**
 * Daily Schedule of Service PDF
 * Lists every funeral case scheduled for a given date, with full logistics,
 * assigned staff contacts, and timeline — printed on company letterhead.
 */

import PDFDocument from "pdfkit";
import type { Response } from "express";
import { storage } from "./storage";
import { resolveImage } from "./object-storage";
import { eq, and } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { funeralCases } from "../shared/schema";

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 44;
const COL = A4_W - MARGIN * 2;

const C_PRIMARY = "#0f766e";
const C_ACCENT = "#134e4a";
const C_TEXT = "#111827";
const C_MUTED = "#6b7280";
const C_LIGHT = "#f0fdf4";
const C_BORDER = "#d1fae5";

function fmt(v: string | null | undefined): string {
  return v?.trim() || "—";
}

function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("en-ZA", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  } catch { return String(v); }
}

const TZ = "Africa/Harare"; // CAT = UTC+2, no DST

function fmtTime(v: Date | string | null | undefined): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  } catch { return String(v); }
}

function fmtDateTime(v: Date | string | null | undefined): string {
  if (!v) return "—";
  try {
    const d = new Date(v);
    return d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", timeZone: TZ }) + " " +
      d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  } catch { return String(v); }
}

type StaffInfo = { displayName: string | null; phone: string | null; email: string | null; };

export async function streamDailyScheduleToResponse(
  orgId: string,
  date: string, // YYYY-MM-DD
  res: Response,
  opts?: { attachment?: boolean }
): Promise<void> {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  // Fetch all cases with funeralDate = date
  const tdb = await getDbForOrg(orgId);
  const cases = await tdb.select().from(funeralCases)
    .where(and(eq(funeralCases.organizationId, orgId), eq(funeralCases.funeralDate, date)));

  // Sort by earliest event time
  const getEarliestTime = (fc: typeof cases[0]) => {
    const times = [fc.bodyWashTime, fc.burialDepartureTime, fc.memorialServiceStart].filter(Boolean) as Date[];
    if (times.length === 0) return "99:99";
    return times.map(t => new Date(t).toISOString()).sort()[0];
  };
  cases.sort((a, b) => getEarliestTime(a).localeCompare(getEarliestTime(b)));

  // Cemeteries + pitching assignments for this date (grouped by case) — surfaces the
  // overnighting leg and cemetery/pitching crew alongside the rest of the day's logistics.
  // Fetched before the user/vehicle lookup maps below so the pitching crew and vehicle are
  // included in those maps too — otherwise a pitcher who isn't also a removal/burial/overnight
  // driver (or a vehicle only used for pitching) would resolve to blank on the printed PDF.
  const cemeteriesList = await storage.getCemeteries(orgId);
  const cemeteriesMap: Record<string, { name: string; address: string | null }> = {};
  for (const c of cemeteriesList) cemeteriesMap[c.id] = { name: c.name, address: (c as any).address ?? null };

  const pitchingRows = await storage.getPitchingAssignmentsByDate(orgId, date);
  const pitchingByCase: Record<string, any[]> = {};
  for (const r of pitchingRows) {
    if (!pitchingByCase[r.funeralCaseId]) pitchingByCase[r.funeralCaseId] = [];
    pitchingByCase[r.funeralCaseId].push(r);
  }
  const equipmentList = await storage.getEquipmentItems(orgId);
  const equipmentMap: Record<string, string> = {};
  for (const e of equipmentList) equipmentMap[e.id] = e.name;

  // Resolve all user ids
  const userIdSet = new Set<string>();
  const vehicleIdSet = new Set<string>();
  for (const fc of cases) {
    [fc.removalDriverId, fc.burialDriverId, (fc as any).overnightDriverId, fc.attendingAgentId, fc.assignedTo].forEach(id => { if (id) userIdSet.add(id); });
    [fc.removalVehicleId, fc.burialVehicleId, (fc as any).overnightVehicleId].forEach(id => { if (id) vehicleIdSet.add(id); });
  }
  for (const r of pitchingRows) {
    (r.staffUserIds || []).forEach((id: string) => { if (id) userIdSet.add(id); });
    if (r.vehicleId) vehicleIdSet.add(r.vehicleId);
  }
  const usersMap: Record<string, StaffInfo> = {};
  const vehiclesMap: Record<string, { registrationNumber: string | null; make: string | null; model: string | null }> = {};
  await Promise.all([
    ...Array.from(userIdSet).map(async (id) => {
      const u = await storage.getUser(id);
      if (u) usersMap[id] = { displayName: u.displayName, phone: u.phone ?? null, email: u.email ?? null };
    }),
    ...Array.from(vehicleIdSet).map(async (id) => {
      const v = await storage.getFleetVehicleById(id, orgId);
      // fleetVehicles' actual column is `registration`, not `registrationNumber` — this map key
      // is just this function's internal naming; read from the real field.
      if (v) vehiclesMap[id] = { registrationNumber: (v as any).registration ?? null, make: (v as any).make ?? null, model: (v as any).model ?? null };
    }),
  ]);

  const logoData = await resolveImage(org.logoUrl);
  const dateLabel = fmtDate(date + "T00:00:00");
  const filename = `Daily-Schedule-${date}.pdf`;

  if (opts?.attachment) {
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  } else {
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  }
  res.setHeader("Content-Type", "application/pdf");

  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true, info: { Title: `Daily Schedule of Service — ${date}`, Author: org.name || "POL263" } });
  doc.pipe(res);

  let y = MARGIN;
  let pageNum = 0;

  const newPage = () => {
    if (pageNum > 0) doc.addPage();
    pageNum++;
    y = MARGIN;
    drawHeader();
  };

  const ensureSpace = (h: number) => {
    if (y + h > A4_H - MARGIN - 24) newPage();
  };

  const drawHeader = () => {
    // Logo
    if (logoData) {
      try { doc.image(logoData, MARGIN, y, { height: 50, fit: [100, 50] }); } catch { /* skip */ }
    }
    // Org name + contact
    doc.font("Helvetica-Bold").fontSize(13).fillColor(C_PRIMARY)
      .text(org.name || "Funeral Services", MARGIN + 110, y, { width: COL - 110, align: "right" });
    y += 16;
    doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED);
    const parts = [org.phone, org.email, org.address].filter(Boolean) as string[];
    for (const p of parts) {
      doc.text(p, MARGIN + 110, y, { width: COL - 110, align: "right" });
      y += 10;
    }
    y = Math.max(y, MARGIN + 56) + 8;
    doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(2).strokeColor(C_PRIMARY).stroke();
    y += 10;
    // Title block
    doc.rect(MARGIN, y, COL, 28).fill(C_ACCENT);
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#ffffff")
      .text("DAILY SCHEDULE OF SERVICE", MARGIN, y + 7, { width: COL, align: "center" });
    y += 32;
    doc.font("Helvetica").fontSize(9).fillColor(C_MUTED)
      .text(`Date: ${dateLabel}  ·  ${cases.length} case${cases.length !== 1 ? "s" : ""} scheduled  ·  Printed: ${new Date().toLocaleString("en-ZA")}`, MARGIN, y, { width: COL, align: "center" });
    y += 18;
  };

  newPage();

  if (cases.length === 0) {
    doc.font("Helvetica").fontSize(11).fillColor(C_MUTED)
      .text("No funeral cases are scheduled for this date.", MARGIN, y, { width: COL, align: "center" });
    doc.end();
    return;
  }

  // ── Case helpers ─────────────────────────────────────────────
  const sectionBand = (title: string) => {
    ensureSpace(22);
    doc.rect(MARGIN, y, COL, 17).fill(C_PRIMARY);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff")
      .text(title.toUpperCase(), MARGIN + 6, y + 4, { width: COL - 12 });
    y += 20;
    doc.fillColor(C_TEXT);
  };

  const subBand = (title: string) => {
    ensureSpace(16);
    doc.rect(MARGIN, y, COL, 14).fill(C_LIGHT);
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C_ACCENT)
      .text(title.toUpperCase(), MARGIN + 6, y + 3, { width: COL - 12 });
    y += 17;
  };

  const kv = (label: string, value: string, lw = 140) => {
    ensureSpace(14);
    const vw = COL - lw - 6;
    const sy = y;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED).text(label, MARGIN, sy, { width: lw });
    doc.font("Helvetica").fontSize(8).fillColor(C_TEXT).text(value, MARGIN + lw + 6, sy, { width: vw });
    y += 13;
  };

  const kv2 = (l1: string, v1: string, l2: string, v2: string) => {
    ensureSpace(14);
    const half = COL / 2 - 4;
    const sy = y;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED).text(l1, MARGIN, sy, { width: 90 });
    doc.font("Helvetica").fontSize(8).fillColor(C_TEXT).text(v1, MARGIN + 94, sy, { width: half - 94 });
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED).text(l2, MARGIN + half + 8, sy, { width: 90 });
    doc.font("Helvetica").fontSize(8).fillColor(C_TEXT).text(v2, MARGIN + half + 102, sy, { width: half - 94 });
    y += 13;
  };

  const staffContact = (role: string, userId: string | null | undefined) => {
    const u = userId ? usersMap[userId] : null;
    if (!u) { kv(role, "—"); return; }
    kv(`${role} Name`, fmt(u.displayName));
    if (u.phone) kv(`${role} Phone`, u.phone);
    if (u.email) kv(`${role} Email`, u.email);
  };

  const vehicleLabel = (vehicleId: string | null | undefined) => {
    if (!vehicleId) return "—";
    const v = vehiclesMap[vehicleId];
    if (!v) return "—";
    return [v.make, v.model, v.registrationNumber].filter(Boolean).join(" / ");
  };

  // ── Each case ────────────────────────────────────────────────
  for (let i = 0; i < cases.length; i++) {
    const fc = cases[i];
    ensureSpace(30);

    // Case header card
    doc.rect(MARGIN, y, COL, 22).fill(C_BORDER).stroke(C_PRIMARY).lineWidth(0.5);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(C_ACCENT)
      .text(`CASE ${i + 1} OF ${cases.length}  ·  ${fc.caseNumber}  ·  ${fc.deceasedName.toUpperCase()}`, MARGIN + 8, y + 6, { width: COL - 16 });
    y += 26;

    // Deceased + case info
    sectionBand("1. Case Summary");
    kv2("Case Number", fc.caseNumber, "Status", fmt(fc.status).replace(/_/g, " ").toUpperCase());
    kv2("Deceased Name", fc.deceasedName, "Date of Death", fmtDate(fc.dateOfDeath));
    kv2("Cause of Death", fmt(fc.causeOfDeath), "Place of Death", fmt(fc.placeOfDeath));
    kv2("Service Type", fmt(fc.serviceType), "Funeral Date", fmtDate(fc.funeralDate));
    kv("Funeral Location", fmt(fc.funeralLocation));
    const cemetery = (fc as any).cemeteryId ? cemeteriesMap[(fc as any).cemeteryId] : undefined;
    if (cemetery) kv("Cemetery", [cemetery.name, cemetery.address].filter(Boolean).join(" — "));
    if (fc.notes) kv("Notes / Instructions", fc.notes);

    // Informant
    if (fc.informantName || fc.informantPhone) {
      sectionBand("2. Informant / Next of Kin");
      kv2("Name", fmt(fc.informantName), "Phone", fmt(fc.informantPhone));
      kv("Relationship", fmt(fc.informantRelationship));
    }

    // Service timeline
    sectionBand("3. Service Timeline");
    kv2("Body Wash Time", fmtTime(fc.bodyWashTime), "Removal Location", fmt(fc.removalLocation));
    kv2("Burial Departure", fmtTime(fc.burialDepartureTime), "Memorial Start", fmtTime(fc.memorialServiceStart));
    kv("Memorial End", fmtTime(fc.memorialServiceEnd));

    // Body removal team
    sectionBand("4. Body Removal Team");
    subBand("Removal Vehicle");
    kv("Vehicle", vehicleLabel(fc.removalVehicleId));
    subBand("Removal Driver");
    staffContact("Driver", fc.removalDriverId);

    // Overnight team (only when the body overnights before burial — can be a different
    // vehicle/driver than either removal or burial)
    if ((fc as any).overnightUsed) {
      sectionBand("Overnight Team");
      kv2("Overnight Date", fmtDate((fc as any).overnightDate), "Location", fmt((fc as any).overnightLocation));
      subBand("Overnight Vehicle");
      kv("Vehicle", vehicleLabel((fc as any).overnightVehicleId));
      subBand("Overnight Driver");
      staffContact("Driver", (fc as any).overnightDriverId);
    }

    // Burial team
    sectionBand("5. Burial / Service Team");
    subBand("Burial Vehicle");
    kv("Vehicle", vehicleLabel(fc.burialVehicleId));
    subBand("Burial Driver");
    staffContact("Driver", fc.burialDriverId);

    // Attending agent
    sectionBand("6. Attending Agent");
    staffContact("Agent", fc.attendingAgentId);

    // Cemetery / pitching team — who's setting up the gravesite, with what equipment/vehicle
    const pitching = pitchingByCase[fc.id] || [];
    if (pitching.length > 0) {
      sectionBand("Cemetery / Pitching Team");
      for (const p of pitching) {
        const cem = p.cemeteryId ? cemeteriesMap[p.cemeteryId] : undefined;
        kv("Cemetery", cem ? cem.name : "—");
        kv("Vehicle", vehicleLabel(p.vehicleId));
        const staffNames = (p.staffUserIds || []).map((uid: string) => usersMap[uid]?.displayName).filter(Boolean).join(", ");
        kv("Crew", staffNames || "—");
        const equipNames = (p.equipmentItemIds || []).map((eid: string) => equipmentMap[eid]).filter(Boolean).join(", ");
        kv("Equipment", equipNames || "—");
      }
    }

    // Case manager
    if (fc.assignedTo) {
      sectionBand("7. Case Manager");
      staffContact("Manager", fc.assignedTo);
    }

    // Emergency contact (company number for families to reach the office)
    sectionBand("Emergency Contact");
    kv("Office Number", "+263772378786");

    y += 16;

    // Page break between cases (not after last)
    if (i < cases.length - 1) {
      doc.moveTo(MARGIN, y - 6).lineTo(A4_W - MARGIN, y - 6).lineWidth(0.5).strokeColor(C_BORDER).dash(4, { space: 3 }).stroke();
      doc.undash();
      ensureSpace(60);
    }
  }

  // ── Footer on all pages ──────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const footerY = A4_H - MARGIN + 6;
    doc.font("Helvetica").fontSize(7).fillColor(C_MUTED)
      .text(`${org.name || ""} · Confidential — Internal Use Only · Page ${i + 1} of ${range.count}`, MARGIN, footerY, { width: COL, align: "center", lineBreak: false });
    if (org.footerText) {
      doc.font("Helvetica").fontSize(6.5).fillColor(C_MUTED)
        .text(org.footerText, MARGIN, footerY + 9, { width: COL, align: "center", lineBreak: false });
    }
  }

  doc.end();
}
