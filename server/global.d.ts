// Make this a module file so declare global / declare module augmentations
// extend existing types rather than replacing them.
// Ambient module declarations (pdfkit, csurf) live in server/ambient.d.ts.
export {};

// Typed Express.User so route handlers can access req.user without `as any`.
// organizationId is null for the platform owner before a tenant is selected;
// requireTenantScope ensures it is always a string in tenant-scoped routes.
declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      displayName: string | null;
      avatarUrl: string | null;
      referralCode: string | null;
      organizationId: string | null;
      branchId: string | null;
      isActive: boolean;
      phone: string | null;
      address: string | null;
      nationalId: string | null;
      dateOfBirth: string | null;
      gender: string | null;
      maritalStatus: string | null;
      nextOfKinName: string | null;
      nextOfKinPhone: string | null;
      department: string | null;
      googleId: string | null;
      createdAt: Date;
      // Set dynamically by auth middleware — never stored in DB
      isPlatformOwner?: boolean;
    }
  }
}

declare module "express-session" {
  interface SessionData {
    clientId?: string;
    clientOrgId?: string;
    authTenantId?: string;
    authReturnTo?: string;
    activeTenantId?: string;
  }
}
