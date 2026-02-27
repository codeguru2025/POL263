# Entity Relationship Diagram (ERD) Summary

## Core Multi-Tenancy
- **Organization**: Top-level tenant (e.g., Acme Corp)
- **Branch**: Sub-division of an Organization (e.g., HQ - New York)

## Identity & Access
- **User**: System actors (Staff or Clients)
- **Role**: Defined roles (Superuser, Manager, Staff, Viewer)
- **Permission**: Atomic actions (read:policy, write:policy)
- **RolePermission**: Join table mapping Roles to Permissions
- **UserRole**: Join table mapping Users to Roles (scoped to Org/Branch)

## Domain Entities
- **Policy**: Insurance policies (belongs to Org/Branch)
- **Claim**: Claims tying Clients to Policies
- **AuditLog**: Immutable ledger of all CUD operations, storing `before` and `after` diffs.