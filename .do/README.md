# DigitalOcean App Spec

`app.yaml` is a **template** for the POL263 app on DigitalOcean App Platform.

- **Build:** Uses `npm run build:do` (no `NPM_CONFIG_PRODUCTION` needed).
- **Single DATABASE_URL:** Defined once in app-level `envs`.
- **Secrets:** Values marked `SET_IN_DASHBOARD` must be set in the DO dashboard (Settings → App-Level Environment Variables). Do not commit real secrets here.

After importing or editing this spec, set these in the dashboard:

- `DATABASE_URL` – full Postgres connection string (e.g. Supabase)
- `SESSION_SECRET` – long random string (e.g. `npm run generate-secret`)
- `PAYNOW_INTEGRATION_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

See [../docs/DEPLOY-DIGITALOCEAN-APP.md](../docs/DEPLOY-DIGITALOCEAN-APP.md) for full deploy steps.
