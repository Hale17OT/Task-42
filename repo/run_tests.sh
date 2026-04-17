#!/usr/bin/env bash
#
# TrailForge one-click test runner — Docker-only, no local installs.
#
# Runs the full backend (unit + integration) and frontend test suites
# inside isolated Docker containers using docker-compose.yml with the
# "test" profile (ephemeral MySQL + test-only service containers).
# No Node/npm, no database, and no project dependencies need to be
# installed on the host — Docker is the only prerequisite.

set +e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_SUMMARY="$ROOT_DIR/unit_tests/.summary"
API_SUMMARY="$ROOT_DIR/API_tests/.summary"
LOG_DIR="$ROOT_DIR/unit_tests/logs"
API_LOG_DIR="$ROOT_DIR/API_tests/logs"

mkdir -p "$ROOT_DIR/unit_tests" "$ROOT_DIR/API_tests" "$LOG_DIR" "$API_LOG_DIR"

COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
PROJECT="trailforge-tests"

compose() {
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --profile test "$@"
}

cleanup() {
  compose down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required but not found in PATH."
  exit 1
fi

# Ensure clean state
cleanup

echo ""
echo "===== RUNNING BACKEND TESTS (unit + integration, Dockerized) ====="
BACKEND_LOG="$LOG_DIR/backend.log"
compose up --build --abort-on-container-exit --exit-code-from backend-tests backend-tests >"$BACKEND_LOG" 2>&1
BACKEND_EXIT=$?
tail -n 20 "$BACKEND_LOG"

# Parse backend test counts (strip ANSI, handle docker-compose 'service | ' prefix)
BACKEND_SUMMARY=$(sed -E $'s/\x1b\\[[0-9;]*m//g; s/^[^|]*\\| //' "$BACKEND_LOG")
BACKEND_TESTS_LINE=$(echo "$BACKEND_SUMMARY" | grep -E "^[[:space:]]*Tests[[:space:]]" | tail -n 1)
BACKEND_PASSED=$(echo "$BACKEND_TESTS_LINE" | grep -oE '[0-9]+ passed' | head -n 1 | awk '{print $1}')
BACKEND_FAILED=$(echo "$BACKEND_TESTS_LINE" | grep -oE '[0-9]+ failed' | head -n 1 | awk '{print $1}')
BACKEND_TOTAL=$(echo "$BACKEND_TESTS_LINE" | grep -oE '\([0-9]+\)' | head -n 1 | tr -d '()')
BACKEND_PASSED=${BACKEND_PASSED:-0}
BACKEND_FAILED=${BACKEND_FAILED:-0}
BACKEND_TOTAL=${BACKEND_TOTAL:-0}

if [ "$BACKEND_EXIT" -eq 0 ]; then
  echo "[BACKEND][PASS] $BACKEND_PASSED tests"
else
  echo "[BACKEND][FAIL] exit=$BACKEND_EXIT"
fi

# Clean up backend containers before starting frontend
compose down -v --remove-orphans >/dev/null 2>&1 || true

echo ""
echo "===== RUNNING FRONTEND TESTS (Dockerized) ====="
FRONTEND_LOG="$LOG_DIR/frontend.log"
compose up --build --abort-on-container-exit --exit-code-from frontend-tests frontend-tests >"$FRONTEND_LOG" 2>&1
FRONTEND_EXIT=$?
tail -n 20 "$FRONTEND_LOG"

FRONTEND_SUMMARY=$(sed -E $'s/\x1b\\[[0-9;]*m//g; s/^[^|]*\\| //' "$FRONTEND_LOG")
FRONTEND_TESTS_LINE=$(echo "$FRONTEND_SUMMARY" | grep -E "^[[:space:]]*Tests[[:space:]]" | tail -n 1)
FRONTEND_PASSED=$(echo "$FRONTEND_TESTS_LINE" | grep -oE '[0-9]+ passed' | head -n 1 | awk '{print $1}')
FRONTEND_FAILED=$(echo "$FRONTEND_TESTS_LINE" | grep -oE '[0-9]+ failed' | head -n 1 | awk '{print $1}')
FRONTEND_TOTAL=$(echo "$FRONTEND_TESTS_LINE" | grep -oE '\([0-9]+\)' | head -n 1 | tr -d '()')
FRONTEND_PASSED=${FRONTEND_PASSED:-0}
FRONTEND_FAILED=${FRONTEND_FAILED:-0}
FRONTEND_TOTAL=${FRONTEND_TOTAL:-0}

if [ "$FRONTEND_EXIT" -eq 0 ]; then
  echo "[FRONTEND][PASS] $FRONTEND_PASSED tests"
else
  echo "[FRONTEND][FAIL] exit=$FRONTEND_EXIT"
fi

# Write per-suite summary files (preserve shape expected by downstream tooling)
cat >"$UNIT_SUMMARY" <<EOF
TOTAL=$FRONTEND_TOTAL
PASSED=$FRONTEND_PASSED
FAILED=$FRONTEND_FAILED
EOF

cat >"$API_SUMMARY" <<EOF
TOTAL=$BACKEND_TOTAL
PASSED=$BACKEND_PASSED
FAILED=$BACKEND_FAILED
EOF

TOTAL=$((BACKEND_TOTAL + FRONTEND_TOTAL))
PASSED=$((BACKEND_PASSED + FRONTEND_PASSED))
FAILED=$((BACKEND_FAILED + FRONTEND_FAILED))

echo ""
echo "===== CONSOLIDATED SUMMARY ====="
echo "TOTAL=$TOTAL"
echo "PASSED=$PASSED"
echo "FAILED=$FAILED"

if [ "$FAILED" -gt 0 ] || [ "$BACKEND_EXIT" -ne 0 ] || [ "$FRONTEND_EXIT" -ne 0 ]; then
  exit 1
fi

exit 0
