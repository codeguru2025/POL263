import { describe, it, expect } from 'vitest';

// Mocked RBAC Guard for testing
const checkPermission = (userRoles: string[], requiredPerm: string) => {
  const rolePermissions: Record<string, string[]> = {
    'SUPERUSER': ['read:property', 'write:property', 'delete:property', 'read:lease', 'write:lease', 'read:audit_log', 'manage:settings'],
    'MANAGER': ['read:property', 'write:property', 'read:lease', 'write:lease', 'read:audit_log'],
    'STAFF': ['read:property', 'read:lease', 'write:lease'],
  };

  return userRoles.some(role => rolePermissions[role]?.includes(requiredPerm));
};

describe('RBAC Server-Side Guards', () => {
  it('should allow SUPERUSER to manage settings', () => {
    const isAllowed = checkPermission(['SUPERUSER'], 'manage:settings');
    expect(isAllowed).toBe(true);
  });

  it('should deny STAFF from managing settings', () => {
    const isAllowed = checkPermission(['STAFF'], 'manage:settings');
    expect(isAllowed).toBe(false);
  });

  it('should allow STAFF to write leases', () => {
    const isAllowed = checkPermission(['STAFF'], 'write:lease');
    expect(isAllowed).toBe(true);
  });

  it('should deny MANAGER from deleting properties', () => {
    const isAllowed = checkPermission(['MANAGER'], 'delete:property');
    expect(isAllowed).toBe(false);
  });
});
