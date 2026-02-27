# Deploy POL263 on DigitalOcean App Platform (from scratch)

This guide sets up **POL263** on DigitalOcean App Platform using **DigitalOcean’s inbuilt PostgreSQL database** (no Supabase or external DB required). The app and database run in the same App Platform app.

---

## Setup from scratch (checklist)

Do these in order:

1. **GitHub** – Push the POL263 repo to GitHub (Section 1).
2. **Create App** – In DigitalOcean: **Apps** → **Create App** → connect **GitHub** → select repo and **main** branch.
3. **Add inbuilt database** – In the same app, add a **Database** component (PostgreSQL). Name it e.g. `pol263-db`.
4. **Configure app component** – Set **Build Command** to `npm run build:do`, **Run Command** to `npm start`, **HTTP Port** to `5000`. Leave **Output Directory** empty.
5. **Link database to app** – In the app (web service) component, add env var **`DATABASE_URL`** and set it to the **bindable variable** from the database (e.g. `${pol263-db.DATABASE_URL}`). Add other required env vars (Section 4).
6. **Deploy** – Create Resources. After first successful deploy, set `RUN_DB_BOOTSTRAP=false`.

---

## Prerequisites

- **GitHub** account and the POL263 repo pushed to GitHub (see Section 1).
- **DigitalOcean** account.

---

## 1. Put POL263 on GitHub

If the repo is not on GitHub yet:

1. Create a new repository at [github.com/new](https://github.com/new) (e.g. name `POL263`). Do **not** initialize with a README if you already have code.
2. From your project folder:

   ```powershell
   cd "C:\Users\ausiz\.cursor\worktrees\POL263\fxq"
   git add -A
   git status
   git commit -m "POL263: DigitalOcean App Platform deploy"
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   git branch -M main
   git push -u origin main
   ```

   Replace `YOUR_USERNAME` and `YOUR_REPO_NAME`. Use a **Personal Access Token** as password if you use 2FA.

3. Never commit `.env`. App Platform will get configuration from the DO dashboard.

---

## 2. Create the App and add the inbuilt database

1. In DigitalOcean: **Apps** → **Create App**.
2. **Source:** GitHub. Authorize DigitalOcean if needed, then select your **POL263** repo and branch **main**.
3. **Resource type:** Choose **Web Service** (not static site).
4. **Add the database in the same app:**
   - On the same “Create App” flow, click **Add Resource** → **Database**.
   - Choose **PostgreSQL**.
   - Name it e.g. `pol263-db`. Pick region and plan (Dev Database is fine for starting).
   - Create the database component.
5. Ensure both components (your **App** and **pol263-db**) are in the same app. Click **Next** to go to the app’s configuration.

---

## 3. Configure the App (Build & Run)

In the **App** (web service) component settings:

| Setting | Value |
|--------|--------|
| **Build Command** | `npm run build:do` |
| **Output Directory** | Leave default or empty |
| **Run Command** | `npm start` |
| **HTTP Port** | `5000` |

Do **not** use a custom Dockerfile; use the default Nixpacks/buildpack.

---

## 4. Environment variables and linking the database

In the **App** component: **Settings** → **App-Level Environment Variables** (or the component’s env vars).

### Required

| Variable | Value / notes |
|----------|----------------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | **Bind to the inbuilt database:** Choose “Edit” for the variable, then select the **database component** (e.g. `pol263-db`) and the **DATABASE_URL** bindable variable. Do **not** type a placeholder; the app will fail if the host is unresolved (e.g. `base`). |
| `SESSION_SECRET` | Long random string. Generate with `npm run generate-secret` locally and paste the output. |
| `HOST` | `0.0.0.0` |
| `RUN_DB_BOOTSTRAP` | Set to `true` for the **first deploy only**. After a successful deploy, set to `false` or remove so the server does not re-run schema push and seed on every start. |
| `SUPERUSER_EMAIL` | Your email (e.g. Google account). Used by the seed to create the initial superuser for staff login. |

### Optional (production)

- **`APP_BASE_URL`** – e.g. `https://your-app-xxxxx.ondigitalocean.app`
- **`API_BASE_URL`** – Same as `APP_BASE_URL` if app and API are same origin
- **`VITE_APP_PUBLIC_URL`** – Your app URL (for client-side links; set at **build** time if used)
- **Google OAuth (staff login):** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` = `https://YOUR-APP-URL.ondigitalocean.app/api/auth/google/callback`. Create the OAuth client in [Google Cloud Console](https://console.cloud.google.com/apis/credentials) and add that callback URL.
- Paynow, receipt branding, etc. – add as needed.

**Important:** Do not commit `.env` or paste secrets into the repo. Set everything in the App Platform UI.

---

## 5. Deploy

1. Click **Next** through resource sizing (e.g. Basic).
2. Name the app (e.g. **POL263**).
3. Click **Create Resources**. DigitalOcean will build from GitHub and deploy; the database will be created and linked.

After the first deploy, the app will be at a URL like:

`https://your-app-name-xxxxx.ondigitalocean.app`

Use this URL for staff login, client portal, and agent links. If you use Google OAuth, set `GOOGLE_CALLBACK_URL` to this URL and add it in Google Cloud Console.

**After first successful run:** In **Settings** → **Environment Variables**, set **`RUN_DB_BOOTSTRAP`** to `false` (or remove it) and save. Redeploy or restart so the app does not run schema push and seed on every startup.

---

## 6. Custom domain (optional)

In the app **Settings** → **Domains**, add your domain and follow DO’s CNAME instructions. Then set `APP_BASE_URL`, `API_BASE_URL`, and (if used at build time) `VITE_APP_PUBLIC_URL` to that domain.

---

## 7. Updates (push to GitHub)

Pushing to the connected branch (e.g. `main`) triggers a new build and deploy if auto-deploy is on. You can also use **Deploy** in the DO dashboard.

---

## 8. If the build fails: "npm lockfile is not in sync"

- Ensure you deploy from the **latest** commit on `main` that includes an up-to-date `package-lock.json`.
- After changing `package.json`, run `npm install` and commit the updated `package-lock.json`. Run `npm run lockfile:check` before pushing.

---

## 9. If Deploy / Force Rebuild fails but Restart works

**Symptom:** Build fails with "tsx: command not found" or "vite: command not found"; **Restart** works.

**Cause:** The platform installed dependencies without devDependencies, so the build command cannot run.

**Fix:** Ensure **Build Command** is exactly `npm run build:do` (it runs `npm ci --include=dev` then `npm run build`). No need to set `NPM_CONFIG_PRODUCTION` if you use `build:do`.

---

## 10. If you see `getaddrinfo ENOTFOUND base`

**Cause:** `DATABASE_URL` is not set correctly (e.g. placeholder or wrong binding).

**Fix:** In the **App** component’s environment variables, set **`DATABASE_URL`** to the **bindable variable** from your **database** component (e.g. select the database component and choose `DATABASE_URL`). Do not type a literal value like `postgresql://base/...`. Save and redeploy.

---

## Summary

| Item | Value |
|------|--------|
| App name | POL263 |
| Source | GitHub (your POL263 repo) |
| Build | `npm run build:do` |
| Run | `npm start` |
| Port | 5000 |
| Database | DigitalOcean inbuilt PostgreSQL (add Database component, bind `DATABASE_URL`) |

For an architecture review of the app, see **[docs/ARCHITECTURE-REVIEW.md](ARCHITECTURE-REVIEW.md)**.
