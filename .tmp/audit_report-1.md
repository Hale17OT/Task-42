# TrailForge Static Audit (Re-run 2)

## 1. Verdict
- **Overall conclusion:** **Partial Pass**

## 2. Scope and Static Verification Boundary
- **What was reviewed:** updated backend migrations/services/middleware/tests, frontend core pages/components/offline modules, root docs/scripts/manifests.
- **What was not reviewed:** runtime behavior of external environment, real browser/device rendering behavior, and non-core style-only assets in full depth.
- **What was intentionally not executed:** project startup, Docker/compose, worker ticks, DB migrations/seeds, unit/API/integration tests.
- **Claims requiring manual verification:** real ingestion/reconciliation processing on migrated DB, queue retry/dead-letter persistence under live load, and full offline UX behavior in browser.

## 3. Repository / Requirement Mapping Summary
- **Prompt core goal:** offline-capable, single-host sports portal covering auth, personalized feed, activities+GPX, review governance/appeals, payment ledger/reconciliation/refunds, ingestion/audit logs, and operations analytics.
- **Mapped implementation areas:**
  - Auth/RBAC/session/encryption: `backend/src/modules/auth/auth.routes.js`, `backend/src/middleware/auth.js`, `backend/src/security/encryption.js`
  - Data model/migrations: `backend/migrations/002_core_domain.js`, `backend/migrations/003_review_governance.js`, `backend/migrations/004_offline_analytics.js`, `backend/migrations/007_ingestion_moderation_log_type.js`
  - Business modules: `backend/src/modules/feed`, `backend/src/modules/activities`, `backend/src/modules/reviews`, `backend/src/modules/payments`, `backend/src/modules/ingestion`, `backend/src/modules/analytics`
  - Frontend flow coverage: `frontend/src/pages/*`, `frontend/src/components/*`, `frontend/src/offline/*`
  - Test assets: `backend/tests/*`, `API_tests/run_api_tests.sh`, `unit_tests/run_unit_tests.sh`

## 4. Section-by-section Review

### 1. Hard Gates

#### 1.1 Documentation and static verifiability
- **Conclusion:** Pass
- **Rationale:** startup/config/test instructions and service structure are documented and statically consistent.
- **Evidence:** `README.md:18`, `README.md:40`, `README.md:202`, `docker-compose.yml:22`, `backend/scripts/migrate.js:63`, `backend/scripts/seed.js:25`
- **Manual verification note:** command success remains **Manual Verification Required**.

#### 1.2 Material deviation from Prompt
- **Conclusion:** Partial Pass
- **Rationale:** prior ingestion-log enum mismatch is addressed by migration 007; however, sensitive-word dictionary details are still exposed in client-facing error details, weakening governance controls.
- **Evidence:** `backend/migrations/007_ingestion_moderation_log_type.js:6`, `backend/src/modules/ingestion/ingestion.service.js:277`, `backend/src/modules/reviews/moderation.service.js:32`, `backend/src/middleware/error-handler.js:30`

### 2. Delivery Completeness

#### 2.1 Core requirement coverage
- **Conclusion:** Partial Pass
- **Rationale:** core flows are implemented across feed, activities, reviews/governance, payments/ledger, ingestion, analytics; remaining material gap is governance hardening (dictionary leak to client).
- **Evidence:** `backend/src/modules/feed/feed.routes.js:10`, `backend/src/modules/activities/activities.routes.js:23`, `backend/src/modules/reviews/reviews.routes.js:31`, `backend/src/modules/payments/payments.routes.js:12`, `backend/src/modules/ingestion/ingestion.service.js:270`, `backend/src/modules/analytics/analytics.routes.js:16`, `backend/src/modules/reviews/moderation.service.js:32`

#### 2.2 End-to-end deliverable vs partial/demo
- **Conclusion:** Pass
- **Rationale:** complete multi-service repository with backend/frontend/worker, schema, seeds, and substantial test structure.
- **Evidence:** `README.md:5`, `docker-compose.yml:1`, `backend/src/routes/index.js:22`, `frontend/src/router.js:21`, `backend/migrations/001_init.js:1`

### 3. Engineering and Architecture Quality

