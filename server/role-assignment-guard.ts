/**
 * Stops privilege escalation through user management. write:user used to let its holder
 * (administrators, branch managers) give ANY role to ANY user — themselves included, and
 * including superuser, which bypasses every permission check — and set the password of a more
 * powerful account. Standard rules now:
 *
 *  1. Nobody changes their own roles (only the platform owner).
 *  2. You can only give a role whose permissions you hold yourself — so only a superuser can
 *     make a superuser, and an administrator can't hand out finance_manager.
 *  3. You can't change the password, email, active status or roles of — or delete — a user who
 *     has powers you don't.
 */
import { storage } from "./storage";

type Actor = { id: string; organizationId: string; isPlatformOwner?: boolean };
type RoleLike = { id: string; name: string };

async function permsOfRole(role: RoleLike, orgId: string): Promise<string[]> {
  if (role.name === "superuser") return (await storage.getPermissions()).map((p) => p.name);
  return (await storage.getRolePermissions(role.id, orgId)).map((p) => p.name);
}

/** Error message if `actor` may not give `roles` to `targetUserId` (undefined = a new user). */
export async function roleAssignmentError(actor: Actor, roles: RoleLike[], targetUserId?: string): Promise<string | null> {
  if (actor.isPlatformOwner) return null;
  if (targetUserId && targetUserId === actor.id) return "You can't change your own roles. Ask another administrator or the owner.";
  const mine = new Set(await storage.getUserEffectivePermissions(actor.id, actor.organizationId));
  for (const role of roles) {
    const missing = (await permsOfRole(role, actor.organizationId)).filter((p) => !mine.has(p));
    if (missing.length > 0) {
      return `You can't give the "${role.name.replace(/_/g, " ")}" role — it has powers you don't have yourself. Ask the owner.`;
    }
  }
  return null;
}

/** Error message if `actor` may not manage (reset password, change email/status/roles, delete) the target. */
export async function manageUserError(actor: Actor, targetUserId: string): Promise<string | null> {
  if (actor.isPlatformOwner) return null;
  if (targetUserId === actor.id) return null; // own profile — role changes are blocked separately
  const mine = new Set(await storage.getUserEffectivePermissions(actor.id, actor.organizationId));
  const theirs = await storage.getUserEffectivePermissions(targetUserId, actor.organizationId);
  if (theirs.some((p) => !mine.has(p))) {
    return "This person has powers you don't have, so only the owner (or someone with at least their access) can change their account.";
  }
  return null;
}
