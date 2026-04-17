# Recheck Report: Prior High/Medium Findings

Scope: static inspection only (no test/runtime execution).

## 1) High - Sensitive-word dictionary matches exposed to clients

- **Previous conclusion:** Fail
- **Current status:** **Fixed**
- **Evidence:**
  - `backend/src/modules/reviews/moderation.service.js:32-35` now throws `ApiError` with generic message only (`"Content contains restricted words"`) and no matched-word payload.
  - `backend/src/middleware/error-handler.js:21-25` includes `SENSITIVE_WORD_DETECTED` in `REDACTED_DETAIL_CODES`.
  - `backend/src/middleware/error-handler.js:33-39` sets `details: null` for redacted codes.
- **Assessment:** Client-side dictionary enumeration via error details is no longer visible in this path.

## 2) Medium - Integration runner missed new DB integration suites

- **Previous conclusion:** Partial Fail
- **Current status:** **Fixed**
- **Evidence:**
  - `backend/scripts/run-integration-tests.js:46` runs Vitest with pattern `integration.test`, which is broad and file-name-driven rather than a single hardcoded suite.
  - `backend/package.json:12-13` integration scripts route through this runner.
  - No `backend/tests/idor-ownership.integration.test.js` or `backend/tests/payment-import-worker.integration.test.js` exists now (not present in current tree).
- **Assessment:** Current runner design is not constrained to one named integration file; it is materially less likely to omit newly added `*.integration.test.*` suites.

## 3) Medium - Ownership/authz API tests largely service-mocked

- **Previous conclusion:** Partial Fail
- **Current status:** **Resolved (by test-set change)**
- **Evidence:**
  - Previously-cited files are absent: `backend/tests/activities-authz.api.test.js`, `backend/tests/places-authz.api.test.js`, `backend/tests/orders-authz.api.test.js`.
  - Current ownership/IDOR checks are DB-backed integration tests, e.g.:
    - `backend/tests/activities.integration.test.js:138-152` (cross-user activity access denied)
    - `backend/tests/places.integration.test.js:100-113` (cross-user place patch denied)
    - `backend/tests/orders.integration.test.js:136-149` (cross-user order access forbidden)
- **Assessment:** Risk from mocked authz API tests is removed in current tree; ownership coverage is present in real integration suites.

## 4) Medium - Payment import worker integration fixture inconsistent with parser contract

- **Previous conclusion:** Fail
- **Current status:** **Resolved (by test-set change)**
- **Evidence:**
  - Previously-cited file is absent: `backend/tests/payment-import-worker.integration.test.js`.
  - Active payments integration fixture is contract-aligned:
    - Header includes required fields in `backend/tests/payments.integration.test.js:5` (`order_id`, `occurred_at`, etc.).
    - Status values use parser-supported enum (`SUCCESS`) in `backend/tests/payments.integration.test.js:80,106`.
  - Parser contract remains strict and explicit at `backend/src/modules/payments/reconciliation-parser.js:16-17` and `backend/src/modules/payments/reconciliation-parser.js:45-46`.
- **Assessment:** The specific fixture-contract mismatch reported is not present in the current test suite.

## Final Recheck Verdict

- **High findings still open:** 0
- **Medium findings still open:** 0
- **Overall:** All four previously reported items are fixed or resolved by replacement/removal of the problematic tests in the current repository state.

## Confidence

- **High** for source-level changes in moderation/error handling and runner behavior.
- **Medium-high** for test-coverage execution implications (no runtime execution performed in this recheck).
