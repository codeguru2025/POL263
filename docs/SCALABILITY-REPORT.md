# POL263 — Scalability & Capacity Report

This document summarizes how the application scales, where limits come from, and estimated capacities for users, traffic, clients, policies, and concurrent usage under default and tuned configurations.

---

## 1. Architecture Summary

| Layer | Technology | Notes |
|-------|------------|--------|
| **Runtime** | Node.js (single process) | Event-driven; one process per instance. |
| **Web** | Express 5 | No built-in clustering; scale out by adding instances. |
| **Database** | PostgreSQL + Drizzle ORM | Central shared store; connection pool per process. |
| **Sessions** | connect-pg-simple (PostgreSQL) | Sessions in DB; safe for multiple app instances. |
| **Static / Uploads** | Local filesystem (`uploads/`) | Not shared across instances without a shared volume or object store. |

---

## 2. Bottlenecks & Mitigations

### 2.1 Database Connections

- **Default pool:** `DB_POOL_MAX=10` (configurable via env).
- **Impact:** Each in-flight request that hits the DB can hold a connection. With 10 connections and ~100–200 ms average query time, the process can serve on the order of **50–100 concurrent DB-bound requests** before connection starvation.
- **Mitigation:** Increase `DB_POOL_MAX` (e.g. 20–50) based on DB server capacity and number of app instances. Ensure PostgreSQL `max_connections` is higher than the sum of all pools across instances.

### 2.2 In-Memory Data Loads

- **Dashboard & reports:** Bounded by `DASHBOARD_MAX_ROWS` (default 20,000) and `REPORT_EXPORT_MAX_ROWS` (default 5,000). Heavy dashboard endpoints (policy breakdown, product performance, lapse/retention, etc.) and CSV exports use these caps so that a single request does not load unbounded rows.
- **User list:** `GET /api/users` is paginated (max 500 per page; default 100). `getUsersByOrg` is limited to 500 rows per call.
- **Agent by referral:** Resolved with a single lookup by referral code instead of loading all org users.
- **Risk:** If a tenant has more than 20k policies, dashboard aggregates reflect only the first 20k (by creation order). For very large tenants, consider moving aggregations into the DB (e.g. SQL GROUP BY) or dedicated analytics.

### 2.3 Request Body Size

- **JSON body limit:** `express.json({ limit: "1mb" })` (override via `JSON_BODY_LIMIT`). Prevents huge payloads from exhausting memory or causing slow parsing.

### 2.4 File Uploads

- **Storage:** Local disk under `uploads/`. With multiple app instances, uploads are not shared unless you use a shared filesystem or object store (e.g. S3).
- **Limit:** 5 MB per file (multer). Extension and MIME checks restrict to images.

### 2.5 Rate Limits

- **Auth-related:** `/api/auth`, `/api/client-auth`, `/api/security-questions`, `/api/agents/by-referral` are limited to 20 requests per 15 minutes per client (by IP). Reduces brute-force and enumeration; does not limit general API traffic.

### 2.6 Session Store

- Sessions are stored in PostgreSQL. No in-process memory ceiling for sessions; growth is bounded by DB size and session TTL (e.g. 24 h). Suitable for multi-instance deployment.

---

## 3. Estimated Capacity (Single Instance, Default Config)

Assumptions: one Node process, default env (pool size 10, dashboard/export caps as above), typical mix of list/detail/dashboard and a few heavy report/dashboard requests.

| Metric | Conservative | Moderate | Notes |
|--------|--------------|----------|--------|
| **Concurrent authenticated users (staff)** | 50–80 | 100–150 | Depends on how many hit DB at once; pool of 10 is the main constraint. |
| **Concurrent client-portal users** | 50–80 | 100–150 | Same process and pool; session in DB. |
| **Requests per second (mixed API)** | ~30–60 | ~60–100 | DB-bound; 10 conns × ~2–5 req/s per conn. |
| **Peak requests per second (light endpoints)** | ~100–200 | ~200–400 | Health, static, simple JSON; less DB. |
| **Total staff users (per tenant)** | 500 (paginated) | 500 per page | List capped at 500 per request; more users supported with pagination. |
| **Total clients (per tenant)** | Large | Large | List paginated (200 max per page); total limited by DB. |
| **Policies (per tenant)** | 20k in dashboard | 20k in dashboard | Dashboard/analytics use `DASHBOARD_MAX_ROWS`; list API is paginated (200/page). |
| **Report export rows** | 5k per report type | 5k | `REPORT_EXPORT_MAX_ROWS`; increase env if needed. |

