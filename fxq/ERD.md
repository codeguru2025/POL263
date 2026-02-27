# Entity Relationship Diagram (ERD) Summary

## Core Multi-Tenancy
- **Organization**: Top-level tenant (e.g., Acme Corp)
- **Branch**: Sub-division of an Organization (e.g., HQ - New York)

## Identity & Access
- **User**: System actors (Staff or Clients)
- **Role**: Defined roles (Superuser, Manager, Staff, Viewer)
- **Permission**: Atomic actions (read:property, write:lease)
- **RolePermission**: Join table mapping Roles to Permissions
- **UserRole**: Join table mapping Users to Roles (scoped to Org/Branch)

## Domain Entities
- **Property**: Physical real estate assets (belongs to Org/Branch)
- **Lease**: Contracts tying Users (Clients) to Properties
- **AuditLog**: Immutable ledger of all CUD operations, storing `before` and `after` diffs.