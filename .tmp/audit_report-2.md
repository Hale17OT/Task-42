# Delivery Acceptance + Project Architecture Audit (Static-Only Re-run)

## 1. Verdict
- **Overall conclusion: Partial Pass**
- Rationale: Core TrailForge scope is materially implemented (auth/RBAC, feed, activities+GPX, reviews+appeals+governance, offline payment reconciliation/ledger, ingestion, analytics), but there are still material gaps against prompt intent, most notably deployment-level ingestion drop-folder wiring (High) and incomplete offline mutation recovery semantics.

## 2. Scope and Static Verification Boundary
- **Reviewed**: docs/config/startup scripts, backend entrypoints/routes/middleware/security, core modules (feed, follows, activities, reviews, payments, queue, ingestion, analytics), migrations/seeds, frontend routing/pages/components/offline layer, test suites and test runners.
- **Not reviewed exhaustively**: every frontend style rule and every single test assertion in all files; focused on prompt-critical and risk-critical paths.
- **Intentionally not executed**: app runtime, Docker, DB migrations, API calls, browser interactions, unit/integration/API tests.
- **Manual verification required**:
  - Real Docker deployment behavior (especially ingestion drop-folder workflow).
  - Browser offline behavior and service-worker cache/update semantics.
  - End-to-end queue processing timing/retry under real DB load.

## 3. Repository / Requirement Mapping Summary
- **Prompt core goal**: offline-ready on-prem sports portal for regular users + staff/admin, combining personalized feed, activity tracking (incl. GPX), reviews/governance/arbitration, offline payment ledger+reconciliation, local news ingestion, and analytics/export.
- **Mapped implementation areas**:
  - Auth/session/RBAC and protected routes: `backend/src/modules/auth/auth.routes.js:17`, `backend/src/middleware/auth.js:58`, `backend/src/routes/index.js:22`
  - Feed personalization/actions/dedupe/cold-start: `backend/src/modules/feed/feed.service.js:204`, `backend/src/modules/feed/feed.logic.js:55`, `frontend/src/components/FeedPanel.vue:62`
  - Activities/places/GPX: `backend/src/modules/activities/activities.routes.js:23`, `backend/src/modules/activities/activities.service.js:264`, `backend/src/modules/activities/gpx.parser.js:21`
  - Reviews/governance/appeals/replies: `backend/src/modules/reviews/reviews.create.service.js:26`, `backend/src/modules/reviews/reviews.followup.service.js:20`, `backend/src/modules/reviews/reviews.appeals.service.js:52`, `backend/src/modules/reviews/admin-governance.routes.js:22`
  - Payments/reconciliation/refunds/queue: `backend/src/modules/payments/payments.service.js:25`, `backend/src/modules/payments/refunds.service.js:14`, `backend/src/modules/queue/queue.service.js:17`, `backend/src/modules/payments/processor.service.js:86`
  - Ingestion + immutable logs: `backend/src/modules/ingestion/ingestion.service.js:184`, `backend/src/modules/ingestion/ingestion.service.js:34`, `backend/migrations/007_ingestion_moderation_log_type.js:5`
  - Analytics/export logging: `backend/src/modules/analytics/analytics.routes.js:26`, `backend/src/modules/analytics/analytics.service.js:236`, `backend/migrations/004_offline_analytics.js:63`

## 4. Section-by-section Review

### 4.1 Hard Gates

#### 4.1.1 Documentation and static verifiability
- **Conclusion: Partial Pass**
- **Rationale**: Startup/test docs and entrypoints are present and mostly consistent with code, but one documentation drift exists for DB integration test scope.
- **Evidence**:
  - Startup/docs present: `README.md:18`, `README.md:40`, `README.md:202`
  - Compose startup and backend migration+seed command: `docker-compose.yml:50`
  - Backend test scripts: `backend/package.json:11`, `backend/package.json:13`, `backend/scripts/run-integration-tests.js:36`
  - Drift: README still states only refund integration test expected: `README.md:127`
- **Manual verification note**: Runtime startup success cannot be confirmed statically.

