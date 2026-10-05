/**
 * Shared primitives for the FitCoach domain model.
 *
 * These types are persistence-agnostic: they describe the domain, not any
 * particular database schema. Database mapping belongs to packages/db.
 */

/** Opaque entity identifier. Kept as a plain string until ID strategy is finalized. */
export type EntityId = string;

export type UserId = EntityId;
export type GoalId = EntityId;
export type EquipmentId = EntityId;
export type ExerciseId = EntityId;
export type MuscleId = EntityId;
export type TrainingPlanId = EntityId;
export type WorkoutId = EntityId;
export type BodyMeasurementId = EntityId;
export type ActivityRecordId = EntityId;
export type FoodId = EntityId;
export type FoodSourceId = EntityId;
export type RecipeId = EntityId;
export type MealId = EntityId;
export type DiagnosisId = EntityId;
export type InterventionId = EntityId;
export type RecommendationId = EntityId;

/** Full ISO-8601 timestamp, e.g. "2026-08-25T07:30:00Z". */
export type Timestamp = string;

/** Calendar date in ISO-8601 format, e.g. "2026-08-25" (user-local day). */
export type CalendarDate = string;

export interface Identified {
  id: EntityId;
}

/**
 * Design requirement (see src/entities.md): entities retain timestamps so the
 * system can reconstruct what it knew and recommended at any point in time.
 */
export interface Timestamped {
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type BaseEntity = Identified & Timestamped;

/** Qualitative effort/intensity scale shared by training and activity data. */
export type EffortLevel = "low" | "moderate" | "high";

/**
 * Provenance of externally-sourced content (exercise definitions, food data,
 * media). Every third-party component must also be registered in
 * data/provenance/THIRD_PARTY.md; licenses must never be assumed.
 */
export interface ExternalProvenance {
  /** Identifier of the upstream source, e.g. "opengym". */
  origin: string;
  /** SPDX license identifier when verified, e.g. "AGPL-3.0", "MIT". */
  licenseSpdx?: string;
  /** Reference to the entry in the provenance register. */
  registryRef?: string;
}
