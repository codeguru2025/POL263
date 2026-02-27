# POL263 Codebase & Deployment Analysis

**Date:** 2025-02-27  
**Focus:** Why changes work in dev but DigitalOcean builds fail and new changes don’t appear on the live app (including after restart).

---

## 1. TestSprite Codebase Analysis

TestSprite was used to analyze the POL263 repo. Summary of findings:

- **Tech stack:** Node 18+, npm 9+, TypeScript, Vite 7, React 19, Express 5, Drizzle ORM, PostgreSQL, Tailwind 4. Monorepo-style with `client/` (Vite), `server/`, `script/` (build/tooling), `shared/`.
- **Build:** Single `npm run build` runs `npx tsx script/build.ts` → Vite build (client → `dist/public`) and esbuild (server → `dist/index.cjs`). Production runs `node dist/index.cjs` on port 5000.
- **Deploy docs:** `docs/DEPLOY-DIGITALOCEAN-APP.md` and `docs/DEPLOY-CHECKLIST.md` already describe App Platform, build command, env vars, lockfile, and devDependency issues.

TestSprite’s full PRD generation failed because the expected temp dir (`testsprite_tests/tmp/prd_files`) was missing; the codebase itself is consistent with the deploy docs and the issues below.

---

## 2. Why DigitalOcean Builds Fail (And Restart Doesn’t Fix It)

### Root cause 1: Build uses **production install** → no devDependencies

- **What happens:** App Platform often runs `npm ci` with **production** settings (`NODE_ENV=production` or `NPM_CONFIG_PRODUCTION=true`). Then only **dependencies** are installed, not **devDependencies**.
- **Your build needs devDependencies:**  
  `npm run build` → `npx tsx script/build.ts` → needs **tsx**, **vite**, **tailwindcss**, **@tailwindcss/vite**, **esbuild**, etc. All of these are in **devDependencies** in `package.json`.
- **Result:** Build fails with errors like:
  - `tsx: command not found`
  - `vite: command not found`
  - Or script/build.ts failing because Vite/tsx aren’t available.

So in **dev** everything works (you have devDeps). On **DO**, the install step doesn’t install them, so the same build command fails.

### Root cause 2: Lockfile out of sync

- App Platform runs **`npm ci`**, which requires `package-lock.json` to **exactly** match `package.json`.
- If you added or changed dependencies and ran `npm install` but **didn’t commit** the updated `package-lock.json`, the commit that DO builds will fail with:
  - “npm lockfile is not in sync” or “Missing: … from lock file”.

Locally, `npm run lockfile:check` passed at analysis time, but any push that doesn’t include an up-to-date lockfile will break the next DO build.

### Why “Restart” doesn’t show new changes

- **Deploy / Force Rebuild** = full pipeline: clone → install → **run Build Command** → new container image → deploy.
- **Restart** = **no build**. It just restarts the **existing** container image.

So:

1. If the **build** fails, no new image is created.
2. The live app keeps running the **last successfully built** image (often an old commit).
3. **Restart** only restarts that same old image → you never see new code.

So: **builds fail** → **no new image** → **restart still shows old app**. Fixing the build is required for new changes to appear.

---

## 3. What to Do on DigitalOcean

### A. Use the DO-specific build script (recommended)

The repo already has a script that installs **including devDependencies** then builds:

- In DigitalOcean: **Settings** → **Commands** → **Build Command** set to:
  ```bash
  npm run build:do
  ```
- This runs `npm ci --include=dev && npm run build`, so `tsx`, Vite, Tailwind, etc. are available and the build can succeed.

### B. Or keep `npm run build` but install devDependencies

- In **Settings** → **App-Level Environment Variables**, add a **build-time** variable:
  - **Key:** `NPM_CONFIG_PRODUCTION`  
  - **Value:** `false`
- Then the default `npm ci` will install devDependencies and your current Build Command `npm run build` can stay as-is.

### C. Always keep lockfile in sync before pushing

- After any change to `package.json`:
  1. Run `npm install`.
  2. Commit the updated `package-lock.json` in the same (or next) commit.
  3. Before pushing, run:
     ```bash
     npm run lockfile:check
     ```
- If the check fails, run `npm install` again and commit the new lockfile, then push.

### D. Ensure DO builds the commit you just pushed

- In DO: **Settings** → confirm the app is set to deploy from branch **main** (or whichever branch you push to).
- After pushing, trigger **Deploy** (or **Force Rebuild and Deploy**), not only **Restart**.
- In the build log, confirm the commit hash is the one you just pushed. If you see an old hash, the app may be pinned to an old commit or branch.

---

## 4. Worktree / Git Checklist (Your Current Repo)

- You’re in a **Cursor worktree** at `c:\Users\ausiz\.cursor\worktrees\POL263`, on branch **main**, with `origin` → `https://github.com/codeguru2025/POL263.git`.
- At analysis time there were **uncommitted changes** in many files (e.g. `.npmrc`, `README.md`, client components, server routes, deploy docs, `script/lockfile-check.cjs`).

To get changes onto the live app:

1. **Commit** all intended changes (including `package-lock.json` if you changed deps).
2. Run **`npm run lockfile:check`** before committing if you touched `package.json`.
3. **Push** to the branch DO deploys from (e.g. `git push origin main`).
4. In DO, run **Deploy** or **Force Rebuild and Deploy** (not only Restart).
5. Confirm in the build log that the **commit hash** matches your latest commit.

If you only **restart** after a failed build, the running app will not include new changes.

---

## 5. Summary Table

| Issue | Cause | Fix |
|-------|--------|-----|
| Build fails (tsx/vite not found) | devDependencies not installed on DO | Use Build Command `npm run build:do` **or** set build-time `NPM_CONFIG_PRODUCTION=false` |
| Build fails (lockfile) | `package-lock.json` not in sync with `package.json` | Run `npm install`, commit lockfile, `npm run lockfile:check` before push |
| New changes don’t appear after “Restart” | Restart does not rebuild; it reuses the last successful image | Fix the build so a new image is created; use **Deploy** / **Force Rebuild**, not only Restart |
| DO building old code | App or branch set to wrong commit/branch | In DO Settings, set deploy branch to `main` and trigger Deploy; confirm commit hash in build log |

---

## 6. References

- **Deploy (DO):** `docs/DEPLOY-DIGITALOCEAN-APP.md` — build/run commands, env vars, lockfile, devDeps, “Restart vs Deploy”.
- **Checklist:** `docs/DEPLOY-CHECKLIST.md` — pull, build, start, cache.
- **Lockfile check:** `npm run lockfile:check` (uses `script/lockfile-check.cjs`).
- **TestSprite:** `docs/TESTSPRITE-SETUP.md` — MCP setup and usage.