#### 4.1.2 Material deviation from prompt
- **Conclusion: Partial Pass**
- **Rationale**: Implementation is largely centered on prompt business scope; however default deployment wiring for monitored ingestion folders is incomplete for the stated on-prem drop-folder workflow.
- **Evidence**:
  - Prompt-aligned ingestion scanning logic expects filesystem files: `backend/src/modules/ingestion/ingestion.service.js:197`, `backend/src/modules/ingestion/ingestion.service.js:239`
  - Worker configured with drop dir env but no ingestion-drop volume mount: `docker-compose.yml:81`, `docker-compose.yml:85`
  - Backend also no ingestion-drop volume mount: `docker-compose.yml:43`, `docker-compose.yml:51`

### 4.2 Delivery Completeness

#### 4.2.1 Core explicit requirements coverage
- **Conclusion: Partial Pass**
- **Rationale**: Most explicit functional requirements are statically implemented (feed actions/dedupe/cold start, activity+GPX, review lifecycle/governance, payment reconciliation/refunds/queue, ingestion/analytics). Offline workflow is partially implemented but not fully resilient.
- **Evidence**:
  - Feed actions + dedupe + cold start: `backend/src/modules/feed/feed.schemas.js:8`, `backend/src/modules/feed/feed.service.js:213`, `backend/src/modules/feed/feed.service.js:235`, `frontend/src/components/FeedPanel.vue:64`
  - Activity fields + places + GPX + coordinate list: `backend/src/modules/activities/activities.schemas.js:3`, `backend/src/modules/activities/activities.service.js:39`, `backend/src/modules/activities/activities.service.js:353`
  - Review constraints (one/order, 2/day, follow-up 30d, appeal 7d, image constraints): `backend/src/modules/reviews/reviews.create.service.js:51`, `backend/src/modules/reviews/moderation.service.js:70`, `backend/src/modules/reviews/reviews.followup.service.js:20`, `backend/src/modules/reviews/reviews.appeals.service.js:25`, `backend/src/modules/reviews/reviews.image.service.js:40`
  - Arbitration masking + threaded replies: `backend/src/modules/reviews/reviews.read.service.js:52`, `backend/src/modules/reviews/reviews.read.service.js:107`
  - Payment reconciliation/signature/refund/idempotency/queue: `backend/src/modules/payments/reconciliation-parser.js:59`, `backend/src/modules/payments/payments.service.js:41`, `backend/src/modules/payments/refunds.service.js:23`, `backend/src/modules/queue/queue.service.js:4`
  - Ingestion allow/block/retry/logs: `backend/src/modules/ingestion/ingestion.service.js:190`, `backend/src/modules/ingestion/ingestion.service.js:203`, `backend/src/modules/queue/queue.service.js:89`, `backend/src/modules/ingestion/ingestion.service.js:34`
  - Analytics/report filters/csv/access logs: `backend/src/modules/analytics/analytics.schemas.js:3`, `backend/src/modules/analytics/analytics.routes.js:26`, `backend/src/modules/analytics/analytics.service.js:238`

#### 4.2.2 End-to-end 0->1 deliverable vs partial demo
- **Conclusion: Pass (with limitations)**
- **Rationale**: Repo is a complete full-stack structure with backend/frontend/worker/db migrations/tests/docs, not a single-file demo. Limitation is confidence, not presence.
- **Evidence**:
  - Full project layout documented: `README.md:250`
  - Services defined: `docker-compose.yml:1`
  - Route aggregation across domains: `backend/src/routes/index.js:22`
  - Frontend routed app with multiple product areas: `frontend/src/router.js:24`

### 4.3 Engineering and Architecture Quality

#### 4.3.1 Structure and module decomposition
- **Conclusion: Pass**
- **Rationale**: Clear decomposition by domain modules and middleware; no monolithic single-file architecture.
- **Evidence**:
  - Modular route registration: `backend/src/routes/index.js:3`
  - Domain services separated (feed/reviews/payments/ingestion/analytics): `backend/src/modules/feed/feed.service.js:1`, `backend/src/modules/reviews/reviews.create.service.js:1`, `backend/src/modules/payments/payments.service.js:1`, `backend/src/modules/ingestion/ingestion.service.js:1`, `backend/src/modules/analytics/analytics.service.js:1`

