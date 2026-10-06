-- FitCoach Phase 2 — fitness knowledge engine: muscle structures, movement
-- functions, exercise roles/characteristics, head-level targeting, structured
-- form guidance, instructional-media metadata, substitution edges and user
-- exercise preferences.
--
-- Conventions are unchanged from 0001_init: snake_case via @map, CHECK
-- enumerations spelled out verbatim in the column comments, reference data
-- retired (is_active) rather than deleted, append-only content tables
-- trigger-enforced, and nothing here rewrites a historical row.
--
-- Historical integrity: no existing workout/plan/set row is touched. The
-- ALTERs below only widen Phase 1 columns, and every new table either hangs off
-- the exercise identity (which is stable) or carries its own validity interval.

-- ---------------------------------------------------------------------------
-- 1. Exercise variation identity and characteristics
-- ---------------------------------------------------------------------------

ALTER TABLE "exercises"
  ADD COLUMN "variation_key" TEXT,
  ADD COLUMN "variation_label" TEXT,
  ADD COLUMN "stability_demand" TEXT,
  ADD COLUMN "loading_characteristic" TEXT,
  ADD COLUMN "range_of_motion_characteristic" TEXT,
  ADD COLUMN "knowledge_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "exercises" ADD CONSTRAINT "exercises_stability_demand_domain"
  CHECK ("stability_demand" IS NULL OR "stability_demand" IN ('high','moderate','low'));

ALTER TABLE "exercises" ADD CONSTRAINT "exercises_loading_characteristic_domain"
  CHECK ("loading_characteristic" IS NULL OR "loading_characteristic" IN (
    'free_weight_multi_joint','free_weight_single_joint','machine_guided',
    'cable_variable','cable_fixed','bodyweight_external_load','bodyweight_only',
    'elastic_tension'));

ALTER TABLE "exercises" ADD CONSTRAINT "exercises_range_of_motion_characteristic_domain"
  CHECK ("range_of_motion_characteristic" IS NULL OR "range_of_motion_characteristic" IN (
    'full_stretch_to_squeeze','stretch_emphasised','shortened_emphasised','partial_rom'));

ALTER TABLE "exercises" ADD CONSTRAINT "exercises_knowledge_version_positive"
  CHECK ("knowledge_version" >= 1);

-- Exercise identity is stable across renames; the variation key is what form
-- guidance and media attach to, so it must be unique when present.
CREATE UNIQUE INDEX "exercises_variation_key_key" ON "exercises"("variation_key")
  WHERE "variation_key" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Per-user equipment usability state (Phase 2 §16: "the machine is busy")
-- ---------------------------------------------------------------------------

ALTER TABLE "user_equipment" ADD COLUMN "availability" TEXT NOT NULL DEFAULT 'available';

ALTER TABLE "user_equipment" ADD CONSTRAINT "user_equipment_availability_domain"
  CHECK ("availability" IN ('available','temporarily_unavailable','unavailable'));

-- ---------------------------------------------------------------------------
-- 3. Richer whole-muscle targeting: emphasis, confidence, notes, provenance
-- ---------------------------------------------------------------------------

ALTER TABLE "exercise_muscle_relations"
  ADD COLUMN "emphasis" TEXT,
  ADD COLUMN "confidence" DECIMAL(4,3),
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "external_source_id" UUID;

-- `supporting` joins the original three roles (Phase 2 §2). Existing values keep
-- their exact meaning; nothing is renamed or reinterpreted.
ALTER TABLE "exercise_muscle_relations" DROP CONSTRAINT "exercise_muscle_relations_role_domain";
ALTER TABLE "exercise_muscle_relations" ADD CONSTRAINT "exercise_muscle_relations_role_domain"
  CHECK ("role" IN ('primary_mover','secondary_mover','supporting','stabilizer'));

ALTER TABLE "exercise_muscle_relations" ADD CONSTRAINT "exercise_muscle_relations_confidence_range"
  CHECK ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1);