#### 3.1 Module decomposition
- **Conclusion:** Pass
- **Rationale:** modular domain boundaries are clear and responsibilities are separated into routes/services/middleware.
- **Evidence:** `backend/src/modules/README.md:5`, `backend/src/routes/index.js:3`, `backend/src/modules/reviews/reviews.service.js:1`

#### 3.2 Maintainability/extensibility
- **Conclusion:** Partial Pass
- **Rationale:** architecture is extensible; test execution path still lags newly added DB integration tests, reducing maintainability confidence.
- **Evidence:** new DB integration tests exist `backend/tests/idor-ownership.integration.test.js:12`, `backend/tests/payment-import-worker.integration.test.js:25`; integration runner still executes only one file `backend/scripts/run-integration-tests.js:36`

### 4. Engineering Details and Professionalism

#### 4.1 Error handling/logging/validation/API design
- **Conclusion:** Partial Pass
- **Rationale:** centralized error handling, validation, request logging and audit events are present; but sensitive moderation internals are returned to clients.
- **Evidence:** `backend/src/middleware/error-handler.js:20`, `backend/src/middleware/validate.js:3`, `backend/src/app.js:22`, `backend/src/services/audit-log.js:3`, `backend/src/modules/reviews/moderation.service.js:32`

#### 4.2 Product/service shape
- **Conclusion:** Pass
- **Rationale:** includes admin/staff endpoints, queue worker, ingestion controls, analytics exports/access logs, and role-aware frontend.
- **Evidence:** `backend/src/modules/admin/admin.routes.js:20`, `backend/src/worker.js:14`, `backend/src/modules/analytics/analytics.service.js:236`, `frontend/src/pages/AdminOpsPage.vue:1`, `frontend/src/pages/AnalyticsPage.vue:1`

### 5. Prompt Understanding and Requirement Fit

#### 5.1 Goal/scenario/constraints fit
- **Conclusion:** Partial Pass
- **Rationale:** fit remains strong and improved (ingestion moderation quarantine + arbitration masking in list), but dictionary leakage in responses weakens governance constraint fidelity.
- **Evidence:** `backend/src/modules/ingestion/ingestion.service.js:271`, `backend/src/modules/reviews/reviews.read.service.js:165`, `backend/src/modules/reviews/reviews.read.service.js:91`, `backend/src/modules/reviews/moderation.service.js:32`

### 6. Aesthetics (frontend/full-stack)

#### 6.1 Visual and interaction quality
- **Conclusion:** Pass
- **Rationale:** clear layout hierarchy, section separation, and interaction feedback (loading/errors/toasts/actions) are implemented in UI code.
- **Evidence:** `frontend/src/styles.css:72`, `frontend/src/styles.css:190`, `frontend/src/components/ToastList.vue:1`, `frontend/src/pages/FeedPage.vue:93`, `frontend/src/pages/ReviewsPage.vue:64`
- **Manual verification note:** final visual rendering quality is **Manual Verification Required**.

## 5. Issues / Suggestions (Severity-Rated)

### High

1) **Severity:** High  
**Title:** Sensitive-word dictionary matches are exposed to clients  
**Conclusion:** Fail  
**Evidence:** `backend/src/modules/reviews/moderation.service.js:32`, `backend/src/middleware/error-handler.js:30`  
**Impact:** Attackers can enumerate or infer moderation dictionary terms through API error details, weakening server-side governance effectiveness.  
**Minimum actionable fix:** Return only generic moderation metadata (e.g., `count`) to clients; store exact matched words only in internal logs/audit stores.

### Medium

2) **Severity:** Medium  
**Title:** Integration test runner does not execute newly added DB integration suites  
**Conclusion:** Partial Fail (coverage execution gap)  
**Evidence:** new integration tests `backend/tests/idor-ownership.integration.test.js:12`, `backend/tests/payment-import-worker.integration.test.js:25`; runner only invokes refund test `backend/scripts/run-integration-tests.js:36`  
**Impact:** Important high-risk tests can exist but never run in standard integration command, allowing regressions to slip.
**Minimum actionable fix:** Expand `run-integration-tests.js` to include all `.integration.test.js` files or an explicit curated list including new suites.