#### 4.3.2 Maintainability and extensibility
- **Conclusion: Pass**
- **Rationale**: Use of schemas, reusable auth middleware, service separation, migrations, queue abstraction, and audit logging shows extensible baseline.
- **Evidence**:
  - Validation layer: `backend/src/middleware/validate.js:1`
  - Route auth middleware reuse: `backend/src/middleware/auth.js:58`, `backend/src/middleware/auth.js:70`
  - Queue abstraction with retry/dead-letter: `backend/src/modules/queue/queue.service.js:87`
  - Migration framework: `backend/scripts/migrate.js:9`

### 4.4 Engineering Details and Professionalism

#### 4.4.1 Error handling, logging, validation, API design
- **Conclusion: Partial Pass**
- **Rationale**: Strong baseline exists (global error handler, schema validation, structured logging, audit trail, sensitive error redaction), but deployment wiring and offline mutation reliability reduce professional completeness.
- **Evidence**:
  - Central error handling and request IDs: `backend/src/middleware/error-handler.js:27`, `backend/src/middleware/request-id.js:1`
  - Error redaction controls: `backend/src/middleware/error-handler.js:21`, `backend/src/middleware/error-handler.js:38`
  - Structured logs: `backend/src/logger/index.js:4`
  - Validation patterns: `backend/src/modules/reviews/reviews.schemas.js:3`, `backend/src/modules/activities/activities.schemas.js:3`
  - Audit events: `backend/src/services/audit-log.js:3`

#### 4.4.2 Product/service realism vs demo
- **Conclusion: Pass (static)**
- **Rationale**: Overall shape is production-like with migrations, seeds, auth, RBAC, queue, worker, admin/staff lanes, and test suites.
- **Evidence**:
  - Worker lifecycle: `backend/src/worker.js:9`
  - Queue-backed jobs: `backend/src/modules/payments/processor.service.js:52`
  - Admin/staff product surfaces: `backend/src/modules/reviews/staff.routes.js:9`, `backend/src/modules/analytics/analytics.routes.js:12`, `frontend/src/router.js:34`

### 4.5 Prompt Understanding and Requirement Fit

#### 4.5.1 Business goal/constraints fit
- **Conclusion: Partial Pass**
- **Rationale**: Business semantics are mostly understood and implemented. Main shortfall is default deployment mismatch for monitored-folder ingestion and partial offline mutation robustness.
- **Evidence**:
  - Personalized feed behavior: `backend/src/modules/feed/feed.service.js:204`, `frontend/src/pages/FeedPage.vue:100`
  - Review governance/risk/blacklist: `backend/src/modules/reviews/risk.service.js:30`, `backend/src/modules/reviews/admin-governance.routes.js:125`
  - Payment and reconciliation controls: `backend/src/modules/payments/reconciliation-parser.js:16`, `backend/src/modules/payments/refunds.service.js:42`
  - Ingestion monitored-folder logic: `backend/src/modules/ingestion/ingestion.service.js:184`

### 4.6 Aesthetics (frontend-only)

#### 4.6.1 Visual/interaction quality
- **Conclusion: Pass**
- **Rationale**: UI provides clear sectioning, role-aware navigation, stateful interaction feedback (loading/errors/toasts), and responsive layout patterns; no obvious static rendering mismatch detected.
- **Evidence**:
  - Layout hierarchy and role-aware nav: `frontend/src/App.vue:15`, `frontend/src/App.vue:23`
  - Feed interaction controls and feedback hooks: `frontend/src/components/FeedPanel.vue:62`, `frontend/src/pages/FeedPage.vue:104`
  - Global styling consistency and responsive behavior: `frontend/src/styles.css:72`, `frontend/src/styles.css:190`, `frontend/src/styles.css:301`
- **Manual verification note**: Real cross-device rendering quality requires browser runtime validation.

## 5. Issues / Suggestions (Severity-Rated)

### High

