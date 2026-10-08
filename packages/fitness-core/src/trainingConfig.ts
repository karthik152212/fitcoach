import type {
  TrainingGoalProfile,
  TrainingExperience,
  TrainingEnvironmentKind,
  MuscleVolumeTarget,
  MuscleFrequencyTarget,
  SessionDurationBudget,
  EffectiveSetCoefficients,
  ProgressionConfiguration,
  AdaptationThresholds,
  SplitConfiguration,
} from "@fitcoach/domain";

/**
 * Training configuration (Phase 3).
 *
 * All training heuristics are centralized here so they can be calibrated,
 * versioned, and tested without rewriting core algorithms. Every value is a
 * modeling assumption, not a scientific law — see the documentation for the
 * rationale behind each coefficient.
 *
 * Configuration version: "fitcoach.training.v1"
 */

export const TRAINING_CONFIG_VERSION = "fitcoach.training.v1";

// ---------------------------------------------------------------------------
// Volume targets — per goal profile + experience
// ---------------------------------------------------------------------------

/**
 * Config records are keyed by muscle slug, so the lookup tables omit the
 * identity fields. `getMuscleVolumeTarget` / `getMuscleFrequencyTarget` fill
 * them in when a target is resolved for a specific muscle.
 */
export type MuscleVolumeTargetConfig = Omit<MuscleVolumeTarget, "muscleSlug">;
export type MuscleFrequencyTargetConfig = Omit<MuscleFrequencyTarget, "muscleSlug">;

/**
 * Weekly effective-set targets for major muscles.
 *
 * These are configurable heuristics informed by current evidence, not
 * universal laws. They represent:
 * - min: minimum useful weekly volume (below this likely insufficient)
 * - preferred: the target to aim for
 * - max: upper caution boundary (above this may be excessive for most)
 *
 * Experience modifiers adjust these up (advanced) or down (beginner).
 */
export const DEFAULT_MUSCLE_VOLUME_TARGETS: Readonly<Record<string, MuscleVolumeTargetConfig>> = {
  // Chest — pectoralis major
  "pectoralis_major": {
    min: 6,
    preferred: 10,
    max: 20,
    goalProfile: "hypertrophy",
    experienceModifier: 1,
  },
  // Shoulders — deltoids
  "deltoid_anterior": {
    min: 6,
    preferred: 10,
    max: 18,
    goalProfile: "hypertrophy",
    experienceModifier: 1,
  },
  "deltoid_lateral": {
    min: 8,
    preferred: 14,
    max: 22,
    goalProfile: "hypertrophy",
    experienceModifier: 1,
  },
  "deltoid_rear": {
    min: 6,
    preferred: 10,
    max: 18,
    goalProfile: "hypertrophy",
    experienceModifier: 1,
  },
  // Back
  "latissimus_dorsi": {
    min: 8,
    preferred: 12,
    max: 20,
    goalProfile: "hypertrophy",
    experienceModifier: 1,
  },
  "trapezius": {
    min: 4,
    preferred: 8,
    max: 14,
    goalProfile: "hypertrophy",
    experienceModifier: 1,
  },
  "rhomboids": {
    min: 4,
    preferred: 8,
    max: 14,
    goalProfile: "hypertrophy",
    experienceModifier: 1,
  },
  "spinal_erectors": {
    min: 4,
    preferred: 6,
    max: 10,
    goalProfile: "hypertrophy",
    experienceModifier: 1,
  },
  // Arms
  "biceps_brachii": {
    min: 6,
    preferred: 10,
    max: 16,
    goalProfile: "hypertrophy",
    experienceModifier: 1,
  },
  "triceps_brachii": {
    min: 6,
    preferred: 10,
    max: 18,
    goalProfile: "hypertrophy",
    experienceModifier: 1,
  },
  "brachialis": {
    min: 4,
    preferred: 8,
    max: 12,
    goalProfile: "hypertrophy",
    experienceModifier: 1,
  },
  // Legs
  "quadriceps": {
    min: 8,
    preferred: 14,
    max: 22,
    goalProfile: "hypertrophy",
    experienceModifier: 1,
  },
  "hamstrings": {
    min: 6,
    preferred: 10,
    max: 16,
    goalProfile: "hypertrophy",
    experienceModifier: 1,
  },
  "gluteus_maximus": {
    min: 6,
    preferred: 10,
    max: 16,
    goalProfile: "hypertrophy",
    experienceModifier: 1,
  },
  "gluteus_medius": {
    min: 4,
    preferred: 8,
    max: 12,
    goalProfile: "hypertrophy",
    experienceModifier: 1,
  },
  "calves": {
    min: 6,
    preferred: 10,
    max: 16,
    goalProfile: "hypertrophy",
    experienceModifier: 1,
  },
  // Core
  "abdominals": {
    min: 4,
    preferred: 8,
    max: 12,
    goalProfile: "hypertrophy",
    experienceModifier: 1,
  },
  "obliques": {
    min: 4,
    preferred: 6,
    max: 10,
    goalProfile: "hypertrophy",
    experienceModifier: 1,
  },
};

