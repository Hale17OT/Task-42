#!/usr/bin/env bash
# Thin Docker-based API integration test wrapper. No local installs, no host DB.
set +e
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUMMARY_FILE="$ROOT_DIR/API_tests/.summary"
LOG_DIR="$ROOT_DIR/API_tests/logs"
mkdir -p "$LOG_DIR"

COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
PROJECT="trailforge-api"

cleanup() {
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --profile test down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

LOG_FILE="$LOG_DIR/integration.log"
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --profile test up --build --abort-on-container-exit --exit-code-from backend-tests backend-tests >"$LOG_FILE" 2>&1
EXIT=$?

SUMMARY=$(sed -E $'s/\x1b\\[[0-9;]*m//g; s/^[^|]*\\| //' "$LOG_FILE")
TESTS_LINE=$(echo "$SUMMARY" | grep -E "^[[:space:]]*Tests[[:space:]]" | tail -n 1)
PASSED=$(echo "$TESTS_LINE" | grep -oE '[0-9]+ passed' | head -n 1 | awk '{print $1}')
FAILED=$(echo "$TESTS_LINE" | grep -oE '[0-9]+ failed' | head -n 1 | awk '{print $1}')
TOTAL=$(echo "$TESTS_LINE" | grep -oE '\([0-9]+\)' | head -n 1 | tr -d '()')

TOTAL=${TOTAL:-0}
PASSED=${PASSED:-0}
FAILED=${FAILED:-0}

echo "API TEST SUMMARY"
echo "TOTAL=$TOTAL"
echo "PASSED=$PASSED"
echo "FAILED=$FAILED"

cat >"$SUMMARY_FILE" <<EOF
TOTAL=$TOTAL
PASSED=$PASSED
FAILED=$FAILED
EOF

[ "$EXIT" -eq 0 ] || exit 1
exit 0