ALTER TABLE "exercise_muscle_relations" ADD CONSTRAINT "exercise_muscle_relations_emphasis_domain"
  CHECK ("emphasis" IS NULL OR "emphasis" IN (
    'lengthened_position','shortened_position','structure_biased',
    'upper_range_bias','lower_range_bias','eccentric_emphasis'));

CREATE INDEX "exercise_muscle_relations_external_source_id_idx"
  ON "exercise_muscle_relations"("external_source_id");

ALTER TABLE "exercise_muscle_relations"
  ADD CONSTRAINT "exercise_muscle_relations_external_source_id_fkey"
  FOREIGN KEY ("external_source_id") REFERENCES "external_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. Muscle taxonomy: heads / regions / portions
-- ---------------------------------------------------------------------------

CREATE TABLE "muscle_structures" (
    "id" UUID NOT NULL,
    "muscle_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "display_name" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "muscle_structures_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "muscle_structures" ADD CONSTRAINT "muscle_structures_kind_domain"
  CHECK ("kind" IN ('head','region','portion'));

CREATE UNIQUE INDEX "muscle_structures_muscle_id_slug_key" ON "muscle_structures"("muscle_id","slug");
CREATE INDEX "muscle_structures_muscle_id_idx" ON "muscle_structures"("muscle_id");

ALTER TABLE "muscle_structures" ADD CONSTRAINT "muscle_structures_muscle_id_fkey"
  FOREIGN KEY ("muscle_id") REFERENCES "muscles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5. Head/region-specific targeting ("long-head-biased contribution")
-- ---------------------------------------------------------------------------

CREATE TABLE "exercise_muscle_structure_relations" (
    "exercise_id" UUID NOT NULL,
    "muscle_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "emphasis" TEXT,
    "contribution_weight" DECIMAL(4,3),
    "confidence" DECIMAL(4,3),
    "notes" TEXT,
    "external_source_id" UUID,

    CONSTRAINT "exercise_muscle_structure_relations_pkey" PRIMARY KEY ("exercise_id","muscle_id","structure_id","role")
);

ALTER TABLE "exercise_muscle_structure_relations"
  ADD CONSTRAINT "exercise_muscle_structure_relations_role_domain"
  CHECK ("role" IN ('primary_mover','secondary_mover','supporting','stabilizer'));

ALTER TABLE "exercise_muscle_structure_relations"
  ADD CONSTRAINT "exercise_muscle_structure_relations_emphasis_domain"
  CHECK ("emphasis" IS NULL OR "emphasis" IN (
    'lengthened_position','shortened_position','structure_biased',
    'upper_range_bias','lower_range_bias','eccentric_emphasis'));

ALTER TABLE "exercise_muscle_structure_relations"
  ADD CONSTRAINT "exercise_muscle_structure_relations_weight_range"
  CHECK ("contribution_weight" IS NULL OR "contribution_weight" BETWEEN 0 AND 1);

ALTER TABLE "exercise_muscle_structure_relations"
  ADD CONSTRAINT "exercise_muscle_structure_relations_confidence_range"
  CHECK ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1);

CREATE INDEX "exercise_muscle_structure_relations_muscle_id_idx"
  ON "exercise_muscle_structure_relations"("muscle_id");
CREATE INDEX "exercise_muscle_structure_relations_structure_id_idx"
  ON "exercise_muscle_structure_relations"("structure_id");
CREATE INDEX "exercise_muscle_structure_relations_external_source_id_idx"
  ON "exercise_muscle_structure_relations"("external_source_id");

ALTER TABLE "exercise_muscle_structure_relations" ADD CONSTRAINT "exercise_muscle_structure_relations_exercise_id_fkey"
  FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exercise_muscle_structure_relations" ADD CONSTRAINT "exercise_muscle_structure_relations_muscle_id_fkey"
  FOREIGN KEY ("muscle_id") REFERENCES "muscles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exercise_muscle_structure_relations" ADD CONSTRAINT "exercise_muscle_structure_relations_structure_id_fkey"
  FOREIGN KEY ("structure_id") REFERENCES "muscle_structures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exercise_muscle_structure_relations" ADD CONSTRAINT "exercise_muscle_structure_relations_external_source_id_fkey"
  FOREIGN KEY ("external_source_id") REFERENCES "external_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 6. Movement/function taxonomy (multi-valued, finer than movement_pattern)
