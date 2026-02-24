import { eq, and, desc } from "drizzle-orm";
import { db } from "./db";
import {
  organizations,
  branches,
  users,
  roles,
  permissions,
  rolePermissions,
  userRoles,
  userPermissionOverrides,
  auditLogs,
  type Organization,
  type InsertOrganization,
  type Branch,
  type InsertBranch,
  type User,
  type InsertUser,
  type Role,
  type InsertRole,
  type Permission,
  type InsertPermission,
  type AuditLog,
  type InsertAuditLog,
} from "@shared/schema";

export interface IStorage {
  // Organizations
  getOrganization(id: string): Promise<Organization | undefined>;
  getOrganizations(): Promise<Organization[]>;
  createOrganization(org: InsertOrganization): Promise<Organization>;
  updateOrganization(id: string, data: Partial<InsertOrganization>): Promise<Organization | undefined>;

  // Branches
  getBranch(id: string): Promise<Branch | undefined>;
  getBranchesByOrg(organizationId: string): Promise<Branch[]>;
  createBranch(branch: InsertBranch): Promise<Branch>;

  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  getUsersByOrg(organizationId: string): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined>;

  // Roles
  getRole(id: string): Promise<Role | undefined>;
  getRolesByOrg(organizationId: string): Promise<Role[]>;
  getRoleByName(name: string, organizationId: string): Promise<Role | undefined>;
  createRole(role: InsertRole): Promise<Role>;

  // Permissions
  getPermissions(): Promise<Permission[]>;
  createPermission(perm: InsertPermission): Promise<Permission>;

  // Role-Permission mapping
  getRolePermissions(roleId: string): Promise<Permission[]>;
  addRolePermission(roleId: string, permissionId: string): Promise<void>;

  // User-Role mapping
  getUserRoles(userId: string): Promise<(Role & { branchId: string | null })[]>;
  addUserRole(userId: string, roleId: string, branchId?: string): Promise<void>;

  // User permission overrides
  getUserPermissionOverrides(userId: string): Promise<{ permissionName: string; isGranted: boolean }[]>;
  addUserPermissionOverride(userId: string, permissionId: string, isGranted: boolean): Promise<void>;

  // Effective permissions (combines roles + overrides)
  getUserEffectivePermissions(userId: string): Promise<string[]>;

  // Audit logs
  getAuditLogs(organizationId: string, limit?: number, offset?: number): Promise<AuditLog[]>;
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
}

