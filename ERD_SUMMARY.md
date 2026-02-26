# ERD Summary - POL263 (Phase 0-1)

This outlines the core tables required for multi-tenancy, authentication, and RBAC before specific product features (properties, leases, payments) are fully modeled.

## 1. Tenancy
### Organization
*   `id` (UUID, PK)
*   `name` (String)
*   `primary_color` (String)
*   `logo_url` (String)
*   `created_at` (Timestamp)

### Branch
*   `id` (UUID, PK)
*   `organization_id` (UUID, FK -> Organization)
*   `name` (String)
*   `created_at` (Timestamp)

## 2. Identity & Access
### User
*   `id` (UUID, PK)
*   `email` (String, Unique)
*   `google_id` (String, Unique)
*   `avatar_url` (String)
*   `organization_id` (UUID, FK -> Organization)

### Role
*   `id` (UUID, PK)
*   `organization_id` (UUID, FK -> Organization)
*   `name` (String) // e.g., 'Superuser', 'Property Manager'

### Permission
*   `id` (UUID, PK)
*   `name` (String, Unique) // e.g., 'write:lease', 'read:audit_log'

### RolePermission
*   `role_id` (UUID, FK -> Role)
*   `permission_id` (UUID, FK -> Permission)
*   (Composite PK)

### UserRole
*   `user_id` (UUID, FK -> User)
*   `role_id` (UUID, FK -> Role)
*   `branch_id` (UUID, FK -> Branch, Nullable for org-wide roles)

### UserPermissionOverride
*   `user_id` (UUID, FK -> User)
*   `permission_id` (UUID, FK -> Permission)
*   `is_granted` (Boolean) // Allows granting or explicitly revoking

## 3. Auditing
### AuditLog
*   `id` (UUID, PK)
*   `organization_id` (UUID, FK -> Organization)
*   `actor_id` (UUID, FK -> User)
*   `action` (String)
*   `entity_type` (String)
*   `entity_id` (UUID)
*   `delta` (JSONB) // Before/After state
*   `timestamp` (Timestamp)
*   `request_id` (String) // For tracing

*(Note: Product tables like Property, Unit, Lease, Payment will all inherit `organization_id` and potentially `branch_id` from this foundation.)*