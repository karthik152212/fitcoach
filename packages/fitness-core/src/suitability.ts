import type {
  ExercisePreferenceKind,
  MovementFunction,
  SuitabilityComponentKey,
  SuitabilityContext,
  SuitabilityScore,
  SuitabilityScoreComponent,
  SuitabilityTier,
} from "@fitcoach/domain";
import type { ExerciseKnowledge } from "./knowledgeCatalog";
import { GOAL_AXIS_WEIGHTS } from "./goalProfiles";
import type { RedundancyFinding } from "./redundancy";

/**
 * Contextual suitability scoring (Phase 2, §7/§8).
 *
 * ## What this is
 *
 * A deterministic, decomposable score answering: "for THIS user, THIS target,
 * THIS goal and THIS context, how good is this exercise?" It is explicitly
 * **not** a universal ranking of exercises, not a scientific law, and not an
 * ML or LLM output. The same exercise scores differently for a beginner
 * without a barbell and a strong lifter preparing for a meet, and that is the
 * intended behaviour, not a bug.
 *
 * ## The formula
 *
 *   overall suitability =
 *       target suitability      (+0..40)
 *     + goal fit                 (+0..20)
 *     + equipment fit            (+0..15)
 *     + progression potential    (+0..10)
 *     + stimulus quality         (+0..15)
 *     + user compatibility       (+0..10)
 *     - redundancy               (-0..15)
 *     - constraint penalties     (-0..30)
 *
 * The maximum reachable total is 110; the score is normalised to 0..100 for
 * display, but ordering always uses the raw total so two exercises are never
 * separated by a rounding artefact.
 *
 * ## Determinism
 *
 * Every input is explicit, no clock or randomness is read, every collection is
 * sorted before use, and floating point results are rounded at a fixed
 * precision. The same request always produces the same score object.
 */
export const SUITABILITY_MODEL_VERSION = "fitcoach.suitability.v1";

/** Positive component ceilings. Referenced by tests and documentation. */
export const COMPONENT_WEIGHTS: Readonly<Record<string, number>> = {
  target_fit: 40,
  goal_fit: 20,
  equipment_fit: 15,
  progression_potential: 10,
  stimulus_quality: 15,
  user_compatibility: 10,
  redundancy: 15,
  constraint_penalty: 30,
};

/**
 * Tier cut-offs on the raw total. Chosen so that, on the shipped catalog, an
 * exercise that is a poor match for the goal cannot reach S by accumulating
 * small bonuses elsewhere.
 */
export const TIER_THRESHOLDS: Readonly<Record<SuitabilityTier, number>> = {
  S: 85,
  A: 72,
  B: 55,
  C: -Infinity,
};

export function tierForScore(total: number): SuitabilityTier {
  if (total >= TIER_THRESHOLDS.S) return "S";
  if (total >= TIER_THRESHOLDS.A) return "A";
  if (total >= TIER_THRESHOLDS.B) return "B";
  return "C";
}

const TARGET_ROLE_FIT: Readonly<Record<string, number>> = {
  primary_mover: 1,
  secondary_mover: 0.6,
  supporting: 0.35,
  stabilizer: 0.1,
};

const PROGRESSION_VALUE: Readonly<Record<string, number>> = {
  free_weight_multi_joint: 1,
  cable_variable: 0.95,
  free_weight_single_joint: 0.85,
  machine_guided: 0.7,
  bodyweight_external_load: 0.7,
  elastic_tension: 0.7,
  cable_fixed: 0.6,
  bodyweight_only: 0.5,
};

const CONTROL_VALUE: Readonly<Record<string, number>> = {
  low: 1,
  moderate: 0.8,
  high: 0.55,
};

const FATIGUE_EFFICIENCY_VALUE: Readonly<Record<string, number>> = {
  free_weight_single_joint: 1,
  machine_guided: 0.9,
  cable_variable: 0.85,
  cable_fixed: 0.85,
  elastic_tension: 0.8,
  bodyweight_only: 0.75,
  bodyweight_external_load: 0.65,
  free_weight_multi_joint: 0.5,
};

