# Falakhe PMS

Property Management System Foundation - Phase 0-1

## Overview
Falakhe PMS is a multi-tenant property management system designed to handle organizations, branches, and properties with strict Role-Based Access Control (RBAC) and comprehensive audit logging.

> **Note**: This is currently a Frontend UI Mockup. The backend architecture described below is simulated in the UI to allow for rapid design iteration and feedback.

## Architecture Highlights
- **Frontend**: React + Vite (Simulating Next.js App Router for mockup purposes)
- **Styling**: Tailwind CSS v4, custom design system, Shadcn/UI
- **Multi-tenancy**: Organization and Branch scoping on all major entities.
- **Authentication**: Staff login via Google OAuth/OIDC only (simulated).
- **RBAC**: Database-driven roles and permissions mapped to users.

## Route Structure
- `/staff`: Internal portal for property managers, admins, and agents.
- `/client`: External portal for tenants/clients to view leases and payments.