/**
 * Experience-level volume modifier.
 *
 * Beginners need less volume to progress; advanced lifters can handle more.
 * These are multipliers applied to the base volume targets.
 */
export const EXPERIENCE_VOLUME_MODIFIER: Readonly<Record<TrainingExperience, number>> = {
  untrained: 0.6,
  beginner: 0.75,
  intermediate: 1.0,
  advanced: 1.2,
};

/**
 * Goal-profile volume modifier.
 *
 * Strength goals typically use lower volume than hypertrophy goals.
 */
export const GOAL_VOLUME_MODIFIER: Readonly<Record<TrainingGoalProfile, number>> = {
  hypertrophy: 1.0,
  strength: 0.7,
  athletic: 0.8,
  v_taper: 0.9,
  recomposition: 0.85,
  general_fitness: 0.6,
};

// ---------------------------------------------------------------------------
// Frequency targets
// ---------------------------------------------------------------------------

/**
 * Muscle frequency targets — how many sessions per week each muscle should be
 * trained, as a function of volume and goal.
 *
 * Higher volume muscles benefit from more frequent exposure (within reason).
 * These are starting points, not prescriptions.
 */
export const DEFAULT_MUSCLE_FREQUENCY_TARGETS: Readonly<Record<string, MuscleFrequencyTargetConfig>> = {
  "pectoralis_major": {
    min: 1,
    preferred: 2,
    max: 4,
    rationale: "Chest recovers in 48-72h; 2x/week is the common effective range.",
  },
  "deltoid_anterior": {
    min: 1,
    preferred: 2,
    max: 4,
    rationale: "Front delts recover quickly; receive indirect from pressing.",
  },
  "deltoid_lateral": {
    min: 1,
    preferred: 2,
    max: 4,
    rationale: "Side delts respond well to frequent moderate-volume work.",
  },
  "deltoid_rear": {
    min: 1,
    preferred: 2,
    max: 3,
    rationale: "Rear delts are often under-trained; 2x/week recommended.",
  },
  "latissimus_dorsi": {
    min: 1,
    preferred: 2,
    max: 4,
    rationale: "Lats recover in 48-72h; 2x/week is effective.",
  },
  "trapezius": {
    min: 1,
    preferred: 2,
    max: 3,
    rationale: "Upper traps recover quickly; lower traps need more recovery.",
  },
  "rhomboids": {
    min: 1,
    preferred: 2,
    max: 3,
    rationale: "Rhomboids recover in 48h; receive indirect from pulling.",
  },
  "spinal_erectors": {
    min: 1,
    preferred: 2,
    max: 3,
    rationale: "Erectors are postural; avoid excessive frequency to prevent fatigue.",
  },
  "biceps_brachii": {
    min: 1,
    preferred: 2,
    max: 3,
    rationale: "Biceps recover in 48h; 2x/week is effective for hypertrophy.",
  },
  "triceps_brachii": {
    min: 1,
    preferred: 2,
    max: 4,
    rationale: "Triceps recover quickly; receive indirect from pressing.",
  },
  "brachialis": {
    min: 1,
    preferred: 2,
    max: 3,
    rationale: "Brachialis recovers in 48h; targeted by elbow flexion variations.",
  },
  "quadriceps": {
    min: 1,
    preferred: 2,
    max: 4,
    rationale: "Quads can handle high frequency with adequate recovery.",
  },
  "hamstrings": {
    min: 1,
    preferred: 2,
    max: 3,
    rationale: "Hamstrings recover in 48-72h; 2x/week is effective.",
  },
  "gluteus_maximus": {
    min: 1,
    preferred: 2,
    max: 4,
    rationale: "Glutes recover in 48-72h; respond well to frequent work.",
  },
  "gluteus_medius": {
    min: 1,
    preferred: 2,
    max: 3,
    rationale: "Glute medius recovers in 48h; important for hip stability.",
  },
  "calves": {
    min: 2,
    preferred: 3,
    max: 5,
    rationale: "Calves recover quickly and respond to higher frequency.",
  },
  "abdominals": {
    min: 1,
    preferred: 2,
    max: 4,
    rationale: "Abs recover quickly; can be trained frequently.",
  },
  "obliques": {
    min: 1,
    preferred: 2,
    max: 3,
    rationale: "Obliques recover in 48h; receive indirect from loaded carries.",
  },
};