const ROM_VALUE: Readonly<Record<string, number>> = {
  stretch_emphasised: 1,
  full_stretch_to_squeeze: 0.9,
  shortened_emphasised: 0.8,
  partial_rom: 0.7,
};

const ROM_LABELS: Readonly<Record<string, string>> = {
  stretch_emphasised: "works the lengthened position",
  full_stretch_to_squeeze: "spans the full range from stretch to contraction",
  shortened_emphasised: "concentrates on the shortened position",
  partial_rom: "uses a partial range of motion",
};

export interface SuitabilityRequest {
  exercise: ExerciseKnowledge;
  context: SuitabilityContext;
  /**
   * What the user is trying to train right now. Without this the target
   * component stays neutral rather than guessing.
   */
  targetMuscleIds?: readonly string[];
  targetMuscleSlugs?: readonly string[];
  targetStructureIds?: readonly string[];
  /** Redundancy findings against what the session already contains. */
  redundancy?: readonly RedundancyFinding[];
  /** Equipment the user owns but cannot use right now. */
  temporarilyUnavailableEquipmentIds?: readonly string[];
  /** Current preference for this exercise, if any. */
  preference?: ExercisePreferenceKind;
  /**
   * User limitations as free-form tags. Matching is a conservative,
   * case-insensitive substring test against muscle slugs and display names;
   * it is a prompt to look, never a diagnosis.
   */
  limitations?: readonly string[];
}

