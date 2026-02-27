# Deployment & Concurrency

## Which DigitalOcean option to choose

- **Application (Node + Vite):** Use **App Platform**. It deploys from your repo, handles scaling and load balancing, and you don’t manage servers. Set build command, run command, and env (e.g. `DATABASE_URL`, `SESSION_SECRET`). The app’s public URL (e.g. `https://your-app.ondigitalocean.app`) is where agent links will point if you use `VITE_APP_PUBLIC_URL` or the same origin.
- **Database:** Use **Managed Database** (PostgreSQL) for production, or keep your current Supabase/Neon Postgres. Managed DB gives backups, replication, and avoids running Postgres on a Droplet yourself.
- **Droplet:** Use only if you want full control over the OS and prefer to manage Node, PM2, nginx, and DB yourself.
- **Gradient AI:** Not needed for POL263 unless you add AI features later.

**Recommendation:** **App Platform** (app) + **App Platform inbuilt PostgreSQL** (add Database component and bind `DATABASE_URL`). Alternatively use **Managed Database** or **Supabase** and set `DATABASE_URL` manually. See [DEPLOY-DIGITALOCEAN-APP.md](DEPLOY-DIGITALOCEAN-APP.md).

---

## Agent link persistence

- The agent link is **persistent**. It is of the form `https://<your-domain>/join?ref=<referralCode>`.
- `referralCode` is stored in the **users** table (unique per agent). It does not change when many people use the link.
- Many people can use the **same** link; each registration is attributed to that agent. The link does not “run out” or expire from sharing.
- To keep the link stable across environments (e.g. always point to production), set **`VITE_APP_PUBLIC_URL`** (or similar) at build time and use it when building the referral URL instead of `window.location.origin`.

---

## Concurrent policy creation (same policy number)

- **Risk:** Policy numbers were generated with `COUNT(*) + 1`. Under concurrent signups, two requests can get the same count and thus the same number.
- **Safeguard:** The schema has a **unique index** on `(policy_number, organization_id)`, so a second insert with the same number would fail (client would see an error; no duplicate policy number in the DB).
- **Improvement:** Policy number generation is being changed to use an **atomic sequence** (e.g. `org_policy_sequences` table with `UPDATE ... RETURNING` or `SELECT FOR UPDATE` + increment in a transaction), so only one process gets each next number and duplicates are avoided at generation time.

---

## Concurrent payments

- **Payment intents (Paynow):** Each create uses an **idempotency key** (e.g. `client-<clientId>-<policyId>-<timestamp>`). If the same key is sent again (e.g. double-click or retry), the **existing** intent is returned; no second charge or duplicate intent.
- **Paynow result webhook:** The gateway sends one result per transaction; the handler is idempotent (same poll/result does not double-apply). Applying payment to policy and creating receipt run in the same flow; the DB unique constraint on receipt number and transaction idempotency prevent duplicate receipts for the same payment.
- **Receipt numbers:** Generated from a count today; like policy numbers, a **sequence table** is recommended so concurrent receipts never get the same number. The unique index on `(receipt_number, organization_id)` prevents duplicates in the DB but can cause one of two concurrent requests to fail.
- **Cash receipts (staff):** One receipt per request; for very high concurrency, receipt number generation should also use an atomic sequence.

---

## Summary

| Topic | Current behavior | Recommendation |
|-------|-------------------|----------------|
| Hosting | — | App Platform (app) + inbuilt Database component or Managed DB or Supabase |
| Agent link | Persistent (same link for all); domain = current origin | Set `VITE_APP_PUBLIC_URL` for a fixed production domain |
| Policy number | COUNT+1 (race possible; unique index prevents duplicate) | Use atomic sequence table (implemented) |
| Payments | Idempotency keys; unique constraints | Keep; optionally make receipt number atomic like policy number |
