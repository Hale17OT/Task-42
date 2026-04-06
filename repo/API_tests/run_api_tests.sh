#!/usr/bin/env bash

set +e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUMMARY_FILE="$ROOT_DIR/API_tests/.summary"
API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:${API_PORT:-3000}}"

TOTAL=0
PASSED=0
FAILED=0

COOKIE_JAR_ADMIN="$(mktemp)"
COOKIE_JAR_USER="$(mktemp)"
COOKIE_JAR_SUPPORT="$(mktemp)"
COOKIE_JAR_COACH="$(mktemp)"

cleanup() {
  rm -f "$COOKIE_JAR_ADMIN" "$COOKIE_JAR_USER" "$COOKIE_JAR_SUPPORT" "$COOKIE_JAR_COACH"
}
trap cleanup EXIT

write_summary() {
  cat >"$SUMMARY_FILE" <<EOF
TOTAL=$TOTAL
PASSED=$PASSED
FAILED=$FAILED
EOF
}

fail_fast_unreachable() {
  echo "[API][FAIL] backend_reachability"
  echo "  reason: backend server is not reachable at $API_BASE_URL"
  echo "  hint: start backend before running API tests"
  TOTAL=1
  PASSED=0
  FAILED=1
  write_summary
  exit 1
}

if ! command -v curl >/dev/null 2>&1; then
  echo "[API][FAIL] prerequisites"
  echo "  reason: curl command is required"
  TOTAL=1
  PASSED=0
  FAILED=1
  write_summary
  exit 1
fi

if ! curl -sS -m 5 "$API_BASE_URL/health" >/dev/null 2>&1; then
  fail_fast_unreachable
fi

run_status_test() {
  local name="$1"
  local method="$2"
  local path="$3"
  local expected_status="$4"
  local payload="${5:-}"
  local cookie_jar="${6:-}"

  TOTAL=$((TOTAL + 1))
  local body_file
  body_file="$(mktemp)"

  local curl_args=(-sS -m 10 -o "$body_file" -w "%{http_code}" -X "$method" "$API_BASE_URL$path")

  if [ -n "$cookie_jar" ]; then
    curl_args+=(-b "$cookie_jar")
  fi

  if [ -n "$payload" ]; then
    curl_args+=(-H "Content-Type: application/json" --data "$payload")
  fi

  local status
  status="$(curl "${curl_args[@]}")"
  local curl_exit=$?

  if [ "$curl_exit" -ne 0 ]; then
    FAILED=$((FAILED + 1))
    echo "[API][FAIL] $name"
    echo "  reason: request failed with curl exit code $curl_exit"
    rm -f "$body_file"
    return
  fi

  if [ "$status" = "$expected_status" ]; then
    PASSED=$((PASSED + 1))
    echo "[API][PASS] $name"
  else
    FAILED=$((FAILED + 1))
    echo "[API][FAIL] $name"
    echo "  reason: expected HTTP $expected_status but got $status"
    echo "  log snippet:"
    sed -n '1,10p' "$body_file"
  fi

  rm -f "$body_file"
}

login_as() {
  local username="$1"
  local password="$2"
  local cookie_jar="$3"
  curl -sS -m 10 -c "$cookie_jar" -H "Content-Type: application/json" \
    -d "{\"username\":\"$username\",\"password\":\"$password\"}" \
    "$API_BASE_URL/api/v1/auth/login" >/dev/null 2>&1
}

echo "API TESTS against $API_BASE_URL"

# ===== Health =====
run_status_test "health_endpoint" "GET" "/health" "200"

# ===== Auth =====
run_status_test "auth_register_missing_fields" "POST" "/api/v1/auth/register" "400" '{"username":"ab"}'

# ===== Route not found =====
run_status_test "unknown_route_not_found" "GET" "/api/v1/does-not-exist" "404"

# ===== Follows: 401 unauthenticated =====
run_status_test "follows_mine_requires_auth" "GET" "/api/v1/follows/mine" "401"
run_status_test "follows_post_requires_auth" "POST" "/api/v1/follows/2" "401"
run_status_test "follows_delete_requires_auth" "DELETE" "/api/v1/follows/2" "401"

# ===== Reviews: 401 unauthenticated =====
run_status_test "reviews_mine_requires_auth" "GET" "/api/v1/reviews/mine" "401"
run_status_test "reviews_post_requires_auth" "POST" "/api/v1/reviews" "401" '{"orderId":1,"rating":5,"reviewText":"test"}'
run_status_test "reviews_detail_requires_auth" "GET" "/api/v1/reviews/1" "401"

# ===== Feed: 401 unauthenticated =====
run_status_test "feed_requires_auth" "GET" "/api/v1/feed?limit=1" "401"
run_status_test "feed_preferences_requires_auth" "GET" "/api/v1/feed/preferences" "401"
run_status_test "feed_actions_requires_auth" "POST" "/api/v1/feed/actions" "401" '{"action":"clicked","itemType":"news","similarityKey":"test"}'