// ---------------------------------------------------------------------------
// Session duration budget
// ---------------------------------------------------------------------------

/**
 * Default session duration budget.
 *
 * These values are used to estimate session duration and to repair
 * over-budget sessions. They represent typical gym session components.
 */
export const DEFAULT_SESSION_DURATION_BUDGET: SessionDurationBudget = {
  maxMinutes: 75,
  warmupMinutes: 8,
  transitionSecondsPerExercise: 120,
  restSecondsPerSet: 90,
  loggingMinutes: 5,
};

/**
 * Rest time assumptions by training goal profile.
 *
 * Strength work typically uses longer rest than hypertrophy work.
 */
export const REST_SECONDS_BY_GOAL: Readonly<Record<TrainingGoalProfile, number>> = {
  hypertrophy: 90,
  strength: 180,
  athletic: 120,
  v_taper: 90,
  recomposition: 90,
  general_fitness: 60,
};

/**
 * Warm-up time by session type.
 */
export const WARMUP_MINUTES_BY_SESSION_TYPE: Readonly<Record<string, number>> = {
  full_body: 10,
  upper: 8,
  lower: 8,
  push: 6,
  pull: 6,
  legs: 8,
  specialization: 6,
};

// ---------------------------------------------------------------------------
// Effective set coefficients
// ---------------------------------------------------------------------------

/**
 * Effective set contribution coefficients.
 *
 * These coefficients determine how much each type of exercise-muscle
 * relationship contributes to "effective sets" for a muscle.
 *
 * The model is:
 *   effective_sets = sum over all planned sets of (set_count * coefficient)
 *
 * Where coefficient depends on the relationship role:
 *   - direct (primary_mover): 1.0 — full contribution
 *   - indirect (secondary_mover): 0.5 — half contribution
 *   - supporting: 0.25 — small contribution
 *   - stabilizer: 0.1 — minimal contribution
 *   - emphasis (structure-level): adds 0.25 to the parent muscle's coefficient
 *
 * These are modeling assumptions with uncertain evidence. They are
 * configurable so they can be calibrated.
 */
export const DEFAULT_EFFECTIVE_SET_COEFFICIENTS: EffectiveSetCoefficients = {
  direct: 1.0,
  indirect: 0.5,
  supporting: 0.25,
  stabilizer: 0.1,
  emphasis: 0.25,
  sameMuscleOverlapPenalty: 0.15,
  compoundIndirectCap: 0.5,
};

// ---------------------------------------------------------------------------
// Progression configuration
// ---------------------------------------------------------------------------

/**
 * Default progression configuration.
 *
 * These values control how progression decisions are made.
 */
export const DEFAULT_PROGRESSION_CONFIGURATION: ProgressionConfiguration = {
  version: TRAINING_CONFIG_VERSION,
  defaultRirTarget: 2,
  hypertrophyRepMin: 8,
  hypertrophyRepMax: 15,
  strengthRepMin: 3,
  strengthRepMax: 6,
  loadIncrementKg: 2.5,
  repsToAddBeforeLoad: 2,
  sessionsAtTopBeforeProgress: 2,
  maxProgressionsPerWeek: 3,
  deloadStalledSessionThreshold: 3,
  minRirForProgression: 1,
};

// ---------------------------------------------------------------------------
// Adaptation thresholds
// ---------------------------------------------------------------------------

