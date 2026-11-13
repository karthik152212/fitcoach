# Phase 9.5 Production Deployment Checklist

## Pre-Deployment Requirements

### Supabase Production Project
- [ ] Create production Supabase project
- [ ] Note project URL and anon key
- [ ] Enable pooled connection (PgBouncer) - get pooled connection string

### Database Setup
- [ ] Run migration: `psql "$PROD_DB_URL" -f packages/db/prisma/migrations/20261113000000_add_persistent_infrastructure/migration.sql`
- [ ] Create `fitcoach_app` role with password:
  ```sql
  CREATE ROLE fitcoach_app NOINHERIT LOGIN PASSWORD 'secure_password';
  GRANT fitcoach_app TO postgres; -- or your admin role
  ```
- [ ] Verify grants applied (run verification queries from `scripts/staging-migrate.sh`)

### Environment Variables (Production)
```bash
# Required
NODE_ENV=production
DATABASE_URL="postgresql://fitcoach_app:password@host:6543/postgres?pgbouncer=true"
# OR for pooled connection
DATABASE_URL="postgresql://fitcoach_app:password@host:5432/postgres"

# AI Provider (required - no silent fallback)
AI_PROVIDER=anthropic  # or openai
ANTHROPIC_API_KEY=sk-ant-...  # if anthropic
OPENAI_API_KEY=sk-...         # if openai

# Supabase Auth
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # for admin operations

# Optional
LOG_LEVEL=info
PORT=3000
```

### Application Deployment
- [ ] Build: `npm run build`
- [ ] Deploy to hosting (Vercel, Railway, Fly.io, etc.)
- [ ] Set all environment variables in hosting platform
- [ ] Verify health endpoint: `GET /health` returns `{"status":"healthy"}`

## Post-Deployment Verification

### Run verification scripts
```bash
# Set production URL
PROD_APP_URL="https://your-app.com"

# Test health
curl "$PROD_APP_URL/health"

# Test rate limiting
for i in {1..35}; do curl -H "Authorization: Bearer $TOKEN" "$PROD_APP_URL/api/ai/coach" -X POST -d '{"message":"test"}'; done

# Test idempotency
KEY=$(uuidgen)
curl -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $KEY" "$PROD_APP_URL/api/test" -X POST -d '{"data":"test"}'
curl -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $KEY" "$PROD_APP_URL/api/test" -X POST -d '{"data":"test"}'

# Test token budget
curl -H "Authorization: Bearer $TOKEN" "$PROD_APP_URL/api/ai/coach" -X POST -d '{"message":"test"}' | jq '.usage'
```

### Monitoring
- [ ] Check logs for errors
- [ ] Verify rate limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`
- [ ] Verify idempotency headers work
- [ ] Check token budget consumption in `token_budgets` table

## Rollback Plan
- [ ] Keep previous deployment available
- [ ] Database migration is backward compatible (new tables only)
- [ ] If issues: revert environment variables, redeploy previous version

## Sign-off
- [ ] Engineering lead approval
- [ ] Security review (RLS, grants, no broad permissions)
- [ ] Load test completed
- [ ] Monitoring alerts configured

---

**Status: Code Complete - Awaiting Infrastructure & Approval**