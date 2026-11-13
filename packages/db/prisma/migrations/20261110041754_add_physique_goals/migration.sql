-- DropForeignKey
ALTER TABLE "food_nutrient_values" DROP CONSTRAINT "food_nutrient_values_food_id_fkey";

-- DropForeignKey
ALTER TABLE "food_nutrient_values" DROP CONSTRAINT "food_nutrient_values_nutrient_id_fkey";

-- DropForeignKey
ALTER TABLE "nutrient_definitions" DROP CONSTRAINT "nutrient_definitions_source_id_fkey";

-- DropForeignKey
ALTER TABLE "workout_exercises" DROP CONSTRAINT "workout_exercises_substitution_origin_fkey";

-- DropIndex
DROP INDEX "body_measurement_values_site_idx";

-- DropIndex
DROP INDEX "exercise_form_versions_external_source_id_idx";

-- DropIndex
DROP INDEX "exercise_media_assets_external_source_id_idx";

-- DropIndex
DROP INDEX "exercise_muscle_relations_external_source_id_idx";

-- DropIndex
DROP INDEX "exercise_muscle_structure_relations_external_source_id_idx";

-- DropIndex
DROP INDEX "exercise_sets_position_unique";

-- DropIndex
DROP INDEX "exercises_aliases_gin";

-- DropIndex
DROP INDEX "movement_functions_region_idx";

-- DropIndex
DROP INDEX "training_plan_decisions_version_id_idx";

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

-- CreateIndex
CREATE INDEX "physique_goals_user_id_effective_from_idx" ON "physique_goals"("user_id", "effective_from" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "physique_goal_priorities_physique_goal_id_position_key" ON "physique_goal_priorities"("physique_goal_id", "position");

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
CREATE INDEX "exercise_form_versions_exercise_id_status_idx" ON "exercise_form_versions"("exercise_id", "status");

-- CreateIndex
CREATE INDEX "training_plan_decisions_version_id_idx" ON "training_plan_decisions"("version_id");

-- RenameForeignKey
ALTER TABLE "training_plan_versions" RENAME CONSTRAINT "training_plan_versions_parent_version_fkey" TO "training_plan_versions_parent_version_id_fkey";

-- AddForeignKey
ALTER TABLE "physique_goals" ADD CONSTRAINT "physique_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physique_goal_priorities" ADD CONSTRAINT "physique_goal_priorities_physique_goal_id_fkey" FOREIGN KEY ("physique_goal_id") REFERENCES "physique_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrient_definitions" ADD CONSTRAINT "nutrient_definitions_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "external_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_nutrient_values" ADD CONSTRAINT "food_nutrient_values_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_nutrient_values" ADD CONSTRAINT "food_nutrient_values_nutrient_id_fkey" FOREIGN KEY ("nutrient_id") REFERENCES "nutrient_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sleep_observations" ADD CONSTRAINT "sleep_observations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_indicators" ADD CONSTRAINT "recovery_indicators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "exercise_media_assets_exercise_id_media_type_angle_content_vers" RENAME TO "exercise_media_assets_exercise_id_media_type_angle_content__key";

-- RenameIndex
ALTER INDEX "exercise_substitutions_exercise_id_substitute_exercise_id_trigg" RENAME TO "exercise_substitutions_exercise_id_substitute_exercise_id_t_key";
