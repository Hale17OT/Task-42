# Recheck Report: Prior Findings (Round 3)

Scope: static inspection only.

## 1) High - Default deployment ingestion folders not wired for worker processing

- **Status:** **Fixed**
- **Evidence:**
  - Backend bind mount added: `docker-compose.yml:57`
  - Worker bind mount added: `docker-compose.yml:93`
  - Shared env path remains consistent: `docker-compose.yml:43`, `docker-compose.yml:86`
  - Ingestion processor still resolves source path from configured drop dir: `backend/src/modules/ingestion/ingestion.service.js:197`, file existence check `backend/src/modules/ingestion/ingestion.service.js:239`
  - Operator workflow documented, including host folder and override variable: `README.md:178`
  - Host folder exists and is repo-prepared: `ingestion_drop/.gitkeep`, `ingestion_drop/README.md`; gitignore keeps dropped files out of VCS: `.gitignore:10-12`
- **Verdict:** PASS

## 2) Medium - Offline mutation handling was record-only

- **Status:** **Fixed**
- **Evidence:**
  - Replay engine exists: `frontend/src/offline/mutation-intents.js:67-102`
  - Reconnect-trigger hook exists: `frontend/src/offline/mutation-intents.js:106-126`
  - App runs replay on `online` event: `frontend/src/App.vue:177-183`
  - Replay handler now covers feed action, feed preferences, follow/unfollow, review follow-up, and appeal: `frontend/src/App.vue:139-166`
  - Feed records replay-compatible payloads/intents: `frontend/src/pages/FeedPage.vue:113`, `frontend/src/pages/FeedPage.vue:138`, `frontend/src/pages/FeedPage.vue:173`
  - Reviews records replay-compatible intents with required context: `frontend/src/pages/ReviewsPage.vue:222`, `frontend/src/pages/ReviewsPage.vue:252-255`
- **Verdict:** PASS

## 3) Medium - Security/authz API tests largely mocked

- **Status:** **Fixed / not present in current tree**
- **Evidence:**
  - Previously cited files are absent:
    - `backend/tests/orders-authz.api.test.js` (not found)
    - `backend/tests/activities-authz.api.test.js` (not found)
    - `backend/tests/places-authz.api.test.js` (not found)
    - `backend/tests/review-detail-authz.api.test.js` (not found)
  - No backend test mocking markers found in test files (`jest.mock`, `vi.mock`, `sinon.stub`) under `backend/tests/*.test.js`.
- **Verdict:** PASS

## 4) Low - README integration-test scope stale vs runner behavior

- **Status:** **Fixed**
- **Evidence:**
  - Runner still executes broad integration pattern: `backend/scripts/run-integration-tests.js:46`
  - README now describes broad DB-backed integration coverage and current compose test usage: `README.md:117`, `README.md:145-147`
- **Verdict:** PASS

## Final Result

- High open: **0**
- Medium open: **0**
- Low open: **0**

Overall: all four previously reported issues are fixed in the current repository state.
