# POL263 - Phase 0-1 Foundation

## How to run (no coding required)

**Website:** Run `npm run dev`, then open the URL it shows in your browser.

**Android app:** Run `npm run setup` once, then `npm run cap:android` to open Android Studio and run the app.

**iOS app:** After `npm run setup`, run `npm run cap:ios` to open Xcode (requires macOS and Xcode). On Windows, the `ios/` project is in the repo; build and run on a Mac or in CI.

**Builds on every push:** Pushing to `main` triggers a GitHub Actions workflow that builds the web app, Android APK, and iOS (simulator). Download artifacts from the **Actions** tab. See **[docs/WEB-AND-MOBILE-SINGLE-CODEBASE.md](docs/WEB-AND-MOBILE-SINGLE-CODEBASE.md)** for CI details and release signing.

**Publish to stores:** To ship to **Google Play** and **App Store Connect**, follow **[docs/GOOGLE-PLAY-AND-APP-STORE.md](docs/GOOGLE-PLAY-AND-APP-STORE.md)** (keystore, GitHub Secrets, store listing, and upload steps).

Full step-by-step instructions: **[docs/HOW-TO-RUN.md](docs/HOW-TO-RUN.md)**  
**Database setup (PostgreSQL):** **[docs/DATABASE-SETUP.md](docs/DATABASE-SETUP.md)**  
**Deploy on DigitalOcean App Platform (from GitHub):** **[docs/DEPLOY-DIGITALOCEAN-APP.md](docs/DEPLOY-DIGITALOCEAN-APP.md)**  
**Deploy on InterServer VPS:** **[docs/DEPLOY-INTERSERVER-VPS.md](docs/DEPLOY-INTERSERVER-VPS.md)**  
**TestSprite (AI testing in Cursor):** **[docs/TESTSPRITE-SETUP.md](docs/TESTSPRITE-SETUP.md)**

---

## Overview
POL263 is a modern, multi-tenant Policy Management System built with a focus on security, scalability, and clean design. This repository contains the Phase 0-1 foundation, establishing the core architecture, tenant isolation, and RBAC implementation before product features are built.

## Project structure
Run all commands from the **repository root** (this directory). The app is a single codebase:
*   **`client/`** – React (Vite) frontend; entry `client/index.html` and `client/src/main.tsx`
*   **`server/`** – Express API and server entry `server/index.ts`
*   **`shared/`** – Drizzle schema and shared types
*   **`script/`** – Build, DB migrations, seed, lockfile checks
*   **`migrations/`** – SQL migrations
*   **`tests/`** – Unit tests (Vitest)
*   **`android/`**, **`ios/`** – Capacitor native projects (synced via `npm run cap:sync`)

Build output: **`dist/public/`** (client) and **`dist/index.cjs`** (server). The `fxq/` folder is a legacy mirror; use the root `client/`, `server/`, and configs as the single source of truth.

## Architecture & Tech Stack
*   **Frontend**: React (Vite) + Tailwind CSS + shadcn/ui + Wouter + TanStack Query
*   **Backend**: Express (Node.js), modular API routes with Zod validation where applied, shared schema and DTOs
*   **Database**: PostgreSQL + Drizzle ORM; schema and migrations in `shared/schema.ts` and `migrations/`
*   **Styling**: Custom CSS variables (Tailwind) for tenant branding and a modern SaaS look

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

**Toolchain & install**
- **Node.js** 22.x (use [nvm](https://github.com/nvm-sh/nvm) and run `nvm use` or set from `.nvmrc`).
- **npm** 11.x. Use `npm ci` in CI and on first clone; use `npm install` only when adding/updating dependencies, then commit `package-lock.json`.
- After changing `package.json`, run `npm run lint:lock` before pushing to ensure the lockfile is in sync. To regenerate from scratch: `npm run relock`.

**Lockfile & deploy flow** — `package-lock.json` is **regenerated on Linux by CI** (`.github/workflows/lockfile-linux.yml`). This ensures platform-specific optional dependencies (esbuild, rollup, tailwindcss-oxide, lightningcss — all have linux-x64 variants) are present so `npm ci` succeeds on Ubuntu. The workflow then fast-forwards the **`deploy`** branch to the verified commit. **DigitalOcean tracks `deploy`, not `main`**, so it only builds commits with a Linux-correct lockfile. Do not hand-edit the lockfile or push directly to `deploy`. If CI auto-commits a lockfile update to `main`, run `git pull` before pushing again.

```bash
npm install
npm run dev:client
```