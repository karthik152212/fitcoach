#!/usr/bin/env bash
# Deploy FitCoach's Prisma migration history to the configured Supabase staging database.
set -euo pipefail

: "${STAGING_DB_URL:?Set STAGING_DB_URL to the direct staging database URL}"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

DATABASE_URL="$STAGING_DB_URL" npm run db:migrate:deploy
DATABASE_URL="$STAGING_DB_URL" npm run db:migrate:status
DATABASE_URL="$STAGING_DB_URL" npm exec -- prisma db execute \
  --schema packages/db/prisma/schema.prisma --file packages/db/prisma/verify-baseline.sql