/**
 * Default adaptation thresholds.
 *
 * These control when the adaptation engine considers making changes.
 */
export const DEFAULT_ADAPTATION_THRESHOLDS: AdaptationThresholds = {
  version: TRAINING_CONFIG_VERSION,
  adherenceThreshold: 0.6,
  stagnationThreshold: 3,
  volumeAdjustmentThresholdPercent: 20,
  frequencyAdjustmentThreshold: 1,
  underTargetFraction: 0.7,
  overTargetFraction: 1.3,
};

// ---------------------------------------------------------------------------
// Split configuration
// ---------------------------------------------------------------------------

/**
 * Default split configuration.
 *
 * These values determine how the split generator chooses a structure.
 */
export const DEFAULT_SPLIT_CONFIGURATION: SplitConfiguration = {
  version: TRAINING_CONFIG_VERSION,
  fullBodyMinSessions: 2,
  fullBodyMaxSessions: 3,
  upperLowerSessions: 4,
  pushPullLegsSessions: 6,
  maxExercisesPerSession: {
    "30": 4,
    "45": 6,
    "60": 8,
    "75": 10,
    "90": 12,
    "120": 14,
  },
  minExercisesPerSession: 3,
};

// ---------------------------------------------------------------------------
// Plan quality weights
// ---------------------------------------------------------------------------

/**
 * Plan quality evaluation weights.
 *
 * These determine how much each dimension contributes to the total quality
 * score. They sum to 1.0.
 */
export const PLAN_QUALITY_WEIGHTS: Readonly<Record<string, number>> = {
  goalAlignment: 0.15,
  muscleCoverage: 0.20,
  volumeAppropriateness: 0.15,
  frequencyAppropriateness: 0.10,
  exerciseSuitability: 0.10,
  redundancy: 0.05,
  equipmentFeasibility: 0.10,
  preferenceCompatibility: 0.05,
  sessionDuration: 0.05,
  progressionReadiness: 0.05,
  constraintSatisfaction: 0.00, // Hard constraints are binary; this is informational
};

// ---------------------------------------------------------------------------
// Goal-specific modifiers
// ---------------------------------------------------------------------------

/**
 * Goal-specific training emphasis modifiers.
 *
 * These influence how the planner prioritizes different aspects of the plan
 * based on the goal.
 */
export interface GoalTrainingModifiers {
  /** How much to prioritize volume for this goal. */
  volumePriority: number;
  /** How much to prioritize frequency for this goal. */
  frequencyPriority: number;
  /** How much to prioritize exercise specificity for this goal. */
  specificityPriority: number;
  /** Preferred rep range center. */
  preferredRepRangeCenter: number;
  /** Preferred rest duration. */
  preferredRestSeconds: number;
  /** Whether to prioritize compound or isolation work. */
  compoundPreference: number; // >1 favors compounds, <1 favors isolation
}

export const GOAL_TRAINING_MODIFIERS: Readonly<Record<TrainingGoalProfile, GoalTrainingModifiers>> = {
  hypertrophy: {
    volumePriority: 1.0,
    frequencyPriority: 0.8,
    specificityPriority: 0.7,
    preferredRepRangeCenter: 10,
    preferredRestSeconds: 90,
    compoundPreference: 0.9,
  },
  strength: {
    volumePriority: 0.6,
    frequencyPriority: 0.7,
    specificityPriority: 1.0,
    preferredRepRangeCenter: 4,
    preferredRestSeconds: 180,
    compoundPreference: 1.3,
  },
  athletic: {
    volumePriority: 0.7,
    frequencyPriority: 0.8,
    specificityPriority: 0.8,
    preferredRepRangeCenter: 8,
    preferredRestSeconds: 120,
    compoundPreference: 1.1,
  },
  v_taper: {
    volumePriority: 0.9,
    frequencyPriority: 0.7,
    specificityPriority: 0.9,
    preferredRepRangeCenter: 10,
    preferredRestSeconds: 90,
    compoundPreference: 0.8,
  },
  recomposition: {
    volumePriority: 0.8,
    frequencyPriority: 0.8,
    specificityPriority: 0.7,
    preferredRepRangeCenter: 10,
    preferredRestSeconds: 90,
    compoundPreference: 1.0,
  },
  general_fitness: {
    volumePriority: 0.5,
    frequencyPriority: 0.6,
    specificityPriority: 0.5,
    preferredRepRangeCenter: 12,
    preferredRestSeconds: 60,
    compoundPreference: 1.2,
  },
};

