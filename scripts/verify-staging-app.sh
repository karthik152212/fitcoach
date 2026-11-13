#!/usr/bin/env bash
# Verify staging application with production wiring
# Usage: STAGING_DB_URL="postgresql://..." STAGING_APP_URL="https://staging.fitcoach.app" ./scripts/verify-staging-app.sh

set -euo pipefail

if [[ -z "${STAGING_DB_URL:-}" ]]; then
  echo "ERROR: STAGING_DB_URL environment variable not set"
  exit 1
fi

if [[ -z "${STAGING_APP_URL:-}" ]]; then
  echo "ERROR: STAGING_APP_URL environment variable not set"
  exit 1
fi

echo "=== Staging Application Verification ==="
echo "Database: ${STAGING_DB_URL}"
echo "App URL: ${STAGING_APP_URL}"
echo

# Test 1: Health check
echo "--- Test 1: Health Endpoint ---"
curl -sf "${STAGING_APP_URL}/health" | jq '.' || echo "Health endpoint failed"
echo

# Test 2: Rate limiting (should use PostgreSQL)
echo "--- Test 2: Rate Limit (AI endpoint) ---"
for i in {1..5}; do
  response=$(curl -sf -w "\n%{http_code}" -H "Authorization: Bearer $TEST_TOKEN" \
    "${STAGING_APP_URL}/api/ai/coach" -X POST -d '{"message":"test"}' || true)
  echo "$response"
done
echo

# Test 3: Idempotency
echo "--- Test 3: Idempotency Key ---"
KEY=$(uuidgen | tr '[:upper:]' '[:lower:]')
echo "Using key: $KEY"

# First request
curl -sf -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Idempotency-Key: $KEY" \
  "${STAGING_APP_URL}/api/test" -X POST -d '{"data":"first"}' | jq '.'

# Second request with same key - should return cached
curl -sf -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Idempotency-Key: $KEY" \
  "${STAGING_APP_URL}/api/test" -X POST -d '{"data":"first"}' | jq '.'
echo

# Test 4: Token budget
echo "--- Test 4: Token Budget (AI request) ---"
curl -sf -H "Authorization: Bearer $TEST_TOKEN" \
  "${STAGING_APP_URL}/api/ai/coach" -X POST -d '{"message":"test"}' | jq '.usage'
echo

# Test 5: Database connectivity
echo "--- Test 5: Database Connectivity ---"
psql "$STAGING_DB_URL" -c "SELECT 'DB connection OK' AS status;"
echo

echo "✅ Staging application verification complete!"
echo "Check outputs above for expected behavior."