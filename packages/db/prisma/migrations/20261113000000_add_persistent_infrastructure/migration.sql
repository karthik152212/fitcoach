-- Add persistent infrastructure tables for rate limiting, idempotency, and token budgets

-- Idempotency keys for request deduplication
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "key_hash" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "response" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idempotency_key_user_key" ON "idempotency_keys"("user_id", "key_hash");
CREATE INDEX "idempotency_key_expires_at_idx" ON "idempotency_keys"("expires_at");
CREATE INDEX "idempotency_key_status_idx" ON "idempotency_keys"("status");

-- Rate limit buckets for token-bucket algorithm
-- No user_id column - these are shared across instances, not user-specific
-- RLS NOT ENABLED - accessed by service role only
CREATE TABLE "rate_limit_buckets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key_prefix" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "window_start" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rate_limit_bucket_key" ON "rate_limit_buckets"("key_prefix", "identifier");
CREATE INDEX "rate_limit_bucket_window_idx" ON "rate_limit_buckets"("window_start");

-- Per-user daily token budget
CREATE TABLE "token_budgets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "daily_budget" INTEGER NOT NULL DEFAULT 100000,
    "used_today" INTEGER NOT NULL DEFAULT 0,
    "day_start" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "token_budgets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "token_budgets_user_id_key" ON "token_budgets"("user_id");
CREATE INDEX "token_budget_day_start_idx" ON "token_budgets"("day_start");

-- Token reservations with 5-minute lease
CREATE TABLE "token_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "tokens" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "provider_usage" INTEGER,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "token_reservations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "token_reservation_user_status_idx" ON "token_reservations"("user_id", "status");
CREATE INDEX "token_reservation_expires_at_idx" ON "token_reservations"("expires_at");

-- Global daily token budget (single row)
-- RLS NOT ENABLED - accessed by service role only
CREATE TABLE "global_token_budget" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "used_today" INTEGER NOT NULL DEFAULT 0,
    "day_start" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "global_token_budget_pkey" PRIMARY KEY ("id")
);

-- Enable RLS on user-scoped tables only
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "token_budgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "token_reservations" ENABLE ROW LEVEL SECURITY;

-- RLS policies for idempotency_keys (user-scoped)
CREATE POLICY "idempotency_key_own_data" ON "idempotency_keys"
  FOR ALL USING ("user_id" = current_setting('app.current_user_id')::uuid);

-- RLS policies for token_budgets (user-scoped)
CREATE POLICY "token_budget_own_data" ON "token_budgets"
  FOR ALL USING ("user_id" = current_setting('app.current_user_id')::uuid);

-- RLS policies for token_reservations (user-scoped)
CREATE POLICY "token_reservation_own_data" ON "token_reservations"
  FOR ALL USING ("user_id" = current_setting('app.current_user_id')::uuid);

-- NOTE: rate_limit_buckets and global_token_budget have NO RLS
-- They are accessed by the application service role directly

-- Create dedicated application role with least privilege
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fitcoach_app') THEN
        CREATE ROLE fitcoach_app NOINHERIT LOGIN;
    END IF;
END
$$;

-- Grant minimal permissions to application role
GRANT USAGE ON SCHEMA public TO fitcoach_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "idempotency_keys" TO fitcoach_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "token_budgets" TO fitcoach_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "token_reservations" TO fitcoach_app;
GRANT SELECT, INSERT, UPDATE ON "rate_limit_buckets" TO fitcoach_app;
GRANT SELECT, UPDATE ON "global_token_budget" TO fitcoach_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fitcoach_app;

-- Revoke broad grants from end-user roles (security hardening)
-- These roles should NOT have direct table access in production
REVOKE ALL ON "idempotency_keys" FROM anon, authenticated;
REVOKE ALL ON "token_budgets" FROM anon, authenticated;
REVOKE ALL ON "token_reservations" FROM anon, authenticated;
REVOKE ALL ON "rate_limit_buckets" FROM anon, authenticated;
REVOKE ALL ON "global_token_budget" FROM anon, authenticated;

-- Grant only to fitcoach_app role