export class DatabaseStorage implements IStorage {
  // ─── Organizations ────────────────────────────────────────
  async getOrganization(id: string): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
    return org;
  }

  async getOrganizations(): Promise<Organization[]> {
    return db.select().from(organizations);
  }

  async createOrganization(org: InsertOrganization): Promise<Organization> {
    const [created] = await db.insert(organizations).values(org).returning();
    return created;
  }

  async updateOrganization(id: string, data: Partial<InsertOrganization>): Promise<Organization | undefined> {
    const [updated] = await db.update(organizations).set(data).where(eq(organizations.id, id)).returning();
    return updated;
  }

  // ─── Branches ─────────────────────────────────────────────
  async getBranch(id: string): Promise<Branch | undefined> {
    const [branch] = await db.select().from(branches).where(eq(branches.id, id));
    return branch;
  }

  async getBranchesByOrg(organizationId: string): Promise<Branch[]> {
    return db.select().from(branches).where(eq(branches.organizationId, organizationId));
  }

  async createBranch(branch: InsertBranch): Promise<Branch> {
    const [created] = await db.insert(branches).values(branch).returning();
    return created;
  }

  // ─── Users ────────────────────────────────────────────────
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    return user;
  }

  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.googleId, googleId));
    return user;
  }

  async getUsersByOrg(organizationId: string): Promise<User[]> {
    return db.select().from(users).where(eq(users.organizationId, organizationId));
  }

  async createUser(user: InsertUser): Promise<User> {
    const [created] = await db.insert(users).values({ ...user, email: user.email.toLowerCase() }).returning();
    return created;
  }

  async updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined> {
    const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return updated;
  }

  // ─── Roles ────────────────────────────────────────────────
  async getRole(id: string): Promise<Role | undefined> {
    const [role] = await db.select().from(roles).where(eq(roles.id, id));
    return role;
  }

  async getRolesByOrg(organizationId: string): Promise<Role[]> {
    return db.select().from(roles).where(eq(roles.organizationId, organizationId));
  }

  async getRoleByName(name: string, organizationId: string): Promise<Role | undefined> {
    const [role] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.name, name), eq(roles.organizationId, organizationId)));
    return role;
  }

  async createRole(role: InsertRole): Promise<Role> {
    const [created] = await db.insert(roles).values(role).returning();
    return created;
  }

  // ─── Permissions ──────────────────────────────────────────
  async getPermissions(): Promise<Permission[]> {
    return db.select().from(permissions);
  }

  async createPermission(perm: InsertPermission): Promise<Permission> {
    const [created] = await db.insert(permissions).values(perm).returning();
    return created;
  }

  // ─── Role-Permission mapping ──────────────────────────────
  async getRolePermissions(roleId: string): Promise<Permission[]> {
    const rows = await db
      .select({ permission: permissions })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(rolePermissions.roleId, roleId));
    return rows.map((r) => r.permission);
  }

  async addRolePermission(roleId: string, permissionId: string): Promise<void> {
    await db
      .insert(rolePermissions)
      .values({ roleId, permissionId })
      .onConflictDoNothing();
  }

  // ─── User-Role mapping ────────────────────────────────────
  async getUserRoles(userId: string): Promise<(Role & { branchId: string | null })[]> {
    const rows = await db
      .select({ role: roles, branchId: userRoles.branchId })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, userId));
    return rows.map((r) => ({ ...r.role, branchId: r.branchId }));
  }

  async addUserRole(userId: string, roleId: string, branchId?: string): Promise<void> {
    await db.insert(userRoles).values({ userId, roleId, branchId: branchId ?? null });
  }

  // ─── User permission overrides ────────────────────────────
  async getUserPermissionOverrides(userId: string): Promise<{ permissionName: string; isGranted: boolean }[]> {
    const rows = await db
      .select({ permissionName: permissions.name, isGranted: userPermissionOverrides.isGranted })
      .from(userPermissionOverrides)
      .innerJoin(permissions, eq(userPermissionOverrides.permissionId, permissions.id))
      .where(eq(userPermissionOverrides.userId, userId));
    return rows;
  }

  async addUserPermissionOverride(userId: string, permissionId: string, isGranted: boolean): Promise<void> {
    await db.insert(userPermissionOverrides).values({ userId, permissionId, isGranted });
  }

  // ─── Effective permissions ────────────────────────────────
  async getUserEffectivePermissions(userId: string): Promise<string[]> {
    const userRolesList = await this.getUserRoles(userId);
    const permSet = new Set<string>();

    for (const role of userRolesList) {
      if (role.name === "superuser") {
        const allPerms = await this.getPermissions();
        return allPerms.map((p) => p.name);
      }
      const rolePerms = await this.getRolePermissions(role.id);
      for (const p of rolePerms) {
        permSet.add(p.name);
      }
    }

    const overrides = await this.getUserPermissionOverrides(userId);
    for (const o of overrides) {
      if (o.isGranted) {
        permSet.add(o.permissionName);
      } else {
        permSet.delete(o.permissionName);
      }
    }

    return Array.from(permSet);
  }

  // ─── Audit Logs ───────────────────────────────────────────
  async getAuditLogs(organizationId: string, limit = 50, offset = 0): Promise<AuditLog[]> {
    return db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, organizationId))
      .orderBy(desc(auditLogs.timestamp))
      .limit(limit)
      .offset(offset);
  }

  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const [created] = await db.insert(auditLogs).values(log).returning();
    return created;
  }
}

export const storage = new DatabaseStorage();
