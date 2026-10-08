-- FitCoach Phase 3 — adaptive training engine: plan-version lifecycle and
-- generation metadata, structured plan decisions, explicit constraint
-- evaluations, and deterministic progression rules.
--
-- Conventions are unchanged from 0001_init / 0002_phase2: snake_case via
-- @map, CHECK enumerations spelled out verbatim in the constraints, UUIDv7
-- application ids, and historical content frozen at write time.
--
-- Historical integrity: no workout, set or completed-session row is touched.
-- Plan-version CONTENT stays frozen exactly as Phase 1 froze it — the only
-- relaxation is that the two lifecycle columns below may now move, which is
-- what "superseded" means; everything else still rejects an update.

-- ---------------------------------------------------------------------------
-- 1. Version lifecycle + generation metadata
-- ---------------------------------------------------------------------------

ALTER TABLE "training_plan_versions"
  ADD COLUMN "lifecycle_status" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "generation_reason" TEXT,
  ADD COLUMN "parent_version_id" UUID,
  ADD COLUMN "superseded_at" TIMESTAMPTZ(6),
  ADD COLUMN "config_version" TEXT;

-- Drop the blanket append-only trigger first: the backfill below has to write
-- the lifecycle state of older versions, and after that only lifecycle columns
-- may move.
DROP TRIGGER IF EXISTS "training_plan_versions_no_update" ON "training_plan_versions";

-- Only the newest version of a plan is active; every older version is already
-- superseded (its content is unchanged — only the lifecycle state moves).
UPDATE "training_plan_versions" v
SET "lifecycle_status" = 'superseded',
    "superseded_at" = v."created_at"
WHERE EXISTS (
  SELECT 1
  FROM "training_plan_versions" newer
  WHERE newer."plan_id" = v."plan_id"
    AND newer."version_number" > v."version_number"
);

ALTER TABLE "training_plan_versions" ADD CONSTRAINT "training_plan_versions_lifecycle_domain"
  CHECK ("lifecycle_status" IN ('active','superseded','retired'));

ALTER TABLE "training_plan_versions" ADD CONSTRAINT "training_plan_versions_generation_reason_domain"
  CHECK ("generation_reason" IS NULL OR "generation_reason" IN (
    'initial_plan','plan_adjustment','exercise_substitution','volume_adjustment',
    'frequency_adjustment','split_adjustment','progression_adjustment','no_change'));

ALTER TABLE "training_plan_versions" ADD CONSTRAINT "training_plan_versions_parent_not_self"
  CHECK ("parent_version_id" IS NULL OR "parent_version_id" <> "id");

ALTER TABLE "training_plan_versions" ADD CONSTRAINT "training_plan_versions_superseded_after_creation"
  CHECK ("superseded_at" IS NULL OR "superseded_at" >= "created_at");

ALTER TABLE "training_plan_versions" ADD CONSTRAINT "training_plan_versions_parent_version_fkey"
  FOREIGN KEY ("parent_version_id") REFERENCES "training_plan_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Exactly one active version per plan (partial index, §14 style).
CREATE UNIQUE INDEX "training_plan_versions_one_active_per_plan"
  ON "training_plan_versions"("plan_id")
  WHERE "lifecycle_status" = 'active';

CREATE INDEX "training_plan_versions_plan_id_lifecycle_status_idx"
  ON "training_plan_versions"("plan_id", "lifecycle_status");

-- Content stays frozen: only the two lifecycle columns may ever change.
CREATE TRIGGER "training_plan_versions_lifecycle_only"
  BEFORE UPDATE ON "training_plan_versions"
  FOR EACH ROW EXECUTE FUNCTION fitcoach_guard_lifecycle_columns(
    'lifecycle_status', 'superseded_at'
  );

-- ---------------------------------------------------------------------------
-- 2. Structured plan decisions (append-only explainability record)
-- ---------------------------------------------------------------------------

CREATE TABLE "training_plan_decisions" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "reason_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "evidence" TEXT NOT NULL,
    "satisfied_constraints" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "violated_constraints" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "affected_muscles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "affected_exercises" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "before_snapshot" JSONB,
    "after_snapshot" JSONB,
    "confidence" DECIMAL(4,3),
    "assumptions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "config_version" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_plan_decisions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "training_plan_decisions" ADD CONSTRAINT "training_plan_decisions_decision_domain"
  CHECK ("decision" IN (
    'no_change','progress_load','progress_reps','adjust_volume','adjust_frequency',
    'replace_exercise','redistribute_exercise','adjust_session','revise_split',
    'modify_progression','reduce_training_stress'));

