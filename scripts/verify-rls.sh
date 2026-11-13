#!/usr/bin/env bash
# Verify RLS isolation on Supabase staging
# Usage: STAGING_DB_URL="postgresql://..." ./scripts/verify-rls.sh

set -euo pipefail

if [[ -z "${STAGING_DB_URL:-}" ]]; then
  echo "ERROR: STAGING_DB_URL environment variable not set"
  echo "Usage: STAGING_DB_URL=\"postgresql://user:pass@host:5432/db\" $0"
  exit 1
fi

# Generate test UUIDs
USER_A=$(uuidgen | tr '[:upper:]' '[:lower:]')
USER_B=$(uuidgen | tr '[:upper:]' '[:lower:]')

echo "=== RLS Isolation Verification ==="
echo "User A: $USER_A"
echo "User B: $USER_B"
echo

# Test 1: Idempotency keys isolation
echo "--- Test 1: Idempotency Keys RLS ---"
psql "$STAGING_DB_URL" -v user_a="$USER_A" -v user_b="$USER_B" <<'SQL'
-- Insert as fitcoach_app with user_a context
SET LOCAL "app.current_user_id" = :'user_a';
INSERT INTO idempotency_keys (user_id, key_hash, request_hash, status, response, expires_at)
VALUES (:'user_a', 'hash_a', 'req_hash_a', 'COMPLETED', '{"data":"user_a_data"}'::jsonb, now() + interval '1 day');

SET LOCAL "app.current_user_id" = :'user_b';
INSERT INTO idempotency_keys (user_id, key_hash, request_hash, status, response, expires_at)
VALUES (:'user_b', 'hash_b', 'req_hash_b', 'COMPLETED', '{"data":"user_b_data"}'::jsonb, now() + interval '1 day');

-- Query as user_a - should only see user_a's data
SET LOCAL "app.current_user_id" = :'user_a';
SELECT 'user_a sees:' AS context, count(*) AS rows FROM idempotency_keys;

-- Query as user_b - should only see user_b's data
SET LOCAL "app.current_user_id" = :'user_b';
SELECT 'user_b sees:' AS context, count(*) AS rows FROM idempotency_keys;

-- Cleanup
DELETE FROM idempotency_keys WHERE user_id IN (:'user_a', :'user_b');
SQL

echo
echo "--- Test 2: Token Budgets RLS ---"
psql "$STAGING_DB_URL" -v user_a="$USER_A" -v user_b="$USER_B" <<'SQL'
-- Insert as fitcoach_app with user_a context
SET LOCAL "app.current_user_id" = :'user_a';
INSERT INTO token_budgets (user_id, daily_budget, used_today, day_start)
VALUES (:'user_a', 10000, 500, now());

SET LOCAL "app.current_user_id" = :'user_b';
INSERT INTO token_budgets (user_id, daily_budget, used_today, day_start)
VALUES (:'user_b', 20000, 1500, now());

-- Query as user_a
SET LOCAL "app.current_user_id" = :'user_a';
SELECT 'user_a budget:' AS context, used_today, daily_budget FROM token_budgets;

-- Query as user_b
SET LOCAL "app.current_user_id" = :'user_b';
SELECT 'user_b budget:' AS context, used_today, daily_budget FROM token_budgets;

-- Cleanup
DELETE FROM token_budgets WHERE user_id IN (:'user_a', :'user_b');
SQL

echo
echo "--- Test 3: Token Reservations RLS ---"
psql "$STAGING_DB_URL" -v user_a="$USER_A" -v user_b="$USER_B" <<'SQL'
-- Insert as fitcoach_app with user_a context
SET LOCAL "app.current_user_id" = :'user_a';
INSERT INTO token_reservations (user_id, tokens, status, expires_at)
VALUES (:'user_a', 100, 'ACTIVE', now() + interval '5 minutes');

SET LOCAL "app.current_user_id" = :'user_b';
INSERT INTO token_reservations (user_id, tokens, status, expires_at)
VALUES (:'user_b', 200, 'ACTIVE', now() + interval '5 minutes');

-- Query as user_a
SET LOCAL "app.current_user_id" = :'user_a';
SELECT 'user_a reservations:' AS context, count(*), sum(tokens) FROM token_reservations;

-- Query as user_b
SET LOCAL "app.current_user_id" = :'user_b';
SELECT 'user_b reservations:' AS context, count(*), sum(tokens) FROM token_reservations;

-- Cleanup
DELETE FROM token_reservations WHERE user_id IN (:'user_a', :'user_b');
SQL

echo
echo "--- Test 4: Rate Limit Buckets (NO RLS - shared) ---"
psql "$STAGING_DB_URL" <<'SQL'
-- These should be accessible without RLS context
INSERT INTO rate_limit_buckets (key_prefix, identifier, tokens, window_start)
VALUES ('test', 'identifier_1', 10, now());

SELECT 'rate_limit_buckets:' AS context, count(*) FROM rate_limit_buckets;

DELETE FROM rate_limit_buckets WHERE key_prefix = 'test';
SQL

echo
echo "--- Test 5: Global Token Budget (NO RLS - single row) ---"
psql "$STAGING_DB_URL" <<'SQL'
-- These should be accessible without RLS context
INSERT INTO global_token_budget (id, used_today, day_start)
VALUES ('global', 5000, now())
ON CONFLICT (id) DO UPDATE SET used_today = 5000, day_start = now();

SELECT 'global_token_budget:' AS context, used_today FROM global_token_budget;
SQL

echo
echo "✅ RLS verification complete!"
echo "All user-scoped tables should show isolation."
echo "Shared tables (rate_limit_buckets, global_token_budget) should be accessible without RLS context."