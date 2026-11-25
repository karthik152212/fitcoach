DO $$
DECLARE
  role_name name;
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_roles WHERE rolname = 'fitcoach_app'
      AND rolcanlogin AND NOT rolinherit AND NOT rolbypassrls AND NOT rolsuper
  ) THEN
    RAISE EXCEPTION 'fitcoach_app is missing or has unexpected privileges';
  END IF;

  IF (SELECT count(*) FROM pg_class
      WHERE oid IN ('idempotency_keys'::regclass, 'token_budgets'::regclass,
                    'token_reservations'::regclass) AND relrowsecurity) <> 3 THEN
    RAISE EXCEPTION 'user-scoped infrastructure tables must enforce row security';
  END IF;

  IF NOT has_table_privilege('fitcoach_app', 'idempotency_keys', 'INSERT')
     OR NOT has_table_privilege('fitcoach_app', 'rate_limit_buckets', 'DELETE')
     OR NOT has_table_privilege('fitcoach_app', 'global_token_budget', 'INSERT')
     OR NOT has_table_privilege('fitcoach_app', 'token_budgets', 'UPDATE')
     OR NOT has_table_privilege('fitcoach_app', 'token_reservations', 'UPDATE') THEN
    RAISE EXCEPTION 'fitcoach_app is missing service privileges';
  END IF;

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = role_name) AND EXISTS (
      SELECT FROM unnest(ARRAY['idempotency_keys', 'token_budgets', 'token_reservations',
                               'rate_limit_buckets', 'global_token_budget']) AS t(table_name)
      WHERE has_table_privilege(role_name, table_name, 'SELECT, INSERT, UPDATE, DELETE')
    ) THEN
      RAISE EXCEPTION '% can access service infrastructure', role_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT FROM pg_trigger
    WHERE tgrelid = 'body_measurements'::regclass
      AND tgname = 'body_measurements_require_datum' AND tginitdeferred
  ) OR NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conrelid = 'workouts'::regclass
      AND conname = 'workouts_plan_version_id_fkey' AND condeferred
  ) THEN
    RAISE EXCEPTION 'deferred history guards are missing';
  END IF;

  IF NOT EXISTS (
    SELECT FROM pg_index
    WHERE indexrelid = 'body_measurement_values_site_idx'::regclass
      AND indnatts > indnkeyatts
  ) OR NOT EXISTS (
    SELECT FROM pg_index
    WHERE indexrelid = 'exercise_media_assets_identity_key'::regclass
      AND indisunique AND indnullsnotdistinct
  ) THEN
    RAISE EXCEPTION 'custom covering or null-safe unique index is missing';
  END IF;
END
$$;
