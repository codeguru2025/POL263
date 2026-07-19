/**
 * Non-blocking availability check for funeral-logistics scheduling — a driver, vehicle,
 * staff member, or equipment item may already be committed elsewhere on the same date
 * (another case's removal/burial/overnight leg, or another pitching assignment). Returns
 * human-readable conflict descriptions; callers surface these as warnings and let staff
 * proceed anyway (real-world logistics often need last-minute overrides).
 */
import { and, eq, or, inArray } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { funeralCases, pitchingAssignments, pitchingAssignmentStaff, pitchingAssignmentEquipment } from "../shared/schema";

export interface AvailabilityWant {
  vehicleId?: string;
  driverId?: string;
  userIds?: string[];
  equipmentItemIds?: string[];
  /** Exclude this assignment/case from the conflict check (when editing an existing one). */
  excludePitchingAssignmentId?: string;
  excludeFuneralCaseId?: string;
}

export async function checkAvailability(orgId: string, date: string, want: AvailabilityWant): Promise<string[]> {
  const tdb = await getDbForOrg(orgId);
  const conflicts: string[] = [];

  if (want.vehicleId || want.driverId) {
    const caseConds = [eq(funeralCases.organizationId, orgId), or(eq(funeralCases.funeralDate, date), eq(funeralCases.overnightDate, date))];
    const cases = await tdb.select().from(funeralCases).where(and(...caseConds));
    for (const fc of cases) {
      if (want.excludeFuneralCaseId && fc.id === want.excludeFuneralCaseId) continue;
      const vehicleHit = want.vehicleId && [fc.removalVehicleId, fc.burialVehicleId, fc.overnightVehicleId].includes(want.vehicleId);
      const driverHit = want.driverId && [fc.removalDriverId, fc.burialDriverId, fc.overnightDriverId].includes(want.driverId);
      if (vehicleHit) conflicts.push(`Vehicle already assigned to case ${fc.caseNumber} (${fc.deceasedName}) on ${date}`);
      if (driverHit) conflicts.push(`Driver already assigned to case ${fc.caseNumber} (${fc.deceasedName}) on ${date}`);
    }
    if (want.vehicleId) {
      const paConds = [eq(pitchingAssignments.organizationId, orgId), eq(pitchingAssignments.assignmentDate, date), eq(pitchingAssignments.vehicleId, want.vehicleId)];
      const rows = await tdb.select().from(pitchingAssignments).where(and(...paConds));
      for (const r of rows) {
        if (want.excludePitchingAssignmentId && r.id === want.excludePitchingAssignmentId) continue;
        conflicts.push(`Vehicle already on a pitching assignment on ${date}`);
      }
    }
  }

  if (want.userIds && want.userIds.length > 0) {
    const caseConds = [eq(funeralCases.organizationId, orgId), or(eq(funeralCases.funeralDate, date), eq(funeralCases.overnightDate, date))];
    const cases = await tdb.select().from(funeralCases).where(and(...caseConds));
    for (const fc of cases) {
      if (want.excludeFuneralCaseId && fc.id === want.excludeFuneralCaseId) continue;
      for (const uid of want.userIds) {
        if ([fc.removalDriverId, fc.burialDriverId, fc.overnightDriverId].includes(uid)) {
          conflicts.push(`Staff member already driving on case ${fc.caseNumber} (${fc.deceasedName}) on ${date}`);
        }
      }
    }
    const paRows = await tdb.select({ id: pitchingAssignments.id, caseId: pitchingAssignments.funeralCaseId })
      .from(pitchingAssignments)
      .where(and(eq(pitchingAssignments.organizationId, orgId), eq(pitchingAssignments.assignmentDate, date)));
    const paIds = paRows.map(r => r.id).filter(id => id !== want.excludePitchingAssignmentId);
    if (paIds.length > 0) {
      const staffRows = await tdb.select().from(pitchingAssignmentStaff)
        .where(and(inArray(pitchingAssignmentStaff.pitchingAssignmentId, paIds), inArray(pitchingAssignmentStaff.userId, want.userIds)));
      if (staffRows.length > 0) conflicts.push(`One or more staff already on another pitching assignment on ${date}`);
    }
  }

  if (want.equipmentItemIds && want.equipmentItemIds.length > 0) {
    const paRows = await tdb.select({ id: pitchingAssignments.id })
      .from(pitchingAssignments)
      .where(and(eq(pitchingAssignments.organizationId, orgId), eq(pitchingAssignments.assignmentDate, date)));
    const paIds = paRows.map(r => r.id).filter(id => id !== want.excludePitchingAssignmentId);
    if (paIds.length > 0) {
      const equipRows = await tdb.select().from(pitchingAssignmentEquipment)
        .where(and(inArray(pitchingAssignmentEquipment.pitchingAssignmentId, paIds), inArray(pitchingAssignmentEquipment.equipmentItemId, want.equipmentItemIds)));
      if (equipRows.length > 0) conflicts.push(`One or more equipment items already assigned elsewhere on ${date}`);
    }
  }

  return conflicts;
}
