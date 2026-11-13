#!/usr/bin/env bash
# Apply Phase 9.5 migration to Supabase staging
# Usage: STAGING_DB_URL="postgresql://..." ./scripts/staging-migrate.sh

set -euo pipefail

MIGRATION_FILE="packages/db/prisma/migrations/20261113000000_add_persistent_infrastructure/migration.sql"

if [[ -z "${STAGING_DB_URL:-}" ]]; then
  echo "ERROR: STAGING_DB_URL environment variable not set"
  echo "Usage: STAGING_DB_URL=\"postgresql://user:pass@host:5432/db\" $0"
  exit 1
fi

if [[ ! -f "$MIGRATION_FILE" ]]; then
  echo "ERROR: Migration file not found: $MIGRATION_FILE"
  exit 1
fi

echo "=== Applying Phase 9.5 migration to Supabase staging ==="
echo "Database: ${STAGING_DB_URL}"
echo "Migration: $MIGRATION_FILE"
echo

psql "$STAGING_DB_URL" -f "$MIGRATION_FILE"

echo
echo "=== Migration applied. Verifying tables and grants ==="
psql "$STAGING_DB_URL" -c "
  \dt idempotency_keys token_budgets token_reservations rate_limit_buckets global_token_budget
"

echo
echo "=== Verifying RLS policies ==="
psql "$STAGING_DB_URL" -c "
  SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
  FROM pg_policies
  WHERE tablename IN ('idempotency_keys', 'token_budgets', 'token_reservations')
  ORDER BY tablename, policyname;
"

echo
echo "=== Verifying fitcoach_app role grants ==="
psql "$STAGING_DB_URL" -c "
  SELECT grantee, table_name, privilege_type
  FROM information_schema.table_privileges
  WHERE table_name IN ('idempotency_keys', 'token_budgets', 'token_reservations', 'rate_limit_buckets', 'global_token_budget')
    AND grantee = 'fitcoach_app'
  ORDER BY table_name, privilege_type;
"

echo
echo "=== Verifying REVOKE from anon/authenticated ==="
psql "$STAGING_DB_URL" -c "
  SELECT grantee, table_name, privilege_type
  FROM information_schema.table_privileges
  WHERE table_name IN ('idempotency_keys', 'token_budgets', 'token_reservations', 'rate_limit_buckets', 'global_token_budget')
    AND grantee IN ('anon', 'authenticated')
  ORDER BY table_name, grantee;
"

echo
echo "✅ Staging migration complete!"