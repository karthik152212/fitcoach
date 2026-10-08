import type { GoalContext, GoalKind, TrainingGoalProfile } from "@fitcoach/domain";
import type { MuscleGroup } from "@fitcoach/domain";
import { GOAL_TRAINING_MODIFIERS } from "./trainingConfig";
import { goalProfileFor } from "./goalProfiles";

/**
 * Goal alignment engine (Phase 3).
 *
 * Replaces the Phase 1/2 stub. Evaluates how well a training plan aligns with
 * the user's goal and priorities.
 *
 * The goal alignment engine answers:
 * - Which muscle groups does this goal prioritize?
 * - Which exercise roles does this goal value?
 * - How should volume, frequency, and exercise selection be weighted?
 * - Does a given plan serve the goal's priorities?
 */

// ---------------------------------------------------------------------------
// Goal-aware muscle priorities
// ---------------------------------------------------------------------------

/**
 * Get the muscle groups a goal profile prioritizes, with relative weight.
 */
export function getGoalMusclePriorities(
  goalProfile: TrainingGoalProfile,
  priorities: readonly string[] = [],
  physiquePriorities: readonly string[] = [],
): Readonly<Record<MuscleGroup, number>> {
  const basePriorities: Record<MuscleGroup, number> = {
    chest: 1,
    upper_back: 1,
    lats: 1,
    traps: 1,
    front_delts: 1,
    side_delts: 1,
    rear_delts: 1,
    biceps: 1,
    triceps: 1,
    forearms: 1,
    quadriceps: 1,
    hamstrings: 1,
    glutes: 1,
    adductors: 1,
    calves: 1,
    abdominals: 1,
    obliques: 1,
    lower_back: 1,
    neck: 1,
    other: 0,
  };

  // Apply goal profile modifiers
  switch (goalProfile) {
    case "hypertrophy":
      // Balanced development — all muscles equal
      break;
    case "strength":
      // Compounds emphasize posterior chain and full-body
      basePriorities.lower_back = 1.3;
      basePriorities.hamstrings = 1.2;
      basePriorities.glutes = 1.2;
      break;
    case "v_taper":
      // V-taper: lats, side delts, upper back, upper chest
      basePriorities.lats = 1.5;
      basePriorities.side_delts = 1.5;
      basePriorities.upper_back = 1.3;
      basePriorities.chest = 1.1;
      basePriorities.traps = 1.2;
      // Waist appearance is served by overall body composition, not spot
      // reduction: core work supports trunk stability and posture.
      basePriorities.abdominals = 1.2;
      basePriorities.obliques = 1.1;
      break;
    case "recomposition":
      // Full body with emphasis on large muscle groups for energy expenditure
      basePriorities.quadriceps = 1.2;
      basePriorities.glutes = 1.2;
      basePriorities.lats = 1.1;
      basePriorities.chest = 1.1;
      break;
    case "athletic":
      // Movement competence — posterior chain, core, full body
      basePriorities.hamstrings = 1.3;
      basePriorities.glutes = 1.3;
      basePriorities.lower_back = 1.2;
      basePriorities.abdominals = 1.2;
      basePriorities.obliques = 1.2;
      basePriorities.quadriceps = 1.1;
      break;
    case "general_fitness":
      // Balanced with emphasis on compound movement patterns
      basePriorities.quadriceps = 1.1;
      basePriorities.glutes = 1.1;
      basePriorities.lats = 1.1;
      basePriorities.chest = 1.1;
      break;
  }

  // Apply explicit priorities
  const priorityMuscleMap: Record<string, MuscleGroup | string> = {
    "shoulder_width": "side_delts",
    "upper_body": "chest",
    "arm_development": "biceps",
    "chest_development": "chest",
    "leg_development": "quadriceps",
    "posterior_chain": "hamstrings",
    "core": "abdominals",
    "waist_control": "abdominals",
    "lats": "lats",
    "upper_back": "upper_back",
    "side_delts": "side_delts",
    "front_delts": "front_delts",
    "rear_delts": "rear_delts",
    "biceps": "biceps",
    "triceps": "triceps",
    "quadriceps": "quadriceps",
    "hamstrings": "hamstrings",
    "glutes": "glutes",
    "calves": "calves",
  };

  for (const priority of [...priorities, ...physiquePriorities]) {
    const mapped = priorityMuscleMap[priority];
    if (mapped && basePriorities[mapped as MuscleGroup] !== undefined) {
      basePriorities[mapped as MuscleGroup] = Math.min(basePriorities[mapped as MuscleGroup] + 0.3, 2.0);
    }
  }

  return basePriorities as Readonly<Record<MuscleGroup, number>>;
}

// ---------------------------------------------------------------------------
// Goal-aware exercise role valuation
// ---------------------------------------------------------------------------

/**
 * Get the exercise roles a goal profile values, with relative weight.
 */