function round(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function component(
  key: SuitabilityComponentKey,
  label: string,
  value: number,
  weight: number,
  detail: string,
): SuitabilityScoreComponent {
  return { key, label, value: round(value), weight, detail };
}

/** Best role-weighted match between the exercise and the requested targets. */
function bestTargetMatch(exercise: ExerciseKnowledge, request: SuitabilityRequest): number {
  const muscles = new Set(request.targetMuscleIds ?? []);
  const slugs = new Set(request.targetMuscleSlugs ?? []);
  const structures = new Set(request.targetStructureIds ?? []);
  let best = 0;
  for (const target of exercise.targets) {
    const muscleMatch = muscles.has(target.muscleId) || slugs.has(target.muscleSlug);
    const structureMatch = target.structureId !== undefined && structures.has(target.structureId);
    if (!muscleMatch && !structureMatch) continue;
    const roleFit = TARGET_ROLE_FIT[target.role] ?? 0.2;
    const value = roleFit * (target.contributionWeight ?? 0.6);
    if (value > best) best = value;
  }
  return clamp(best, 0, 1);
}

function hasAnyRole(exercise: ExerciseKnowledge, roles: readonly string[]): boolean {
  return exercise.roles.some((role) => roles.includes(role));
}

function scoreGoalFit(
  exercise: ExerciseKnowledge,
  context: SuitabilityContext,
  emphasisedRoles: readonly string[],
): { value: number; detail: string } {
  const weights = GOAL_AXIS_WEIGHTS[context.goalProfile];
  const axisTotal = Object.values(weights).reduce((sum, value) => sum + value, 0);

  const stimulus = hasAnyRole(exercise, [
    "hypertrophy_movement",
    "lengthened_position_emphasis",
    "shortened_position_emphasis",
  ])
    ? 1
    : exercise.category === "compound"
      ? 0.7
      : 0.85;

  const progression = PROGRESSION_VALUE[exercise.loadingCharacteristic ?? "machine_guided"] ?? 0.6;
  const control = CONTROL_VALUE[exercise.stabilityDemand ?? "moderate"] ?? 0.8;
  const fatigue =
    FATIGUE_EFFICIENCY_VALUE[exercise.loadingCharacteristic ?? "machine_guided"] ?? 0.7;

  // Balance axis: does the exercise serve a role this goal explicitly values?
  const servesPriority = exercise.roles.some((role) => emphasisedRoles.includes(role));
  const balance = servesPriority ? 1 : 0.6;

  const weighted =
    (stimulus * weights.stimulus +
      progression * weights.progression +
      control * weights.control +
      fatigue * weights.fatigueEfficiency +
      balance * weights.balance) /
    axisTotal;

  const detail = servesPriority
    ? `serves the ${context.goalProfile} goal through ${exercise.roles
        .filter((role) => emphasisedRoles.includes(role))
        .join(", ")}`
    : `neutral for a ${context.goalProfile} goal: ${exercise.loadingCharacteristic ?? "unknown loading"} with ${exercise.stabilityDemand ?? "moderate"} stability demand`;
  return { value: clamp(weighted, 0, 1), detail };
}

function scoreStimulusQuality(exercise: ExerciseKnowledge): { value: number; detail: string } {
  const confidences = exercise.targets
    .map((target) => target.confidence)
    .filter((value): value is number => value !== undefined);
  const meanConfidence =
    confidences.length === 0
      ? 0.7
      : confidences.reduce((sum, value) => sum + value, 0) / confidences.length;

  const rom = ROM_VALUE[exercise.rangeOfMotionCharacteristic ?? ""] ?? 0.75;
  const completeness = clamp(exercise.roles.length / 3, 0.4, 1);
  const value = clamp(0.5 * meanConfidence + 0.3 * rom + 0.2 * completeness, 0, 1);
  const romText = ROM_LABELS[exercise.rangeOfMotionCharacteristic ?? ""] ?? "no range classification";
  return {
    value,
    detail: `${romText}; targeting confidence ${round(meanConfidence, 2)} across ${exercise.targets.length} declared relations`,
  };
}

function scoreProgression(
  exercise: ExerciseKnowledge,
  context: SuitabilityContext,
): { value: number; detail: string } {
  let value = PROGRESSION_VALUE[exercise.loadingCharacteristic ?? "machine_guided"] ?? 0.6;
  const experience = context.trainingExperience;
  if ((experience === "untrained" || experience === "beginner") && exercise.stabilityDemand === "high") {
    // A high-skill movement is a poor progression vehicle for a beginner, even
    // when it is an excellent long-term movement.
    value *= 0.85;
    return { value, detail: "high skill demand makes this a slow progression route" };
  }
  return { value, detail: `progression path: ${exercise.loadingCharacteristic ?? "unspecified"}` };
}

function scoreUserCompatibility(
  exercise: ExerciseKnowledge,
  preference: ExercisePreferenceKind | undefined,
  context: SuitabilityContext,
): { value: number; detail: string } {
  let value = 0.6;
  const notes: string[] = [];
  if (preference === "preferred") {
    value += 0.25;
    notes.push("you prefer this exercise");
  } else if (preference === "disliked") {
    value -= 0.35;
    notes.push("you have marked this exercise as disliked");
  } else if (preference === "neutral") {
    value += 0.05;
    notes.push("neutral preference");
  }
  const experience = context.trainingExperience;
  if (experience === "untrained" || experience === "beginner") {
    if (exercise.stabilityDemand === "low") {
      value += 0.15;
      notes.push("low skill demand suits a beginner");
    } else if (exercise.stabilityDemand === "high") {
      value -= 0.1;
      notes.push("high skill demand is demanding for a beginner");
    }
  }
  return { value: clamp(value, 0, 1), detail: notes.length > 0 ? notes.join("; ") : "no preference or experience signal supplied" };
}

/**
 * Conservative limitation match: does any stated limitation name one of the
 * muscles this exercise actually targets? A miss is harmless (the planner sees
 * everything it would have seen); a hit produces a clear, explainable warning
 * rather than a silent exclusion.
 */
function matchingLimitations(
  exercise: ExerciseKnowledge,
  limitations: readonly string[],
): string[] {
  const haystacks = [exercise.name.toLowerCase()];
  for (const target of exercise.targets) {
    haystacks.push(target.muscleSlug.toLowerCase());
    haystacks.push(target.muscleDisplayName.toLowerCase());
    if (target.structureSlug) haystacks.push(target.structureSlug.toLowerCase());
    if (target.structureDisplayName) haystacks.push(target.structureDisplayName.toLowerCase());
  }
  return limitations
    .map((limitation) => limitation.trim().toLowerCase())
    .filter((limitation) => limitation.length > 0)
    .filter((limitation) => haystacks.some((needle) => needle.includes(limitation) || limitation.includes(needle)))
    .sort();
}

/**
 * Score one exercise in one context.
 *
 * Pure and total: it always returns a score with a tier and an explanation for
 * every component, including the zero cases. There is no path that returns
 * "unknown" because there is always an honest component-level answer.
 */
export function scoreExerciseSuitability(request: SuitabilityRequest): SuitabilityScore {
  const { exercise, context } = request;
  const available = new Set(context.availableEquipmentIds);
  const temporary = new Set(request.temporarilyUnavailableEquipmentIds ?? []);
  const missing: string[] = [];
  const blocked: string[] = [];
  for (const equipmentId of [...exercise.requiredEquipmentIds].sort()) {
    if (available.has(equipmentId)) continue;
    if (temporary.has(equipmentId)) blocked.push(equipmentId);
    else missing.push(equipmentId);
  }

  const hasTargetRequest =
    (request.targetMuscleIds?.length ?? 0) > 0 ||
    (request.targetMuscleSlugs?.length ?? 0) > 0 ||
    (request.targetStructureIds?.length ?? 0) > 0;

  const targetValue = hasTargetRequest
    ? bestTargetMatch(exercise, request) * COMPONENT_WEIGHTS["target_fit"]!
    : COMPONENT_WEIGHTS["target_fit"]! * 0.5;

  const emphasisedRoles = goalProfileRoles(context.goalProfile, context.goalPriorities);
  const goal = scoreGoalFit(exercise, context, emphasisedRoles);
  const stimulus = scoreStimulusQuality(exercise);
  const progression = scoreProgression(exercise, context);
  const compatibility = scoreUserCompatibility(exercise, request.preference, context);

  const equipmentValue =
    exercise.requiredEquipmentIds.length === 0
      ? COMPONENT_WEIGHTS["equipment_fit"]!
      : missing.length === 0 && blocked.length === 0
        ? COMPONENT_WEIGHTS["equipment_fit"]!
        : missing.length === 0 && blocked.length > 0
          ? COMPONENT_WEIGHTS["equipment_fit"]! * 0.4
          : 0;

  const maxRedundancy =
    (request.redundancy ?? []).reduce((max, finding) => Math.max(max, finding.overlapScore), 0);
  const redundancyValue = -maxRedundancy * COMPONENT_WEIGHTS["redundancy"]!;

  let constraintValue = 0;
  const constraintNotes: string[] = [];
  if (missing.length > 0) {
    constraintValue -= COMPONENT_WEIGHTS["constraint_penalty"]!;
    constraintNotes.push(`requires equipment you do not have (${missing.length} item(s))`);
  }
  if (blocked.length > 0) {
    constraintValue -= COMPONENT_WEIGHTS["constraint_penalty"]! * 0.2;
    constraintNotes.push("required equipment is temporarily unavailable");
  }
  if (request.preference === "excluded") {
    constraintValue -= COMPONENT_WEIGHTS["constraint_penalty"]!;
    constraintNotes.push("you have excluded this exercise");
  }
  const limitationHits = matchingLimitations(exercise, request.limitations ?? []);
  if (limitationHits.length > 0) {
    constraintValue -= COMPONENT_WEIGHTS["constraint_penalty"]! * 0.5;
    constraintNotes.push(`matches a stated limitation: ${limitationHits.join(", ")}`);
  }

  const components: SuitabilityScoreComponent[] = [
    component(
      "target_fit",
      "Target suitability",
      targetValue,
      COMPONENT_WEIGHTS["target_fit"]!,
      hasTargetRequest
        ? `best matching role contributes ${round(bestTargetMatch(exercise, request), 2)} of the target weight`
        : "no specific target muscle was requested, so target fit stays neutral",
    ),
    component("goal_fit", "Goal fit", goal.value * COMPONENT_WEIGHTS["goal_fit"]!, COMPONENT_WEIGHTS["goal_fit"]!, goal.detail),
    component(
      "equipment_fit",
      "Equipment fit",
      equipmentValue,
      COMPONENT_WEIGHTS["equipment_fit"]!,
      exercise.requiredEquipmentIds.length === 0
        ? "no equipment required"
        : missing.length === 0 && blocked.length === 0
          ? "every required item is available"
          : blocked.length > 0
            ? `${blocked.length} required item(s) temporarily unavailable`
            : `missing ${missing.length} required item(s)`,
    ),
    component(
      "progression_potential",
      "Progression potential",
      progression.value * COMPONENT_WEIGHTS["progression_potential"]!,
      COMPONENT_WEIGHTS["progression_potential"]!,
      progression.detail,
    ),
    component(
      "stimulus_quality",
      "Stimulus quality",
      stimulus.value * COMPONENT_WEIGHTS["stimulus_quality"]!,
      COMPONENT_WEIGHTS["stimulus_quality"]!,
      stimulus.detail,
    ),
    component(
      "user_compatibility",
      "User compatibility",
      compatibility.value * COMPONENT_WEIGHTS["user_compatibility"]!,
      COMPONENT_WEIGHTS["user_compatibility"]!,
      compatibility.detail,
    ),
    component(
      "redundancy",
      "Redundancy",
      redundancyValue,
      COMPONENT_WEIGHTS["redundancy"]!,
      maxRedundancy === 0
        ? "no overlap with the other selected exercises"
        : `highest overlap with a selected exercise is ${round(maxRedundancy, 2)}`,
    ),
    component(
      "constraint_penalty",
      "Constraint penalties",
      constraintValue,
      COMPONENT_WEIGHTS["constraint_penalty"]!,
      constraintNotes.length > 0 ? constraintNotes.join("; ") : "no constraints apply",
    ),
  ];

  const total = round(
    components.reduce((sum, item) => sum + item.value, 0),
    2,
  );
  const positiveCeiling = 110;
  const normalised = round(clamp((total / positiveCeiling) * 100, 0, 100), 1);

  return {
    total,
    normalised,
    tier: tierForScore(total),
    components,
    modelVersion: SUITABILITY_MODEL_VERSION,
  };
}

/** Roles a goal profile values, including any priority-derived roles. */
function goalProfileRoles(
  profile: SuitabilityContext["goalProfile"],
  priorities: readonly string[],
): readonly string[] {
  const base = DEFAULT_EMPHASIS[profile] ?? [];
  const fromPriorities = priorities.flatMap((priority) => PRIORITY_ROLES[priority] ?? []);
  return [...new Set([...base, ...fromPriorities])];
}

const DEFAULT_EMPHASIS: Readonly<Record<string, readonly string[]>> = {
  hypertrophy: ["hypertrophy_movement", "lengthened_position_emphasis"],
  strength: ["primary_strength_movement", "compound_movement"],
  athletic: ["compound_movement", "primary_strength_movement"],
  v_taper: ["lat_emphasis_pull", "lateral_delt_isolation", "upper_chest_press"],
  recomposition: ["compound_movement", "hypertrophy_movement"],
  general_fitness: ["compound_movement"],
};

const PRIORITY_ROLES: Readonly<Record<string, readonly string[]>> = {
  v_taper: ["lat_emphasis_pull", "lateral_delt_isolation", "upper_chest_press"],
  shoulder_width: ["lateral_delt_isolation"],
  upper_body: ["horizontal_push", "horizontal_pull", "vertical_pull", "vertical_push"],
  arm_development: ["isolation_movement"],
  chest_development: ["upper_chest_press", "horizontal_push"],
  leg_development: ["knee_extension_movement"],
  posterior_chain: ["hip_extension_movement", "hamstring_knee_flexion"],
  core: ["core_anti_extension", "core_rotation"],
};

/** Convenience: which movement functions an exercise should be asked about. */
export function functionsOf(exercise: ExerciseKnowledge): readonly MovementFunction[] {
  return exercise.primaryMovementFunction
    ? [exercise.primaryMovementFunction, ...exercise.movementFunctions.filter((fn) => fn !== exercise.primaryMovementFunction)]
    : exercise.movementFunctions;
}
