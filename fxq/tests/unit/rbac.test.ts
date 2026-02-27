import { describe, it, expect } from 'vitest';

// Mocked RBAC Guard for testing
const checkPermission = (userRoles: string[], requiredPerm: string) => {
  const rolePermissions: Record<string, string[]> = {
    'SUPERUSER': ['read:policy', 'write:policy', 'delete:policy', 'read:claim', 'write:claim', 'read:audit_log', 'manage:settings'],
    'MANAGER': ['read:policy', 'write:policy', 'read:claim', 'write:claim', 'read:audit_log'],
    'STAFF': ['read:policy', 'read:claim', 'write:claim'],
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

  it('should allow STAFF to write claims', () => {
    const isAllowed = checkPermission(['STAFF'], 'write:claim');
    expect(isAllowed).toBe(true);
  });

  it('should deny MANAGER from deleting policies', () => {
    const isAllowed = checkPermission(['MANAGER'], 'delete:policy');
    expect(isAllowed).toBe(false);
  });
});
