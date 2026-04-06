# TrailForge Fullstack

This repository contains TrailForge as an offline-ready fullstack project with a Vue frontend, Koa backend, MySQL storage, background worker processing, feed ingestion, governance workflows, and analytics.

## Services

- `frontend` - Vue 3 + Vite role-aware application
- `backend` - Koa API with auth/RBAC, validation, auditing, domain services, analytics, and ingestion APIs
- `worker` - queue worker for payment/order sweeps and ingestion jobs
- `mysql` - MySQL 8.4 data store

## Ports

- Frontend: `5173`
- Backend API: `3000`
- MySQL: `3306`

## Primary Startup Path

```bash
docker compose up --build
```

This is the default and recommended startup flow.

When started from root compose, backend automatically applies migrations and seeds before serving traffic. No hidden manual initialization steps are required for a clean local boot.

## Quick Demo Credentials (Seeded)

From `backend/seeds/002_roles_users_seed.js`:

| Role | Username | Password | Email |
|---|---|---|---|
| Admin | `admin` | `admin12345` | `admin@trailforge.local` |
| Coach | `coach1` | `coach12345` | `coach1@trailforge.local` |
| Support Agent | `support1` | `support12345` | `support1@trailforge.local` |
| Regular User | `athlete1` | `athlete12345` | `athlete1@trailforge.local` |


## Optional Local Scripts

```bash
npm run up
npm run down
npm run logs
npm run migrate
npm run migrate:down
npm run seed
npm run test
npm run test:integration:db
```

## Verification Steps

1. Start stack:

```bash
docker compose up --build
```

2. Verify backend health:

```bash
curl http://localhost:3000/health
```

Expected response includes `success: true` and `data.status: "ok"`.

3. Verify auth foundation:

```bash
curl -c /tmp/trailforge-session.cookies -H "Content-Type: application/json" -d '{"username":"admin","password":"admin12345"}' http://localhost:3000/api/v1/auth/login
curl -b /tmp/trailforge-session.cookies http://localhost:3000/api/v1/auth/me
curl -b /tmp/trailforge-session.cookies http://localhost:3000/api/v1/admin/test
```

Expected behavior:

- Login returns a signed session cookie.
- `/api/v1/auth/me` returns current user data.
- `/api/v1/admin/test` is allowed for admin role and denied for non-admin users.

4. Verify frontend app shell:

- Open `http://localhost:5173`
- Confirm TrailForge app shell renders and API base URL is shown.

5. Verify database connectivity:

- Check backend logs for successful MySQL check at startup.

6. Run full test pass:

```bash
npm run test
```

## Backend Verification Workflows

### Default fast/local backend tests (no DB required)

```bash
npm --prefix backend install
npm --prefix backend test
```

Expected outcome:

- Vitest completes successfully in local environments even when MySQL is unavailable.
- Refund authorization regression coverage is still exercised (`401`, `403`, privileged success path).

### DB-backed refund integration tests (opt-in)

Prerequisites:

- MySQL is running and reachable by backend env vars.
- Schema migrations and seeds are already applied.

Run integration coverage explicitly:

```bash
npm --prefix backend run test:integration:db
```

Expected outcome:

- `backend/tests/refund-persistence.integration.test.js` runs (not skipped).
- Authorized refund request persists side effects end-to-end:
  - refund row created,
  - order refunded amount and status updated,
  - payment status updated,
  - ledger refund entry created.

If MySQL is unavailable, this command fails fast with a prerequisite message instead of running the baseline suite.

### Docker checklist (full stack)

1. Start services:

```bash
docker compose up --build
```

2. Health check:

```bash
curl http://localhost:3000/health
```

3. Refund authorization checks:

```bash
# Unauthenticated should be 401
curl -i -X POST -H "Content-Type: application/json" -d '{"amountDollars":0.01,"reason":"test","idempotencyKey":"unauth-check"}' http://localhost:3000/api/v1/payments/orders/1/refunds

# Authenticated regular user should be 403
curl -c /tmp/trailforge-user.cookies -H "Content-Type: application/json" -d '{"username":"athlete1","password":"athlete12345"}' http://localhost:3000/api/v1/auth/login
curl -i -b /tmp/trailforge-user.cookies -X POST -H "Content-Type: application/json" -d '{"amountDollars":0.01,"reason":"test","idempotencyKey":"user-forbidden-check"}' http://localhost:3000/api/v1/payments/orders/1/refunds

# Create a refundable fixture order/payment in MySQL (returns new order id)
docker exec trailforge-mysql mysql -utrailforge -ptrailforge -D trailforge -Nse "SET @uid=(SELECT id FROM users WHERE username='athlete1' LIMIT 1); SET @pid=(SELECT id FROM users WHERE username='support1' LIMIT 1); INSERT INTO courses_services (kind,title,description,provider_user_id,status) VALUES ('service', CONCAT('Docker Refund Fixture ', UNIX_TIMESTAMP()), 'docker refund verification fixture', @pid, 'active'); SET @csid=LAST_INSERT_ID(); INSERT INTO orders (user_id,course_service_id,order_type,order_status,total_amount_cents,paid_amount_cents,refunded_amount_cents,currency,idempotency_key) VALUES (@uid,@csid,'service','paid',1000,1000,0,'USD', CONCAT('docker-refund-order-', UNIX_TIMESTAMP())); SET @oid=LAST_INSERT_ID(); INSERT INTO payments (order_id,provider,provider_txn_id,payment_status,amount_cents,signature_valid,raw_payload,confirmed_at) VALUES (@oid,'wechat_pay', CONCAT('docker-txn-', UNIX_TIMESTAMP()),'confirmed',1000,1,JSON_OBJECT('source','docker-refund-check'),CURRENT_TIMESTAMP); SELECT @oid;"

# Authenticated support/admin should succeed on that refundable order
curl -c /tmp/trailforge-support.cookies -H "Content-Type: application/json" -d '{"username":"support1","password":"support12345"}' http://localhost:3000/api/v1/auth/login
curl -i -b /tmp/trailforge-support.cookies -X POST -H "Content-Type: application/json" -d '{"amountDollars":1.50,"reason":"authorized-check","idempotencyKey":"support-authorized-check"}' http://localhost:3000/api/v1/payments/orders/<ORDER_ID_FROM_SQL>/refunds
```

Expected status codes:

- Unauthenticated refund request: `401`
- Authenticated regular user refund request: `403`
- Authenticated support/admin request against the refundable fixture order: `201`