- **“Conservative”:** Leaves headroom for spikes and heavy dashboard/report requests.
- **“Moderate”:** Assumes some tuning (e.g. higher pool, strong DB) and not all users hitting the heaviest endpoints at once.

---

## 4. Multi-Instance Scaling

- **Horizontal scaling:** Run multiple Node processes (e.g. behind a load balancer). Sessions and auth are DB-backed, so no sticky sessions required.
- **Uploads:** Use a shared storage (NFS, S3, etc.) or route upload/download through a single instance or object store so all instances see the same files.
- **Database:** Ensure PostgreSQL can handle `(number of instances) × DB_POOL_MAX` connections and has enough CPU/RAM and connection capacity.

---

## 5. Per-Tenant Data Volume (Guidance)

| Data | Soft limit (default caps) | Hard limit |
|------|---------------------------|------------|
| **Users (staff) per org** | 500 per list request | DB / pagination. |
| **Policies per org** | 20k in dashboard/analytics | DB; list paginated. |
| **Payments / leads / etc.** | 20k in dashboard, 5k in export | DB; list/export paginated. |
| **Clients** | 200 per list page | DB. |

These are not hard product limits; they are where default env caps apply. For larger tenants, increase `DASHBOARD_MAX_ROWS` and `REPORT_EXPORT_MAX_ROWS` and/or move heavy aggregations to the database.

---

## 6. Environment Variables That Affect Scale

| Variable | Default | Effect |
|----------|---------|--------|
| `DB_POOL_MAX` | 10 | Max DB connections per process. Increase for more concurrency. |
| `DB_IDLE_TIMEOUT_MS` | 30000 | Idle connection timeout. |
| `DB_CONNECTION_TIMEOUT_MS` | 5000 | Connect timeout. |
| `DASHBOARD_MAX_ROWS` | 20000 | Cap for dashboard analytics queries. |
| `REPORT_EXPORT_MAX_ROWS` | 5000 | Cap for CSV export row count per report type. |
| `JSON_BODY_LIMIT` | 1mb | Max JSON request body size. |

---

## 7. Recommendations to Avoid Crashes at Scale

1. **Set `DB_POOL_MAX`** to match expected concurrency (e.g. 20–50 for a single instance) and keep total connections across instances below PostgreSQL `max_connections`.
2. **Run DB migrations** separately from app startup (`RUN_DB_BOOTSTRAP` only where intended) so that multiple instances and restarts do not contend on schema push/seed.
3. **Monitor** DB connection usage, slow queries, and memory. Add alerting on pool exhaustion and high response times.
4. **Load test** with a representative mix (list, detail, dashboard, report export, auth) to validate throughput and concurrency before going live.
5. **Use shared or external storage** for uploads when running more than one instance.
6. **Consider** moving the heaviest dashboard aggregations (e.g. product performance, lapse/retention) into SQL (GROUP BY, window functions) or a separate analytics store if a single tenant grows beyond tens of thousands of policies.

---

## 8. Summary Table: “How many X can it handle?”

| Question | Short answer |
|----------|--------------|
| **Concurrent users (staff + client) without issues?** | **~50–150** per Node instance with default pool; increase pool and DB for more. |
| **Total staff users per org?** | **Unbounded** in DB; list returns up to **500 per page** (paginated). |
| **Total clients / policies per org?** | **Unbounded** in DB; list/dashboard caps (e.g. **20k** in dashboard, **5k** in export) apply per request. |
| **Requests per second?** | **~30–100** mixed API per instance (DB-bound); **~100–400** for light endpoints. |
| **Traffic (monthly active users)?** | Order of **thousands** of MAU per instance if usage is spread out; concurrency (same-second users) is the binding constraint. |

*These figures are estimates. Run load tests with your workload and environment to confirm.*