// ---------------------------------------------------------------------------
// Configuration accessors
// ---------------------------------------------------------------------------

/**
 * Get the complete training configuration.
 */
export function getTrainingConfiguration(): {
  version: string;
  muscleVolumeTargets: Readonly<Record<string, MuscleVolumeTargetConfig>>;
  muscleFrequencyTargets: Readonly<Record<string, MuscleFrequencyTargetConfig>>;
  sessionDurationBudget: SessionDurationBudget;
  effectiveSetCoefficients: EffectiveSetCoefficients;
  progressionConfiguration: ProgressionConfiguration;
  adaptationThresholds: AdaptationThresholds;
  splitConfiguration: SplitConfiguration;
  planQualityWeights: Readonly<Record<string, number>>;
  goalTrainingModifiers: Readonly<Record<TrainingGoalProfile, GoalTrainingModifiers>>;
  experienceVolumeModifier: Readonly<Record<TrainingExperience, number>>;
  goalVolumeModifier: Readonly<Record<TrainingGoalProfile, number>>;
  restSecondsByGoal: Readonly<Record<TrainingGoalProfile, number>>;
  warmupMinutesByType: Readonly<Record<string, number>>;
} {
  return {
    version: TRAINING_CONFIG_VERSION,
    muscleVolumeTargets: DEFAULT_MUSCLE_VOLUME_TARGETS,
    muscleFrequencyTargets: DEFAULT_MUSCLE_FREQUENCY_TARGETS,
    sessionDurationBudget: DEFAULT_SESSION_DURATION_BUDGET,
    effectiveSetCoefficients: DEFAULT_EFFECTIVE_SET_COEFFICIENTS,
    progressionConfiguration: DEFAULT_PROGRESSION_CONFIGURATION,
    adaptationThresholds: DEFAULT_ADAPTATION_THRESHOLDS,
    splitConfiguration: DEFAULT_SPLIT_CONFIGURATION,
    planQualityWeights: PLAN_QUALITY_WEIGHTS,
    goalTrainingModifiers: GOAL_TRAINING_MODIFIERS,
    experienceVolumeModifier: EXPERIENCE_VOLUME_MODIFIER,
    goalVolumeModifier: GOAL_VOLUME_MODIFIER,
    restSecondsByGoal: REST_SECONDS_BY_GOAL,
    warmupMinutesByType: WARMUP_MINUTES_BY_SESSION_TYPE,
  };
}

/**
 * Get muscle volume target for a specific muscle, with experience and goal
 * modifiers applied.
 */
export function getMuscleVolumeTarget(
  muscleSlug: string,
  experience: TrainingExperience,
  goalProfile: TrainingGoalProfile,
): { min: number; preferred: number; max: number; baseline: MuscleVolumeTarget } | null {
  const config = DEFAULT_MUSCLE_VOLUME_TARGETS[muscleSlug];
  if (!config) return null;

  const expMod = EXPERIENCE_VOLUME_MODIFIER[experience];
  const goalMod = GOAL_VOLUME_MODIFIER[goalProfile];
  const baseline: MuscleVolumeTarget = { ...config, muscleSlug };

  return {
    min: Math.round(config.min * expMod * goalMod),
    preferred: Math.round(config.preferred * expMod * goalMod),
    max: Math.round(config.max * expMod * goalMod),
    baseline,
  };
}

/**
 * Get the raw (unmodified) weekly volume target configuration for a muscle.
 */
export function getMuscleVolumeTargetConfig(muscleSlug: string): MuscleVolumeTargetConfig | null {
  return DEFAULT_MUSCLE_VOLUME_TARGETS[muscleSlug] ?? null;
}

/**
 * Get the raw (unmodified) weekly frequency target configuration for a muscle.
 */
export function getMuscleFrequencyTargetConfig(muscleSlug: string): MuscleFrequencyTargetConfig | null {
  return DEFAULT_MUSCLE_FREQUENCY_TARGETS[muscleSlug] ?? null;
}

// ---------------------------------------------------------------------------
// Phase 3.1 — Progression ledger configuration
// ---------------------------------------------------------------------------

