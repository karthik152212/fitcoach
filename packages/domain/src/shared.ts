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
/** A head/region/portion of a muscle — see `./anatomy`. */
export type MuscleStructureId = EntityId;
/** A structured form-guidance version of one exercise variation. */
export type ExerciseFormVersionId = EntityId;
/** An instructional media asset reference (metadata only, never a binary). */
export type ExerciseMediaId = EntityId;
/** A timed user→exercise preference interval. */
export type UserExercisePreferenceId = EntityId;
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

/**
 * Qualitative trust level for a nutrition value. Lives in shared.ts (V2) so
 * non-nutrition domains (photo-estimated portions, imported food records) can
 * reuse one scale; re-exported from nutrition.ts for existing callers.
 */
export type ConfidenceLevel = "measured" | "label_declared" | "estimated" | "unknown";

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

// ---------------------------------------------------------------------------
// V2 shared primitives (architecture milestone, see docs/ARCHITECTURE.md).
// These are contract types only: no persistence and no engines exist yet. They
// exist so future domains (projection, physique, activity import, sleep) can
// be designed without reintroducing ad-hoc "confidence"/"source" shapes.
// ---------------------------------------------------------------------------

/**
 * How a value came to exist, from the user's point of view. Used by physique
 * models (CURRENT PHYSIQUE), projections and every estimate surface: an
 * INFERRED body dimension must never be presented as a MEASURED one.
 */
export type ProvenanceClass = "measured" | "estimated" | "inferred";

/**
 * Where an observation originated. Platform health frameworks and wearables
 * are names here, not special cases in code, so import pipelines can be added
 * without touching the domain (docs/ARCHITECTURE.md §Activity pipeline).
 */
export type ObservationOrigin =
  | "manual"
  | "health_connect"
  | "apple_health"
  | "wearable"
  | "phone_sensor"
  | "imported_dataset"
  | "ai_parsed"
  | "photo_derived"
  | "system_computed";

/**
 * An optional interval around a point estimate. Present precisely because the
 * product must not invent precision (PRODUCT_SPEC §Scientific honesty):
 * photo-estimated portions, body-composition estimates and physique
 * projections all carry a range rather than a fake exact number.
 */
export interface UncertaintyRange {
  /** Lower bound, inclusive, in the same unit as the estimate. */
  low?: number;
  /** Upper bound, inclusive, in the same unit as the estimate. */
  high?: number;
  /** Short human-readable explanation of the spread ("plate size guess"). */
  note?: string;
}

/**
 * A value plus how it should be trusted and shown. Reused by body-composition
 * estimates, food-photo portion estimates and projection outputs.
 */
export interface Estimated<T> {
  value: T;
  /** measured = observed directly; estimated = modelled; inferred = derived. */
  provenance: ProvenanceClass;
  /** Qualitative trust level; see nutrition.ConfidenceLevel for the graded scale. */
  confidence?: ConfidenceLevel;
  /** Present whenever the value is not a point estimate. */
  uncertainty?: UncertaintyRange;
}