3) **Severity:** Medium  
**Title:** New ownership/authz API tests are largely service-mocked  
**Conclusion:** Partial Fail (test realism)  
**Evidence:** `backend/tests/activities-authz.api.test.js:67`, `backend/tests/places-authz.api.test.js:53`, `backend/tests/orders-authz.api.test.js:53`  
**Impact:** Tests may validate mocked behavior rather than true DB-backed authorization paths, reducing confidence against real IDOR regressions.  
**Minimum actionable fix:** Keep these as fast tests but pair with DB-backed ownership integration tests in regular integration run.

4) **Severity:** Medium  
**Title:** Payment import worker integration test fixture is schema/parser inconsistent  
**Conclusion:** Fail (test quality defect)  
**Evidence:** test CSV uses header without required `order_id`/`occurred_at` and lowercase status `confirmed` `backend/tests/payment-import-worker.integration.test.js:56`, parser requires `order_id`, `occurred_at`, and status in `SUCCESS/FAILED` `backend/src/modules/payments/reconciliation-parser.js:16`, `backend/src/modules/payments/reconciliation-parser.js:45`  
**Impact:** Intended integration coverage can fail for fixture reasons, masking true regressions and reducing trust in test results.  
**Minimum actionable fix:** Align fixture format/status with parser contract or update parser/contract consistently and document it.

## 6. Security Review Summary

- **authentication entry points:** **Pass**  
  Evidence: local username/password + bcrypt + session cookie/token hashing (`backend/src/modules/auth/auth.routes.js:82`, `backend/src/security/session.js:7`, `backend/src/middleware/auth.js:58`).

- **route-level authorization:** **Pass**  
  Evidence: protected admin/staff/payment/analytics/ingestion routes use `requireAuth` and `requireRole` (`backend/src/modules/ingestion/ingestion.routes.js:18`, `backend/src/modules/analytics/analytics.routes.js:14`, `backend/src/modules/payments/payments.routes.js:38`).

- **object-level authorization:** **Partial Pass**  
  Evidence in implementation is strong (`backend/src/modules/activities/activities.service.js:108`, `backend/src/modules/places/../activities/places.service.js:61`, `backend/src/modules/orders/orders.service.js:102`, `backend/src/modules/reviews/reviews.authorization.js:20`), but major API authz tests are still heavily mocked.

- **function-level authorization:** **Pass**  
  Evidence: refund authorization enforced at route and service levels (`backend/src/modules/payments/payments.routes.js:38`, `backend/src/modules/payments/refunds.service.js:6`).

- **tenant / user isolation:** **Partial Pass**  
  Evidence: feed course updates scoped by user (`backend/src/modules/feed/feed.service.js:146`) and specific isolation tests exist (`backend/tests/feed-course-update-isolation.test.js:81`); broader DB-backed isolation testing still limited in standard run.

- **admin / internal / debug protection:** **Pass**  
  Evidence: admin test/job endpoints are role-restricted (`backend/src/modules/admin/admin.routes.js:8`, `backend/src/modules/admin/admin.routes.js:20`).

## 7. Tests and Logging Review

- **Unit tests:** Partial Pass  
  - Large suite exists and includes new governance/queue/security tests.
  - Evidence: `backend/tests/error-log-redaction.test.js:18`, `backend/tests/review-listing-arbitration.test.js:13`, `frontend/src/pages/FeedPage.test.js:79`.

- **API / integration tests:** Partial Pass  
  - API shell suite exists for 401/403/400/404 checks (`API_tests/run_api_tests.sh:124`).
  - DB integration tests added but not fully wired into integration runner (`backend/scripts/run-integration-tests.js:36`).

- **Logging categories / observability:** Partial Pass  
  - Request logs, error logs, audit events, immutable ingestion logs are present.
  - Evidence: `backend/src/app.js:22`, `backend/src/middleware/error-handler.js:34`, `backend/src/services/audit-log.js:3`, `backend/src/modules/ingestion/ingestion.service.js:34`.

- **Sensitive-data leakage risk in logs/responses:** Partial Pass  
  - Log redaction exists (`backend/src/middleware/error-handler.js:6`) and has tests (`backend/tests/error-log-redaction.test.js:18`).
  - Response leakage persists for sensitive-word matches (`backend/src/modules/reviews/moderation.service.js:32`).

