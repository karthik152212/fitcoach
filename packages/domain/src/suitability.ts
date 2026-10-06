import type { CalendarDate } from "./shared";

/**
 * Suitability vocabulary (Phase 2, §7/§32).
 *
 * FitCoach's S/A/B/C tier is a **contextual decision-support model**, not an
 * objective ranking of exercises and not a scientific law. The same exercise
 * is legitimately S for lat hypertrophy on a machine stack and C for a
 * beginner's home routine. The tier therefore only ever exists together with
 * the context that produced it, and is never persisted without that context.
 */

export type SuitabilityTier = "S" | "A" | "B" | "C";

export const SUITABILITY_TIERS: readonly SuitabilityTier[] = ["S", "A", "B", "C"] as const;

/** Human-readable meaning of each tier, reused verbatim by every surface. */
export const SUITABILITY_TIER_MEANINGS: Readonly<Record<SuitabilityTier, string>> = {
  S: "Exceptional choice for the specific target, goal and context.",
  A: "Excellent choice for the specific target, goal and context.",
  B: "Useful, but more dependent on context.",
  C: "Limited usefulness for the specific target, goal and context.",
};

/**
 * The goal axes exercise quality is judged against. A goal kind maps onto one
 * of these deterministically (see `fitness-core/goalProfiles`); user priority
 * tags can only refine the profile, never invent a new axis.
 */
export type TrainingGoalProfile =
  | "hypertrophy"
  | "strength"
  | "athletic"
  | "v_taper"
  | "recomposition"
  | "general_fitness";

export const TRAINING_GOAL_PROFILES: readonly TrainingGoalProfile[] = [
  "hypertrophy",
  "strength",
  "athletic",
  "v_taper",
  "recomposition",
  "general_fitness",
] as const;

/**
 * The additive components of the suitability score, in a fixed order.
 *
 * The score is decomposed rather than opaque so a future UI can answer "why is
 * this an S?" with the actual factors instead of a shrug. Values are signed:
 * penalty components are negative by construction.
 */
export type SuitabilityComponentKey =
  | "target_fit"
  | "goal_fit"
  | "equipment_fit"
  | "progression_potential"
  | "stimulus_quality"
  | "user_compatibility"
  | "redundancy"
  | "constraint_penalty";

export const SUITABILITY_COMPONENT_KEYS: readonly SuitabilityComponentKey[] = [
  "target_fit",
  "goal_fit",
  "equipment_fit",
  "progression_potential",
  "stimulus_quality",
  "user_compatibility",
  "redundancy",
  "constraint_penalty",
] as const;

/** One deterministic contribution to the overall suitability score. */
export interface SuitabilityScoreComponent {
  key: SuitabilityComponentKey;
  label: string;
  /** Signed contribution to the score, before/after weighting as documented. */
  value: number;
  /** Maximum this component can contribute, for normalisation and display. */
  weight: number;
  /** Evidence-grounded sentence describing how the value was derived. */
  detail: string;
}

/**
 * The full, reproducible suitability result for one exercise in one context.
 */
export interface SuitabilityScore {
  /** Sum of all component values, rounded for stability. */
  total: number;
  /** Score remapped to 0..100 for display; never the authority for ordering. */
  normalised: number;
  tier: SuitabilityTier;
  components: readonly SuitabilityScoreComponent[];
  /** Engine version — bump when the formula changes so old scores stay legible. */
  modelVersion: string;
}

/**
 * The context a suitability judgement was made in. It travels with the score;
 * a tier without it is meaningless.
 */
export interface SuitabilityContext {
  userId?: string;
  goalProfile: TrainingGoalProfile;
  /** Free-form goal priority tags, already mapped to this context. */
  goalPriorities: readonly string[];
  /** Equipment the user had available at the context date. */
  availableEquipmentIds: readonly string[];
  /** Equipment temporarily unusable right now (machine busy, broken). */
  unavailableEquipmentIds?: readonly string[];
  /** User-stated constraints (injuries, restrictions) as free-form tags. */
  limitations?: readonly string[];
  trainingExperience?: string;
  /** Exercise ids to judge against, e.g. what the session already contains. */
  consideredAlongsideExerciseIds?: readonly string[];
  /** Date the judgement is being made for; keeps historical replay honest. */
  asOf?: CalendarDate;
}