export function getGoalValuedRoles(
  goalProfile: TrainingGoalProfile,
  priorities: readonly string[] = [],
): Readonly<Record<string, number>> {
  const baseRoles: Record<string, number> = {};

  // Start with emphasized roles from goalProfileFor
  const profileResult = goalProfileFor({ kind: mapProfileToGoalKind(goalProfile), priorities });
  for (const role of profileResult.emphasisedRoles) {
    baseRoles[role] = 1.0;
  }

  // Apply goal-specific role valuation
  switch (goalProfile) {
    case "hypertrophy":
      // Hypertrophy values: hypertrophy movements, lengthened position, isolation
      baseRoles["hypertrophy_movement"] = 1.0;
      baseRoles["lengthened_position_emphasis"] = 0.8;
      baseRoles["isolation_movement"] = 0.7;
      baseRoles["shortened_position_emphasis"] = 0.5;
      break;
    case "strength":
      // Strength values: primary strength, compounds
      baseRoles["primary_strength_movement"] = 1.0;
      baseRoles["compound_movement"] = 0.9;
      baseRoles["isolation_movement"] = 0.3;
      break;
    case "v_taper":
      // V-taper values: lat emphasis pulls, lateral delt isolation, upper chest press
      baseRoles["lat_emphasis_pull"] = 1.0;
      baseRoles["lateral_delt_isolation"] = 1.0;
      baseRoles["upper_chest_press"] = 0.9;
      baseRoles["hypertrophy_movement"] = 0.8;
      break;
    case "athletic":
      // Athletic values: compounds, primary strength, core
      baseRoles["compound_movement"] = 1.0;
      baseRoles["primary_strength_movement"] = 0.9;
      baseRoles["core_anti_extension"] = 0.7;
      baseRoles["core_rotation"] = 0.6;
      break;
    case "recomposition":
      // Recomposition values: compounds, hypertrophy
      baseRoles["compound_movement"] = 0.9;
      baseRoles["hypertrophy_movement"] = 0.8;
      baseRoles["lengthened_position_emphasis"] = 0.5;
      break;
    case "general_fitness":
      // General fitness values: compounds, movement variety
      baseRoles["compound_movement"] = 1.0;
      baseRoles["primary_strength_movement"] = 0.6;
      break;
  }

  // Apply priority-based role emphasis
  const priorityRoleMap: Record<string, string[]> = {
    "shoulder_width": ["lateral_delt_isolation"],
    "upper_body": ["horizontal_push", "horizontal_pull", "vertical_push", "vertical_pull"],
    "arm_development": ["isolation_movement"],
    "chest_development": ["upper_chest_press", "horizontal_push"],
    "leg_development": ["knee_extension_movement", "squat"],
    "posterior_chain": ["hinge", "hip_extension_movement", "hamstring_knee_flexion"],
    "core": ["core_anti_extension", "core_rotation"],
  };

  for (const priority of priorities) {
    const roles = priorityRoleMap[priority] ?? [];
    for (const role of roles) {
      baseRoles[role] = Math.min((baseRoles[role] ?? 0) + 0.2, 1.5);
    }
  }

  return baseRoles as Readonly<Record<string, number>>;
}

// ---------------------------------------------------------------------------
// Goal alignment evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate how well a plan aligns with the user's goal.
 *
 * @param goalContext - The user's goal context.
 * @param planMuscleExposure - Map of muscle group slug → weekly effective sets.
 * @param planExerciseRoles - Map of exercise role → count in plan.
 * @param goalProfile - The goal profile (derived from goal kind).
 * @returns Alignment evaluation with score and recommendations.
 */
/**
 * Result of evaluating a plan against a goal's priorities.
 */
export interface GoalAlignmentResult {
  alignmentScore: number;
  profile: TrainingGoalProfile;
  emphasisedMuscles: Readonly<Record<string, number>>;
  emphasisedRoles: readonly string[];
  gaps: readonly string[];
  strengths: readonly string[];
  recommendations: readonly string[];
}

export function evaluateGoalAlignment(
  goalContext: GoalContext,
  planMuscleExposure: Readonly<Record<string, number>>,
  planExerciseRoles: Readonly<Record<string, number>>,
): GoalAlignmentResult {
  const goalProfile = mapGoalKindToProfile(goalContext.goalKind);
  const musclePriorities = getGoalMusclePriorities(goalProfile, goalContext.priorities, goalContext.physiquePriorities);
  const valuedRoles = getGoalValuedRoles(goalProfile, goalContext.priorities);

  const gaps: string[] = [];
  const strengths: string[] = [];
  const recommendations: string[] = [];

  // Evaluate muscle coverage against priorities
  let alignmentSum = 0;
  let maxPossibleSum = 0;

  for (const [muscleGroup, priority] of Object.entries(musclePriorities)) {
    if (priority === 0) continue;

    const exposure = planMuscleExposure[muscleGroup] ?? 0;
    const expectedMin = priority * 6; // Rough expected minimum

    maxPossibleSum += priority * 10;
    alignmentSum += Math.min(exposure / expectedMin, 1) * priority * 10;

    if (exposure < expectedMin * 0.5) {
      gaps.push(`${muscleGroup}: low exposure (${Math.round(exposure)} effective sets vs expected ~${Math.round(expectedMin)})`);
      recommendations.push(`Consider adding ${muscleGroup} work to better serve the ${goalProfile} goal.`);
    } else if (exposure >= expectedMin) {
      strengths.push(`${muscleGroup}: adequate exposure (${Math.round(exposure)} effective sets)`);
    }
  }

  // Evaluate role coverage
  for (const [role, weight] of Object.entries(valuedRoles)) {
    const count = planExerciseRoles[role] ?? 0;
    if (count === 0 && weight > 0.5) {
      gaps.push(`Role "${role}": not represented in plan`);
      recommendations.push(`Consider including exercises with the "${role}" role to better serve the goal.`);
    } else if (count > 0) {
      strengths.push(`Role "${role}": ${count} exercise(s) in plan`);
    }
  }

  const alignmentScore = maxPossibleSum > 0 ? alignmentSum / maxPossibleSum : 0;

  return {
    alignmentScore: Math.round(alignmentScore * 100) / 100,
    profile: goalProfile,
    emphasisedMuscles: musclePriorities,
    emphasisedRoles: Object.entries(valuedRoles)
      .filter(([, w]) => w > 0.5)
      .map(([r]) => r),
    gaps: gaps as readonly string[],
    strengths: strengths as readonly string[],
    recommendations: recommendations as readonly string[],
  };
}