## 8. Test Coverage Assessment (Static Audit)

### 8.1 Test Overview
- **Unit tests exist:** backend + frontend Vitest suites (`backend/package.json:11`, `frontend/package.json:10`).
- **API/integration tests exist:** shell API checks and DB integration test files (`API_tests/run_api_tests.sh:1`, `backend/tests/refund-persistence.integration.test.js:12`, `backend/tests/idor-ownership.integration.test.js:12`).
- **Test frameworks:** Vitest, Supertest, shell curl wrappers.
- **Entry points documented:** `README.md:49`, `README.md:102`, `README.md:219`.

### 8.2 Coverage Mapping Table

| Requirement / Risk Point | Mapped Test Case(s) | Key Assertion / Fixture / Mock | Coverage Assessment | Gap | Minimum Test Addition |
|---|---|---|---|---|---|
| Authentication + login throttling | `backend/tests/auth-login-rate-limit.api.test.js:128` | 429 with `Retry-After`, repeated failed attempts (`backend/tests/auth-login-rate-limit.api.test.js:158`) | sufficient | Session lifecycle edge cases | Add logout/revoked-session integration tests |
| Route authz (401/403) | `backend/tests/feed-authz.api.test.js:5`; `backend/tests/admin-ingestion-authz.api.test.js:83`; `backend/tests/staff-reviews-authz.api.test.js:70` | Protected route matrices | basically covered | Mostly route-layer only | Add more DB-backed role/object combinations |
| Object-level ownership / IDOR | `backend/tests/idor-ownership.integration.test.js:13`; plus mocked suites `backend/tests/activities-authz.api.test.js:117` | Owner success vs cross-user deny in DB-backed test | basically covered | Not wired into default integration runner | Include this file in `run-integration-tests.js` |
| Feed dedupe + tenant isolation | `backend/tests/feed-logic.test.js:4`; `backend/tests/feed-service-dedupe.test.js:68`; `backend/tests/feed-course-update-isolation.test.js:81` | Dedupe signal filters + user_id query assertion | basically covered | Missing API-level full flow coverage | Add feed API integration flow with impressions/actions |
| Review governance windows + arbitration masking | `backend/tests/reviews-write-edge-cases.test.js:41`; `backend/tests/review-listing-arbitration.test.js:13` | 30-day follow-up checks and hidden content assertions | basically covered | No full DB-backed lifecycle integration | Add review→appeal→staff resolution integration |
| Sensitive-word governance no-leak | intended `backend/tests/sensitive-word-no-leak.test.js:12` | expects no matched words in `error.details` | insufficient | currently mismatched with implementation | Update implementation and keep this regression test |
| Ingestion moderation/quarantine | `backend/tests/ingestion-sensitive-words.test.js:63`; `backend/migrations/007_ingestion_moderation_log_type.js:6` | quarantined status + moderation_flag log type | basically covered | still mock-based; no real DB integration | Add DB-backed ingestion integration test |
| Payment import + queue behavior | `backend/tests/reconciliation-parser.test.js:9`; `backend/tests/payment-import-worker.integration.test.js:25`; `backend/tests/queue-retry-deadletter.test.js:17` | parser checks + mocked queue behavior | insufficient | integration fixture currently inconsistent with parser contract | Fix fixture and run DB-backed import worker integration |

### 8.3 Security Coverage Audit
- **authentication:** Meaningful coverage exists and is strong for brute-force throttling and unauth paths.
- **route authorization:** Broadly covered with many 401/403 checks.
- **object-level authorization:** Improved by new DB integration test, but not yet included in standard integration execution path.
- **tenant/data isolation:** Partially covered (feed isolation + IDOR integration), still not comprehensive across all entities in standard run.
- **admin/internal protection:** Covered at route authz level.

### 8.4 Final Coverage Judgment
- **Partial Pass**
- Major risk areas have improved test assets, but important gaps remain: not all high-value integration tests are executed by default, some authz tests are still mock-heavy, and payment-import integration fixture inconsistency can hide true regressions.

## 9. Final Notes
- This report is static-only and does not claim runtime success.
- The previous ingestion enum compatibility defect appears addressed by migration 007.
- The most material remaining issue is moderation dictionary leakage in API responses.
