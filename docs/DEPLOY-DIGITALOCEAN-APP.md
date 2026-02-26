# Deploy POL263 on DigitalOcean App Platform (from GitHub)

This guide deploys **POL263** using DigitalOcean App Platform, with the app and (optionally) a Managed Database. The app is deployed from your **GitHub** repository.

---

## Prerequisites

- A **GitHub** account and the POL263 repo pushed to GitHub (see [Put POL263 on GitHub](#put-pol263-on-github) below).
- A **DigitalOcean** account.

---

## 1. Put POL263 on GitHub

If the repo is not on GitHub yet:

1. **Create a new repository** on GitHub:
   - Go to [github.com/new](https://github.com/new).
   - Name it e.g. `POL263` or `pol263-app`.
   - Choose **Private** or **Public**. Do **not** initialize with a README if you already have local code.

2. **Add the GitHub remote and push** (from your project folder):

   ```powershell
   cd "C:\Users\ausiz\.cursor\worktrees\Falakhe-PMS"

   git add -A
   git status
   git commit -m "POL263: app rename, client portal, agent registration, DigitalOcean-ready"

   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   git branch -M main
   git push -u origin main
   ```

   Replace `YOUR_USERNAME` and `YOUR_REPO_NAME` with your GitHub username and repo name. Use a **Personal Access Token** as password if you have 2FA enabled.

3. **Ensure secrets are not committed:**  
   `.env` is in `.gitignore`; never commit it. App Platform will get env vars from the DO dashboard.

---

## 2. Create a DigitalOcean Managed Database (optional but recommended)

1. In DigitalOcean: **Databases** → **Create Database Cluster**.
2. Choose **PostgreSQL**, region, and plan.
3. Create the cluster. When it’s ready, open it and copy the **Connection string** (URI).  
   It looks like:  
   `postgresql://doadmin:PASSWORD@HOST:25060/defaultdb?sslmode=require`
4. (Optional) Create a database named `pol263` via the DO console or by connecting with `psql` and running `CREATE DATABASE pol263;`. If you use the default DB, use `defaultdb` in the path.

You will use this URI as `DATABASE_URL` in the app’s environment.

---

## 3. Create the App on App Platform

1. In DigitalOcean: **Apps** → **Create App**.
2. **Choose source:** GitHub. Authorize DigitalOcean to access GitHub if needed.
3. Select your **POL263** repository and the **main** branch (or your default branch).
4. **Resource type:** Choose **Web Service** (not static site).

---

## 4. Configure the App (POL263)

### Build settings

- **Build Command:**  
  `npm run build`  
  (This runs the repo’s build script: client Vite build + server bundle.)
- **Output Directory:**  
  Leave default or leave empty; the run command uses `dist/` and the built client is served from the server.
- **Dockerfile:**  
  Leave empty (use Nixpacks / default buildpack).

### Run settings

- **Run Command:**  
  `npm start`  
  (Runs `node dist/index.cjs` in production.)
- **HTTP Port:**  
  `5000`  
  (The server listens on `process.env.PORT` or 5000.)

### Environment variables (App-level)

Add these in the App’s **Settings** → **App-Level Environment Variables**:

| Variable            | Value / notes |
|---------------------|----------------|
| `NODE_ENV`          | `production` |
| `DATABASE_URL`      | Your Postgres URI (from Managed Database or Supabase). |
| `SESSION_SECRET`   | Long random string (e.g. from `npm run generate-secret`). |
| `HOST`              | `0.0.0.0` (so the server listens on all interfaces). |

Optional (for production):

- `APP_BASE_URL` – e.g. `https://your-app.ondigitalocean.app`
- `API_BASE_URL` – same as `APP_BASE_URL` if API and app are same origin
- `VITE_APP_PUBLIC_URL` – set to your app URL so client-side links (e.g. agent referral) use the correct domain (must be set at **build** time if the client uses it)
- Paynow, Google OAuth, receipt branding, etc. – add as needed.

**Important:** Do **not** commit `.env` or paste secrets into the repo. Set everything in the App Platform UI.

**If you see `getaddrinfo ENOTFOUND base` in logs:** The app is trying to connect to a host named `"base"`. That means `DATABASE_URL` is wrong or unresolved. Fix it by either: (1) Using an **external** database (e.g. Supabase): set `DATABASE_URL` to the **full** connection string (e.g. `postgresql://postgres.xxx:PASSWORD@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require`) — paste the real URI, no `${...}` placeholders. (2) Using a **DO Managed Database** attached to the app: use the exact bind variable name App Platform shows for the database (e.g. `DATABASE_URL` = value from the database component’s “Connection string” or the variable they provide), and ensure the database component is linked to the app so the variable resolves at runtime.

---

## 5. Deploy

1. Click **Next** through any resource sizing (e.g. Basic plan).
2. Name the app e.g. **POL263**.
3. Click **Create Resources**. DigitalOcean will build from GitHub and deploy.

After the first deploy, your app will be at a URL like:

`https://your-app-name-xxxxx.ondigitalocean.app`

Use this URL for staff login, client portal, and agent links. If you set `VITE_APP_PUBLIC_URL` (at build time), use this URL there so referral links point to production.

---

## 6. Custom domain (optional)

In the app’s **Settings** → **Domains**, add your domain (e.g. `app.pol263.com`) and follow DO’s instructions to add the required CNAME. Then set `APP_BASE_URL` and `API_BASE_URL` (and `VITE_APP_PUBLIC_URL` at build) to that domain.

---

## 7. Updates (push to GitHub)

Whenever you push to the connected branch (e.g. `main`), App Platform will rebuild and redeploy automatically (if auto-deploy is on). To deploy manually, use **Deploy** in the DO dashboard.

---

## Summary

| Item        | Value |
|------------|--------|
| App name   | POL263 |
| Source     | GitHub (your POL263 repo) |
| Build      | `npm run build` |
| Run        | `npm start` |
| Port       | 5000 |
| Database   | DigitalOcean Managed PostgreSQL or existing Supabase/Neon |

Keeping everything under the name **POL263** and in one GitHub repo keeps App Platform and future deploys consistent.
