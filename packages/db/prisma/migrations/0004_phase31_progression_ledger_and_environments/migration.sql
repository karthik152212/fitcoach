-- FitCoach Phase 3.1 — training progression ledger + training-continuity
-- (environment adaptation).
--
-- Conventions are unchanged from 0001_init / 0002_phase2 / 0003_phase3:
-- snake_case via @map, CHECK enumerations spelled out verbatim, UUIDv7
-- application ids, immutable history, lifecycle-only updates where a state must
-- be able to move.
--
-- Historical integrity: NO existing row is rewritten. The new columns are
-- nullable, so every workout, set, plan and version recorded before this
-- migration keeps exactly the meaning it had. Completed training is never
-- mutated to make a new progression rule look correct — evaluations and
-- decisions are append-only tables of their own.

-- ---------------------------------------------------------------------------
-- 1. Training environments (interval-versioned, like user_equipment)
-- ---------------------------------------------------------------------------

CREATE TABLE "training_environment_periods" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "available_equipment_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "unavailable_equipment_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "reason" TEXT,
    "is_temporary" BOOLEAN NOT NULL DEFAULT TRUE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_environment_periods_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "training_environment_periods" ADD CONSTRAINT "training_environment_periods_kind_domain"
  CHECK ("kind" IN ('gym','home','home_no_equipment','home_limited_equipment','hotel','travel','outdoor','custom'));

ALTER TABLE "training_environment_periods" ADD CONSTRAINT "training_environment_periods_window"
  CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from");

ALTER TABLE "training_environment_periods" ADD CONSTRAINT "training_environment_periods_reason_not_empty"
  CHECK ("reason" IS NULL OR "reason" <> '');

ALTER TABLE "training_environment_periods" ADD CONSTRAINT "training_environment_periods_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "training_environment_periods_user_id_kind_effective_from_key"
  ON "training_environment_periods"("user_id", "kind", "effective_from");

CREATE INDEX "training_environment_periods_user_id_effective_from_idx"
  ON "training_environment_periods"("user_id", "effective_from" DESC);

-- Closing a period is the only permitted update: the interval is the history.
CREATE TRIGGER "training_environment_periods_lifecycle_only"
  BEFORE UPDATE ON "training_environment_periods"
  FOR EACH ROW EXECUTE FUNCTION fitcoach_guard_lifecycle_columns('effective_to');

-- ---------------------------------------------------------------------------
-- 2. Progression ledger — immutable evaluations
-- ---------------------------------------------------------------------------

CREATE TABLE "progression_evaluations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "exercise_name" TEXT NOT NULL,
    "plan_id" UUID,
    "plan_version_id" UUID,
    "slot_id" UUID,
    "environment_kind" TEXT,
    "outcome" TEXT NOT NULL,
    "current_observation" JSONB NOT NULL,
    "previous_observation" JSONB,
    "performance" JSONB NOT NULL,
    "recommendation" JSONB NOT NULL,
    "evidence" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "fingerprint" TEXT NOT NULL,
    "config_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progression_evaluations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "progression_evaluations" ADD CONSTRAINT "progression_evaluations_outcome_domain"
  CHECK ("outcome" IN (
    'increase_load','increase_reps','maintain','repeat','reduce_load','reduce_target',
    'modify_rep_range','modify_rir_target','change_exercise','no_change','insufficient_data'));

ALTER TABLE "progression_evaluations" ADD CONSTRAINT "progression_evaluations_environment_kind_domain"
  CHECK ("environment_kind" IS NULL OR "environment_kind" IN (
    'gym','home','home_no_equipment','home_limited_equipment','hotel','travel','outdoor','custom'));

ALTER TABLE "progression_evaluations" ADD CONSTRAINT "progression_evaluations_text_not_empty"
  CHECK ("exercise_name" <> '' AND "fingerprint" <> '' AND "config_version" <> '');

ALTER TABLE "progression_evaluations" ADD CONSTRAINT "progression_evaluations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "progression_evaluations" ADD CONSTRAINT "progression_evaluations_exercise_id_fkey"
  FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Idempotency: the same inputs on the same day cannot be evaluated twice.
CREATE UNIQUE INDEX "progression_evaluations_user_id_fingerprint_key"
  ON "progression_evaluations"("user_id", "fingerprint");

CREATE INDEX "progression_evaluations_user_id_created_at_idx"
  ON "progression_evaluations"("user_id", "created_at" DESC);

CREATE INDEX "progression_evaluations_exercise_id_idx"
  ON "progression_evaluations"("exercise_id");

-- Evaluations are written once. A later, differently-informed evaluation is a
-- new row — a recommendation must never be rewritten after the fact.
CREATE TRIGGER "progression_evaluations_no_update"
  BEFORE UPDATE ON "progression_evaluations"
  FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();

-- ---------------------------------------------------------------------------
-- 3. Progression ledger — immutable decision events
-- ---------------------------------------------------------------------------