ALTER TABLE "training_plan_decisions" ADD CONSTRAINT "training_plan_decisions_confidence_range"
  CHECK ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1);

ALTER TABLE "training_plan_decisions" ADD CONSTRAINT "training_plan_decisions_evidence_not_empty"
  CHECK ("evidence" <> '');

ALTER TABLE "training_plan_decisions" ADD CONSTRAINT "training_plan_decisions_version_id_fkey"
  FOREIGN KEY ("version_id") REFERENCES "training_plan_versions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "training_plan_decisions_version_id_idx"
  ON "training_plan_decisions"("version_id", "created_at");

-- Decisions are written once; a changed mind is a new decision row.
CREATE TRIGGER "training_plan_decisions_no_update"
  BEFORE UPDATE ON "training_plan_decisions"
  FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();

-- ---------------------------------------------------------------------------
-- 3. Explicit constraint evaluation per version
-- ---------------------------------------------------------------------------

CREATE TABLE "training_plan_constraints" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "constraint_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_hard" BOOLEAN NOT NULL DEFAULT TRUE,
    "result" TEXT NOT NULL,
    "violation_detail" TEXT,
    "warning_detail" TEXT,

    CONSTRAINT "training_plan_constraints_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "training_plan_constraints" ADD CONSTRAINT "training_plan_constraints_result_domain"
  CHECK ("result" IN ('satisfied','violated','warning'));

ALTER TABLE "training_plan_constraints" ADD CONSTRAINT "training_plan_constraints_key_not_empty"
  CHECK ("constraint_key" <> '' AND "label" <> '');

-- A violated hard constraint must say why.
ALTER TABLE "training_plan_constraints" ADD CONSTRAINT "training_plan_constraints_violation_detail_required"
  CHECK ("result" <> 'violated' OR "violation_detail" IS NOT NULL);

ALTER TABLE "training_plan_constraints" ADD CONSTRAINT "training_plan_constraints_version_id_fkey"
  FOREIGN KEY ("version_id") REFERENCES "training_plan_versions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "training_plan_constraints_version_id_constraint_key_key"
  ON "training_plan_constraints"("version_id", "constraint_key");

CREATE INDEX "training_plan_constraints_version_id_idx"
  ON "training_plan_constraints"("version_id");

-- Constraint results belong to the version they were evaluated for.
CREATE TRIGGER "training_plan_constraints_no_update"
  BEFORE UPDATE ON "training_plan_constraints"
  FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();

-- ---------------------------------------------------------------------------
-- 4. Deterministic progression rules per planned exercise
-- ---------------------------------------------------------------------------

CREATE TABLE "training_plan_progression_rules" (
    "id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "trigger" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "bounds" TEXT NOT NULL,
    "reset_behavior" TEXT,
    "rationale" TEXT NOT NULL,
    "config_version" TEXT,

    CONSTRAINT "training_plan_progression_rules_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "training_plan_progression_rules" ADD CONSTRAINT "training_plan_progression_rules_action_domain"
  CHECK ("action" IN (
    'progress_load','progress_reps','maintain','regress','hold','repeat',
    'modify_target','reduce_stimulus'));

ALTER TABLE "training_plan_progression_rules" ADD CONSTRAINT "training_plan_progression_rules_text_not_empty"
  CHECK ("trigger" <> '' AND "condition" <> '' AND "bounds" <> '' AND "rationale" <> '');

ALTER TABLE "training_plan_progression_rules" ADD CONSTRAINT "training_plan_progression_rules_slot_id_fkey"
  FOREIGN KEY ("slot_id") REFERENCES "training_plan_exercise_slots"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "training_plan_progression_rules_slot_id_key"
  ON "training_plan_progression_rules"("slot_id");

-- Rules are frozen with the plan version that carried them.
CREATE TRIGGER "training_plan_progression_rules_no_update"
  BEFORE UPDATE ON "training_plan_progression_rules"
  FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();