// ---------------------------------------------------------------------------
// Goal-aware plan quality contribution
// ---------------------------------------------------------------------------

/**
 * Calculate the goal alignment contribution to overall plan quality.
 *
 * @param alignment - The goal alignment evaluation.
 * @param weights - Plan quality weights.
 * @returns The goal alignment quality contribution (0-100).
 */
export function goalAlignmentQuality(
  alignment: ReturnType<typeof evaluateGoalAlignment>,
  weights: Readonly<Record<string, number>> = { goalAlignment: 1 },
): number {
  // Quality = alignment score * weight
  const rawScore = alignment.alignmentScore * 100; // Convert to 0-100
  return Math.round(rawScore * (weights.goalAlignment ?? 1));
}

// ---------------------------------------------------------------------------
// Goal strategy description
// ---------------------------------------------------------------------------

/**
 * Get a human-readable description of the training strategy for a goal.
 */
export function describeGoalStrategy(goalContext: GoalContext): string {
  const profile = mapGoalKindToProfile(goalContext.goalKind);
  const modifiers = GOAL_TRAINING_MODIFIERS[profile];
  const priorities = [...goalContext.priorities, ...goalContext.physiquePriorities ?? []];

  const parts: string[] = [];

  switch (profile) {
    case "hypertrophy":
      parts.push("Training is structured for muscle growth: moderate rep ranges (8-15), " +
        `${modifiers.preferredRestSeconds}s rest, with emphasis on effective volume and exercise quality.`);
      break;
    case "strength":
      parts.push("Training is structured for strength development: lower rep ranges (3-6), " +
        `${modifiers.preferredRestSeconds}s rest, with emphasis on compound movements and progressive overload.`);
      break;
    case "v_taper":
      parts.push("Training is structured for V-taper aesthetics: emphasis on lat development, " +
        "lateral delts, and upper back, with balanced chest and waist management.");
      break;
    case "recomposition":
      parts.push("Training is structured for body recomposition: balanced full-body or upper/lower work " +
        "with moderate volume to support both muscle retention and fat loss.");
      break;
    case "athletic":
      parts.push("Training is structured for athletic performance: compound movement variety, " +
        "posterior chain development, and core stability.");
      break;
    case "general_fitness":
      parts.push("Training is structured for general fitness: balanced full-body work with " +
        "emphasis on movement quality and consistency.");
      break;
  }

  if (priorities.length > 0) {
    parts.push(`Specific priorities: ${priorities.join(", ")}.`);
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function mapGoalKindToProfile(goalKind: string): TrainingGoalProfile {
  const mapping: Record<string, TrainingGoalProfile> = {
    bodybuilding: "hypertrophy",
    aesthetics_v_taper: "v_taper",
    lean_recomposition: "recomposition",
    athletic_performance: "athletic",
    max_strength: "strength",
    general_fitness: "general_fitness",
    custom: "general_fitness",
  };
  return mapping[goalKind] ?? "general_fitness";
}

function mapProfileToGoalKind(profile: TrainingGoalProfile): GoalKind {
  const mapping: Record<TrainingGoalProfile, GoalKind> = {
    hypertrophy: "bodybuilding",
    v_taper: "aesthetics_v_taper",
    recomposition: "lean_recomposition",
    athletic: "athletic_performance",
    strength: "max_strength",
    general_fitness: "general_fitness",
  };
  return mapping[profile];
}

// ---------------------------------------------------------------------------
// Deprecated: backward compatibility
// ---------------------------------------------------------------------------

/**
 * @deprecated Use evaluateGoalAlignment instead.
 */
export function evaluateGoalAlignmentOld(
  _params: { goal: unknown; inputs: unknown },
): void {
  throw new Error(
    "fitness-core: evaluateGoalAlignment has been replaced by the goal alignment engine. Import evaluateGoalAlignment from './goalAlignment'.",
  );
}
