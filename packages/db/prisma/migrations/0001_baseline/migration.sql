-- FitCoach baseline for a fresh PostgreSQL database.

BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED');

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
    "availability" TEXT NOT NULL DEFAULT 'available',
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
    "variation_key" TEXT,
    "variation_label" TEXT,
    "stability_demand" TEXT,
    "loading_characteristic" TEXT,
    "range_of_motion_characteristic" TEXT,
    "knowledge_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_required_equipment" (
    "exercise_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "priority" SMALLINT NOT NULL,
    "quantity" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercise_required_equipment_pkey" PRIMARY KEY ("exercise_id","equipment_id")
);

-- CreateTable
CREATE TABLE "exercise_muscle_relations" (
    "id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "muscle_id" UUID NOT NULL,
    "external_source_id" UUID,
    "role" TEXT NOT NULL,
    "emphasis" DECIMAL(3,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercise_muscle_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_muscle_structure_relations" (
    "id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "external_source_id" UUID,
    "role" TEXT NOT NULL,
    "emphasis" DECIMAL(3,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercise_muscle_structure_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_form_versions" (
    "id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "external_source_id" UUID,
    "section" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "position" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercise_form_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_media_assets" (
    "id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "form_version_id" UUID,
    "external_source_id" UUID,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "angle" TEXT,
    "caption" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercise_media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_exercise_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "preference" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_exercise_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_plans" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'primary',
    "status" TEXT NOT NULL,
    "active_from" DATE,
    "active_until" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_plan_versions" (
    "version_number" INTEGER NOT NULL DEFAULT 1,
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "plan_json" TEXT NOT NULL,
    "config_version" TEXT,
    "supersedes_id" UUID,
    "effective_from" DATE NOT NULL,
    "effective_until" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_plan_sessions" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "dayOfWeek" SMALLINT NOT NULL,
    "name" TEXT,
    "notes" TEXT,
    "estimated_duration_minutes" SMALLINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_plan_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_plan_exercise_slots" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "targetSets" SMALLINT NOT NULL,
    "targetReps" TEXT NOT NULL,
    "targetRir" DECIMAL(3,1) NOT NULL,
    "load_prescription" TEXT NOT NULL,
    "load_value" DECIMAL(7,2),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_plan_exercise_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_environment_periods" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_environment_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progression_evaluations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "exercise_name" TEXT NOT NULL,
    "plan_id" UUID,
    "plan_version_id" UUID,
    "slot_id" UUID,
    "environment_kind" TEXT,
    "current" JSONB NOT NULL,
    "previous" JSONB,
    "performance" JSONB NOT NULL,
    "outcome" TEXT NOT NULL,
    "recommendation" JSONB NOT NULL,
    "evidence" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fingerprint" TEXT NOT NULL,
    "config_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progression_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progression_decision_events" (
    "id" UUID NOT NULL,
    "evaluation_id" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "idempotency_key" TEXT,
    "actual_change" JSONB,
    "resulting_performance" JSONB,
    "evidence" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progression_decision_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "training_plan_constraints" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "constraint_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "is_hard" BOOLEAN NOT NULL,
    "violation_detail" TEXT,
    "warning_detail" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_plan_constraints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_plan_decisions" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_plan_decisions_pkey" PRIMARY KEY ("id")
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
    "environment_kind" TEXT,
    "session_classification" TEXT,
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
    "slot_id" UUID,
    "substituted_from_exercise_id" UUID,
    "performance_source" TEXT,
    "substitution_reason" TEXT,
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
    "load_kind" TEXT,
    "assistance_load_kg" DECIMAL(7,2),
    "client_request_id" TEXT,
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
CREATE TABLE "physique_goals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_until" DATE,
    "custom_priorities" JSONB,
    "target_timeframe_weeks" SMALLINT,
    "direction" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "physique_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "physique_goal_priorities" (
    "id" UUID NOT NULL,
    "physique_goal_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "tag" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "physique_goal_priorities_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "nutrient_definitions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "precision" SMALLINT NOT NULL DEFAULT 2,
    "rdi_value" DECIMAL(12,4),
    "rdi_unit" TEXT,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "source_id" UUID,
    "is_core" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nutrient_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_nutrient_values" (
    "id" UUID NOT NULL,
    "food_id" UUID NOT NULL,
    "nutrient_id" UUID NOT NULL,
    "amount_per_100" DECIMAL(12,4) NOT NULL,
    "confidence" TEXT NOT NULL,
    "provenance_tier" TEXT NOT NULL,
    "preparation_state" TEXT,
    "preparation_method" TEXT,
    "uncertainty_low" DECIMAL(12,4),
    "uncertainty_high" DECIMAL(12,4),
    "external_id" TEXT,
    "measured_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_nutrient_values_pkey" PRIMARY KEY ("id")
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

-- CreateTable
CREATE TABLE "decision_snapshots" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "decided_at" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "unified_state_id" UUID NOT NULL,
    "diagnoses_addressed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "monitoring_plan" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "config_version" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "supersedes_id" UUID,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_interventions" (
    "id" UUID NOT NULL,
    "decision_snapshot_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "rationale" TEXT NOT NULL,
    "expected_effect" TEXT NOT NULL,
    "addresses_diagnoses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "review_on" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_interventions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_evidence" (
    "id" UUID NOT NULL,
    "decision_snapshot_id" UUID NOT NULL,
    "source_engine" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "window" TEXT NOT NULL,
    "observed" TEXT NOT NULL,
    "observed_numeric" DECIMAL(14,4),
    "expected" TEXT,
    "confidence" TEXT NOT NULL,
    "provenance_class" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_assumptions" (
    "id" UUID NOT NULL,
    "decision_snapshot_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_assumptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_outcomes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "decision_snapshot_id" UUID NOT NULL,
    "evaluated_at" TIMESTAMPTZ(6) NOT NULL,
    "evaluation_window" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "intervention_verdicts" JSONB NOT NULL,
    "observations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "explanation" TEXT NOT NULL,
    "follow_up_diagnosis_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "triggers_reevaluation" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sleep_observations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6) NOT NULL,
    "time_in_bed_minutes" INTEGER,
    "asleep_minutes" INTEGER,
    "efficiency" SMALLINT,
    "latency_minutes" INTEGER,
    "deep_minutes" INTEGER,
    "rem_minutes" INTEGER,
    "light_minutes" INTEGER,
    "awake_minutes" INTEGER,
    "awakenings" INTEGER,
    "source" TEXT NOT NULL,
    "external_id" TEXT,
    "confidence" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sleep_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_indicators" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "hrv_ms" DECIMAL(6,1),
    "resting_heart_rate_bpm" SMALLINT,
    "sleep_score" SMALLINT,
    "readiness_score" SMALLINT,
    "muscle_soreness" SMALLINT,
    "fatigue" SMALLINT,
    "sleep_quality" SMALLINT,
    "readiness_subjective" SMALLINT,
    "source" TEXT NOT NULL,
    "external_id" TEXT,
    "confidence" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_indicators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projection_snapshots" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "generated_at" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "inputs_json" TEXT NOT NULL,
    "assumptions_json" TEXT NOT NULL,
    "metrics_json" TEXT NOT NULL,
    "supersedes_id" UUID,
    "config_version" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "warnings_json" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projection_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projection_divergences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "projection_snapshot_id" UUID NOT NULL,
    "target" TEXT NOT NULL,
    "horizon" TEXT NOT NULL,
    "detected_at" DATE NOT NULL,
    "projected_central" DECIMAL(10,3) NOT NULL,
    "actual_value" DECIMAL(10,3) NOT NULL,
    "absolute_difference" DECIMAL(10,3) NOT NULL,
    "relative_difference_percent" DECIMAL(6,2) NOT NULL,
    "significant" BOOLEAN NOT NULL,
    "context" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projection_divergences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "context_snapshot" JSONB,
    "evidence_refs" JSONB,
    "proposed_actions" JSONB,
    "is_mock" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT,
    "model" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "key_hash" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'PENDING',
    "response" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key_prefix" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "window_start" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_budgets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "daily_budget" INTEGER NOT NULL DEFAULT 100000,
    "used_today" INTEGER NOT NULL DEFAULT 0,
    "day_start" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "tokens" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "provider_usage" INTEGER,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_token_budget" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "used_today" INTEGER NOT NULL DEFAULT 0,
    "day_start" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "global_token_budget_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "muscle_structures_muscle_id_idx" ON "muscle_structures"("muscle_id");

-- CreateIndex
CREATE UNIQUE INDEX "muscle_structures_muscle_id_slug_key" ON "muscle_structures"("muscle_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "exercises_slug_key" ON "exercises"("slug");

-- CreateIndex
CREATE INDEX "exercises_external_source_id_idx" ON "exercises"("external_source_id");

-- CreateIndex
CREATE INDEX "exercises_movement_pattern_idx" ON "exercises"("movement_pattern");

-- CreateIndex
CREATE INDEX "exercises_variation_key_idx" ON "exercises"("variation_key");

-- CreateIndex
CREATE UNIQUE INDEX "exercises_external_source_id_external_id_key" ON "exercises"("external_source_id", "external_id");

-- CreateIndex
CREATE INDEX "exercise_required_equipment_equipment_id_idx" ON "exercise_required_equipment"("equipment_id");

-- CreateIndex
CREATE INDEX "exercise_muscle_relations_muscle_id_idx" ON "exercise_muscle_relations"("muscle_id");

-- CreateIndex
CREATE INDEX "exercise_muscle_relations_external_source_id_idx" ON "exercise_muscle_relations"("external_source_id");

-- CreateIndex
CREATE UNIQUE INDEX "exercise_muscle_relations_exercise_id_muscle_id_role_key" ON "exercise_muscle_relations"("exercise_id", "muscle_id", "role");

-- CreateIndex
CREATE INDEX "exercise_muscle_structure_relations_structure_id_idx" ON "exercise_muscle_structure_relations"("structure_id");

-- CreateIndex
CREATE INDEX "exercise_muscle_structure_relations_external_source_id_idx" ON "exercise_muscle_structure_relations"("external_source_id");

-- CreateIndex
CREATE UNIQUE INDEX "exercise_muscle_structure_relations_exercise_id_structure_i_key" ON "exercise_muscle_structure_relations"("exercise_id", "structure_id", "role");

-- CreateIndex
CREATE INDEX "exercise_form_versions_exercise_id_idx" ON "exercise_form_versions"("exercise_id");

-- CreateIndex
CREATE INDEX "exercise_form_versions_external_source_id_idx" ON "exercise_form_versions"("external_source_id");

-- CreateIndex
CREATE UNIQUE INDEX "exercise_form_versions_exercise_id_section_kind_position_key" ON "exercise_form_versions"("exercise_id", "section", "kind", "position");

-- CreateIndex
CREATE INDEX "exercise_media_assets_exercise_id_idx" ON "exercise_media_assets"("exercise_id");

-- CreateIndex
CREATE INDEX "exercise_media_assets_form_version_id_idx" ON "exercise_media_assets"("form_version_id");

-- CreateIndex
CREATE INDEX "exercise_media_assets_external_source_id_idx" ON "exercise_media_assets"("external_source_id");

-- CreateIndex
CREATE INDEX "user_exercise_preferences_user_id_idx" ON "user_exercise_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_exercise_preferences_user_id_exercise_id_key" ON "user_exercise_preferences"("user_id", "exercise_id");

-- CreateIndex
CREATE INDEX "training_plans_user_id_active_from_idx" ON "training_plans"("user_id", "active_from" DESC);

-- CreateIndex
CREATE INDEX "training_plan_versions_plan_id_effective_from_idx" ON "training_plan_versions"("plan_id", "effective_from" DESC);

-- CreateIndex
CREATE INDEX "training_plan_sessions_version_id_idx" ON "training_plan_sessions"("version_id");

-- CreateIndex
CREATE UNIQUE INDEX "training_plan_sessions_version_id_dayOfWeek_key" ON "training_plan_sessions"("version_id", "dayOfWeek");

-- CreateIndex
CREATE INDEX "training_plan_exercise_slots_exercise_id_idx" ON "training_plan_exercise_slots"("exercise_id");

-- CreateIndex
CREATE UNIQUE INDEX "training_plan_exercise_slots_session_id_position_key" ON "training_plan_exercise_slots"("session_id", "position");

-- CreateIndex
CREATE INDEX "training_environment_periods_user_id_valid_from_idx" ON "training_environment_periods"("user_id", "valid_from" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "training_environment_periods_user_id_kind_valid_from_key" ON "training_environment_periods"("user_id", "kind", "valid_from");

-- CreateIndex
CREATE INDEX "progression_evaluations_user_id_created_at_idx" ON "progression_evaluations"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "progression_evaluations_plan_version_id_slot_id_fingerprint_key" ON "progression_evaluations"("plan_version_id", "slot_id", "fingerprint");

-- CreateIndex
CREATE INDEX "progression_decision_events_evaluation_id_created_at_idx" ON "progression_decision_events"("evaluation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "progression_decision_events_evaluation_id_idempotency_key_key" ON "progression_decision_events"("evaluation_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "training_plan_progression_rules_slot_id_key" ON "training_plan_progression_rules"("slot_id");

-- CreateIndex
CREATE INDEX "training_plan_constraints_version_id_idx" ON "training_plan_constraints"("version_id");

-- CreateIndex
CREATE INDEX "training_plan_decisions_version_id_idx" ON "training_plan_decisions"("version_id");

-- CreateIndex
CREATE INDEX "workouts_user_id_started_at_idx" ON "workouts"("user_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "workouts_plan_version_id_idx" ON "workouts"("plan_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "workouts_user_id_client_request_id_key" ON "workouts"("user_id", "client_request_id");

-- CreateIndex
CREATE INDEX "workout_exercises_exercise_id_idx" ON "workout_exercises"("exercise_id");

-- CreateIndex
CREATE INDEX "workout_exercises_slot_id_idx" ON "workout_exercises"("slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "workout_exercises_workout_id_position_key" ON "workout_exercises"("workout_id", "position");

-- CreateIndex
-- CreateIndex
CREATE UNIQUE INDEX "exercise_sets_workout_exercise_id_client_request_id_key" ON "exercise_sets"("workout_exercise_id", "client_request_id");

-- CreateIndex
CREATE INDEX "body_measurements_user_id_recorded_at_idx" ON "body_measurements"("user_id", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "body_measurements_external_id_idx" ON "body_measurements"("external_id");

-- CreateIndex
CREATE INDEX "physique_goals_user_id_effective_from_idx" ON "physique_goals"("user_id", "effective_from" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "physique_goal_priorities_physique_goal_id_position_key" ON "physique_goal_priorities"("physique_goal_id", "position");

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
CREATE UNIQUE INDEX "nutrient_definitions_key_key" ON "nutrient_definitions"("key");

-- CreateIndex
CREATE INDEX "nutrient_definitions_category_idx" ON "nutrient_definitions"("category");

-- CreateIndex
CREATE INDEX "nutrient_definitions_is_core_idx" ON "nutrient_definitions"("is_core");

-- CreateIndex
CREATE INDEX "nutrient_definitions_sort_order_idx" ON "nutrient_definitions"("sort_order");

-- CreateIndex
CREATE INDEX "food_nutrient_values_food_id_idx" ON "food_nutrient_values"("food_id");

-- CreateIndex
CREATE INDEX "food_nutrient_values_nutrient_id_idx" ON "food_nutrient_values"("nutrient_id");

-- CreateIndex
CREATE INDEX "food_nutrient_values_provenance_tier_idx" ON "food_nutrient_values"("provenance_tier");

-- CreateIndex
CREATE UNIQUE INDEX "food_nutrient_values_food_id_nutrient_id_preparation_state_key" ON "food_nutrient_values"("food_id", "nutrient_id", "preparation_state");

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

-- CreateIndex
CREATE INDEX "decision_snapshots_user_id_decided_at_idx" ON "decision_snapshots"("user_id", "decided_at" DESC);

-- CreateIndex
CREATE INDEX "decision_snapshots_status_idx" ON "decision_snapshots"("status");

-- CreateIndex
CREATE INDEX "decision_snapshots_unified_state_id_idx" ON "decision_snapshots"("unified_state_id");

-- CreateIndex
CREATE INDEX "decision_interventions_decision_snapshot_id_idx" ON "decision_interventions"("decision_snapshot_id");

-- CreateIndex
CREATE INDEX "decision_evidence_decision_snapshot_id_idx" ON "decision_evidence"("decision_snapshot_id");

-- CreateIndex
CREATE INDEX "decision_evidence_source_engine_code_idx" ON "decision_evidence"("source_engine", "code");

-- CreateIndex
CREATE INDEX "decision_assumptions_decision_snapshot_id_idx" ON "decision_assumptions"("decision_snapshot_id");

-- CreateIndex
CREATE INDEX "decision_assumptions_category_idx" ON "decision_assumptions"("category");

-- CreateIndex
CREATE INDEX "decision_outcomes_decision_snapshot_id_idx" ON "decision_outcomes"("decision_snapshot_id");

-- CreateIndex
CREATE INDEX "decision_outcomes_user_id_idx" ON "decision_outcomes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "decision_outcomes_decision_snapshot_id_evaluation_window_key" ON "decision_outcomes"("decision_snapshot_id", "evaluation_window");

-- CreateIndex
CREATE INDEX "sleep_observations_user_id_date_idx" ON "sleep_observations"("user_id", "date" DESC);

-- CreateIndex
CREATE INDEX "sleep_observations_user_id_started_at_idx" ON "sleep_observations"("user_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "sleep_observations_external_id_idx" ON "sleep_observations"("external_id");

-- CreateIndex
CREATE INDEX "recovery_indicators_user_id_date_idx" ON "recovery_indicators"("user_id", "date" DESC);

-- CreateIndex
CREATE INDEX "recovery_indicators_external_id_idx" ON "recovery_indicators"("external_id");

-- CreateIndex
CREATE INDEX "projection_snapshots_user_id_generated_at_idx" ON "projection_snapshots"("user_id", "generated_at" DESC);

-- CreateIndex
CREATE INDEX "projection_snapshots_status_idx" ON "projection_snapshots"("status");

-- CreateIndex
CREATE INDEX "projection_divergences_projection_snapshot_id_idx" ON "projection_divergences"("projection_snapshot_id");

-- CreateIndex
CREATE INDEX "projection_divergences_user_id_detected_at_idx" ON "projection_divergences"("user_id", "detected_at" DESC);

-- CreateIndex
CREATE INDEX "projection_divergences_target_horizon_idx" ON "projection_divergences"("target", "horizon");

-- CreateIndex
CREATE INDEX "conversations_user_id_updated_at_idx" ON "conversations"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "conversation_messages_conversation_id_created_at_idx" ON "conversation_messages"("conversation_id", "created_at" ASC);

-- CreateIndex
CREATE INDEX "idempotency_key_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_user_id_key_hash_key" ON "idempotency_keys"("user_id", "key_hash");

-- CreateIndex
CREATE INDEX "rate_limit_bucket_window_idx" ON "rate_limit_buckets"("window_start");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_buckets_key_prefix_identifier_key" ON "rate_limit_buckets"("key_prefix", "identifier");

-- CreateIndex
CREATE UNIQUE INDEX "token_budgets_user_id_key" ON "token_budgets"("user_id");

-- CreateIndex
CREATE INDEX "token_budget_day_start_idx" ON "token_budgets"("day_start");

-- CreateIndex
CREATE INDEX "token_reservation_user_status_idx" ON "token_reservations"("user_id", "status");

-- CreateIndex
CREATE INDEX "token_reservation_expires_at_idx" ON "token_reservations"("expires_at");

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
ALTER TABLE "muscle_structures" ADD CONSTRAINT "muscle_structures_muscle_id_fkey" FOREIGN KEY ("muscle_id") REFERENCES "muscles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "exercise_muscle_relations" ADD CONSTRAINT "exercise_muscle_relations_external_source_id_fkey" FOREIGN KEY ("external_source_id") REFERENCES "external_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_muscle_structure_relations" ADD CONSTRAINT "exercise_muscle_structure_relations_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_muscle_structure_relations" ADD CONSTRAINT "exercise_muscle_structure_relations_structure_id_fkey" FOREIGN KEY ("structure_id") REFERENCES "muscle_structures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_muscle_structure_relations" ADD CONSTRAINT "exercise_muscle_structure_relations_external_source_id_fkey" FOREIGN KEY ("external_source_id") REFERENCES "external_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_form_versions" ADD CONSTRAINT "exercise_form_versions_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_form_versions" ADD CONSTRAINT "exercise_form_versions_external_source_id_fkey" FOREIGN KEY ("external_source_id") REFERENCES "external_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_media_assets" ADD CONSTRAINT "exercise_media_assets_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_media_assets" ADD CONSTRAINT "exercise_media_assets_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "exercise_form_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_media_assets" ADD CONSTRAINT "exercise_media_assets_external_source_id_fkey" FOREIGN KEY ("external_source_id") REFERENCES "external_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_exercise_preferences" ADD CONSTRAINT "user_exercise_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_exercise_preferences" ADD CONSTRAINT "user_exercise_preferences_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_plan_versions" ADD CONSTRAINT "training_plan_versions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "training_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_plan_versions" ADD CONSTRAINT "training_plan_versions_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "training_plan_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_plan_sessions" ADD CONSTRAINT "training_plan_sessions_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "training_plan_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_plan_exercise_slots" ADD CONSTRAINT "training_plan_exercise_slots_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "training_plan_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_plan_exercise_slots" ADD CONSTRAINT "training_plan_exercise_slots_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_environment_periods" ADD CONSTRAINT "training_environment_periods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progression_evaluations" ADD CONSTRAINT "progression_evaluations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progression_evaluations" ADD CONSTRAINT "progression_evaluations_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "training_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progression_evaluations" ADD CONSTRAINT "progression_evaluations_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "training_plan_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progression_evaluations" ADD CONSTRAINT "progression_evaluations_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "training_plan_exercise_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progression_decision_events" ADD CONSTRAINT "progression_decision_events_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "progression_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_plan_progression_rules" ADD CONSTRAINT "training_plan_progression_rules_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "training_plan_exercise_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_plan_constraints" ADD CONSTRAINT "training_plan_constraints_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "training_plan_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_plan_decisions" ADD CONSTRAINT "training_plan_decisions_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "training_plan_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "training_plan_exercise_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_workout_exercise_id_fkey" FOREIGN KEY ("workout_exercise_id") REFERENCES "workout_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "body_measurement_values" ADD CONSTRAINT "body_measurement_values_measurement_id_fkey" FOREIGN KEY ("measurement_id") REFERENCES "body_measurements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physique_goals" ADD CONSTRAINT "physique_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physique_goal_priorities" ADD CONSTRAINT "physique_goal_priorities_physique_goal_id_fkey" FOREIGN KEY ("physique_goal_id") REFERENCES "physique_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "nutrient_definitions" ADD CONSTRAINT "nutrient_definitions_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "external_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_nutrient_values" ADD CONSTRAINT "food_nutrient_values_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_nutrient_values" ADD CONSTRAINT "food_nutrient_values_nutrient_id_fkey" FOREIGN KEY ("nutrient_id") REFERENCES "nutrient_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "decision_snapshots" ADD CONSTRAINT "decision_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_snapshots" ADD CONSTRAINT "decision_snapshots_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "decision_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_interventions" ADD CONSTRAINT "decision_interventions_decision_snapshot_id_fkey" FOREIGN KEY ("decision_snapshot_id") REFERENCES "decision_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_evidence" ADD CONSTRAINT "decision_evidence_decision_snapshot_id_fkey" FOREIGN KEY ("decision_snapshot_id") REFERENCES "decision_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_assumptions" ADD CONSTRAINT "decision_assumptions_decision_snapshot_id_fkey" FOREIGN KEY ("decision_snapshot_id") REFERENCES "decision_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_outcomes" ADD CONSTRAINT "decision_outcomes_decision_snapshot_id_fkey" FOREIGN KEY ("decision_snapshot_id") REFERENCES "decision_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_outcomes" ADD CONSTRAINT "decision_outcomes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sleep_observations" ADD CONSTRAINT "sleep_observations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_indicators" ADD CONSTRAINT "recovery_indicators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projection_snapshots" ADD CONSTRAINT "projection_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projection_divergences" ADD CONSTRAINT "projection_divergences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projection_divergences" ADD CONSTRAINT "projection_divergences_projection_snapshot_id_fkey" FOREIGN KEY ("projection_snapshot_id") REFERENCES "projection_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exercise function taxonomy and ordered program roles.
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

-- FitCoach constraints, indexes, history triggers, and reference data.

ALTER TABLE "users" ADD CONSTRAINT "users_timezone_not_empty" CHECK ("timezone" <> '');

ALTER TABLE "profiles" ADD CONSTRAINT "profiles_sex_domain" CHECK ("sex" IS NULL OR "sex" IN ('male','female','intersex','undisclosed'));

ALTER TABLE "profiles" ADD CONSTRAINT "profiles_training_experience_domain" CHECK ("training_experience" IS NULL OR "training_experience" IN ('untrained','beginner','intermediate','advanced'));

ALTER TABLE "profiles" ADD CONSTRAINT "profiles_height_cm_positive" CHECK ("height_cm" IS NULL OR "height_cm" > 0);

ALTER TABLE "profiles" ADD CONSTRAINT "profiles_training_days_per_week_range" CHECK ("training_days_per_week" IS NULL OR "training_days_per_week" BETWEEN 0 AND 7);

ALTER TABLE "profiles" ADD CONSTRAINT "profiles_session_duration_minutes_positive" CHECK ("session_duration_minutes" IS NULL OR "session_duration_minutes" > 0);

ALTER TABLE "profiles" ADD CONSTRAINT "profiles_unit_system_domain" CHECK ("unit_system" IN ('metric','imperial'));

ALTER TABLE "profile_revisions" ADD CONSTRAINT "profile_revisions_sex_domain" CHECK ("sex" IS NULL OR "sex" IN ('male','female','intersex','undisclosed'));

ALTER TABLE "profile_revisions" ADD CONSTRAINT "profile_revisions_training_experience_domain" CHECK ("training_experience" IS NULL OR "training_experience" IN ('untrained','beginner','intermediate','advanced'));

ALTER TABLE "profile_revisions" ADD CONSTRAINT "profile_revisions_height_cm_positive" CHECK ("height_cm" IS NULL OR "height_cm" > 0);

ALTER TABLE "profile_revisions" ADD CONSTRAINT "profile_revisions_training_days_per_week_range" CHECK ("training_days_per_week" IS NULL OR "training_days_per_week" BETWEEN 0 AND 7);

ALTER TABLE "profile_revisions" ADD CONSTRAINT "profile_revisions_session_duration_minutes_positive" CHECK ("session_duration_minutes" IS NULL OR "session_duration_minutes" > 0);

ALTER TABLE "goals" ADD CONSTRAINT "goals_kind_domain" CHECK ("kind" IN ('bodybuilding','aesthetics_v_taper','lean_recomposition','athletic_performance','max_strength','general_fitness','custom'));

ALTER TABLE "goals" ADD CONSTRAINT "goals_effective_window" CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from");

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

ALTER TABLE "goal_priorities" ADD CONSTRAINT "goal_priorities_position_nonneg" CHECK ("position" >= 0);

ALTER TABLE "equipment" ADD CONSTRAINT "equipment_category_domain" CHECK ("category" IN ('barbell','dumbbell','kettlebell','machine','cable','smith_machine','bench','rack','pull_up_bar','bands','bodyweight','cardio_machine','accessory','other'));

ALTER TABLE "user_equipment" ADD CONSTRAINT "user_equipment_validity_window" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from");

ALTER TABLE "external_sources" ADD CONSTRAINT "external_sources_verified_needs_license" CHECK ("license_verified" = false OR "license_spdx" IS NOT NULL);

ALTER TABLE "muscles" ADD CONSTRAINT "muscles_group_domain" CHECK ("group" IN ('chest','upper_back','lats','traps','front_delts','side_delts','rear_delts','biceps','triceps','forearms','quadriceps','hamstrings','glutes','adductors','calves','abdominals','obliques','lower_back','neck','other'));

ALTER TABLE "exercises" ADD CONSTRAINT "exercises_category_domain" CHECK ("category" IN ('compound','isolation','conditioning','mobility','other'));

ALTER TABLE "exercises" ADD CONSTRAINT "exercises_movement_pattern_domain" CHECK ("movement_pattern" IS NULL OR "movement_pattern" IN ('horizontal_push','vertical_push','horizontal_pull','vertical_pull','squat','hinge','lunge','carry','core','rotation','conditioning','other'));

ALTER TABLE "exercise_muscle_relations" ADD CONSTRAINT "exercise_muscle_relations_role_domain" CHECK ("role" IN ('primary_mover','secondary_mover','supporting','stabilizer'));

ALTER TABLE "exercise_muscle_relations" ADD CONSTRAINT "exercise_muscle_relations_weight_range" CHECK ("emphasis" BETWEEN 0 AND 1);

ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_status_domain" CHECK ("status" IN ('draft','active','paused','retired'));

ALTER TABLE "workouts" ADD CONSTRAINT "workouts_status_domain" CHECK ("status" IN ('planned','in_progress','completed','partial','skipped'));

ALTER TABLE "workouts" ADD CONSTRAINT "workouts_time_window" CHECK ("ended_at" IS NULL OR "ended_at" > "started_at");

ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_kind_domain" CHECK ("kind" IN ('warmup','working','drop_set','rest_pause','amrap','failure'));

ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_load_nonneg" CHECK ("load_kg" IS NULL OR "load_kg" >= 0);

ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_added_load_nonneg" CHECK ("added_load_kg" IS NULL OR "added_load_kg" >= 0);

ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_reps_range" CHECK ("reps" IS NULL OR "reps" BETWEEN 0 AND 1000);

ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_distance_nonneg" CHECK ("distance_meters" IS NULL OR "distance_meters" >= 0);

ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_duration_nonneg" CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0);

ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_rir_range" CHECK ("rir" IS NULL OR "rir" BETWEEN 0 AND 10);

ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_rpe_range" CHECK ("rpe" IS NULL OR "rpe" BETWEEN 0 AND 10);

ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_has_measurable" CHECK ("reps" IS NOT NULL OR "distance_meters" IS NOT NULL OR "duration_seconds" IS NOT NULL);

ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_condition_domain" CHECK ("condition" IS NULL OR "condition" IN ('morning_fasted','post_workout','evening','random','other'));

ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_weight_positive" CHECK ("body_weight_kg" IS NULL OR "body_weight_kg" > 0);

ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_body_fat_range" CHECK ("body_fat_percent" IS NULL OR "body_fat_percent" BETWEEN 0 AND 60);

ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_entered_via_domain" CHECK ("entered_via" IS NULL OR "entered_via" IN ('manual','smart_scale_import','wearable_import','other'));

ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_confidence_domain" CHECK ("confidence" IS NULL OR "confidence" IN ('measured','estimated','unknown'));

ALTER TABLE "body_measurement_values" ADD CONSTRAINT "body_measurement_values_site_domain" CHECK ("site" IN ('neck','shoulders','chest','waist','hips','left_upper_arm','right_upper_arm','left_thigh','right_thigh','left_calf','right_calf'));

ALTER TABLE "body_measurement_values" ADD CONSTRAINT "body_measurement_values_positive" CHECK ("value_cm" > 0);

ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_kind_domain" CHECK ("kind" IN ('steps','walk','run','cycle','row','swim','elliptical','stairs','sport','other'));

ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_steps_nonneg" CHECK ("steps" IS NULL OR "steps" >= 0);

ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_duration_nonneg" CHECK ("duration_minutes" IS NULL OR "duration_minutes" >= 0);

ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_distance_nonneg" CHECK ("distance_km" IS NULL OR "distance_km" >= 0);

ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_hr_range" CHECK ("average_heart_rate_bpm" IS NULL OR "average_heart_rate_bpm" BETWEEN 20 AND 260);

ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_calories_nonneg" CHECK ("estimated_calories_burned" IS NULL OR "estimated_calories_burned" >= 0);

ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_effort_domain" CHECK ("effort" IS NULL OR "effort" IN ('low','moderate','high'));

ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_steps_only_on_steps" CHECK ("kind" <> 'steps' OR "steps" IS NOT NULL);

ALTER TABLE "activity_records" ADD CONSTRAINT "activity_records_steps_only_kind_steps" CHECK ("kind" = 'steps' OR "steps" IS NULL);

ALTER TABLE "food_sources" ADD CONSTRAINT "food_sources_kind_domain" CHECK ("kind" IN ('curated_database','user_created','imported','estimate'));

ALTER TABLE "food_sources" ADD CONSTRAINT "food_sources_confidence_domain" CHECK ("default_confidence" IN ('measured','label_declared','estimated','unknown'));

ALTER TABLE "food_sources" ADD CONSTRAINT "food_sources_user_created_has_owner" CHECK ("kind" <> 'user_created' OR "owner_user_id" IS NOT NULL);

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

ALTER TABLE "food_servings" ADD CONSTRAINT "food_servings_single_basis" CHECK (
  (("grams" IS NOT NULL)::int + ("milliliters" IS NOT NULL)::int = 1 AND "unit_quantity" IS NULL)
  OR ("unit_quantity" IS NOT NULL AND "unit_name" IS NOT NULL AND "grams" IS NULL AND "milliliters" IS NULL));

ALTER TABLE "food_servings" ADD CONSTRAINT "food_servings_grams_positive" CHECK ("grams" IS NULL OR "grams" > 0);

ALTER TABLE "food_servings" ADD CONSTRAINT "food_servings_milliliters_positive" CHECK ("milliliters" IS NULL OR "milliliters" > 0);

ALTER TABLE "food_servings" ADD CONSTRAINT "food_servings_unit_quantity_positive" CHECK ("unit_quantity" IS NULL OR "unit_quantity" > 0);

ALTER TABLE "recipes" ADD CONSTRAINT "recipes_servings_positive" CHECK ("servings" > 0);

ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_quantity_positive" CHECK ("quantity_grams" > 0);

ALTER TABLE "meals" ADD CONSTRAINT "meals_slot_domain" CHECK ("slot" IS NULL OR "slot" IN ('breakfast','lunch','dinner','snack','other'));

ALTER TABLE "meals" ADD CONSTRAINT "meals_total_calories_nonneg" CHECK ("total_calories_kcal" >= 0);

ALTER TABLE "meals" ADD CONSTRAINT "meals_total_protein_nonneg" CHECK ("total_protein_g" >= 0);

ALTER TABLE "meals" ADD CONSTRAINT "meals_total_carbohydrate_nonneg" CHECK ("total_carbohydrate_g" >= 0);

ALTER TABLE "meals" ADD CONSTRAINT "meals_total_fat_nonneg" CHECK ("total_fat_g" >= 0);

ALTER TABLE "meals" ADD CONSTRAINT "meals_total_fiber_nonneg" CHECK ("total_fiber_g" IS NULL OR "total_fiber_g" >= 0);

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

ALTER TABLE "daily_nutrition" ADD CONSTRAINT "daily_nutrition_total_calories_nonneg" CHECK ("total_calories_kcal" >= 0);

ALTER TABLE "daily_nutrition" ADD CONSTRAINT "daily_nutrition_total_protein_nonneg" CHECK ("total_protein_g" >= 0);

ALTER TABLE "daily_nutrition" ADD CONSTRAINT "daily_nutrition_total_carbohydrate_nonneg" CHECK ("total_carbohydrate_g" >= 0);

ALTER TABLE "daily_nutrition" ADD CONSTRAINT "daily_nutrition_total_fat_nonneg" CHECK ("total_fat_g" >= 0);

ALTER TABLE "daily_nutrition" ADD CONSTRAINT "daily_nutrition_total_fiber_nonneg" CHECK ("total_fiber_g" IS NULL OR "total_fiber_g" >= 0);

ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_severity_domain" CHECK ("severity" IN ('informational','watch','act','urgent'));

ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_status_domain" CHECK ("status" IN ('open','monitoring','resolved','dismissed'));

ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_status_domain" CHECK ("status" IN ('presented','acknowledged','acted_on','dismissed','expired'));

ALTER TABLE "interventions" ADD CONSTRAINT "interventions_kind_domain" CHECK ("kind" IN ('nutrition_target_adjustment','food_choice_guidance','activity_target_adjustment','training_volume_adjustment','exercise_substitution','split_structure_adjustment','progression_scheme_adjustment','measurement_protocol_adjustment','recovery_adjustment','no_change','custom'));

ALTER TABLE "interventions" ADD CONSTRAINT "interventions_status_domain" CHECK ("status" IN ('proposed','accepted','active','completed','rejected','superseded'));

ALTER TABLE "intervention_outcomes" ADD CONSTRAINT "intervention_outcomes_verdict_domain" CHECK ("verdict" IN ('improved_as_expected','no_effect','worsened','uncertain','too_early'));

CREATE UNIQUE INDEX "goals_one_active_per_user" ON "goals" ("user_id") WHERE "effective_until" IS NULL;

CREATE UNIQUE INDEX "users_email_lower_unique" ON "users" (lower("email")) WHERE "email" IS NOT NULL;

CREATE UNIQUE INDEX "activity_records_steps_source_day_unique"
  ON "activity_records" ("user_id", "date", COALESCE("recorded_via", ''))
  WHERE "kind" = 'steps';

CREATE UNIQUE INDEX "body_measurements_import_unique"
  ON "body_measurements" ("user_id", COALESCE("entered_via", ''), "external_id")
  WHERE COALESCE("external_id", '') <> '';

CREATE UNIQUE INDEX "exercise_sets_position_unique" ON "exercise_sets" ("workout_exercise_id", "position");

CREATE INDEX "diagnoses_open_idx" ON "diagnoses" ("user_id", "created_at" DESC) WHERE "status" IN ('open','monitoring');

CREATE INDEX "interventions_active_idx" ON "interventions" ("user_id", "created_at" DESC) WHERE "status" = 'active';

CREATE INDEX "workouts_open_idx" ON "workouts" ("user_id", "started_at" DESC) WHERE "status" IN ('planned','in_progress');

CREATE INDEX "exercises_aliases_gin" ON "exercises" USING GIN ("aliases");

CREATE INDEX "body_measurement_values_site_idx" ON "body_measurement_values" ("site") INCLUDE ("value_cm");

ALTER TABLE "goals" DROP CONSTRAINT "goals_superseded_by_goal_id_fkey";

ALTER TABLE "goals" ADD CONSTRAINT "goals_superseded_by_goal_id_fkey" FOREIGN KEY ("superseded_by_goal_id") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "workouts" DROP CONSTRAINT "workouts_plan_version_id_fkey";

ALTER TABLE "workouts" ADD CONSTRAINT "workouts_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "training_plan_versions"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "diagnoses" DROP CONSTRAINT "diagnoses_active_goal_id_fkey";

ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_active_goal_id_fkey" FOREIGN KEY ("active_goal_id") REFERENCES "goals"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "diagnoses" DROP CONSTRAINT "diagnoses_active_plan_version_id_fkey";

ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_active_plan_version_id_fkey" FOREIGN KEY ("active_plan_version_id") REFERENCES "training_plan_versions"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "recommendations" DROP CONSTRAINT "recommendations_diagnosis_id_fkey";

ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_diagnosis_id_fkey" FOREIGN KEY ("diagnosis_id") REFERENCES "diagnoses"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "recommendations" DROP CONSTRAINT "recommendations_intervention_id_fkey";

ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_intervention_id_fkey" FOREIGN KEY ("intervention_id") REFERENCES "interventions"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "interventions" DROP CONSTRAINT "interventions_diagnosis_id_fkey";

ALTER TABLE "interventions" ADD CONSTRAINT "interventions_diagnosis_id_fkey" FOREIGN KEY ("diagnosis_id") REFERENCES "diagnoses"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "interventions" DROP CONSTRAINT "interventions_active_goal_id_fkey";

ALTER TABLE "interventions" ADD CONSTRAINT "interventions_active_goal_id_fkey" FOREIGN KEY ("active_goal_id") REFERENCES "goals"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "interventions" DROP CONSTRAINT "interventions_active_plan_version_id_fkey";

ALTER TABLE "interventions" ADD CONSTRAINT "interventions_active_plan_version_id_fkey" FOREIGN KEY ("active_plan_version_id") REFERENCES "training_plan_versions"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "intervention_outcomes" DROP CONSTRAINT "intervention_outcomes_intervention_id_fkey";

ALTER TABLE "intervention_outcomes" ADD CONSTRAINT "intervention_outcomes_intervention_id_fkey" FOREIGN KEY ("intervention_id") REFERENCES "interventions"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "recipe_items" DROP CONSTRAINT "recipe_items_food_id_fkey";

ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "meal_items" DROP CONSTRAINT "meal_items_food_id_fkey";

ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "meal_items" DROP CONSTRAINT "meal_items_recipe_id_fkey";

ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

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

CREATE TRIGGER "profile_revisions_no_update" BEFORE UPDATE ON "profile_revisions" FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();

CREATE TRIGGER "physique_targets_no_update" BEFORE UPDATE ON "physique_targets" FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();

CREATE TRIGGER "goal_priorities_no_update" BEFORE UPDATE ON "goal_priorities" FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();

CREATE TRIGGER "training_plan_sessions_no_update" BEFORE UPDATE ON "training_plan_sessions" FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();

CREATE TRIGGER "training_plan_exercise_slots_no_update" BEFORE UPDATE ON "training_plan_exercise_slots" FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();

CREATE TRIGGER "body_measurements_no_update" BEFORE UPDATE ON "body_measurements" FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();

CREATE TRIGGER "body_measurement_values_no_update" BEFORE UPDATE ON "body_measurement_values" FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();

CREATE TRIGGER "diagnosis_evidence_no_update" BEFORE UPDATE ON "diagnosis_evidence" FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();

CREATE TRIGGER "recommendation_evidence_no_update" BEFORE UPDATE ON "recommendation_evidence" FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();

CREATE TRIGGER "intervention_outcomes_no_update" BEFORE UPDATE ON "intervention_outcomes" FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();

CREATE TRIGGER "goals_lifecycle_only" BEFORE UPDATE ON "goals" FOR EACH ROW EXECUTE FUNCTION fitcoach_guard_lifecycle_columns('effective_until', 'superseded_by_goal_id');

CREATE TRIGGER "diagnoses_lifecycle_only" BEFORE UPDATE ON "diagnoses" FOR EACH ROW EXECUTE FUNCTION fitcoach_guard_lifecycle_columns('status', 'resolved_at');

CREATE TRIGGER "recommendations_lifecycle_only" BEFORE UPDATE ON "recommendations" FOR EACH ROW EXECUTE FUNCTION fitcoach_guard_lifecycle_columns('status', 'acknowledged_at', 'dismissed_at');

CREATE TRIGGER "interventions_lifecycle_only" BEFORE UPDATE ON "interventions" FOR EACH ROW EXECUTE FUNCTION fitcoach_guard_lifecycle_columns('status', 'accepted_at', 'completed_at', 'superseded_by_intervention_id');

CREATE TRIGGER "activity_records_steps_only" BEFORE UPDATE ON "activity_records" FOR EACH ROW EXECUTE FUNCTION fitcoach_guard_steps_import();

CREATE TRIGGER "workout_exercises_frozen_when_done" BEFORE UPDATE ON "workout_exercises" FOR EACH ROW EXECUTE FUNCTION fitcoach_guard_workout_exercise_frozen();

CREATE TRIGGER "exercise_sets_frozen_when_done" BEFORE UPDATE ON "exercise_sets" FOR EACH ROW EXECUTE FUNCTION fitcoach_guard_set_frozen();

CREATE CONSTRAINT TRIGGER "body_measurements_require_datum"
  AFTER INSERT ON "body_measurements"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fitcoach_check_measurement_has_datum();

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

CREATE UNIQUE INDEX "exercises_variation_key_key" ON "exercises"("variation_key")
  WHERE "variation_key" IS NOT NULL;

ALTER TABLE "user_equipment" ADD CONSTRAINT "user_equipment_availability_domain"
  CHECK ("availability" IN ('available','temporarily_unavailable','unavailable'));

ALTER TABLE "muscle_structures" ADD CONSTRAINT "muscle_structures_kind_domain"
  CHECK ("kind" IN ('head','region','portion'));

ALTER TABLE "exercise_muscle_structure_relations"
  ADD CONSTRAINT "exercise_muscle_structure_relations_role_domain"
  CHECK ("role" IN ('primary_mover','secondary_mover','supporting','stabilizer'));

ALTER TABLE "exercise_muscle_structure_relations"
  ADD CONSTRAINT "exercise_muscle_structure_relations_weight_range"
  CHECK ("emphasis" BETWEEN 0 AND 1);

ALTER TABLE "exercise_media_assets" ADD CONSTRAINT "exercise_media_assets_angle_domain"
  CHECK ("angle" IN ('primary','front','side','rear','grip_close_up','movement_path'));

ALTER TABLE "user_exercise_preferences" ADD CONSTRAINT "user_exercise_preferences_preference_domain"
  CHECK ("preference" IN ('preferred','neutral','disliked','excluded'));

CREATE TRIGGER "exercise_form_versions_lifecycle_only" BEFORE UPDATE ON "exercise_form_versions"
  FOR EACH ROW EXECUTE FUNCTION fitcoach_guard_lifecycle_columns('is_active', 'updated_at');

CREATE UNIQUE INDEX "training_plan_versions_one_active_per_plan"
  ON "training_plan_versions"("plan_id")
  WHERE "status" = 'active';

CREATE TRIGGER "training_plan_versions_lifecycle_only"
  BEFORE UPDATE ON "training_plan_versions"
  FOR EACH ROW EXECUTE FUNCTION fitcoach_guard_lifecycle_columns(
    'status', 'effective_until', 'updated_at'
  );

CREATE TRIGGER "training_plan_decisions_no_update"
  BEFORE UPDATE ON "training_plan_decisions"
  FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();

ALTER TABLE "training_plan_constraints" ADD CONSTRAINT "training_plan_constraints_result_domain"
  CHECK ("result" IN ('satisfied','violated','warning'));

ALTER TABLE "training_plan_constraints" ADD CONSTRAINT "training_plan_constraints_key_not_empty"
  CHECK ("constraint_key" <> '' AND "label" <> '');

ALTER TABLE "training_plan_constraints" ADD CONSTRAINT "training_plan_constraints_violation_detail_required"
  CHECK ("result" <> 'violated' OR "violation_detail" IS NOT NULL);

CREATE TRIGGER "training_plan_constraints_no_update"
  BEFORE UPDATE ON "training_plan_constraints"
  FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();

ALTER TABLE "training_plan_progression_rules" ADD CONSTRAINT "training_plan_progression_rules_action_domain"
  CHECK ("action" IN (
    'progress_load','progress_reps','maintain','regress','hold','repeat',
    'modify_target','reduce_stimulus'));

ALTER TABLE "training_plan_progression_rules" ADD CONSTRAINT "training_plan_progression_rules_text_not_empty"
  CHECK ("trigger" <> '' AND "condition" <> '' AND "bounds" <> '' AND "rationale" <> '');

CREATE TRIGGER "training_plan_progression_rules_no_update"
  BEFORE UPDATE ON "training_plan_progression_rules"
  FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();

ALTER TABLE "training_environment_periods" ADD CONSTRAINT "training_environment_periods_kind_domain"
  CHECK ("kind" IN ('gym','home','home_no_equipment','home_limited_equipment','hotel','travel','outdoor','custom'));

CREATE TRIGGER "training_environment_periods_lifecycle_only"
  BEFORE UPDATE ON "training_environment_periods"
  FOR EACH ROW EXECUTE FUNCTION fitcoach_guard_lifecycle_columns('valid_to', 'updated_at');

ALTER TABLE "progression_evaluations" ADD CONSTRAINT "progression_evaluations_outcome_domain"
  CHECK ("outcome" IN (
    'increase_load','increase_reps','maintain','repeat','reduce_load','reduce_target',
    'modify_rep_range','modify_rir_target','change_exercise','no_change','insufficient_data'));

ALTER TABLE "progression_evaluations" ADD CONSTRAINT "progression_evaluations_environment_kind_domain"
  CHECK ("environment_kind" IS NULL OR "environment_kind" IN (
    'gym','home','home_no_equipment','home_limited_equipment','hotel','travel','outdoor','custom'));

ALTER TABLE "progression_evaluations" ADD CONSTRAINT "progression_evaluations_text_not_empty"
  CHECK ("exercise_name" <> '' AND "fingerprint" <> '' AND "config_version" <> '');

CREATE TRIGGER "progression_evaluations_no_update"
  BEFORE UPDATE ON "progression_evaluations"
  FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();

ALTER TABLE "progression_decision_events" ADD CONSTRAINT "progression_decision_events_decision_domain"
  CHECK ("decision" IN ('recommended','accepted','rejected','deferred'));

CREATE TRIGGER "progression_decision_events_no_update"
  BEFORE UPDATE ON "progression_decision_events"
  FOR EACH ROW EXECUTE FUNCTION fitcoach_forbid_update();

ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_kind_domain"
  CHECK ("kind" IN ('primary','temporary_environment'));

CREATE UNIQUE INDEX "training_plans_one_active_primary_per_user"
  ON "training_plans"("user_id") WHERE "status" = 'active' AND "kind" = 'primary';

ALTER TABLE "workouts" ADD CONSTRAINT "workouts_environment_kind_domain"
  CHECK ("environment_kind" IS NULL OR "environment_kind" IN (
    'gym','home','home_no_equipment','home_limited_equipment','hotel','travel','outdoor','custom'));

ALTER TABLE "workouts" ADD CONSTRAINT "workouts_session_classification_domain"
  CHECK ("session_classification" IS NULL OR "session_classification" IN (
    'planned','adapted','makeup','unplanned'));

ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_performance_source_domain"
  CHECK ("performance_source" IS NULL OR "performance_source" IN ('manual','imported','inferred'));

ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_load_kind_domain"
  CHECK ("load_kind" IS NULL OR "load_kind" IN (
    'external_load','bodyweight','weighted_bodyweight','assisted_bodyweight','band','none'));

ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_assistance_nonneg"
  CHECK ("assistance_load_kg" IS NULL OR "assistance_load_kg" >= 0);

ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_load_kind_consistent"
  CHECK (
    ("load_kind" IS NULL)
    OR ("load_kind" = 'external_load' AND "load_kg" IS NOT NULL)
    OR ("load_kind" = 'weighted_bodyweight' AND "added_load_kg" IS NOT NULL)
    OR ("load_kind" = 'assisted_bodyweight' AND "assistance_load_kg" IS NOT NULL)
    OR ("load_kind" IN ('bodyweight','band','none') AND "load_kg" IS NULL AND "added_load_kg" IS NULL)
  );

ALTER TABLE nutrient_definitions ADD CONSTRAINT nutrient_definitions_unit_check
    CHECK (unit IN ('kcal', 'kj', 'g', 'mg', 'mcg', 'iu'));

ALTER TABLE nutrient_definitions ADD CONSTRAINT nutrient_definitions_category_check
    CHECK (category IN ('energy', 'macronutrient', 'fiber', 'sugar', 'fat_detail', 'mineral', 'vitamin', 'amino_acid', 'other'));

ALTER TABLE food_nutrient_values ADD CONSTRAINT food_nutrient_values_confidence_check
    CHECK (confidence IN ('measured', 'label_declared', 'estimated', 'unknown'));

ALTER TABLE food_nutrient_values ADD CONSTRAINT food_nutrient_values_provenance_tier_check
    CHECK (provenance_tier IN ('first_party', 'verified_external', 'branded', 'restaurant', 'user_created', 'photo_derived_estimate', 'ai_parsed'));

ALTER TABLE food_nutrient_values ADD CONSTRAINT food_nutrient_values_preparation_state_check
    CHECK (preparation_state IN ('raw', 'cooked', 'unprepared', 'prepared', 'unknown') OR preparation_state IS NULL);

INSERT INTO nutrient_definitions (id, key, display_name, unit, category, precision, rdi_value, rdi_unit, sort_order, is_core, is_active) VALUES
    (gen_random_uuid(), 'calories_kcal', 'Energy', 'kcal', 'energy', 0, 2000, 'kcal', 0, TRUE, TRUE),
    (gen_random_uuid(), 'calories_kj', 'Energy', 'kj', 'energy', 0, 8370, 'kj', 1, FALSE, TRUE),
    (gen_random_uuid(), 'protein_grams', 'Protein', 'g', 'macronutrient', 1, 50, 'g', 10, TRUE, TRUE),
    (gen_random_uuid(), 'carbohydrate_grams', 'Carbohydrate', 'g', 'macronutrient', 1, 275, 'g', 20, TRUE, TRUE),
    (gen_random_uuid(), 'fat_grams', 'Total Fat', 'g', 'macronutrient', 1, 78, 'g', 30, TRUE, TRUE),
    (gen_random_uuid(), 'fiber_grams', 'Dietary Fiber', 'g', 'fiber', 1, 28, 'g', 40, TRUE, TRUE),
    (gen_random_uuid(), 'sugars_grams', 'Total Sugars', 'g', 'sugar', 1, NULL, NULL, 50, TRUE, TRUE),
    -- Fat detail
    (gen_random_uuid(), 'saturated_fat_grams', 'Saturated Fat', 'g', 'fat_detail', 1, 20, 'g', 60, TRUE, TRUE),
    (gen_random_uuid(), 'monounsaturated_fat_grams', 'Monounsaturated Fat', 'g', 'fat_detail', 1, NULL, NULL, 61, FALSE, TRUE),
    (gen_random_uuid(), 'polyunsaturated_fat_grams', 'Polyunsaturated Fat', 'g', 'fat_detail', 1, NULL, NULL, 62, FALSE, TRUE),
    (gen_random_uuid(), 'trans_fat_grams', 'Trans Fat', 'g', 'fat_detail', 1, NULL, NULL, 63, TRUE, TRUE),
    (gen_random_uuid(), 'omega3_grams', 'Omega-3 Fatty Acids', 'g', 'fat_detail', 3, 1.6, 'g', 64, FALSE, TRUE),
    (gen_random_uuid(), 'omega6_grams', 'Omega-6 Fatty Acids', 'g', 'fat_detail', 3, 17, 'g', 65, FALSE, TRUE),
    -- Minerals
    (gen_random_uuid(), 'sodium_mg', 'Sodium', 'mg', 'mineral', 0, 2300, 'mg', 70, TRUE, TRUE),
    (gen_random_uuid(), 'potassium_mg', 'Potassium', 'mg', 'mineral', 0, 4700, 'mg', 71, FALSE, TRUE),
    (gen_random_uuid(), 'calcium_mg', 'Calcium', 'mg', 'mineral', 0, 1300, 'mg', 72, FALSE, TRUE),
    (gen_random_uuid(), 'iron_mg', 'Iron', 'mg', 'mineral', 1, 18, 'mg', 73, FALSE, TRUE),
    (gen_random_uuid(), 'magnesium_mg', 'Magnesium', 'mg', 'mineral', 0, 420, 'mg', 74, FALSE, TRUE),
    (gen_random_uuid(), 'zinc_mg', 'Zinc', 'mg', 'mineral', 1, 11, 'mg', 75, FALSE, TRUE),
    (gen_random_uuid(), 'copper_mg', 'Copper', 'mg', 'mineral', 3, 0.9, 'mg', 76, FALSE, TRUE),
    (gen_random_uuid(), 'manganese_mg', 'Manganese', 'mg', 'mineral', 1, 2.3, 'mg', 77, FALSE, TRUE),
    (gen_random_uuid(), 'selenium_mcg', 'Selenium', 'mcg', 'mineral', 0, 55, 'mcg', 78, FALSE, TRUE),
    -- Vitamins
    (gen_random_uuid(), 'vitamin_a_mcg_rae', 'Vitamin A (RAE)', 'mcg', 'vitamin', 0, 900, 'mcg', 80, FALSE, TRUE),
    (gen_random_uuid(), 'vitamin_c_mg', 'Vitamin C', 'mg', 'vitamin', 0, 90, 'mg', 81, FALSE, TRUE),
    (gen_random_uuid(), 'vitamin_d_mcg', 'Vitamin D', 'mcg', 'vitamin', 1, 20, 'mcg', 82, FALSE, TRUE),
    (gen_random_uuid(), 'vitamin_e_mg', 'Vitamin E', 'mg', 'vitamin', 1, 15, 'mg', 83, FALSE, TRUE),
    (gen_random_uuid(), 'vitamin_k_mcg', 'Vitamin K', 'mcg', 'vitamin', 0, 120, 'mcg', 84, FALSE, TRUE),
    (gen_random_uuid(), 'thiamin_mg', 'Thiamin (B1)', 'mg', 'vitamin', 2, 1.2, 'mg', 85, FALSE, TRUE),
    (gen_random_uuid(), 'riboflavin_mg', 'Riboflavin (B2)', 'mg', 'vitamin', 2, 1.3, 'mg', 86, FALSE, TRUE),
    (gen_random_uuid(), 'niacin_mg', 'Niacin (B3)', 'mg', 'vitamin', 1, 16, 'mg', 87, FALSE, TRUE),
    (gen_random_uuid(), 'vitamin_b6_mg', 'Vitamin B6', 'mg', 'vitamin', 2, 1.7, 'mg', 88, FALSE, TRUE),
    (gen_random_uuid(), 'folate_mcg_dfe', 'Folate (DFE)', 'mcg', 'vitamin', 0, 400, 'mcg', 89, FALSE, TRUE),
    (gen_random_uuid(), 'vitamin_b12_mcg', 'Vitamin B12', 'mcg', 'vitamin', 2, 2.4, 'mcg', 90, FALSE, TRUE),
    (gen_random_uuid(), 'choline_mg', 'Choline', 'mg', 'vitamin', 0, 550, 'mg', 91, FALSE, TRUE),
    -- Other
    (gen_random_uuid(), 'cholesterol_mg', 'Cholesterol', 'mg', 'other', 0, 300, 'mg', 100, TRUE, TRUE),
    (gen_random_uuid(), 'alcohol_grams', 'Alcohol', 'g', 'other', 1, NULL, NULL, 101, TRUE, TRUE);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER nutrient_definitions_updated_at
    BEFORE UPDATE ON nutrient_definitions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER food_nutrient_values_updated_at
    BEFORE UPDATE ON food_nutrient_values
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE decision_snapshots ADD CONSTRAINT decision_snapshots_kind_check
    CHECK (kind IN ('no_change', 'intervention_selected', 'plan_adaptation', 'measurement_protocol_change'));

ALTER TABLE decision_snapshots ADD CONSTRAINT decision_snapshots_status_check
    CHECK (status IN ('current', 'superseded', 'archived'));

ALTER TABLE decision_snapshots ADD CONSTRAINT decision_snapshots_confidence_check
    CHECK (confidence IN ('measured', 'label_declared', 'estimated', 'unknown'));

ALTER TABLE decision_interventions ADD CONSTRAINT decision_interventions_kind_check
    CHECK (kind IN ('nutrition_target_adjustment', 'training_volume_adjustment', 'exercise_substitution', 'split_structure_adjustment', 'progression_scheme_adjustment', 'recovery_adjustment', 'activity_target_adjustment', 'measurement_protocol_adjustment', 'food_choice_guidance', 'no_change'));

ALTER TABLE decision_evidence ADD CONSTRAINT decision_evidence_source_engine_check
    CHECK (source_engine IN ('training_state', 'nutrition_state', 'body_state', 'recovery_state', 'activity_state', 'projection_state', 'goal_state'));

ALTER TABLE decision_evidence ADD CONSTRAINT decision_evidence_confidence_check
    CHECK (confidence IN ('measured', 'label_declared', 'estimated', 'unknown'));

ALTER TABLE decision_evidence ADD CONSTRAINT decision_evidence_provenance_class_check
    CHECK (provenance_class IN ('direct_measurement', 'label_declared', 'derived_calculation', 'heuristic_estimate', 'user_reported', 'third_party_import'));

ALTER TABLE decision_evidence ADD CONSTRAINT decision_evidence_severity_check
    CHECK (severity IN ('informational', 'watch', 'act', 'urgent'));

ALTER TABLE decision_assumptions ADD CONSTRAINT decision_assumptions_category_check
    CHECK (category IN ('adherence', 'progression_rate', 'recovery', 'measurement_consistency'));

ALTER TABLE decision_assumptions ADD CONSTRAINT decision_assumptions_source_check
    CHECK (source IN ('configuration', 'projection', 'user_declared'));

ALTER TABLE decision_outcomes ADD CONSTRAINT decision_outcomes_verdict_check
    CHECK (verdict IN ('improved_as_expected', 'partially_improved', 'no_effect', 'worsened', 'uncertain', 'too_early'));

CREATE TRIGGER decision_snapshots_updated_at
    BEFORE UPDATE ON decision_snapshots
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE conversations ADD CONSTRAINT conversations_status_check
    CHECK (status IN ('active', 'archived'));

ALTER TABLE conversation_messages ADD CONSTRAINT conversation_messages_role_check
    CHECK (role IN ('user', 'assistant', 'system'));

CREATE TRIGGER conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Match nullable media identities during atomic upserts.
CREATE UNIQUE INDEX "exercise_media_assets_identity_key"
  ON "exercise_media_assets" ("exercise_id", "type", "angle", "form_version_id") NULLS NOT DISTINCT;

CREATE UNIQUE INDEX "training_plan_versions_plan_id_version_number_key"
  ON "training_plan_versions" ("plan_id", "version_number");
ALTER TABLE "training_plan_versions" ADD CONSTRAINT "training_plan_versions_number_positive"
  CHECK ("version_number" >= 1);

-- Domain guards adapted to the current plan, environment, and catalogue columns.
ALTER TABLE "training_plan_versions" ADD CONSTRAINT "training_plan_versions_window"
  CHECK ("effective_until" IS NULL OR "effective_until" >= "effective_from");
ALTER TABLE "training_plan_versions" ADD CONSTRAINT "training_plan_versions_lifecycle_domain"
  CHECK ("status" IN ('active','superseded','draft','retired'));
ALTER TABLE "training_plan_versions" ADD CONSTRAINT "training_plan_versions_parent_not_self"
  CHECK ("supersedes_id" IS DISTINCT FROM "id");
ALTER TABLE "training_plan_sessions" ADD CONSTRAINT "training_plan_sessions_weekday_range"
  CHECK ("dayOfWeek" BETWEEN 0 AND 6);
ALTER TABLE "training_plan_exercise_slots" ADD CONSTRAINT "training_plan_exercise_slots_target_sets_positive"
  CHECK ("targetSets" > 0);
ALTER TABLE "training_plan_exercise_slots" ADD CONSTRAINT "training_plan_exercise_slots_target_rir_range"
  CHECK ("targetRir" BETWEEN 0 AND 10);
ALTER TABLE "training_environment_periods" ADD CONSTRAINT "training_environment_periods_window"
  CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from");
CREATE INDEX "idempotency_key_status_idx" ON "idempotency_keys" ("status");

-- Row ownership policies and service permissions.

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "profile_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_equipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_exercise_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "training_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "training_environment_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "progression_evaluations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "body_measurements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "body_measurement_values" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "physique_goals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_nutrition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "diagnoses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recommendations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interventions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_outcomes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sleep_observations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recovery_indicators" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projection_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projection_divergences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation_messages" ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Create RLS policies: users can only access their own data
-- Policy pattern: using (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
-- =============================================================================

-- User table: users can only see themselves
CREATE POLICY "user_own_data" ON "users"
  FOR ALL USING (id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- Profile: user_id column
CREATE POLICY "profile_own_data" ON "profiles"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- ProfileRevision: user_id column
CREATE POLICY "profile_revision_own_data" ON "profile_revisions"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- Goal: user_id column
CREATE POLICY "goal_own_data" ON "goals"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- UserEquipment: user_id column
CREATE POLICY "user_equipment_own_data" ON "user_equipment"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- UserExercisePreference: user_id column
CREATE POLICY "user_exercise_preference_own_data" ON "user_exercise_preferences"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- TrainingPlan: user_id column
CREATE POLICY "training_plan_own_data" ON "training_plans"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- TrainingEnvironmentPeriod: user_id column
CREATE POLICY "training_environment_period_own_data" ON "training_environment_periods"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- ProgressionEvaluation: user_id column
CREATE POLICY "progression_evaluation_own_data" ON "progression_evaluations"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- Workout: user_id column
CREATE POLICY "workout_own_data" ON "workouts"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- BodyMeasurement: user_id column
CREATE POLICY "body_measurement_own_data" ON "body_measurements"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- BodyMeasurementValue: user_id column (via body_measurements)
-- We need a join policy
CREATE POLICY "body_measurement_value_own_data" ON "body_measurement_values"
  FOR ALL USING (
    "measurement_id" IN (
      SELECT id FROM "body_measurements" bm
      WHERE bm."user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

-- PhysiqueGoal: user_id column
CREATE POLICY "physique_goal_own_data" ON "physique_goals"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- ActivityRecord: user_id column
CREATE POLICY "activity_record_own_data" ON "activity_records"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- Meal: user_id column
CREATE POLICY "meal_own_data" ON "meals"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- DailyNutrition: user_id column
CREATE POLICY "daily_nutrition_own_data" ON "daily_nutrition"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- Diagnosis: user_id column
CREATE POLICY "diagnosis_own_data" ON "diagnoses"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- Recommendation: user_id column
CREATE POLICY "recommendation_own_data" ON "recommendations"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- Intervention: user_id column
CREATE POLICY "intervention_own_data" ON "interventions"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- DecisionSnapshot: user_id column
CREATE POLICY "decision_snapshot_own_data" ON "decision_snapshots"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- DecisionOutcome: user_id column
CREATE POLICY "decision_outcome_own_data" ON "decision_outcomes"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- SleepObservation: user_id column
CREATE POLICY "sleep_observation_own_data" ON "sleep_observations"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- RecoveryIndicator: user_id column
CREATE POLICY "recovery_indicator_own_data" ON "recovery_indicators"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- ProjectionSnapshot: user_id column
CREATE POLICY "projection_snapshot_own_data" ON "projection_snapshots"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- ProjectionDivergence: user_id column (via ProjectionSnapshot)
CREATE POLICY "projection_divergence_own_data" ON "projection_divergences"
  FOR ALL USING (
    "projection_snapshot_id" IN (
      SELECT id FROM "projection_snapshots" ps
      WHERE ps."user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

-- Conversation: user_id column
CREATE POLICY "conversation_own_data" ON "conversations"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- ConversationMessage: user_id column (via Conversation)
CREATE POLICY "conversation_message_own_data" ON "conversation_messages"
  FOR ALL USING (
    "conversation_id" IN (
      SELECT id FROM "conversations" c
      WHERE c."user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

-- Enable RLS on user-scoped tables only
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "token_budgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "token_reservations" ENABLE ROW LEVEL SECURITY;

-- RLS policies for idempotency_keys (user-scoped)
CREATE POLICY "idempotency_key_own_data" ON "idempotency_keys"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- RLS policies for token_budgets (user-scoped)
CREATE POLICY "token_budget_own_data" ON "token_budgets"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- RLS policies for token_reservations (user-scoped)
CREATE POLICY "token_reservation_own_data" ON "token_reservations"
  FOR ALL USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

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
GRANT SELECT, INSERT, UPDATE, DELETE ON "rate_limit_buckets" TO fitcoach_app;
GRANT SELECT, INSERT, UPDATE ON "global_token_budget" TO fitcoach_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fitcoach_app;

-- Supabase roles are optional on standalone PostgreSQL. Persistent service tables
-- and the global counters are accessible only to the dedicated application role.
DO $$
DECLARE
  app_role name;
BEGIN
  FOREACH app_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = app_role) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', app_role);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', app_role);
      EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', app_role);
      EXECUTE format('REVOKE ALL ON idempotency_keys, token_budgets, token_reservations, rate_limit_buckets, global_token_budget FROM %I', app_role);
    END IF;
  END LOOP;
END
$$;

COMMIT;