Optional status-only checks:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Content-Type: application/json" -d '{"amountDollars":0.01,"reason":"test","idempotencyKey":"unauth-check"}' http://localhost:3000/api/v1/payments/orders/1/refunds
curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/trailforge-user.cookies -X POST -H "Content-Type: application/json" -d '{"amountDollars":0.01,"reason":"test","idempotencyKey":"user-forbidden-check"}' http://localhost:3000/api/v1/payments/orders/1/refunds
curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/trailforge-support.cookies -X POST -H "Content-Type: application/json" -d '{"amountDollars":1.50,"reason":"authorized-check","idempotencyKey":"support-authorized-check"}' http://localhost:3000/api/v1/payments/orders/<ORDER_ID_FROM_SQL>/refunds
```

## Seeded Roles and Accounts

`backend/seeds/002_roles_users_seed.js` creates these default roles:

- `admin`
- `coach`
- `support`
- `user`

It also seeds one default account per role for local development:

| Role | Username | Password | Email |
|---|---|---|---|
| Admin | `admin` | `admin12345` | `admin@trailforge.local` |
| Coach | `coach1` | `coach12345` | `coach1@trailforge.local` |
| Support Agent | `support1` | `support12345` | `support1@trailforge.local` |
| Regular User | `athlete1` | `athlete12345` | `athlete1@trailforge.local` |

These are seeded local credentials only.

## Unified Acceptance Test Runner

Project root includes required acceptance test directories and one-click runner:

- `unit_tests/` - unit suite wrapper (backend + frontend)
- `API_tests/` - API functional tests for auth, follows, refunds, and staff-review permissions
- `run_tests.sh` - unified runner with consolidated summary and exit code

### Prerequisites

- Node.js + npm available in shell
- Dependencies installed (`backend/node_modules`, `frontend/node_modules`)
  - `run_tests.sh` auto-installs missing dependencies

### One-click command

```bash
./run_tests.sh
```

### Output format

- Per test/group output includes:
  - test name
  - status (`PASS`/`FAIL`)
  - failure reason (for failed tests)
  - log snippet (for failed tests)
- Final strict summary block:

```text
TOTAL=<number>
PASSED=<number>
FAILED=<number>
```

### Exit codes

- `0` - all suites passed
- `1` - one or more tests failed

### Coverage notes

- API tests cover 401 (unauthenticated) for all protected route groups: follows, reviews, feed, refunds, admin ingestion, admin analytics, admin governance, and staff reviews.
- API tests cover 403 (forbidden) for role-restricted routes: refunds (user), ingestion (user/coach/support), analytics (user/coach), governance (user/support), and staff reviews (user).
- API tests cover 400 (validation) for registration, follows params, review creation, and staff reply creation.
- API tests cover 404 for unknown routes.
- Authenticated tests require the backend to be running with seeded data (see Quick Demo Credentials).

## Project Layout

- `frontend/` Vue app + Dockerfile
- `backend/` Koa API + Dockerfile + migrations/seeds

## Backend Order/Payment Foundations

Implemented backend APIs:

- `POST /api/v1/orders`
- `GET /api/v1/orders/:id`
- `GET /api/v1/orders/:id/payment-status`
- `POST /api/v1/payments/imports` (admin/support)
- `GET /api/v1/payments/imports/:importId` (admin/support)
- `POST /api/v1/payments/orders/:id/refunds`
- `POST /api/v1/admin/jobs/process-once` (admin, test helper)

Implemented activity APIs:

- `GET /api/v1/places`
- `POST /api/v1/places`
- `PATCH /api/v1/places/:placeId`
- `DELETE /api/v1/places/:placeId`
- `GET /api/v1/activities`
- `POST /api/v1/activities`
- `GET /api/v1/activities/:activityId`
- `PATCH /api/v1/activities/:activityId`
- `DELETE /api/v1/activities/:activityId`
- `POST /api/v1/activities/:activityId/gpx`
- `GET /api/v1/activities/:activityId/coordinates`

Implemented feed + ingestion APIs:

- `GET /api/v1/feed`
- `POST /api/v1/feed/actions`
- `GET /api/v1/feed/preferences`
- `PUT /api/v1/feed/preferences`
- `GET /api/v1/follows/mine`
- `POST /api/v1/follows/:userId`
- `DELETE /api/v1/follows/:userId`
- `GET /api/v1/admin/ingestion/sources`
- `POST /api/v1/admin/ingestion/sources`
- `PATCH /api/v1/admin/ingestion/sources/:id`
- `POST /api/v1/admin/ingestion/scan`
- `GET /api/v1/admin/ingestion/logs`

Implemented analytics APIs (admin/support):

- `GET /api/v1/admin/analytics/dashboard`
- `GET /api/v1/admin/analytics/report`
- `POST /api/v1/admin/analytics/export`
- `GET /api/v1/admin/analytics/export-logs`

Analytics reports include:

- enrollment funnel
- course popularity
- renewal rates
- refund rates
- channel performance
- instructor utilization
- location revenue/cost

Sample reconciliation files:

- `backend/sample_data/reconciliation/recon_success_sample.csv`
- `backend/sample_data/reconciliation/recon_mixed_sample.csv`

## Notes

- Analytics CSV exports are written under the backend `exports/` directory.
- Every export request writes an access row to `analytics_export_access_logs` including user, report type, filters JSON, row count, and output path.
- Feed ingestion retries are logged as immutable `retried`/`failed` events in `immutable_ingestion_logs`.
- Subscriber status is derived from the latest `subscription` entitlement and exposed in `GET /api/v1/auth/me`.
- First-time users without selected sports are routed to `/onboarding/interests` before entering the feed.