# ===== Refunds: 401 unauthenticated =====
run_status_test "refund_requires_auth" "POST" "/api/v1/payments/orders/1/refunds" "401" '{"amountDollars":0.01,"reason":"test","idempotencyKey":"unauth-check"}'

# ===== Admin ingestion: 401 unauthenticated =====
run_status_test "ingestion_sources_requires_auth" "GET" "/api/v1/admin/ingestion/sources" "401"
run_status_test "ingestion_scan_requires_auth" "POST" "/api/v1/admin/ingestion/scan" "401"
run_status_test "ingestion_logs_requires_auth" "GET" "/api/v1/admin/ingestion/logs" "401"

# ===== Admin analytics: 401 unauthenticated =====
run_status_test "analytics_dashboard_requires_auth" "GET" "/api/v1/admin/analytics/dashboard" "401"
run_status_test "analytics_export_logs_requires_auth" "GET" "/api/v1/admin/analytics/export-logs" "401"

# ===== Admin governance: 401 unauthenticated =====
run_status_test "governance_dimensions_requires_auth" "GET" "/api/v1/admin/review-governance/dimensions" "401"
run_status_test "governance_words_requires_auth" "GET" "/api/v1/admin/review-governance/sensitive-words" "401"
run_status_test "governance_blacklist_requires_auth" "GET" "/api/v1/admin/review-governance/blacklist" "401"

# ===== Staff reviews: 401 unauthenticated =====
run_status_test "staff_appeals_requires_auth" "GET" "/api/v1/staff/reviews/appeals" "401"
run_status_test "staff_replies_requires_auth" "POST" "/api/v1/staff/reviews/replies" "401" '{"reviewId":1,"replyText":"test"}'

# ===== Authenticated role-based tests (require running backend with seeded data) =====
login_as "athlete1" "athlete12345" "$COOKIE_JAR_USER"
login_as "admin" "admin12345" "$COOKIE_JAR_ADMIN"
login_as "support1" "support12345" "$COOKIE_JAR_SUPPORT"
login_as "coach1" "coach12345" "$COOKIE_JAR_COACH"

# ===== Refunds: 403 for regular user =====
run_status_test "refund_forbidden_for_user" "POST" "/api/v1/payments/orders/1/refunds" "403" \
  '{"amountDollars":0.01,"reason":"test","idempotencyKey":"user-forbidden-check"}' "$COOKIE_JAR_USER"

# ===== Admin ingestion: 403 for regular user =====
run_status_test "ingestion_sources_forbidden_for_user" "GET" "/api/v1/admin/ingestion/sources" "403" "" "$COOKIE_JAR_USER"
run_status_test "ingestion_sources_forbidden_for_coach" "GET" "/api/v1/admin/ingestion/sources" "403" "" "$COOKIE_JAR_COACH"
run_status_test "ingestion_sources_forbidden_for_support" "GET" "/api/v1/admin/ingestion/sources" "403" "" "$COOKIE_JAR_SUPPORT"

# ===== Admin analytics: 403 for regular user / coach =====
run_status_test "analytics_dashboard_forbidden_for_user" "GET" "/api/v1/admin/analytics/dashboard" "403" "" "$COOKIE_JAR_USER"
run_status_test "analytics_dashboard_forbidden_for_coach" "GET" "/api/v1/admin/analytics/dashboard" "403" "" "$COOKIE_JAR_COACH"

# ===== Admin governance: 403 for non-admin =====
run_status_test "governance_dimensions_forbidden_for_user" "GET" "/api/v1/admin/review-governance/dimensions" "403" "" "$COOKIE_JAR_USER"
run_status_test "governance_dimensions_forbidden_for_support" "GET" "/api/v1/admin/review-governance/dimensions" "403" "" "$COOKIE_JAR_SUPPORT"

# ===== Staff reviews: 403 for regular user =====
run_status_test "staff_appeals_forbidden_for_user" "GET" "/api/v1/staff/reviews/appeals" "403" "" "$COOKIE_JAR_USER"

# ===== Follows: 400 invalid param =====
run_status_test "follows_post_invalid_param" "POST" "/api/v1/follows/notanumber" "400" "" "$COOKIE_JAR_USER"

# ===== Reviews: 400 validation error =====
run_status_test "reviews_post_missing_fields" "POST" "/api/v1/reviews" "400" '{"rating":5}' "$COOKIE_JAR_USER"

# ===== Staff reviews: 400 validation (missing reply text) =====
run_status_test "staff_replies_missing_fields" "POST" "/api/v1/staff/reviews/replies" "400" '{"reviewId":1}' "$COOKIE_JAR_COACH"

echo ""
echo "API TEST SUMMARY"
echo "TOTAL=$TOTAL"
echo "PASSED=$PASSED"
echo "FAILED=$FAILED"

write_summary

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi

exit 0
