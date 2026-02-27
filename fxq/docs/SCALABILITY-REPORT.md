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

- **Default pool:** `DB_POOL_MAX=25` (configurable via env).
- **Impact:** Each in-flight request that hits the DB can hold a connection. With 25 connections and ~100–200 ms average query time, the process can serve on the order of **~120–250 concurrent DB-bound requests** before connection starvation.
- **Mitigation:** Increase `DB_POOL_MAX` (e.g. 40–80) for higher concurrency. Ensure PostgreSQL `max_connections` is higher than the sum of all pools across instances.

### 2.2 In-Memory Data Loads

- **Dashboard & reports:** Bounded by `DASHBOARD_MAX_ROWS` (default 50,000) and `REPORT_EXPORT_MAX_ROWS` (default 15,000). Heavy dashboard endpoints and CSV exports use these caps.
- **User list:** `GET /api/users` is paginated (max 500 per page; default 100).
- **Other lists (policies, clients, payments, claims, etc.):** Paginated with default 100 per page, max 500 per request.
- **Risk:** If a tenant has more than 50k policies, dashboard aggregates reflect only the first 50k. For very large tenants, increase env or move aggregations into the DB.

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

Assumptions: one Node process, default env (pool size 25, dashboard 50k, export 15k, list max 500), typical mix of list/detail/dashboard and a few heavy report requests.

| Metric | Conservative | Moderate | Notes |
|--------|--------------|----------|--------|
| **Concurrent authenticated users (staff)** | 100–150 | 200–250 | Pool of 25 is the main constraint. |
| **Concurrent client-portal users** | 100–150 | 200–250 | Same process and pool; session in DB. |
| **Requests per second (mixed API)** | ~60–120 | ~120–180 | DB-bound; 25 conns × ~2–5 req/s per conn. |
| **Peak requests per second (light endpoints)** | ~200–400 | ~400–600 | Health, static, simple JSON; less DB. |
| **Total staff users (per tenant)** | 500 (paginated) | 500 per page | List capped at 500 per request. |
| **Total clients (per tenant)** | Large | Large | List paginated (500 max per page). |
| **Policies (per tenant)** | 50k in dashboard | 50k in dashboard | Dashboard uses `DASHBOARD_MAX_ROWS`; list API 500/page. |
| **Report export rows** | 15k per report type | 15k | `REPORT_EXPORT_MAX_ROWS`; increase env if needed. |

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
| **Policies per org** | 50k in dashboard/analytics | DB; list 500/page. |
| **Payments / leads / etc.** | 50k in dashboard, 15k in export | DB; list/export paginated. |
| **Clients** | 500 per list page | DB. |

These are not hard product limits; they are where default env caps apply. For larger tenants, increase `DASHBOARD_MAX_ROWS` and `REPORT_EXPORT_MAX_ROWS` and/or move heavy aggregations to the database.

---

## 6. Environment Variables That Affect Scale

| Variable | Default | Effect |
|----------|---------|--------|
| `DB_POOL_MAX` | 25 | Max DB connections per process. Increase for more concurrency. |
| `DB_IDLE_TIMEOUT_MS` | 30000 | Idle connection timeout. |
| `DB_CONNECTION_TIMEOUT_MS` | 5000 | Connect timeout. |
| `DASHBOARD_MAX_ROWS` | 50000 | Cap for dashboard analytics queries. |
| `REPORT_EXPORT_MAX_ROWS` | 15000 | Cap for CSV export row count per report type. |
| `JSON_BODY_LIMIT` | 1mb | Max JSON request body size. |

---

## 7. Recommendations to Avoid Crashes at Scale

1. **Set `DB_POOL_MAX`** to match expected concurrency (e.g. 40–80 for a single instance) and keep total connections across instances below PostgreSQL `max_connections`.
2. **Run DB migrations** separately from app startup (`RUN_DB_BOOTSTRAP` only where intended) so that multiple instances and restarts do not contend on schema push/seed.
3. **Monitor** DB connection usage, slow queries, and memory. Add alerting on pool exhaustion and high response times.
4. **Load test** with a representative mix (list, detail, dashboard, report export, auth) to validate throughput and concurrency before going live.
5. **Use shared or external storage** for uploads when running more than one instance.
6. **Consider** moving the heaviest dashboard aggregations (e.g. product performance, lapse/retention) into SQL (GROUP BY, window functions) or a separate analytics store if a single tenant grows beyond tens of thousands of policies.

---

## 8. Summary Table: “How many X can it handle?”

| Question | Short answer |
|----------|--------------|
| **Concurrent users (staff + client) without issues?** | **~100–250** per Node instance with default pool (25); increase pool and DB for more. |
| **Total staff users per org?** | **Unbounded** in DB; list returns up to **500 per page** (paginated). |
| **Total clients / policies per org?** | **Unbounded** in DB; dashboard cap **50k**, export **15k**, list **500/page**. |
| **Requests per second?** | **~60–180** mixed API per instance (DB-bound); **~200–600** for light endpoints. |
| **Traffic (monthly active users)?** | Order of **tens of thousands** of MAU per instance if usage is spread out; concurrency is the binding constraint. |

*These figures are estimates. Run load tests with your workload and environment to confirm.*