/**
 * Explicitly versioned, because Phase 3.1 adds ledger semantics that the
 * original `fitcoach.training.v1` configuration never claimed. Ledger rows
 * record THIS version, so a historic decision is never re-explained by a later
 * threshold change.
 */
export const PROGRESSION_LEDGER_CONFIG_VERSION = "fitcoach.progression.v1";

/**
 * Progression-ledger thresholds and mechanism ladders.
 *
 * Everything here is a modelling assumption with uncertain evidence; it is
 * centralized so it can be calibrated and so tests can pin it.
 */
export interface ProgressionLedgerConfiguration {
  version: string;
  /** Completed sessions required before anything other than `insufficient_data`. */
  minSessionsForEvidence: number;
  /** Consecutive sessions at the top of the range before progressing. */
  sessionsAtTopRequired: number;
  /** RIR at or below which a set counts as reaching the target effort. */
  rirAtOrBelowForProgression: number;
  /** Extra reps above the top of the range still counted as "at top". */
  topOfRangeTolerance: number;
  /** Default load increment when the exercise has no explicit increment. */
  loadIncrementKg: number;
  /** Reps added before load is increased. */
  repStep: number;
  /** Ordered levers for a movement that can be loaded externally. */
  loadedMechanisms: readonly string[];
  /** Ordered levers when external load is unavailable (bodyweight / home). */
  bodyweightMechanisms: readonly string[];
  /** Reps added per progression for a bodyweight movement. */
  bodyweightRepStep: number;
  /** Consecutive stalled sessions before recommending `reduce_target`. */
  stallSessionsBeforeReduce: number;
  /** Consecutive hard failures before recommending `change_exercise`. */
  failuresBeforeVariationChange: number;
  /** Confidence reported for a recommendation that satisfies every rule. */
  fullEvidenceConfidence: number;
  /** Confidence reported when the recommendation rests on partial evidence. */
  partialEvidenceConfidence: number;
}

export const DEFAULT_PROGRESSION_LEDGER_CONFIGURATION: ProgressionLedgerConfiguration = {
  version: PROGRESSION_LEDGER_CONFIG_VERSION,
  minSessionsForEvidence: 2,
  sessionsAtTopRequired: 2,
  rirAtOrBelowForProgression: 2,
  topOfRangeTolerance: 0,
  loadIncrementKg: 2.5,
  repStep: 2,
  loadedMechanisms: ["load", "reps", "rir", "sets"],
  bodyweightMechanisms: ["reps", "rir", "variation", "rom", "tempo", "sets"],
  bodyweightRepStep: 2,
  stallSessionsBeforeReduce: 4,
  failuresBeforeVariationChange: 3,
  fullEvidenceConfidence: 0.8,
  partialEvidenceConfidence: 0.5,
};

// ---------------------------------------------------------------------------
// Phase 3.1 — Training environment configuration
// ---------------------------------------------------------------------------

export const ENVIRONMENT_CONFIG_VERSION = "fitcoach.environment.v1";

/** `"*"` means "everything the user already owns". */
export type EnvironmentEquipmentAllowance = readonly string[] | "*";

/**
 * What each environment permits, and what it honestly cannot reproduce.
 *
 * Equipment is expressed as catalog SLUGS, not ids: the planner intersects the
 * user's owned equipment with this list, so the same configuration works for
 * every user and every database.
 */
export interface EnvironmentConfiguration {
  version: string;
  allowedEquipmentSlugs: Readonly<Record<TrainingEnvironmentKind, EnvironmentEquipmentAllowance>>;
  /** Whether external load progression is available at all. */
  loadProgressionAvailable: Readonly<Record<TrainingEnvironmentKind, boolean>>;
  /** Movement patterns the environment cannot support. */
  unsupportedMovementPatterns: Readonly<Record<TrainingEnvironmentKind, readonly string[]>>;
  /** Muscles whose stimulus is expected to be materially reduced. */
  constrainedMuscleSlugs: Readonly<Record<TrainingEnvironmentKind, readonly string[]>>;
  /** Honesty note attached to a temporary plan; never a claim of equivalence. */
  honestyNotes: Readonly<Record<TrainingEnvironmentKind, string>>;
}

