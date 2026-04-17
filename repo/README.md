# TrailForge Fullstack

TrailForge is an offline-ready fullstack application: Vue 3 frontend, Koa backend, MySQL storage, background worker processing, feed ingestion, review governance workflows, and analytics/reporting.

## Services

- `frontend` — Vue 3 + Vite role-aware application
- `backend` — Koa API with auth/RBAC, schema validation, auditing, domain services, analytics, and ingestion APIs
- `worker` — queue worker for payment/order sweeps and ingestion jobs
- `mysql` — MySQL 8.4 data store

## Ports

- Frontend: `5173`
- Backend API: `3000`
- MySQL: `3306`

## Primary Startup Path

Docker is the only prerequisite. The single command below builds images, starts MySQL, applies migrations + seeds, and brings up backend + worker + frontend:

```bash
docker-compose up --build
```

Equivalent modern CLI form:

```bash
docker compose up --build
```

No host-level dependencies (Node, npm, MySQL client, etc.) are required.

When started from root compose, backend automatically applies migrations and seeds before serving traffic. No hidden manual initialization steps are required for a clean local boot.

## Access

Once the stack is up:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3000`

## Quick Demo Credentials (Seeded)

From `backend/seeds/002_roles_users_seed.js`:

| Role | Username | Password | Email |
|---|---|---|---|
| Admin | `admin` | `admin12345` | `admin@trailforge.local` |
| Coach | `coach1` | `coach12345` | `coach1@trailforge.local` |
| Support Agent | `support1` | `support12345` | `support1@trailforge.local` |
| Regular User | `athlete1` | `athlete12345` | `athlete1@trailforge.local` |

Seeded local credentials only. Rotate before any non-local use.

## Verification

1. Start the stack:

   ```bash
   docker-compose up --build
   ```

2. Backend health:

   ```bash
   curl http://localhost:3000/health
   ```

   Expected: `{"success":true,"data":{"status":"ok",...}}`

3. Auth round-trip:

   ```bash
   curl -c /tmp/session.cookies -H "Content-Type: application/json" \
        -d '{"username":"admin","password":"admin12345"}' \
        http://localhost:3000/api/v1/auth/login
   curl -b /tmp/session.cookies http://localhost:3000/api/v1/auth/me
   curl -b /tmp/session.cookies http://localhost:3000/api/v1/admin/test
   ```

4. Frontend app shell: open `http://localhost:5173` and verify the TrailForge login screen renders.

5. Database connectivity: `docker logs trailforge-backend` should include `MySQL check passed`.

## One-Click Test Runner (Docker-only)

The project ships a zero-install one-click test runner. Docker is the only tool you need on the host — all builds, dependencies, and tests run inside containers defined in the single `docker-compose.yml` (under the `test` profile, opt-in and separate from the default `docker-compose up` runtime stack). No Node, npm, or host MySQL required.

```bash
./run_tests.sh
```

This runs:

- Backend unit tests (middleware, validators, parsers, logic, encryption, state machines)
- Backend DB-backed integration tests for every API endpoint (no mocking, real MySQL)
- Frontend unit tests (Vitest)

Final output is a strict summary block:

```text
TOTAL=<number>
PASSED=<number>
FAILED=<number>
```

Exit codes:

- `0` — all suites passed
- `1` — one or more tests failed

### Coverage

- **No mocking**: every backend API test exercises the real Koa app, real middleware, and real MySQL state. No `vi.mock`, no module-cache stubs, no HTTP interceptors.
- **Every endpoint tested across every facet**: `401` unauthenticated, `400` validation (schema/enum/missing field/limits), `403` role-based and object-level IDOR, `404` not found and cross-user ownership, `409` conflicts (duplicate review/appeal/username), `429` rate limiting and daily review quota, `200`/`201` happy paths with DB side-effect assertions.
- **Covered endpoint groups (16 integration files)**: auth register/login/logout/me (+rate limit); users/me; catalog; feed (+ preferences + actions); follows; activities (CRUD + GPX + coordinates); places (CRUD); orders (create/list/detail/payment-status/complete); reviews (create, detail, mine, images, follow-up, appeal, arbitration masking, daily quota); staff reviews (appeals list/reply/status); admin review governance (dimensions/sensitive-words/denylist-hashes/blacklist CRUD); admin ingestion (sources/scan/logs + sensitive-word quarantine + moderation_flag enum); admin analytics (dashboard/report × 7 types/export/export-logs); admin jobs (test/process-once); payments (imports/refunds/signature verification/idempotency/ledger); health + queue processor lifecycle.
- **Pure unit tests** cover middleware (auth, validate, error-handler, rate-limit, request-id, not-found), logic modules (analytics, feed, review rules, money, reconciliation parser, order state machine, GPX parser, activity validation), and security/encryption.