CREATE TABLE "progression_decision_events" (
    "id" UUID NOT NULL,
    "evaluation_id" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "idempotency_key" TEXT,
    "actual_change" JSONB,
    "resulting_performance" JSONB,
    "evidence" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progression_decision_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "progression_decision_events" ADD CONSTRAINT "progression_decision_events_decision_domain"
  CHECK ("decision" IN ('recommended','accepted','rejected','deferred'));

ALTER TABLE "progression_decision_events" ADD CONSTRAINT "progression_decision_events_evaluation_id_fkey"
  FOREIGN KEY ("evaluation_id") REFERENCES "progression_evaluations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- A retried submission with the same key does not create a second event.
CREATE UNIQUE INDEX "progression_decision_events_evaluation_id_idempotency_key_key"
  ON "progression_decision_events"("evaluation_id", "idempotency_key");

CREATE INDEX "progression_decision_events_evaluation_id_created_at_idx"
  ON "progression_decision_events"("evaluation_id", "created_at");

CREATE TRIGGER "progression_decision_events_no_update"
  BEFORE UPDATE ON "progression_decision_events"
  FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();

-- ---------------------------------------------------------------------------
-- 4. Temporary environment-adapted plans (the gym plan is never replaced)
-- ---------------------------------------------------------------------------

ALTER TABLE "training_plans"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'primary',
  ADD COLUMN "environment_kind" TEXT,
  ADD COLUMN "effective_until" DATE,
  ADD COLUMN "temporary_for_version_id" UUID;

ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_kind_domain"
  CHECK ("kind" IN ('primary','temporary_environment'));

ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_environment_kind_domain"
  CHECK ("environment_kind" IS NULL OR "environment_kind" IN (
    'gym','home','home_no_equipment','home_limited_equipment','hotel','travel','outdoor','custom'));

-- A temporary plan must be bounded and must name where it came from.
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_temporary_is_bounded"
  CHECK ("kind" = 'primary' OR ("effective_until" IS NOT NULL AND "temporary_for_version_id" IS NOT NULL));

ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_temporary_isnt_primary"
  CHECK ("kind" <> 'temporary_environment' OR "environment_kind" IS NOT NULL);

ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_temporary_for_version_id_fkey"
  FOREIGN KEY ("temporary_for_version_id") REFERENCES "training_plan_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "training_plans_user_id_kind_idx" ON "training_plans"("user_id", "kind");

-- "At most one active plan" now means at most one active PRIMARY plan: a
-- temporary environment plan must be able to coexist with the gym plan it was
-- adapted from, otherwise "preserve the original plan" would be impossible.
DROP INDEX "training_plans_one_active_per_user";
CREATE UNIQUE INDEX "training_plans_one_active_primary_per_user"
  ON "training_plans"("user_id") WHERE "status" = 'active' AND "kind" = 'primary';

-- ---------------------------------------------------------------------------
-- 5. Workouts: environment + planned-vs-adapted classification
-- ---------------------------------------------------------------------------

ALTER TABLE "workouts"
  ADD COLUMN "environment_kind" TEXT,
  ADD COLUMN "session_classification" TEXT;

ALTER TABLE "workouts" ADD CONSTRAINT "workouts_environment_kind_domain"
  CHECK ("environment_kind" IS NULL OR "environment_kind" IN (
    'gym','home','home_no_equipment','home_limited_equipment','hotel','travel','outdoor','custom'));

-- `planned` = as prescribed, `adapted` = performed elsewhere (still training),
-- `makeup` = a planned session done later, `unplanned` = extra training.
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_session_classification_domain"
  CHECK ("session_classification" IS NULL OR "session_classification" IN (
    'planned','adapted','makeup','unplanned'));

-- ---------------------------------------------------------------------------
-- 6. Workout exercises: slot linkage + substitution provenance
-- ---------------------------------------------------------------------------

ALTER TABLE "workout_exercises"
  ADD COLUMN "slot_id" UUID,
  ADD COLUMN "substituted_from_exercise_id" UUID,
  ADD COLUMN "performance_source" TEXT,
  ADD COLUMN "substitution_reason" TEXT;

ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_performance_source_domain"
  CHECK ("performance_source" IS NULL OR "performance_source" IN ('manual','imported','inferred'));

ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_slot_id_fkey"
  FOREIGN KEY ("slot_id") REFERENCES "training_plan_exercise_slots"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- A substitution must point somewhere else; it can never claim to replace itself.
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_substitution_origin_fkey"
  FOREIGN KEY ("substituted_from_exercise_id") REFERENCES "exercises"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "workout_exercises_slot_id_idx" ON "workout_exercises"("slot_id");

-- ---------------------------------------------------------------------------
-- 7. Exercise sets: load kind, assistance, set-level idempotency
-- ---------------------------------------------------------------------------

ALTER TABLE "exercise_sets"
  ADD COLUMN "load_kind" TEXT,
  ADD COLUMN "assistance_load_kg" DECIMAL(7,2),
  ADD COLUMN "client_request_id" TEXT;

ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_load_kind_domain"
  CHECK ("load_kind" IS NULL OR "load_kind" IN (
    'external_load','bodyweight','weighted_bodyweight','assisted_bodyweight','band','none'));

ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_assistance_nonneg"
  CHECK ("assistance_load_kg" IS NULL OR "assistance_load_kg" >= 0);

-- A declared bodyweight set must not also carry an external load, and a
-- declared external-load set must say what the load was.
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_load_kind_consistent"
  CHECK (
    ("load_kind" IS NULL)
    OR ("load_kind" = 'external_load' AND "load_kg" IS NOT NULL)
    OR ("load_kind" = 'weighted_bodyweight' AND "added_load_kg" IS NOT NULL)
    OR ("load_kind" = 'assisted_bodyweight' AND "assistance_load_kg" IS NOT NULL)
    OR ("load_kind" IN ('bodyweight','band','none') AND "load_kg" IS NULL AND "added_load_kg" IS NULL)
  );

-- Retries: the same set submission cannot be recorded twice.
CREATE UNIQUE INDEX "exercise_sets_workout_exercise_id_client_request_id_key"
  ON "exercise_sets"("workout_exercise_id", "client_request_id");
