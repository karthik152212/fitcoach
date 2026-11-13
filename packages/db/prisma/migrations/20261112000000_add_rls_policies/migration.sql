-- =============================================================================
-- Row Level Security (RLS) Policies for User Data Isolation
-- =============================================================================
-- This migration enables RLS on all user-owned tables and creates policies
-- that use the `app.current_user_id` session variable (set per-request by
-- the API middleware) for row-level access control.
--
-- PgBouncer Transaction Pooling Compatibility:
-- - app.current_user_id is a transaction-local GUC, set via SET LOCAL
-- - Works with PgBouncer transaction pooling (no session state needed)
-- - Middleware must SET LOCAL app.current_user_id = 'user-uuid' at start
-- =============================================================================

-- Helper function to create standard RLS policies for a user-owned table
-- This is defined as a DO block since we can't create functions in migrations easily

-- =============================================================================
-- Enable RLS on all user-owned tables
-- =============================================================================

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Profile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProfileRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Goal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserEquipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserExercisePreference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingEnvironmentPeriod" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProgressionEvaluation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Workout" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BodyMeasurement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BodyMeasurementValue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PhysiqueGoal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ActivityRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Meal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DailyNutrition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Diagnosis" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Recommendation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Intervention" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DecisionSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DecisionOutcome" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SleepObservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecoveryIndicator" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectionSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectionDivergence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConversationMessage" ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Create RLS policies: users can only access their own data
-- Policy pattern: using (user_id = current_setting('app.current_user_id')::uuid)
-- =============================================================================

-- User table: users can only see themselves
CREATE POLICY "user_own_data" ON "User"
  FOR ALL USING (id = current_setting('app.current_user_id')::uuid);

-- Profile: user_id column
CREATE POLICY "profile_own_data" ON "Profile"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- ProfileRevision: user_id column
CREATE POLICY "profile_revision_own_data" ON "ProfileRevision"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- Goal: user_id column
CREATE POLICY "goal_own_data" ON "Goal"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- UserEquipment: user_id column
CREATE POLICY "user_equipment_own_data" ON "UserEquipment"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- UserExercisePreference: user_id column
CREATE POLICY "user_exercise_preference_own_data" ON "UserExercisePreference"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- TrainingPlan: user_id column
CREATE POLICY "training_plan_own_data" ON "TrainingPlan"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- TrainingEnvironmentPeriod: user_id column
CREATE POLICY "training_environment_period_own_data" ON "TrainingEnvironmentPeriod"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- ProgressionEvaluation: user_id column
CREATE POLICY "progression_evaluation_own_data" ON "ProgressionEvaluation"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- Workout: user_id column
CREATE POLICY "workout_own_data" ON "Workout"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- BodyMeasurement: user_id column
CREATE POLICY "body_measurement_own_data" ON "BodyMeasurement"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- BodyMeasurementValue: user_id column (via BodyMeasurement -> Profile -> User)
-- This table links to BodyMeasurement which links to Profile -> User
-- We need a join policy
CREATE POLICY "body_measurement_value_own_data" ON "BodyMeasurementValue"
  FOR ALL USING (
    "measurementId" IN (
      SELECT id FROM "BodyMeasurement" bm
      JOIN "Profile" p ON bm."profileId" = p.id
      WHERE p."userId" = current_setting('app.current_user_id')::uuid
    )
  );

-- PhysiqueGoal: user_id column
CREATE POLICY "physique_goal_own_data" ON "PhysiqueGoal"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- ActivityRecord: user_id column
CREATE POLICY "activity_record_own_data" ON "ActivityRecord"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- Meal: user_id column
CREATE POLICY "meal_own_data" ON "Meal"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- DailyNutrition: user_id column
CREATE POLICY "daily_nutrition_own_data" ON "DailyNutrition"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- Diagnosis: user_id column
CREATE POLICY "diagnosis_own_data" ON "Diagnosis"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- Recommendation: user_id column
CREATE POLICY "recommendation_own_data" ON "Recommendation"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- Intervention: user_id column
CREATE POLICY "intervention_own_data" ON "Intervention"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- DecisionSnapshot: user_id column
CREATE POLICY "decision_snapshot_own_data" ON "DecisionSnapshot"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- DecisionOutcome: user_id column
CREATE POLICY "decision_outcome_own_data" ON "DecisionOutcome"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- SleepObservation: user_id column
CREATE POLICY "sleep_observation_own_data" ON "SleepObservation"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- RecoveryIndicator: user_id column
CREATE POLICY "recovery_indicator_own_data" ON "RecoveryIndicator"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- ProjectionSnapshot: user_id column
CREATE POLICY "projection_snapshot_own_data" ON "ProjectionSnapshot"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- ProjectionDivergence: user_id column (via ProjectionSnapshot)
CREATE POLICY "projection_divergence_own_data" ON "ProjectionDivergence"
  FOR ALL USING (
    "projectionSnapshotId" IN (
      SELECT id FROM "ProjectionSnapshot" ps
      WHERE ps."userId" = current_setting('app.current_user_id')::uuid
    )
  );

-- Conversation: user_id column
CREATE POLICY "conversation_own_data" ON "Conversation"
  FOR ALL USING ("userId" = current_setting('app.current_user_id')::uuid);

-- ConversationMessage: user_id column (via Conversation)
CREATE POLICY "conversation_message_own_data" ON "ConversationMessage"
  FOR ALL USING (
    "conversationId" IN (
      SELECT id FROM "Conversation" c
      WHERE c."userId" = current_setting('app.current_user_id')::uuid
    )
  );

-- =============================================================================
-- Tables with user_id that need special handling (admin/background access)
-- =============================================================================
-- These tables may need service-role access for background jobs
-- Service role bypasses RLS by default (when using service_role key)
-- No additional policies needed for service role

-- =============================================================================
-- Grant necessary permissions for RLS to work with app user
-- =============================================================================
-- The app user (authenticated via Supabase) needs USAGE on the schema
-- and SELECT/INSERT/UPDATE/DELETE on tables (policies control actual access)

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- =============================================================================
-- Create the app.current_user_id setting (must be set per transaction)
-- =============================================================================
-- This is a placeholder GUC - actual value set by middleware via SET LOCAL
-- ALTER SYSTEM is not available in migrations, this documents the requirement

-- Note: The middleware must execute:
--   SET LOCAL app.current_user_id = '<user-uuid>';
-- at the start of each transaction after JWT verification.