### E2E

Real browser-to-backend Playwright specs live in `frontend/e2e/`. They assume the full Docker stack is running (`docker-compose up --build`) and hit the live backend without request mocking.

```bash
docker-compose up --build -d
# then from the frontend dev container or a local runner:
docker compose --profile test run --rm -e E2E_BASE_URL=http://host.docker.internal:5173 frontend-tests npx playwright test
```

## Seeded Roles and Accounts

`backend/seeds/002_roles_users_seed.js` creates these default roles:

- `admin`
- `coach`
- `support`
- `user`

It also seeds one default account per role for local development (credentials shown in the table above).

## Project Layout

- `frontend/` Vue app + Dockerfile
- `backend/` Koa API + Dockerfile + migrations + seeds + worker entrypoint
- `docker-compose.yml` single compose file — default services for runtime (`docker-compose up`), plus `test-mysql`, `backend-tests`, `frontend-tests` gated by the `test` profile
- `run_tests.sh` one-click Dockerized acceptance runner (`docker compose --profile test`)

## Backend API Surface

Auth: `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`
Users: `GET /api/v1/users/me`
Orders: `POST /api/v1/orders`, `GET /api/v1/orders`, `GET /api/v1/orders/:id`, `GET /api/v1/orders/:id/payment-status`, `POST /api/v1/orders/:id/complete` (coach/support/admin)
Payments: `POST /api/v1/payments/imports` (admin/support), `GET /api/v1/payments/imports/:importId` (admin/support), `POST /api/v1/payments/orders/:id/refunds` (admin/support)
Reviews: `GET /api/v1/reviews/mine`, `POST /api/v1/reviews`, `POST /api/v1/reviews/:id/follow-up`, `GET /api/v1/reviews/:id`, `POST /api/v1/reviews/:id/images`, `GET /api/v1/reviews/images/:imageId`, `POST /api/v1/reviews/:id/appeals`
Staff Reviews: `GET /api/v1/staff/reviews/appeals`, `POST /api/v1/staff/reviews/replies`, `PATCH /api/v1/staff/reviews/appeals/:appealId`
Admin Governance: `/api/v1/admin/review-governance/{dimensions,sensitive-words,denylist-hashes,blacklist}` (admin-only CRUD)
Admin Ingestion: `/api/v1/admin/ingestion/{sources,scan,logs}` (admin-only)
Admin Analytics: `/api/v1/admin/analytics/{dashboard,report,export,export-logs}` (admin/support)
Admin Jobs: `GET /api/v1/admin/test`, `POST /api/v1/admin/jobs/process-once` (admin-only)
Activities/Places: `/api/v1/activities` CRUD + GPX + coordinates; `/api/v1/places` CRUD
Follows/Feed: `/api/v1/follows/{mine,:userId}`, `/api/v1/feed`, `/api/v1/feed/actions`, `/api/v1/feed/preferences`
Catalog: `GET /api/v1/catalog`
Health: `GET /health`, `GET /api`

Total: **67 endpoints**, all covered by the DB-backed integration suite.

Analytics reports include: enrollment funnel, course popularity, renewal rates, refund rates, channel performance, instructor utilization, location revenue/cost.

Sample reconciliation files: `backend/sample_data/reconciliation/recon_success_sample.csv`, `backend/sample_data/reconciliation/recon_mixed_sample.csv`.

## Notes

- Analytics CSV exports are written under the backend `exports/` directory.
- Every export request writes an access row to `analytics_export_access_logs` (user, report type, filters JSON, row count, output path).
- Feed ingestion retries/failures are appended to `immutable_ingestion_logs` with event hash uniqueness.
- Subscriber status is derived from the latest `subscription` entitlement and exposed via `GET /api/v1/auth/me`.
- First-time users without selected sports are routed to `/onboarding/interests` before entering the feed.
- **Operator ingestion workflow**: the repo includes an `./ingestion_drop/` directory that is bind-mounted into both `backend` and `worker` containers at `/app/ingestion_drop`. Operators place RSS/HTML/JSON files in this host folder and the worker picks them up on its next scan (every `INGESTION_SCAN_INTERVAL_MINUTES`). Override the host path via `INGESTION_DROP_HOST_DIR=/mnt/custom-path` in `.env`. The folder is gitignored (except `.gitkeep` / `README.md`) so operator-dropped files stay out of version control.