-- ---------------------------------------------------------------------------

CREATE TABLE "movement_functions" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movement_functions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "movement_functions_slug_key" ON "movement_functions"("slug");
CREATE INDEX "movement_functions_region_idx" ON "movement_functions"("region");

CREATE TABLE "exercise_movement_functions" (
    "exercise_id" UUID NOT NULL,
    "function_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "exercise_movement_functions_pkey" PRIMARY KEY ("exercise_id","function_id")
);

CREATE INDEX "exercise_movement_functions_function_id_idx" ON "exercise_movement_functions"("function_id");

ALTER TABLE "exercise_movement_functions" ADD CONSTRAINT "exercise_movement_functions_exercise_id_fkey"
  FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exercise_movement_functions" ADD CONSTRAINT "exercise_movement_functions_function_id_fkey"
  FOREIGN KEY ("function_id") REFERENCES "movement_functions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 7. Exercise purpose/role
-- ---------------------------------------------------------------------------

CREATE TABLE "exercise_roles" (
    "exercise_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "position" SMALLINT NOT NULL,

    CONSTRAINT "exercise_roles_pkey" PRIMARY KEY ("exercise_id","role"),
    CONSTRAINT "exercise_roles_position_positive" CHECK ("position" >= 0)
);

CREATE UNIQUE INDEX "exercise_roles_exercise_id_position_key" ON "exercise_roles"("exercise_id","position");

ALTER TABLE "exercise_roles" ADD CONSTRAINT "exercise_roles_role_domain" CHECK ("role" IN (
  'compound_movement','isolation_movement','primary_strength_movement','hypertrophy_movement',
  'lengthened_position_emphasis','shortened_position_emphasis',
  'horizontal_push','horizontal_pull','vertical_push','vertical_pull',
  'upper_chest_press','lower_chest_press','lateral_delt_isolation','front_delt_press',
  'upper_back_retraction','lower_trap_emphasis','upper_trap_emphasis','lat_emphasis_pull',
  'hamstring_knee_flexion','knee_extension_movement','hip_extension_movement',
  'hip_abduction_movement','calf_raising','core_anti_extension','core_rotation',
  'accessory_movement'));

ALTER TABLE "exercise_roles" ADD CONSTRAINT "exercise_roles_exercise_id_fkey"
  FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 8. Structured, versioned, variation-specific form guidance
-- ---------------------------------------------------------------------------

CREATE TABLE "exercise_form_versions" (
    "id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "version" SMALLINT NOT NULL,
    "status" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "retired_on" DATE,
    "review_notes" TEXT,
    "external_source_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercise_form_versions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "exercise_form_versions" ADD CONSTRAINT "exercise_form_versions_version_positive"
  CHECK ("version" >= 1);
ALTER TABLE "exercise_form_versions" ADD CONSTRAINT "exercise_form_versions_status_domain"
  CHECK ("status" IN ('draft','active','retired'));
ALTER TABLE "exercise_form_versions" ADD CONSTRAINT "exercise_form_versions_retirement_window"
  CHECK ("retired_on" IS NULL OR "retired_on" >= "effective_from");

CREATE UNIQUE INDEX "exercise_form_versions_exercise_id_version_key"
  ON "exercise_form_versions"("exercise_id","version");
-- At most one active published version per exercise.
CREATE UNIQUE INDEX "exercise_form_versions_one_active_per_exercise"
  ON "exercise_form_versions"("exercise_id") WHERE "status" = 'active';
CREATE INDEX "exercise_form_versions_external_source_id_idx"
  ON "exercise_form_versions"("external_source_id");

ALTER TABLE "exercise_form_versions" ADD CONSTRAINT "exercise_form_versions_exercise_id_fkey"
  FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exercise_form_versions" ADD CONSTRAINT "exercise_form_versions_external_source_id_fkey"
  FOREIGN KEY ("external_source_id") REFERENCES "external_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "exercise_form_steps" (
    "id" UUID NOT NULL,
    "form_version_id" UUID NOT NULL,
    "step_key" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "position" SMALLINT NOT NULL,

    CONSTRAINT "exercise_form_steps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "exercise_form_steps_position_positive" CHECK ("position" >= 0)
);