1) **Severity: High**  
**Title**: Default deployment does not wire monitored ingestion folders for worker processing  
**Conclusion**: Prompt-critical ingestion drop-folder workflow is not fully deliverable by default compose setup.  
**Evidence**: `docker-compose.yml:43`, `docker-compose.yml:81`, `docker-compose.yml:85`, `docker-compose.yml:51`, `backend/src/modules/ingestion/ingestion.service.js:197`, `backend/src/modules/ingestion/ingestion.service.js:239`  
**Impact**: Local mirrored files “dropped into monitored folders” may not be accessible/persistent in the running worker container in standard deployment, reducing reliability of a core ingestion path.  
**Minimum actionable fix**: Add explicit shared volume mount for ingestion drop directory (host <-> worker, and backend if needed), document operator drop path, and keep env path consistent.

### Medium

2) **Severity: Medium**  
**Title**: Offline mutation handling is record-only, without replay/sync execution path  
**Conclusion**: Offline-readiness exists for cached reads and user notifications, but mutation continuity is partial.  
**Evidence**: `frontend/src/offline/mutation-intents.js:40`, `frontend/src/offline/mutation-intents.js:56`, `frontend/src/App.vue:31`, `frontend/src/pages/FeedPage.vue:112`, `frontend/src/pages/ReviewsPage.vue:252`  
**Impact**: User actions performed while offline can be dropped unless manually re-entered; this weakens “single offline-ready web experience” expectations.  
**Minimum actionable fix**: Implement reconnect-driven replay queue for recorded intents with idempotent server APIs and conflict handling UX.

3) **Severity: Medium**  
**Title**: Security/authz API tests are largely mocked, limiting detection of DB-backed regressions  
**Conclusion**: Coverage exists but substantial route authz suites bypass real DB behavior.  
**Evidence**: `backend/tests/orders-authz.api.test.js:1`, `backend/tests/activities-authz.api.test.js:1`, `backend/tests/places-authz.api.test.js:1`, `backend/tests/review-detail-authz.api.test.js:26`  
**Impact**: Severe object-authorization or query-level regressions can survive mocked tests; confidence relies heavily on fewer DB-gated integration tests.  
**Minimum actionable fix**: Promote critical authz/IDOR suites to DB-backed integration for orders/reviews/activities/places and include negative-path fixtures.

### Low

4) **Severity: Low**  
**Title**: README integration-test scope is stale vs current runner behavior  
**Conclusion**: Documentation drift can mislead verification planning.  
**Evidence**: `README.md:127`, `backend/scripts/run-integration-tests.js:36`  
**Impact**: Reviewers/operators may assume only refund integration runs while runner executes all `*.integration.test.js`.  
**Minimum actionable fix**: Update README integration section to match wildcard integration runner behavior and enumerate current DB-backed suites.

## 6. Security Review Summary

- **Authentication entry points: Pass**
  - Local auth with bcrypt and signed httpOnly sessions: `backend/src/modules/auth/auth.routes.js:25`, `backend/src/modules/auth/auth.routes.js:179`, `backend/src/middleware/auth.js:8`
- **Route-level authorization: Pass**
  - Consistent `requireAuth`/`requireRole` usage on protected domains: `backend/src/modules/payments/payments.routes.js:37`, `backend/src/modules/reviews/staff.routes.js:11`, `backend/src/modules/analytics/analytics.routes.js:14`, `backend/src/modules/ingestion/ingestion.routes.js:18`