/**
 * Pulling/back is called out explicitly because it is the clearest case where
 * a no-equipment environment genuinely cannot reproduce the gym stimulus.
 */
export const DEFAULT_ENVIRONMENT_CONFIGURATION: EnvironmentConfiguration = {
  version: ENVIRONMENT_CONFIG_VERSION,
  allowedEquipmentSlugs: {
    gym: "*",
    home: [
      "bodyweight",
      "resistance_bands",
      "dumbbells",
      "kettlebell",
      "ez_bar",
      "adjustable_bench",
      "pull_up_bar",
    ],
    home_no_equipment: ["bodyweight"],
    home_limited_equipment: ["bodyweight", "resistance_bands", "dumbbells", "pull_up_bar"],
    hotel: ["bodyweight", "resistance_bands", "dumbbells"],
    travel: ["bodyweight", "resistance_bands"],
    outdoor: ["bodyweight", "resistance_bands"],
    custom: "*",
  },
  loadProgressionAvailable: {
    gym: true,
    home: true,
    home_no_equipment: false,
    home_limited_equipment: true,
    hotel: true,
    travel: false,
    outdoor: false,
    custom: true,
  },
  unsupportedMovementPatterns: {
    gym: [],
    home: [],
    home_no_equipment: ["horizontal_pull", "vertical_pull"],
    home_limited_equipment: [],
    hotel: [],
    travel: ["horizontal_pull", "vertical_pull"],
    outdoor: [],
    custom: [],
  },
  constrainedMuscleSlugs: {
    gym: [],
    home: [],
    home_no_equipment: [
      "latissimus_dorsi",
      "rhomboids",
      "trapezius",
      "biceps_brachii",
      "hamstrings",
      "spinal_erectors",
    ],
    home_limited_equipment: ["latissimus_dorsi", "rhomboids"],
    hotel: ["quadriceps", "gluteus_maximus", "latissimus_dorsi"],
    travel: [
      "latissimus_dorsi",
      "rhomboids",
      "trapezius",
      "quadriceps",
      "hamstrings",
    ],
    outdoor: ["pectoralis_major", "latissimus_dorsi"],
    custom: [],
  },
  honestyNotes: {
    gym: "Full equipment universe available; nothing is knowingly reduced.",
    home: "Home setups vary; only the equipment recorded as available is assumed.",
    home_no_equipment:
      "Your home setup cannot fully reproduce the pulling work from a gym plan, so this temporary plan prioritizes the movements that can be trained effectively without equipment. Some back/hamstring stimulus is expected to fall short of the gym version.",
    home_limited_equipment:
      "Limited equipment at home keeps most stimulus but may not fully reproduce heavy loaded pulling.",
    hotel: "Hotel setups cannot reproduce heavy leg loading; leg volume will be reduced rather than inflated.",
    travel: "Travel setups rely on bodyweight and bands; external-load progression is unavailable.",
    outdoor: "Outdoor training cannot reproduce heavy pressing or loaded pulling.",
    custom: "Custom environment; limitations follow from the equipment you record.",
  },
};

/** Look up (and default) an environment configuration block by kind. */
export function getEnvironmentConfiguration(
  kind: TrainingEnvironmentKind,
  configuration: EnvironmentConfiguration = DEFAULT_ENVIRONMENT_CONFIGURATION,
): {
  allowedEquipmentSlugs: EnvironmentEquipmentAllowance;
  loadProgressionAvailable: boolean;
  unsupportedMovementPatterns: readonly string[];
  constrainedMuscleSlugs: readonly string[];
  honestyNote: string;
  version: string;
} {
  return {
    version: configuration.version,
    allowedEquipmentSlugs: configuration.allowedEquipmentSlugs[kind],
    loadProgressionAvailable: configuration.loadProgressionAvailable[kind],
    unsupportedMovementPatterns: configuration.unsupportedMovementPatterns[kind],
    constrainedMuscleSlugs: configuration.constrainedMuscleSlugs[kind],
    honestyNote: configuration.honestyNotes[kind],
  };
}

/** All environment kinds, in stable declaration order. */
export const TRAINING_ENVIRONMENT_KINDS: readonly TrainingEnvironmentKind[] = [
  "gym",
  "home",
  "home_no_equipment",
  "home_limited_equipment",
  "hotel",
  "travel",
  "outdoor",
  "custom",
];
