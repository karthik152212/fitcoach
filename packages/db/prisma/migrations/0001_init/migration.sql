-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "display_name" TEXT,
    "external_auth_id" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "user_id" UUID NOT NULL,
    "birth_date" DATE,
    "sex" TEXT,
    "height_cm" DECIMAL(5,1),
    "training_experience" TEXT,
    "training_days_per_week" SMALLINT,
    "session_duration_minutes" SMALLINT,
    "limitations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unit_system" TEXT NOT NULL DEFAULT 'metric',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "profile_revisions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "birth_date" DATE,
    "sex" TEXT,
    "height_cm" DECIMAL(5,1),
    "training_experience" TEXT,
    "training_days_per_week" SMALLINT,
    "session_duration_minutes" SMALLINT,
    "limitations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "changed_fields" TEXT[],
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "superseded_by_goal_id" UUID,
    "kind" TEXT NOT NULL,
    "description" TEXT,
    "effective_from" DATE NOT NULL,
    "effective_until" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "physique_targets" (
    "id" UUID NOT NULL,
    "goal_id" UUID NOT NULL,
    "body_weight_kg" DECIMAL(6,2),
    "body_fat_percent" DECIMAL(4,1),
    "waist_cm" DECIMAL(6,1),
    "chest_cm" DECIMAL(6,1),
    "shoulder_circumference_cm" DECIMAL(6,1),
    "arm_cm" DECIMAL(6,1),
    "thigh_cm" DECIMAL(6,1),
    "calf_cm" DECIMAL(6,1),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "physique_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_priorities" (
    "id" UUID NOT NULL,
    "goal_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "tag" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_priorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_equipment" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "label" TEXT,
    "specifications" JSONB,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_sources" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "origin_url" TEXT,
    "license_spdx" TEXT,
    "license_verified" BOOLEAN NOT NULL DEFAULT false,
    "registry_ref" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "muscles" (
    "id" UUID NOT NULL,
    "external_source_id" UUID,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "display_name" TEXT,
    "external_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "muscles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercises" (
    "id" UUID NOT NULL,
    "external_source_id" UUID,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" TEXT NOT NULL,
    "movement_pattern" TEXT,
    "unilateral" BOOLEAN NOT NULL DEFAULT false,
    "instructions" TEXT,
    "external_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_required_equipment" (
    "exercise_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,

    CONSTRAINT "exercise_required_equipment_pkey" PRIMARY KEY ("exercise_id","equipment_id")
);

-- CreateTable
CREATE TABLE "exercise_muscle_relations" (
    "exercise_id" UUID NOT NULL,
    "muscle_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "contribution_weight" DECIMAL(4,3),

    CONSTRAINT "exercise_muscle_relations_pkey" PRIMARY KEY ("exercise_id","muscle_id","role")
);

-- CreateTable
CREATE TABLE "training_plans" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_plan_versions" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "rationale_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_plan_sessions" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "weekday_hint" SMALLINT,
    "position" SMALLINT NOT NULL,

    CONSTRAINT "training_plan_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_plan_exercise_slots" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "target_sets" SMALLINT,
    "rep_min" SMALLINT,
    "rep_max" SMALLINT,
    "target_rir" DECIMAL(3,1),
    "rest_seconds" INTEGER,
    "position" SMALLINT NOT NULL,
    "substitution_exercise_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "notes" TEXT,

    CONSTRAINT "training_plan_exercise_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workouts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "plan_id" UUID,
    "plan_version_id" UUID,
    "plan_session_id" UUID,
    "title" TEXT,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "client_request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_exercises" (
    "id" UUID NOT NULL,
    "workout_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_sets" (
    "id" UUID NOT NULL,
    "workout_exercise_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "load_kg" DECIMAL(7,2),
    "added_load_kg" DECIMAL(7,2),
    "reps" SMALLINT,
    "distance_meters" DECIMAL(8,2),
    "duration_seconds" INTEGER,
    "rir" DECIMAL(3,1),
    "rpe" DECIMAL(3,1),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercise_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "body_measurements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,
    "condition" TEXT,
    "body_weight_kg" DECIMAL(6,2),
    "body_fat_percent" DECIMAL(4,1),
    "entered_via" TEXT,
    "confidence" TEXT,
    "source_name" TEXT,
    "external_id" TEXT,
    "photo_refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "body_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "body_measurement_values" (
    "measurement_id" UUID NOT NULL,
    "site" TEXT NOT NULL,
    "value_cm" DECIMAL(6,1) NOT NULL,

    CONSTRAINT "body_measurement_values_pkey" PRIMARY KEY ("measurement_id","site")
);

-- CreateTable
CREATE TABLE "activity_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "steps" INTEGER,
    "duration_minutes" INTEGER,
    "distance_km" DECIMAL(7,3),
    "average_heart_rate_bpm" SMALLINT,
    "estimated_calories_burned" DECIMAL(7,2),
    "effort" TEXT,
    "recorded_via" TEXT,
    "external_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_sources" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID,
    "external_source_id" UUID,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "default_confidence" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "foods" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "default_serving_id" UUID,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "density_basis" TEXT NOT NULL,
    "calories_kcal" DECIMAL(9,2) NOT NULL,
    "protein_g" DECIMAL(8,3) NOT NULL,
    "carbohydrate_g" DECIMAL(8,3) NOT NULL,
    "fat_g" DECIMAL(8,3) NOT NULL,
    "fiber_g" DECIMAL(8,3),
    "sugars_g" DECIMAL(8,3),
    "saturated_fat_g" DECIMAL(8,3),
    "alcohol_g" DECIMAL(8,3),
    "sodium_mg" DECIMAL(9,3),
    "barcode" TEXT,
    "external_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "foods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_servings" (
    "id" UUID NOT NULL,
    "food_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "grams" DECIMAL(8,2),
    "milliliters" DECIMAL(8,2),
    "unit_quantity" DECIMAL(8,2),
    "unit_name" TEXT,

    CONSTRAINT "food_servings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID,
    "name" TEXT NOT NULL,
    "servings" INTEGER NOT NULL,
    "instructions" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_items" (
    "id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "food_id" UUID NOT NULL,
    "quantity_grams" DECIMAL(9,2) NOT NULL,
    "position" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "recipe_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "local_date" DATE NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "slot" TEXT,
    "total_calories_kcal" DECIMAL(10,2) NOT NULL,
    "total_protein_g" DECIMAL(9,3) NOT NULL,
    "total_carbohydrate_g" DECIMAL(9,3) NOT NULL,
    "total_fat_g" DECIMAL(9,3) NOT NULL,
    "total_fiber_g" DECIMAL(9,3),
    "notes" TEXT,
    "client_request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_items" (
    "id" UUID NOT NULL,
    "meal_id" UUID NOT NULL,
    "food_id" UUID,
    "recipe_id" UUID,
    "quantity_grams" DECIMAL(9,2),
    "recipe_servings" DECIMAL(6,2),
    "calories_kcal" DECIMAL(10,2) NOT NULL,
    "protein_g" DECIMAL(9,3) NOT NULL,
    "carbohydrate_g" DECIMAL(9,3) NOT NULL,
    "fat_g" DECIMAL(9,3) NOT NULL,
    "fiber_g" DECIMAL(9,3),
    "confidence" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_nutrition" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "local_date" DATE NOT NULL,
    "total_calories_kcal" DECIMAL(10,2) NOT NULL,
    "total_protein_g" DECIMAL(9,3) NOT NULL,
    "total_carbohydrate_g" DECIMAL(9,3) NOT NULL,
    "total_fat_g" DECIMAL(9,3) NOT NULL,
    "total_fiber_g" DECIMAL(9,3),
    "targets_snapshot" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_nutrition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnoses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "active_goal_id" UUID,
    "active_plan_version_id" UUID,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "analysis_window_days" INTEGER,
    "context_snapshot" JSONB,
    "contributing_factors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ruled_out" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnosis_evidence" (
    "id" UUID NOT NULL,
    "diagnosis_id" UUID NOT NULL,
    "metric" TEXT NOT NULL,
    "window" TEXT NOT NULL,
    "observed" TEXT NOT NULL,
    "observed_numeric" DECIMAL(14,4),
    "expected" TEXT,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagnosis_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "diagnosis_id" UUID,
    "intervention_id" UUID,
    "headline" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "alternatives_considered" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "presented_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "acknowledged_at" TIMESTAMPTZ(6),
    "dismissed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_evidence" (
    "id" UUID NOT NULL,
    "recommendation_id" UUID NOT NULL,
    "metric" TEXT NOT NULL,
    "window" TEXT NOT NULL,
    "observed" TEXT NOT NULL,
    "observed_numeric" DECIMAL(14,4),
    "expected" TEXT,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interventions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "diagnosis_id" UUID,
    "superseded_by_intervention_id" UUID,
    "active_goal_id" UUID,
    "active_plan_version_id" UUID,
    "kind" TEXT NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "rationale" TEXT NOT NULL,
    "expected_effect" TEXT NOT NULL,
    "review_on" DATE,
    "status" TEXT NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interventions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intervention_outcomes" (
    "id" UUID NOT NULL,
    "intervention_id" UUID NOT NULL,
    "follow_up_diagnosis_id" UUID,
    "evaluated_at" TIMESTAMPTZ(6) NOT NULL,
    "evaluation_window" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "observations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "explanation" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intervention_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_external_auth_id_key" ON "users"("external_auth_id");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "profile_revisions_user_id_created_at_idx" ON "profile_revisions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "goals_user_id_effective_from_idx" ON "goals"("user_id", "effective_from" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "physique_targets_goal_id_key" ON "physique_targets"("goal_id");

-- CreateIndex
CREATE UNIQUE INDEX "goal_priorities_goal_id_position_key" ON "goal_priorities"("goal_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_slug_key" ON "equipment"("slug");

-- CreateIndex
CREATE INDEX "user_equipment_user_id_valid_from_idx" ON "user_equipment"("user_id", "valid_from" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "user_equipment_user_id_equipment_id_valid_from_key" ON "user_equipment"("user_id", "equipment_id", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "external_sources_slug_key" ON "external_sources"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "muscles_slug_key" ON "muscles"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "muscles_external_source_id_external_id_key" ON "muscles"("external_source_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "exercises_slug_key" ON "exercises"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "exercises_external_source_id_external_id_key" ON "exercises"("external_source_id", "external_id");

-- CreateIndex
CREATE INDEX "exercise_required_equipment_equipment_id_idx" ON "exercise_required_equipment"("equipment_id");

-- CreateIndex
CREATE INDEX "exercise_muscle_relations_muscle_id_idx" ON "exercise_muscle_relations"("muscle_id");

-- CreateIndex
CREATE INDEX "training_plans_user_id_idx" ON "training_plans"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "training_plan_versions_plan_id_version_number_key" ON "training_plan_versions"("plan_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "training_plan_sessions_version_id_position_key" ON "training_plan_sessions"("version_id", "position");

-- CreateIndex
CREATE INDEX "training_plan_exercise_slots_exercise_id_idx" ON "training_plan_exercise_slots"("exercise_id");

-- CreateIndex
CREATE UNIQUE INDEX "training_plan_exercise_slots_session_id_position_key" ON "training_plan_exercise_slots"("session_id", "position");

-- CreateIndex
CREATE INDEX "workouts_user_id_started_at_idx" ON "workouts"("user_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "workouts_plan_version_id_idx" ON "workouts"("plan_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "workouts_user_id_client_request_id_key" ON "workouts"("user_id", "client_request_id");

-- CreateIndex
CREATE INDEX "workout_exercises_exercise_id_idx" ON "workout_exercises"("exercise_id");

-- CreateIndex
CREATE UNIQUE INDEX "workout_exercises_workout_id_position_key" ON "workout_exercises"("workout_id", "position");

-- CreateIndex
CREATE INDEX "exercise_sets_workout_exercise_id_position_idx" ON "exercise_sets"("workout_exercise_id", "position");

-- CreateIndex
CREATE INDEX "body_measurements_user_id_recorded_at_idx" ON "body_measurements"("user_id", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "body_measurements_external_id_idx" ON "body_measurements"("external_id");

-- CreateIndex
CREATE INDEX "activity_records_user_id_date_idx" ON "activity_records"("user_id", "date" DESC);

-- CreateIndex
CREATE INDEX "activity_records_user_id_kind_date_idx" ON "activity_records"("user_id", "kind", "date" DESC);

-- CreateIndex
CREATE INDEX "activity_records_external_id_idx" ON "activity_records"("external_id");

-- CreateIndex
CREATE INDEX "food_sources_owner_user_id_idx" ON "food_sources"("owner_user_id");

-- CreateIndex
CREATE INDEX "food_sources_external_source_id_idx" ON "food_sources"("external_source_id");

-- CreateIndex
CREATE UNIQUE INDEX "foods_barcode_key" ON "foods"("barcode");

-- CreateIndex
CREATE INDEX "foods_source_id_idx" ON "foods"("source_id");

-- CreateIndex
CREATE INDEX "foods_name_idx" ON "foods"("name");

-- CreateIndex
CREATE UNIQUE INDEX "foods_source_id_external_id_key" ON "foods"("source_id", "external_id");

-- CreateIndex
CREATE INDEX "food_servings_food_id_idx" ON "food_servings"("food_id");

-- CreateIndex
CREATE UNIQUE INDEX "food_servings_food_id_label_key" ON "food_servings"("food_id", "label");

-- CreateIndex
CREATE INDEX "recipes_owner_user_id_idx" ON "recipes"("owner_user_id");

-- CreateIndex
CREATE INDEX "recipes_name_idx" ON "recipes"("name");

-- CreateIndex
CREATE INDEX "recipe_items_food_id_idx" ON "recipe_items"("food_id");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_items_recipe_id_position_key" ON "recipe_items"("recipe_id", "position");

-- CreateIndex
CREATE INDEX "meals_user_id_local_date_idx" ON "meals"("user_id", "local_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "meals_user_id_client_request_id_key" ON "meals"("user_id", "client_request_id");

-- CreateIndex
CREATE INDEX "meal_items_meal_id_idx" ON "meal_items"("meal_id");

-- CreateIndex
CREATE INDEX "meal_items_food_id_idx" ON "meal_items"("food_id");

-- CreateIndex
CREATE INDEX "meal_items_recipe_id_idx" ON "meal_items"("recipe_id");

-- CreateIndex
CREATE INDEX "daily_nutrition_user_id_local_date_idx" ON "daily_nutrition"("user_id", "local_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "daily_nutrition_user_id_local_date_key" ON "daily_nutrition"("user_id", "local_date");

-- CreateIndex
CREATE INDEX "diagnoses_user_id_created_at_idx" ON "diagnoses"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "diagnoses_code_idx" ON "diagnoses"("code");

-- CreateIndex
CREATE INDEX "diagnoses_active_goal_id_idx" ON "diagnoses"("active_goal_id");

-- CreateIndex
CREATE INDEX "diagnoses_active_plan_version_id_idx" ON "diagnoses"("active_plan_version_id");

-- CreateIndex
CREATE INDEX "diagnosis_evidence_diagnosis_id_idx" ON "diagnosis_evidence"("diagnosis_id");

-- CreateIndex
CREATE INDEX "diagnosis_evidence_metric_idx" ON "diagnosis_evidence"("metric");

-- CreateIndex
CREATE INDEX "recommendations_user_id_presented_at_idx" ON "recommendations"("user_id", "presented_at" DESC);

-- CreateIndex
CREATE INDEX "recommendations_diagnosis_id_idx" ON "recommendations"("diagnosis_id");

-- CreateIndex
CREATE INDEX "recommendations_intervention_id_idx" ON "recommendations"("intervention_id");

-- CreateIndex
CREATE INDEX "recommendation_evidence_recommendation_id_idx" ON "recommendation_evidence"("recommendation_id");

-- CreateIndex
CREATE INDEX "interventions_user_id_created_at_idx" ON "interventions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "interventions_diagnosis_id_idx" ON "interventions"("diagnosis_id");

-- CreateIndex
CREATE INDEX "interventions_active_goal_id_idx" ON "interventions"("active_goal_id");

-- CreateIndex
CREATE INDEX "interventions_active_plan_version_id_idx" ON "interventions"("active_plan_version_id");

-- CreateIndex
CREATE INDEX "intervention_outcomes_intervention_id_idx" ON "intervention_outcomes"("intervention_id");

-- CreateIndex
CREATE INDEX "intervention_outcomes_follow_up_diagnosis_id_idx" ON "intervention_outcomes"("follow_up_diagnosis_id");

-- CreateIndex
CREATE UNIQUE INDEX "intervention_outcomes_intervention_id_evaluation_window_key" ON "intervention_outcomes"("intervention_id", "evaluation_window");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_revisions" ADD CONSTRAINT "profile_revisions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_superseded_by_goal_id_fkey" FOREIGN KEY ("superseded_by_goal_id") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physique_targets" ADD CONSTRAINT "physique_targets_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_priorities" ADD CONSTRAINT "goal_priorities_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_equipment" ADD CONSTRAINT "user_equipment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_equipment" ADD CONSTRAINT "user_equipment_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "muscles" ADD CONSTRAINT "muscles_external_source_id_fkey" FOREIGN KEY ("external_source_id") REFERENCES "external_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_external_source_id_fkey" FOREIGN KEY ("external_source_id") REFERENCES "external_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_required_equipment" ADD CONSTRAINT "exercise_required_equipment_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_required_equipment" ADD CONSTRAINT "exercise_required_equipment_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_muscle_relations" ADD CONSTRAINT "exercise_muscle_relations_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_muscle_relations" ADD CONSTRAINT "exercise_muscle_relations_muscle_id_fkey" FOREIGN KEY ("muscle_id") REFERENCES "muscles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_plan_versions" ADD CONSTRAINT "training_plan_versions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "training_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_plan_sessions" ADD CONSTRAINT "training_plan_sessions_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "training_plan_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_plan_exercise_slots" ADD CONSTRAINT "training_plan_exercise_slots_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "training_plan_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_plan_exercise_slots" ADD CONSTRAINT "training_plan_exercise_slots_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "training_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "training_plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_plan_session_id_fkey" FOREIGN KEY ("plan_session_id") REFERENCES "training_plan_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "workouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_workout_exercise_id_fkey" FOREIGN KEY ("workout_exercise_id") REFERENCES "workout_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "body_measurement_values" ADD CONSTRAINT "body_measurement_values_measurement_id_fkey" FOREIGN KEY ("measurement_id") REFERENCES "body_measurements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_sources" ADD CONSTRAINT "food_sources_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_sources" ADD CONSTRAINT "food_sources_external_source_id_fkey" FOREIGN KEY ("external_source_id") REFERENCES "external_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foods" ADD CONSTRAINT "foods_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "food_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foods" ADD CONSTRAINT "foods_default_serving_id_fkey" FOREIGN KEY ("default_serving_id") REFERENCES "food_servings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_servings" ADD CONSTRAINT "food_servings_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meals" ADD CONSTRAINT "meals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "meals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_nutrition" ADD CONSTRAINT "daily_nutrition_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_active_goal_id_fkey" FOREIGN KEY ("active_goal_id") REFERENCES "goals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_active_plan_version_id_fkey" FOREIGN KEY ("active_plan_version_id") REFERENCES "training_plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnosis_evidence" ADD CONSTRAINT "diagnosis_evidence_diagnosis_id_fkey" FOREIGN KEY ("diagnosis_id") REFERENCES "diagnoses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_diagnosis_id_fkey" FOREIGN KEY ("diagnosis_id") REFERENCES "diagnoses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_intervention_id_fkey" FOREIGN KEY ("intervention_id") REFERENCES "interventions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_evidence" ADD CONSTRAINT "recommendation_evidence_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "recommendations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_diagnosis_id_fkey" FOREIGN KEY ("diagnosis_id") REFERENCES "diagnoses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_superseded_by_intervention_id_fkey" FOREIGN KEY ("superseded_by_intervention_id") REFERENCES "interventions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_active_goal_id_fkey" FOREIGN KEY ("active_goal_id") REFERENCES "goals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_active_plan_version_id_fkey" FOREIGN KEY ("active_plan_version_id") REFERENCES "training_plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intervention_outcomes" ADD CONSTRAINT "intervention_outcomes_intervention_id_fkey" FOREIGN KEY ("intervention_id") REFERENCES "interventions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intervention_outcomes" ADD CONSTRAINT "intervention_outcomes_follow_up_diagnosis_id_fkey" FOREIGN KEY ("follow_up_diagnosis_id") REFERENCES "diagnoses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- Hand-written additions — everything Prisma cannot express in schema.prisma.
-- Implements docs/DATABASE_DESIGN.md §2 (text + CHECK enums), §4 (per-table
-- CHECK constraints), §14 (partial/expression indexes), §5 (append-only
-- triggers) and the cascade-ordering fixes documented as divergence D11.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. CHECK constraints — enum-like text columns mirror domain union types.
-- ---------------------------------------------------------------------------

-- users
ALTER TABLE "users" ADD CONSTRAINT "users_timezone_not_empty" CHECK ("timezone" <> '');

-- profiles
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_sex_domain" CHECK ("sex" IS NULL OR "sex" IN ('male','female','intersex','undisclosed'));
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_training_experience_domain" CHECK ("training_experience" IS NULL OR "training_experience" IN ('untrained','beginner','intermediate','advanced'));
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_height_cm_positive" CHECK ("height_cm" IS NULL OR "height_cm" > 0);
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_training_days_per_week_range" CHECK ("training_days_per_week" IS NULL OR "training_days_per_week" BETWEEN 0 AND 7);
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_session_duration_minutes_positive" CHECK ("session_duration_minutes" IS NULL OR "session_duration_minutes" > 0);
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_unit_system_domain" CHECK ("unit_system" IN ('metric','imperial'));

-- profile_revisions (same value domains as the current-state row)
ALTER TABLE "profile_revisions" ADD CONSTRAINT "profile_revisions_sex_domain" CHECK ("sex" IS NULL OR "sex" IN ('male','female','intersex','undisclosed'));
ALTER TABLE "profile_revisions" ADD CONSTRAINT "profile_revisions_training_experience_domain" CHECK ("training_experience" IS NULL OR "training_experience" IN ('untrained','beginner','intermediate','advanced'));
ALTER TABLE "profile_revisions" ADD CONSTRAINT "profile_revisions_height_cm_positive" CHECK ("height_cm" IS NULL OR "height_cm" > 0);
ALTER TABLE "profile_revisions" ADD CONSTRAINT "profile_revisions_training_days_per_week_range" CHECK ("training_days_per_week" IS NULL OR "training_days_per_week" BETWEEN 0 AND 7);
ALTER TABLE "profile_revisions" ADD CONSTRAINT "profile_revisions_session_duration_minutes_positive" CHECK ("session_duration_minutes" IS NULL OR "session_duration_minutes" > 0);

-- goals
ALTER TABLE "goals" ADD CONSTRAINT "goals_kind_domain" CHECK ("kind" IN ('bodybuilding','aesthetics_v_taper','lean_recomposition','athletic_performance','max_strength','general_fitness','custom'));
ALTER TABLE "goals" ADD CONSTRAINT "goals_effective_window" CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from");

-- physique_targets
ALTER TABLE "physique_targets" ADD CONSTRAINT "physique_targets_weight_positive" CHECK ("body_weight_kg" IS NULL OR "body_weight_kg" > 0);
ALTER TABLE "physique_targets" ADD CONSTRAINT "physique_targets_body_fat_range" CHECK ("body_fat_percent" IS NULL OR "body_fat_percent" BETWEEN 0 AND 60);
ALTER TABLE "physique_targets" ADD CONSTRAINT "physique_targets_waist_positive" CHECK ("waist_cm" IS NULL OR "waist_cm" > 0);
ALTER TABLE "physique_targets" ADD CONSTRAINT "physique_targets_chest_positive" CHECK ("chest_cm" IS NULL OR "chest_cm" > 0);
ALTER TABLE "physique_targets" ADD CONSTRAINT "physique_targets_shoulder_positive" CHECK ("shoulder_circumference_cm" IS NULL OR "shoulder_circumference_cm" > 0);
ALTER TABLE "physique_targets" ADD CONSTRAINT "physique_targets_arm_positive" CHECK ("arm_cm" IS NULL OR "arm_cm" > 0);
ALTER TABLE "physique_targets" ADD CONSTRAINT "physique_targets_thigh_positive" CHECK ("thigh_cm" IS NULL OR "thigh_cm" > 0);
ALTER TABLE "physique_targets" ADD CONSTRAINT "physique_targets_calf_positive" CHECK ("calf_cm" IS NULL OR "calf_cm" > 0);
ALTER TABLE "physique_targets" ADD CONSTRAINT "physique_targets_has_target" CHECK (
  "body_weight_kg" IS NOT NULL OR "body_fat_percent" IS NOT NULL OR "waist_cm" IS NOT NULL
  OR "chest_cm" IS NOT NULL OR "shoulder_circumference_cm" IS NOT NULL OR "arm_cm" IS NOT NULL
  OR "thigh_cm" IS NOT NULL OR "calf_cm" IS NOT NULL);

-- goal_priorities
ALTER TABLE "goal_priorities" ADD CONSTRAINT "goal_priorities_position_nonneg" CHECK ("position" >= 0);

-- equipment
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_category_domain" CHECK ("category" IN ('barbell','dumbbell','kettlebell','machine','cable','smith_machine','bench','rack','pull_up_bar','bands','bodyweight','cardio_machine','accessory','other'));

-- user_equipment
ALTER TABLE "user_equipment" ADD CONSTRAINT "user_equipment_validity_window" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from");

-- external_sources (verified implies SPDX present)
ALTER TABLE "external_sources" ADD CONSTRAINT "external_sources_verified_needs_license" CHECK ("license_verified" = false OR "license_spdx" IS NOT NULL);

-- muscles
ALTER TABLE "muscles" ADD CONSTRAINT "muscles_group_domain" CHECK ("group" IN ('chest','upper_back','lats','traps','front_delts','side_delts','rear_delts','biceps','triceps','forearms','quadriceps','hamstrings','glutes','adductors','calves','abdominals','obliques','lower_back','neck','other'));

-- exercises
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_category_domain" CHECK ("category" IN ('compound','isolation','conditioning','mobility','other'));
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_movement_pattern_domain" CHECK ("movement_pattern" IS NULL OR "movement_pattern" IN ('horizontal_push','vertical_push','horizontal_pull','vertical_pull','squat','hinge','lunge','carry','core','rotation','conditioning','other'));

-- exercise_muscle_relations
ALTER TABLE "exercise_muscle_relations" ADD CONSTRAINT "exercise_muscle_relations_role_domain" CHECK ("role" IN ('primary_mover','secondary_mover','stabilizer'));
ALTER TABLE "exercise_muscle_relations" ADD CONSTRAINT "exercise_muscle_relations_weight_range" CHECK ("contribution_weight" IS NULL OR "contribution_weight" BETWEEN 0 AND 1);

-- training_plans
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_status_domain" CHECK ("status" IN ('draft','active','paused','retired'));

-- training_plan_versions
ALTER TABLE "training_plan_versions" ADD CONSTRAINT "training_plan_versions_number_positive" CHECK ("version_number" >= 1);
ALTER TABLE "training_plan_versions" ADD CONSTRAINT "training_plan_versions_window" CHECK ("ends_on" IS NULL OR "starts_on" IS NULL OR "ends_on" >= "starts_on");

-- training_plan_sessions
ALTER TABLE "training_plan_sessions" ADD CONSTRAINT "training_plan_sessions_weekday_range" CHECK ("weekday_hint" IS NULL OR "weekday_hint" BETWEEN 0 AND 6);

-- training_plan_exercise_slots
ALTER TABLE "training_plan_exercise_slots" ADD CONSTRAINT "training_plan_exercise_slots_target_sets_positive" CHECK ("target_sets" IS NULL OR "target_sets" > 0);
ALTER TABLE "training_plan_exercise_slots" ADD CONSTRAINT "training_plan_exercise_slots_rep_range" CHECK ("rep_min" IS NULL OR "rep_max" IS NULL OR "rep_min" <= "rep_max");
ALTER TABLE "training_plan_exercise_slots" ADD CONSTRAINT "training_plan_exercise_slots_target_rir_range" CHECK ("target_rir" IS NULL OR "target_rir" BETWEEN 0 AND 10);

-- workouts
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_status_domain" CHECK ("status" IN ('planned','in_progress','completed','partial','skipped'));
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_time_window" CHECK ("ended_at" IS NULL OR "ended_at" > "started_at");

-- exercise_sets
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_kind_domain" CHECK ("kind" IN ('warmup','working','drop_set','rest_pause','amrap','failure'));
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_load_nonneg" CHECK ("load_kg" IS NULL OR "load_kg" >= 0);
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_added_load_nonneg" CHECK ("added_load_kg" IS NULL OR "added_load_kg" >= 0);
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_reps_range" CHECK ("reps" IS NULL OR "reps" BETWEEN 0 AND 1000);
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_distance_nonneg" CHECK ("distance_meters" IS NULL OR "distance_meters" >= 0);
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_duration_nonneg" CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0);
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_rir_range" CHECK ("rir" IS NULL OR "rir" BETWEEN 0 AND 10);
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_rpe_range" CHECK ("rpe" IS NULL OR "rpe" BETWEEN 0 AND 10);
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_has_measurable" CHECK ("reps" IS NOT NULL OR "distance_meters" IS NOT NULL OR "duration_seconds" IS NOT NULL);

-- body_measurements
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_condition_domain" CHECK ("condition" IS NULL OR "condition" IN ('morning_fasted','post_workout','evening','random','other'));
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_weight_positive" CHECK ("body_weight_kg" IS NULL OR "body_weight_kg" > 0);
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_body_fat_range" CHECK ("body_fat_percent" IS NULL OR "body_fat_percent" BETWEEN 0 AND 60);
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_entered_via_domain" CHECK ("entered_via" IS NULL OR "entered_via" IN ('manual','smart_scale_import','wearable_import','other'));
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_confidence_domain" CHECK ("confidence" IS NULL OR "confidence" IN ('measured','estimated','unknown'));

-- body_measurement_values
ALTER TABLE "body_measurement_values" ADD CONSTRAINT "body_measurement_values_site_domain" CHECK ("site" IN ('neck','shoulders','chest','waist','hips','left_upper_arm','right_upper_arm','left_thigh','right_thigh','left_calf','right_calf'));
ALTER TABLE "body_measurement_values" ADD CONSTRAINT "body_measurement_values_positive" CHECK ("value_cm" > 0);

-- activity_records
ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_kind_domain" CHECK ("kind" IN ('steps','walk','run','cycle','row','swim','elliptical','stairs','sport','other'));
ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_steps_nonneg" CHECK ("steps" IS NULL OR "steps" >= 0);
ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_duration_nonneg" CHECK ("duration_minutes" IS NULL OR "duration_minutes" >= 0);
ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_distance_nonneg" CHECK ("distance_km" IS NULL OR "distance_km" >= 0);
ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_hr_range" CHECK ("average_heart_rate_bpm" IS NULL OR "average_heart_rate_bpm" BETWEEN 20 AND 260);
ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_calories_nonneg" CHECK ("estimated_calories_burned" IS NULL OR "estimated_calories_burned" >= 0);
ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_effort_domain" CHECK ("effort" IS NULL OR "effort" IN ('low','moderate','high'));
ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_steps_only_on_steps" CHECK ("kind" <> 'steps' OR "steps" IS NOT NULL);
ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_steps_only_kind_steps" CHECK ("kind" = 'steps' OR "steps" IS NULL);

-- food_sources
ALTER TABLE "food_sources" ADD CONSTRAINT "food_sources_kind_domain" CHECK ("kind" IN ('curated_database','user_created','imported','estimate'));
ALTER TABLE "food_sources" ADD CONSTRAINT "food_sources_confidence_domain" CHECK ("default_confidence" IN ('measured','label_declared','estimated','unknown'));
ALTER TABLE "food_sources" ADD CONSTRAINT "food_sources_user_created_has_owner" CHECK ("kind" <> 'user_created' OR "owner_user_id" IS NOT NULL);

-- foods
ALTER TABLE "foods" ADD CONSTRAINT "foods_density_basis_domain" CHECK ("density_basis" IN ('per_100g','per_100ml'));
ALTER TABLE "foods" ADD CONSTRAINT "foods_calories_nonneg" CHECK ("calories_kcal" >= 0);
ALTER TABLE "foods" ADD CONSTRAINT "foods_protein_nonneg" CHECK ("protein_g" >= 0);
ALTER TABLE "foods" ADD CONSTRAINT "foods_carbohydrate_nonneg" CHECK ("carbohydrate_g" >= 0);
ALTER TABLE "foods" ADD CONSTRAINT "foods_fat_nonneg" CHECK ("fat_g" >= 0);
ALTER TABLE "foods" ADD CONSTRAINT "foods_fiber_nonneg" CHECK ("fiber_g" IS NULL OR "fiber_g" >= 0);
ALTER TABLE "foods" ADD CONSTRAINT "foods_sugars_nonneg" CHECK ("sugars_g" IS NULL OR "sugars_g" >= 0);
ALTER TABLE "foods" ADD CONSTRAINT "foods_saturated_fat_nonneg" CHECK ("saturated_fat_g" IS NULL OR "saturated_fat_g" >= 0);
ALTER TABLE "foods" ADD CONSTRAINT "foods_alcohol_nonneg" CHECK ("alcohol_g" IS NULL OR "alcohol_g" >= 0);
ALTER TABLE "foods" ADD CONSTRAINT "foods_sodium_nonneg" CHECK ("sodium_mg" IS NULL OR "sodium_mg" >= 0);

-- food_servings: exactly one size basis
ALTER TABLE "food_servings" ADD CONSTRAINT "food_servings_single_basis" CHECK (
  (("grams" IS NOT NULL)::int + ("milliliters" IS NOT NULL)::int = 1 AND "unit_quantity" IS NULL)
  OR ("unit_quantity" IS NOT NULL AND "unit_name" IS NOT NULL AND "grams" IS NULL AND "milliliters" IS NULL));
ALTER TABLE "food_servings" ADD CONSTRAINT "food_servings_grams_positive" CHECK ("grams" IS NULL OR "grams" > 0);
ALTER TABLE "food_servings" ADD CONSTRAINT "food_servings_milliliters_positive" CHECK ("milliliters" IS NULL OR "milliliters" > 0);
ALTER TABLE "food_servings" ADD CONSTRAINT "food_servings_unit_quantity_positive" CHECK ("unit_quantity" IS NULL OR "unit_quantity" > 0);

-- recipes / recipe_items
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_servings_positive" CHECK ("servings" > 0);
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_quantity_positive" CHECK ("quantity_grams" > 0);

-- meals
ALTER TABLE "meals" ADD CONSTRAINT "meals_slot_domain" CHECK ("slot" IS NULL OR "slot" IN ('breakfast','lunch','dinner','snack','other'));
ALTER TABLE "meals" ADD CONSTRAINT "meals_total_calories_nonneg" CHECK ("total_calories_kcal" >= 0);
ALTER TABLE "meals" ADD CONSTRAINT "meals_total_protein_nonneg" CHECK ("total_protein_g" >= 0);
ALTER TABLE "meals" ADD CONSTRAINT "meals_total_carbohydrate_nonneg" CHECK ("total_carbohydrate_g" >= 0);
ALTER TABLE "meals" ADD CONSTRAINT "meals_total_fat_nonneg" CHECK ("total_fat_g" >= 0);
ALTER TABLE "meals" ADD CONSTRAINT "meals_total_fiber_nonneg" CHECK ("total_fiber_g" IS NULL OR "total_fiber_g" >= 0);

-- meal_items: polymorphic food/recipe reference is exactly one path
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_single_ref" CHECK (
  ("food_id" IS NOT NULL AND "recipe_id" IS NULL AND "quantity_grams" IS NOT NULL AND "recipe_servings" IS NULL)
  OR ("recipe_id" IS NOT NULL AND "food_id" IS NULL AND "recipe_servings" IS NOT NULL AND "quantity_grams" IS NULL));
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_quantity_positive" CHECK ("quantity_grams" IS NULL OR "quantity_grams" > 0);
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_recipe_servings_positive" CHECK ("recipe_servings" IS NULL OR "recipe_servings" > 0);
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_calories_nonneg" CHECK ("calories_kcal" >= 0);
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_protein_nonneg" CHECK ("protein_g" >= 0);
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_carbohydrate_nonneg" CHECK ("carbohydrate_g" >= 0);
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_fat_nonneg" CHECK ("fat_g" >= 0);
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_fiber_nonneg" CHECK ("fiber_g" IS NULL OR "fiber_g" >= 0);
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_confidence_domain" CHECK ("confidence" IN ('measured','label_declared','estimated','unknown'));

-- daily_nutrition
ALTER TABLE "daily_nutrition" ADD CONSTRAINT "daily_nutrition_total_calories_nonneg" CHECK ("total_calories_kcal" >= 0);
ALTER TABLE "daily_nutrition" ADD CONSTRAINT "daily_nutrition_total_protein_nonneg" CHECK ("total_protein_g" >= 0);
ALTER TABLE "daily_nutrition" ADD CONSTRAINT "daily_nutrition_total_carbohydrate_nonneg" CHECK ("total_carbohydrate_g" >= 0);
ALTER TABLE "daily_nutrition" ADD CONSTRAINT "daily_nutrition_total_fat_nonneg" CHECK ("total_fat_g" >= 0);
ALTER TABLE "daily_nutrition" ADD CONSTRAINT "daily_nutrition_total_fiber_nonneg" CHECK ("total_fiber_g" IS NULL OR "total_fiber_g" >= 0);

-- diagnoses
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_severity_domain" CHECK ("severity" IN ('informational','watch','act','urgent'));
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_status_domain" CHECK ("status" IN ('open','monitoring','resolved','dismissed'));

-- recommendations
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_status_domain" CHECK ("status" IN ('presented','acknowledged','acted_on','dismissed','expired'));

-- interventions ('no_change' is first-class)
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_kind_domain" CHECK ("kind" IN ('nutrition_target_adjustment','food_choice_guidance','activity_target_adjustment','training_volume_adjustment','exercise_substitution','split_structure_adjustment','progression_scheme_adjustment','measurement_protocol_adjustment','recovery_adjustment','no_change','custom'));
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_status_domain" CHECK ("status" IN ('proposed','accepted','active','completed','rejected','superseded'));

-- intervention_outcomes
ALTER TABLE "intervention_outcomes" ADD CONSTRAINT "intervention_outcomes_verdict_domain" CHECK ("verdict" IN ('improved_as_expected','no_effect','worsened','uncertain','too_early'));

-- ---------------------------------------------------------------------------
-- 2. Partial / expression unique indexes (idempotency + hot-path uniques)
-- ---------------------------------------------------------------------------

-- At most one active (open-ended) goal per user.
CREATE UNIQUE INDEX "goals_one_active_per_user" ON "goals" ("user_id") WHERE "effective_until" IS NULL;

-- At most one active plan per user.
CREATE UNIQUE INDEX "training_plans_one_active_per_user" ON "training_plans" ("user_id") WHERE "status" = 'active';

-- Case-insensitive email uniqueness (login dedupe).
CREATE UNIQUE INDEX "users_email_lower_unique" ON "users" (lower("email")) WHERE "email" IS NOT NULL;

-- One cumulative steps value per (user, local day, source) -> race-free
-- idempotent upsert: INSERT ... ON CONFLICT DO UPDATE (§15).
CREATE UNIQUE INDEX "activity_records_steps_source_day_unique"
  ON "activity_records" ("user_id", "date", COALESCE("recorded_via", ''))
  WHERE "kind" = 'steps';

-- Wearable/smart-scale import dedupe (§15): same provider event never
-- duplicates a measurement.
CREATE UNIQUE INDEX "body_measurements_import_unique"
  ON "body_measurements" ("user_id", COALESCE("entered_via", ''), "external_id")
  WHERE COALESCE("external_id", '') <> '';

-- Unique set position within a workout exercise (design §4.6).
CREATE UNIQUE INDEX "exercise_sets_position_unique" ON "exercise_sets" ("workout_exercise_id", "position");

-- Open-status hot paths (§14).
CREATE INDEX "diagnoses_open_idx" ON "diagnoses" ("user_id", "created_at" DESC) WHERE "status" IN ('open','monitoring');
CREATE INDEX "interventions_active_idx" ON "interventions" ("user_id", "created_at" DESC) WHERE "status" = 'active';
CREATE INDEX "workouts_open_idx" ON "workouts" ("user_id", "started_at" DESC) WHERE "status" IN ('planned','in_progress');

-- Search / trend support indexes (§14).
CREATE INDEX "exercises_aliases_gin" ON "exercises" USING GIN ("aliases");
CREATE INDEX "body_measurement_values_site_idx" ON "body_measurement_values" ("site") INCLUDE ("value_cm");

-- ---------------------------------------------------------------------------
-- 3. Deferred history foreign keys (divergence D11).
--
-- The design marks these RESTRICT, but every referenced table is reachable
-- from the users(id) cascade tree: with immediate checks, account erasure
-- fails or succeeds depending on the order PostgreSQL happens to fire cascade
-- triggers in. NO ACTION DEFERRABLE INITIALLY DEFERRED keeps the same
-- "referenced history cannot disappear out from under a reference" guarantee
-- (checked at commit) while making erasure deterministic.
--
-- The goals self-reference (supersession) is deferred for the complementary
-- reason: a new goal version links the old row forward (superseded_by) in the
-- same transaction that creates the target row, so the check must run at
-- commit, not at the UPDATE.
-- ---------------------------------------------------------------------------

ALTER TABLE "goals" DROP CONSTRAINT "goals_superseded_by_goal_id_fkey";
ALTER TABLE "goals" ADD CONSTRAINT "goals_superseded_by_goal_id_fkey" FOREIGN KEY ("superseded_by_goal_id") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "workouts" DROP CONSTRAINT "workouts_plan_version_id_fkey";
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "training_plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "diagnoses" DROP CONSTRAINT "diagnoses_active_goal_id_fkey";
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_active_goal_id_fkey" FOREIGN KEY ("active_goal_id") REFERENCES "goals"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "diagnoses" DROP CONSTRAINT "diagnoses_active_plan_version_id_fkey";
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_active_plan_version_id_fkey" FOREIGN KEY ("active_plan_version_id") REFERENCES "training_plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "recommendations" DROP CONSTRAINT "recommendations_diagnosis_id_fkey";
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_diagnosis_id_fkey" FOREIGN KEY ("diagnosis_id") REFERENCES "diagnoses"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "recommendations" DROP CONSTRAINT "recommendations_intervention_id_fkey";
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_intervention_id_fkey" FOREIGN KEY ("intervention_id") REFERENCES "interventions"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "interventions" DROP CONSTRAINT "interventions_diagnosis_id_fkey";
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_diagnosis_id_fkey" FOREIGN KEY ("diagnosis_id") REFERENCES "diagnoses"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "interventions" DROP CONSTRAINT "interventions_active_goal_id_fkey";
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_active_goal_id_fkey" FOREIGN KEY ("active_goal_id") REFERENCES "goals"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "interventions" DROP CONSTRAINT "interventions_active_plan_version_id_fkey";
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_active_plan_version_id_fkey" FOREIGN KEY ("active_plan_version_id") REFERENCES "training_plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "intervention_outcomes" DROP CONSTRAINT "intervention_outcomes_intervention_id_fkey";
ALTER TABLE "intervention_outcomes" ADD CONSTRAINT "intervention_outcomes_intervention_id_fkey" FOREIGN KEY ("intervention_id") REFERENCES "interventions"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "recipe_items" DROP CONSTRAINT "recipe_items_food_id_fkey";
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "meal_items" DROP CONSTRAINT "meal_items_food_id_fkey";
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "meal_items" DROP CONSTRAINT "meal_items_recipe_id_fkey";
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
-- 4. Historical-integrity triggers (§4/§5: observations are not rewritten).
--
-- Policy:
--   * append-only tables    -> UPDATE forbidden entirely;
--   * interval-versioned /  -> UPDATE allowed only for the lifecycle columns
--     status-bearing rows     (status transitions, supersession, resolution);
--   * activity_records      -> UPDATE allowed only for cumulative step rows
--     (the sanctioned max-wins import upsert, §15);
--   * workout children      -> frozen once the workout reaches a final status.
-- DELETE stays governed by the retention policy (§13) and application code;
-- ON DELETE CASCADE erasure must keep working, so no DELETE triggers.
-- ---------------------------------------------------------------------------

CREATE FUNCTION fitcoach_forbid_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only; record a new row instead of updating', TG_TABLE_NAME
    USING ERRCODE = '23514';
END;
$$;

CREATE FUNCTION fitcoach_guard_lifecycle_columns() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  allowed_columns text[];
  old_row jsonb;
  new_row jsonb;
  col text;
BEGIN
  allowed_columns := TG_ARGV;
  old_row := to_jsonb(OLD) - 'updated_at';
  new_row := to_jsonb(NEW) - 'updated_at';
  FOREACH col IN ARRAY allowed_columns LOOP
    old_row := old_row - col;
    new_row := new_row - col;
  END LOOP;
  IF old_row IS DISTINCT FROM new_row THEN
    RAISE EXCEPTION 'table % only permits lifecycle-column updates (%); content is frozen',
      TG_TABLE_NAME, array_to_string(TG_ARGV, ', ')
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION fitcoach_guard_steps_import() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind <> 'steps' THEN
    RAISE EXCEPTION 'activity_records of kind % are append-only; only cumulative step rows may be upserted', OLD.kind
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION fitcoach_guard_workout_exercise_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  workout_status text;
BEGIN
  SELECT w."status" INTO workout_status FROM "workouts" w WHERE w."id" = OLD."workout_id";
  IF workout_status IN ('completed','partial','skipped') THEN
    RAISE EXCEPTION 'workout_exercise % belongs to a finished workout and is frozen', OLD."id"
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION fitcoach_guard_set_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  workout_status text;
BEGIN
  SELECT w."status" INTO workout_status
    FROM "workout_exercises" we
    JOIN "workouts" w ON w."id" = we."workout_id"
    WHERE we."id" = OLD."workout_exercise_id";
  IF workout_status IN ('completed','partial','skipped') THEN
    RAISE EXCEPTION 'exercise_set % belongs to a finished workout and is frozen', OLD."id"
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION fitcoach_check_measurement_has_datum() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."body_weight_kg" IS NULL AND NEW."body_fat_percent" IS NULL
     AND NOT EXISTS (SELECT 1 FROM "body_measurement_values" v WHERE v."measurement_id" = NEW."id") THEN
    RAISE EXCEPTION 'body measurement % must record body weight, body fat or at least one circumference', NEW."id"
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

-- Fully append-only tables.
CREATE TRIGGER "profile_revisions_no_update" BEFORE UPDATE ON "profile_revisions" FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();
CREATE TRIGGER "physique_targets_no_update" BEFORE UPDATE ON "physique_targets" FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();
CREATE TRIGGER "goal_priorities_no_update" BEFORE UPDATE ON "goal_priorities" FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();
CREATE TRIGGER "training_plan_versions_no_update" BEFORE UPDATE ON "training_plan_versions" FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();
CREATE TRIGGER "training_plan_sessions_no_update" BEFORE UPDATE ON "training_plan_sessions" FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();
CREATE TRIGGER "training_plan_exercise_slots_no_update" BEFORE UPDATE ON "training_plan_exercise_slots" FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();
CREATE TRIGGER "body_measurements_no_update" BEFORE UPDATE ON "body_measurements" FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();
CREATE TRIGGER "body_measurement_values_no_update" BEFORE UPDATE ON "body_measurement_values" FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();
CREATE TRIGGER "diagnosis_evidence_no_update" BEFORE UPDATE ON "diagnosis_evidence" FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();
CREATE TRIGGER "recommendation_evidence_no_update" BEFORE UPDATE ON "recommendation_evidence" FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();
CREATE TRIGGER "intervention_outcomes_no_update" BEFORE UPDATE ON "intervention_outcomes" FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();

-- Lifecycle-only updates: interval-versioned goals, status-bearing coaching rows.
CREATE TRIGGER "goals_lifecycle_only" BEFORE UPDATE ON "goals" FOR EACH ROW EXECUTE FUNCTION fitcoach_guard_lifecycle_columns('effective_until', 'superseded_by_goal_id');
CREATE TRIGGER "diagnoses_lifecycle_only" BEFORE UPDATE ON "diagnoses" FOR EACH ROW EXECUTE FUNCTION fitcoach_guard_lifecycle_columns('status', 'resolved_at');
CREATE TRIGGER "recommendations_lifecycle_only" BEFORE UPDATE ON "recommendations" FOR EACH ROW EXECUTE FUNCTION fitcoach_guard_lifecycle_columns('status', 'acknowledged_at', 'dismissed_at');
CREATE TRIGGER "interventions_lifecycle_only" BEFORE UPDATE ON "interventions" FOR EACH ROW EXECUTE FUNCTION fitcoach_guard_lifecycle_columns('status', 'accepted_at', 'completed_at', 'superseded_by_intervention_id');

-- Activity: only cumulative step rows may be updated (sanctioned import upsert).
CREATE TRIGGER "activity_records_steps_only" BEFORE UPDATE ON "activity_records" FOR EACH ROW EXECUTE FUNCTION fitcoach_guard_steps_import();

-- Workout children stay editable while the workout is open, frozen once final.
CREATE TRIGGER "workout_exercises_frozen_when_done" BEFORE UPDATE ON "workout_exercises" FOR EACH ROW EXECUTE FUNCTION fitcoach_guard_workout_exercise_frozen();
CREATE TRIGGER "exercise_sets_frozen_when_done" BEFORE UPDATE ON "exercise_sets" FOR EACH ROW EXECUTE FUNCTION fitcoach_guard_set_frozen();

-- A measurement must carry at least one datum (design §4.7; child-row part
-- cannot be a plain CHECK, so it is a deferred constraint trigger instead).
CREATE CONSTRAINT TRIGGER "body_measurements_require_datum"
  AFTER INSERT ON "body_measurements"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fitcoach_check_measurement_has_datum();