ALTER TABLE "exercise_form_steps" ADD CONSTRAINT "exercise_form_steps_step_key_domain" CHECK ("step_key" IN (
  'setup','body_position','grip','start_position','movement_path','joint_path',
  'range_of_motion','tempo_and_control','breathing','bracing','end_position',
  'common_mistakes','coaching_cues','intended_target','safety_notes'));

CREATE UNIQUE INDEX "exercise_form_steps_form_version_id_step_key_key"
  ON "exercise_form_steps"("form_version_id","step_key");
CREATE UNIQUE INDEX "exercise_form_steps_form_version_id_position_key"
  ON "exercise_form_steps"("form_version_id","position");
CREATE INDEX "exercise_form_steps_step_key_idx" ON "exercise_form_steps"("step_key");

ALTER TABLE "exercise_form_steps" ADD CONSTRAINT "exercise_form_steps_form_version_id_fkey"
  FOREIGN KEY ("form_version_id") REFERENCES "exercise_form_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 9. Instructional media: metadata + provenance + versioning (no binaries)
-- ---------------------------------------------------------------------------

CREATE TABLE "exercise_media_assets" (
    "id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "media_type" TEXT NOT NULL,
    "angle" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "duration_seconds" INTEGER,
    "width_px" INTEGER,
    "height_px" INTEGER,
    "content_version" SMALLINT NOT NULL,
    "status" TEXT NOT NULL,
    "overlays" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "external_source_id" UUID,
    "license_spdx" TEXT,
    "attribution_required" BOOLEAN NOT NULL DEFAULT false,
    "attribution_text" TEXT,
    "imported_version" TEXT,
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercise_media_assets_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "exercise_media_assets" ADD CONSTRAINT "exercise_media_assets_media_type_domain"
  CHECK ("media_type" IN ('instructional_video','still_image','animation','anatomical_illustration','form_overlay'));
ALTER TABLE "exercise_media_assets" ADD CONSTRAINT "exercise_media_assets_angle_domain"
  CHECK ("angle" IN ('primary','front','side','rear','grip_close_up','movement_path'));
ALTER TABLE "exercise_media_assets" ADD CONSTRAINT "exercise_media_assets_status_domain"
  CHECK ("status" IN ('active','retired'));
ALTER TABLE "exercise_media_assets" ADD CONSTRAINT "exercise_media_assets_content_version_positive"
  CHECK ("content_version" >= 1);
ALTER TABLE "exercise_media_assets" ADD CONSTRAINT "exercise_media_assets_duration_positive"
  CHECK ("duration_seconds" IS NULL OR "duration_seconds" > 0);
ALTER TABLE "exercise_media_assets" ADD CONSTRAINT "exercise_media_assets_video_has_duration"
  CHECK ("media_type" <> 'instructional_video' OR "duration_seconds" IS NOT NULL);
-- Provenance and licence stay inseparable from the asset row (§34).
ALTER TABLE "exercise_media_assets" ADD CONSTRAINT "exercise_media_assets_license_when_external"
  CHECK ("external_source_id" IS NULL OR "license_spdx" IS NOT NULL);
-- Every element must be one of the allowed overlay kinds ("<@" = contained in).
ALTER TABLE "exercise_media_assets" ADD CONSTRAINT "exercise_media_assets_overlays_domain"
  CHECK (overlays <@ ARRAY[
    'target_muscle_highlight','movement_arrow','movement_path','joint_path',
    'grip_marker','setup_marker','rom_indicator']);

CREATE UNIQUE INDEX "exercise_media_assets_exercise_id_media_type_angle_content_version_key"
  ON "exercise_media_assets"("exercise_id","media_type","angle","content_version");
CREATE INDEX "exercise_media_assets_exercise_id_status_idx"
  ON "exercise_media_assets"("exercise_id","status");
CREATE INDEX "exercise_media_assets_external_source_id_idx"
  ON "exercise_media_assets"("external_source_id");

ALTER TABLE "exercise_media_assets" ADD CONSTRAINT "exercise_media_assets_exercise_id_fkey"
  FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exercise_media_assets" ADD CONSTRAINT "exercise_media_assets_external_source_id_fkey"
  FOREIGN KEY ("external_source_id") REFERENCES "external_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 10. Curated substitution edges (layered above deterministic derivation)
-- ---------------------------------------------------------------------------

CREATE TABLE "exercise_substitutions" (
    "id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "substitute_exercise_id" UUID NOT NULL,
    "trigger" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "rank_hint" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercise_substitutions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "exercise_substitutions_rank_hint_range" CHECK ("rank_hint" >= 0),
    CONSTRAINT "exercise_substitutions_not_self" CHECK ("exercise_id" <> "substitute_exercise_id")
);

ALTER TABLE "exercise_substitutions" ADD CONSTRAINT "exercise_substitutions_trigger_domain"
  CHECK ("trigger" IN ('default','machine_busy','equipment_missing','disliked'));

CREATE UNIQUE INDEX "exercise_substitutions_exercise_id_substitute_exercise_id_trigger_key"
  ON "exercise_substitutions"("exercise_id","substitute_exercise_id","trigger");
CREATE INDEX "exercise_substitutions_substitute_exercise_id_idx"
  ON "exercise_substitutions"("substitute_exercise_id");

ALTER TABLE "exercise_substitutions" ADD CONSTRAINT "exercise_substitutions_exercise_id_fkey"
  FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exercise_substitutions" ADD CONSTRAINT "exercise_substitutions_substitute_exercise_id_fkey"
  FOREIGN KEY ("substitute_exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 11. User exercise preferences as a validity interval
-- ---------------------------------------------------------------------------

CREATE TABLE "user_exercise_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "preference" TEXT NOT NULL,
    "reason" TEXT,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_exercise_preferences_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "user_exercise_preferences" ADD CONSTRAINT "user_exercise_preferences_preference_domain"
  CHECK ("preference" IN ('preferred','neutral','disliked','excluded'));
ALTER TABLE "user_exercise_preferences" ADD CONSTRAINT "user_exercise_preferences_validity_window"
  CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from");

CREATE UNIQUE INDEX "user_exercise_preferences_user_id_exercise_id_valid_from_key"
  ON "user_exercise_preferences"("user_id","exercise_id","valid_from");
-- At most one open preference per (user, exercise).
CREATE UNIQUE INDEX "user_exercise_preferences_one_open_per_exercise"
  ON "user_exercise_preferences"("user_id","exercise_id") WHERE "valid_to" IS NULL;
CREATE INDEX "user_exercise_preferences_user_id_valid_from_idx"
  ON "user_exercise_preferences"("user_id","valid_from" DESC);
CREATE INDEX "user_exercise_preferences_exercise_id_idx"
  ON "user_exercise_preferences"("exercise_id");

ALTER TABLE "user_exercise_preferences" ADD CONSTRAINT "user_exercise_preferences_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_exercise_preferences" ADD CONSTRAINT "user_exercise_preferences_exercise_id_fkey"
  FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 12. Lifecycle triggers
-- ---------------------------------------------------------------------------

-- Form steps are immutable content: improving guidance means a new version.
CREATE TRIGGER "exercise_form_steps_no_update" BEFORE UPDATE ON "exercise_form_steps"
  FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();

-- Form versions are append-only apart from their lifecycle columns.
CREATE TRIGGER "exercise_form_versions_lifecycle_only" BEFORE UPDATE ON "exercise_form_versions"
  FOR EACH ROW EXECUTE FUNCTION fitcoach_guard_lifecycle_columns('status', 'retired_on');
