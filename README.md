# Falakhe PMS - Phase 0-1 Foundation

## How to run (no coding required)

**Website:** Run `npm run dev`, then open the URL it shows in your browser.

**Android app:** Run `npm run setup` once, then `npm run cap:android` to open Android Studio and run the app.

Full step-by-step instructions: **[docs/HOW-TO-RUN.md](docs/HOW-TO-RUN.md)**  
**Database setup (PostgreSQL):** **[docs/DATABASE-SETUP.md](docs/DATABASE-SETUP.md)**  
**Deploy on InterServer VPS:** **[docs/DEPLOY-INTERSERVER-VPS.md](docs/DEPLOY-INTERSERVER-VPS.md)**

---

## Overview
Falakhe PMS is a modern, multi-tenant Property Management System built with a focus on security, scalability, and clean design. This repository contains the Phase 0-1 foundation, establishing the core architecture, tenant isolation, and RBAC implementation before product features are built.

## Architecture & Tech Stack
*   **Frontend**: React (Vite) + Tailwind CSS + shadcn/ui + Wouter
*   **Backend Strategy**: Modular API routes with Zod validation, shared DTOs (simulated in mockup mode)
*   **Database**: PostgreSQL + Prisma ORM (simulated in mockup mode)
*   **Styling**: Custom CSS Variables matching a modern SaaS aesthetic

## Core Implementations

### 1. Multi-Tenancy
*   Data is strictly isolated using `Organization` and `Branch` scoping.
*   The `organization_id` is propagated through all major tables.
*   Queries are implicitly scoped to the active tenant context.

### 2. Authentication & Authorization
*   **Auth**: Staff authenticate exclusively via Google OAuth/OIDC. Passwords are not supported to reduce attack surface.
*   **RBAC**: Database-driven Role-Based Access Control.
*   Roles map to fine-grained permissions.
*   Support for optional per-user overrides for specific edge cases.

### 3. Audit & Compliance
*   Comprehensive Audit Logging framework.
*   Captures `actor`, `action`, `target_entity`, and full `before/after` JSON diffs.
*   Staff UI includes an Audit Log viewer.

### 4. Tenant Branding
*   Tenant-specific branding (logos, primary colors) is config-driven.
*   Settings UI allows dynamic updates to the organization's visual identity.

## Development Setup
```bash
npm install
npm run dev:client
```