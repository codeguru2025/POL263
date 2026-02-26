# Production setup guide

This guide helps you set **NODE_ENV**, **SESSION_SECRET**, **DATABASE_URL**, **Google OAuth**, and **HTTPS** for production.

---

## 1. NODE_ENV and .env file

On the server, the app must run with **NODE_ENV=production**. The `npm start` script already sets this.

Create a **.env** file on the server (e.g. in `/opt/pol263`) with your production values. Use the template in the repo:

```bash
cp .env.production.example .env
nano .env
```

Fill in every value marked "Required". The app loads `.env` on startup via `dotenv`.

---

## 2. SESSION_SECRET (required in production)

Sessions are encrypted with this secret. If it’s missing in production, the app will not start.

**Generate a secret (on your PC or on the server):**

```bash
npm run generate-secret
```

Copy the long string it prints (e.g. `a1b2c3d4e5...`) and put it in `.env`:

```env
SESSION_SECRET=a1b2c3d4e5f6...paste_the_full_output_here
```

Use a **different** secret for each environment (e.g. production vs staging). Never commit this value to git.

---

## 3. DATABASE_URL (required)

Point this at your **production** PostgreSQL instance.

**If PostgreSQL is on the same VPS:**

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/pol263
```

Replace `YOUR_PASSWORD` with the password you set (e.g. when you ran `script/setup-postgres-vps.sh` with `CHIBIKHULU_DB_PASSWORD`).

**If you use a managed database (Neon, Supabase, etc.):**

Copy the connection string from the provider and set:

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require
```

**Supabase:** Use **Settings → Database** in the Supabase dashboard. Under **Connection string** choose **URI** and **Connection pooling** (port 6543). Copy the URI and replace `[YOUR-PASSWORD]` with your **database password** (the one you set when creating the project, or reset under **Database password** on that page). The **anon key** is not used for `DATABASE_URL` — only for Supabase client APIs from the browser.

Then run **once** on the server (with this `.env` in place):

```bash
npm run db:setup
```

---

## 4. Google OAuth (optional but recommended for staff login)

Without Google OAuth, staff cannot log in with Google. You can enable **demo login** for testing (see below), but for production you should set up Google OAuth.

### Get credentials

1. Go to **[Google Cloud Console](https://console.cloud.google.com/)** and sign in.
2. Create a project or select one (e.g. "POL263").
3. Open **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**.
4. If asked, set the **OAuth consent screen** (User type: External, add your email as test user if in testing).
5. Application type: **Web application**.
6. Name: e.g. "POL263 PMS".
7. Under **Authorized redirect URIs** add:
   - **Production:** `https://yourdomain.com/api/auth/google/callback`
   - Replace `yourdomain.com` with your real domain or VPS IP for testing, e.g. `http://YOUR_VPS_IP:5000/api/auth/google/callback` (Google often requires HTTPS for redirects; use a domain + HTTPS for production.)
8. Create and copy the **Client ID** and **Client secret**.

### Set in .env

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_CALLBACK_URL=https://yourdomain.com/api/auth/google/callback
```

Use the **exact** callback URL you added in the Google console. Restart the app after changing `.env`.

### Demo login (testing only)

For quick testing without Google OAuth:

```env
ENABLE_DEMO_LOGIN=true
```

Only use this in non-production or a locked-down environment. In production, use Google OAuth and leave `ENABLE_DEMO_LOGIN` unset or `false`.

---

## 5. HTTPS (recommended for production)

Running the app over **HTTP** is fine for a quick test, but for production you should put it behind **HTTPS**. Below is one way using **Nginx** and **Let’s Encrypt** on your VPS.

### Prerequisites

- A **domain name** pointing to your VPS IP (e.g. `app.pol263.com` → your VPS IP).
- The app running behind Nginx on port 80 (see [DEPLOY-INTERSERVER-VPS.md](DEPLOY-INTERSERVER-VPS.md) “Optional: Use port 80”).

### Install Certbot and get a certificate

On the VPS (Ubuntu/Debian):

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d yourdomain.com
```

Replace `yourdomain.com` with your domain. Certbot will configure Nginx to use HTTPS and redirect HTTP to HTTPS.

### Update Google OAuth callback

After HTTPS is working, set:

```env
GOOGLE_CALLBACK_URL=https://yourdomain.com/api/auth/google/callback
```

And in Google Cloud Console, set the redirect URI to `https://yourdomain.com/api/auth/google/callback`. Restart the app.

### Renewal

Let’s Encrypt certificates expire after 90 days. Certbot usually adds a renewal cron job. Test renewal with:

```bash
certbot renew --dry-run
```

---

## Quick checklist

| Item | Action |
|------|--------|
| **NODE_ENV** | Set in `.env` to `production` (or rely on `npm start`). |
| **SESSION_SECRET** | Run `npm run generate-secret`, put the output in `.env`. |
| **DATABASE_URL** | Set in `.env` to your production PostgreSQL URL; run `npm run db:setup` once. |
| **Google OAuth** | Create OAuth client in Google Cloud, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` in `.env`. |
| **HTTPS** | Use Nginx + Certbot with your domain; then use `https://yourdomain.com` in callbacks and links. |

---

## Example production .env (minimal)

```env
NODE_ENV=production
PORT=5000
HOST=0.0.0.0
DATABASE_URL=postgresql://postgres:YourDbPassword@localhost:5432/pol263
SESSION_SECRET=your_64_char_hex_from_npm_run_generate_secret
```

After you add Google OAuth and a domain:

```env
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_CALLBACK_URL=https://yourdomain.com/api/auth/google/callback
```

See **.env.production.example** in the repo for a full template.