- **Object-level authorization: Partial Pass**
  - Strong ownership checks in activities/places/orders/reviews images/detail: `backend/src/modules/activities/activities.service.js:108`, `backend/src/modules/activities/places.service.js:61`, `backend/src/modules/orders/orders.service.js:102`, `backend/src/modules/reviews/reviews.authorization.js:20`
  - But confidence reduced by heavy mocked authz tests (see Issue #3).
- **Function-level authorization: Pass**
  - Sensitive operations restricted by role and/or service guards (refunds/governance/staff): `backend/src/modules/payments/refunds.service.js:6`, `backend/src/modules/reviews/admin-governance.routes.js:22`, `backend/src/modules/reviews/staff.routes.js:11`
- **Tenant / user isolation: Partial Pass**
  - Static code indicates user scoping and non-owner denial for core entities: `backend/src/modules/orders/orders.service.js:110`, `backend/src/modules/activities/activities.service.js:214`, `backend/src/modules/activities/places.service.js:10`
  - Runtime data-isolation still requires manual DB-backed verification depth.
- **Admin/internal/debug protection: Pass**
  - Admin ops and ingestion endpoints are protected: `backend/src/modules/admin/admin.routes.js:20`, `backend/src/modules/ingestion/ingestion.routes.js:18`

## 7. Tests and Logging Review

- **Unit tests: Pass (static presence/coverage breadth)**
  - Broad backend and frontend test presence with Vitest: `backend/package.json:11`, `frontend/package.json:10`, `backend/tests/feed-logic.test.js:1`, `frontend/src/pages/FeedPage.test.js:1`
- **API / integration tests: Partial Pass**
  - API wrappers and many backend API tests exist; DB integration runner now runs wildcard integration suites: `API_tests/run_api_tests.sh:124`, `backend/scripts/run-integration-tests.js:36`
  - Coverage realism is mixed due mocked authz suites and DB-gated execution path.
- **Logging categories / observability: Pass**
  - Request logs, worker error logs, and ingestion immutable logs are present: `backend/src/app.js:22`, `backend/src/worker.js:29`, `backend/src/modules/ingestion/ingestion.service.js:34`
- **Sensitive-data leakage risk in logs/responses: Pass (improved)**
  - Error detail redaction and moderation-code suppression are in place: `backend/src/middleware/error-handler.js:16`, `backend/src/middleware/error-handler.js:21`, `backend/src/middleware/error-handler.js:38`
  - Sensitive-word service no longer returns matched terms: `backend/src/modules/reviews/moderation.service.js:31`

## 8. Test Coverage Assessment (Static Audit)

### 8.1 Test Overview
- **Unit/API/integration tests exist**: backend Vitest + frontend Vitest + shell API tests.
  - Evidence: `backend/package.json:11`, `frontend/package.json:10`, `API_tests/run_api_tests.sh:1`
- **Test entry points**:
  - Backend unit: `npm --prefix backend test` via `backend/package.json:11`
  - Backend integration DB: `node scripts/run-integration-tests.js` via `backend/package.json:13`
  - Unified wrapper: `run_tests.sh:22`
- **Documentation for test commands exists**: `README.md:92`, `README.md:119`, `README.md:218`

### 8.2 Coverage Mapping Table

| Requirement / Risk Point | Mapped Test Case(s) | Key Assertion / Fixture / Mock | Coverage Assessment | Gap | Minimum Test Addition |
|---|---|---|---|---|---|
| Auth required on protected routes (401) | `backend/tests/feed-authz.api.test.js:1`, `backend/tests/admin-ingestion-authz.api.test.js:83`, `API_tests/run_api_tests.sh:124` | Status assertions for unauthenticated requests | basically covered | Many are mocked-app route tests | Add DB-backed smoke for each protected route group |
| Role-based authorization (403) | `backend/tests/admin-analytics-authz.api.test.js:1`, `backend/tests/staff-reviews-authz.api.test.js:1`, `backend/tests/admin-governance-authz.api.test.js:1` | Role headers and forbidden assertions | basically covered | Heavy use of module mocks | Add integration authz tests with seeded users and real middleware |
| Object-level authz / IDOR | `backend/tests/idor-ownership.integration.test.js:12` | Cross-user activity/place/order access denied (`404`) | sufficient for sampled domains | Reviews/images IDOR mostly mocked | Add DB-backed review detail/image IDOR integration |
| Feed dedupe and 7-day exclusion | `backend/tests/feed-service-dedupe.test.js:1` | Seen similarity/content IDs filtered | basically covered | No end-to-end with impression writes | Add DB integration asserting 7-day behavior over real table rows |
| Feed course-update tenant isolation | `backend/tests/feed-course-update-isolation.test.js:15` | Query must include `WHERE o.user_id = ?` | basically covered | Mocked DB only | Add DB-backed multi-user feed isolation integration |
| Review one-per-order + limits + follow-up/appeal windows | `backend/tests/reviews-write-edge-cases.test.js:1`, `backend/tests/daily-review-quota.test.js:1`, `backend/tests/review-rules.test.js:1` | Duplicate/conflict and date-window assertions | basically covered | Needs more DB-integrated coverage for race conditions | Add transactional concurrency integration for daily quota and duplicate review |
| Arbitration masking of content | `backend/tests/review-listing-arbitration.test.js:13` | under_arbitration text/images/follow-up masked | basically covered | Mocked pool | Add integration test against real review states and API responses |
| Sensitive-word leakage prevention | `backend/tests/sensitive-word-no-leak.test.js:12`, `backend/tests/error-log-redaction.test.js:64` | No matched-word details in errors/client/logs | sufficient (static) | None major | Keep regression tests as mandatory gate |
| Payment reconciliation parsing/signature | `backend/tests/reconciliation-parser.test.js:1`, `backend/tests/payment-import-worker.integration.test.js:29` | Header/row validation and signed import behavior | basically covered | Worker tick processing not fully E2E in same suite | Add integration that runs queue processor and verifies ledger/order state transitions |
| Refund authz + persistence + money rules | `backend/tests/refunds-authz.service.test.js:1`, `backend/tests/refund-persistence.integration.test.js:1`, `backend/tests/money-rules.test.js:1` | `401/403`, amount bounds, DB side effects | sufficient for core path | Edge multi-refund concurrency not proven | Add integration for concurrent partial refunds/idempotency races |
| Queue retry/dead-letter + processor failure logging | `backend/tests/queue-retry-deadletter.test.js:17`, `backend/tests/processor-failure-logging.test.js:100` | Backoff/dead-letter SQL path and retried/failed logging | basically covered | Mostly mocked queue/pool | Add DB-backed queue state transition integration |
| Ingestion moderation + immutable log type | `backend/tests/ingestion-sensitive-words.test.js:63` | Quarantined status + `moderation_flag` log type | basically covered | Mocked DB/filesystem | Add integration with fixture files in monitored folder path |

### 8.3 Security Coverage Audit
- **Authentication: basically covered**
  - Evidence: `backend/tests/auth-login-rate-limit.api.test.js:1`, `backend/tests/error-response.test.js:1`
  - Gap: More DB-backed login/session lifecycle integration would improve certainty.
- **Route authorization: basically covered**
  - Evidence: `backend/tests/admin-ingestion-authz.api.test.js:74`, `backend/tests/staff-reviews-authz.api.test.js:1`
  - Gap: Many are mocked route harnesses.
- **Object-level authorization: partially covered**
  - Evidence: `backend/tests/idor-ownership.integration.test.js:12`, `backend/tests/review-image-authz.service.test.js:1`
  - Gap: Review detail/image object access lacks strong DB-backed integration depth.
- **Tenant / data isolation: partially covered**
  - Evidence: `backend/tests/feed-course-update-isolation.test.js:15`, `backend/tests/idor-ownership.integration.test.js:93`
  - Gap: Feed and review isolation tests often mock data layer.
- **Admin/internal protection: basically covered**
  - Evidence: `backend/tests/admin-analytics-authz.api.test.js:1`, `backend/tests/admin-governance-authz.api.test.js:1`, `backend/tests/admin-ingestion-authz.api.test.js:74`
  - Gap: DB-backed full-stack checks should be expanded.

### 8.4 Final Coverage Judgment
- **Partial Pass**
- Major risks are covered at baseline (authn/authz, key business validations, reconciliation parsing, queue retry logic, moderation leakage regression), but enough critical tests are mocked that severe DB/query-level authorization defects could still evade detection.

## 9. Final Notes
- This report is static-only and intentionally avoids runtime claims.
- Conclusions labeled Partial Pass/High are tied to traceable code/deployment evidence rather than execution assumptions.
- The strongest remaining defect is deployment-level monitored-folder ingestion wiring in default compose.
