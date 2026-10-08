import type {
  ExercisePreferenceKind,
  ExerciseRole,
  PlannedExercise,
  SessionDurationBudget,
  TrainingContext,
  TrainingExperience,
  TrainingGoalProfile,
} from "@fitcoach/domain";
import {
  DEFAULT_SESSION_DURATION_BUDGET,
  REST_SECONDS_BY_GOAL,
  WARMUP_MINUTES_BY_SESSION_TYPE,
} from "./trainingConfig";
import type { ExerciseKnowledge } from "./knowledgeCatalog";
import type { SessionAssignment } from "./frequency";
import type { VolumeAdjustment } from "./volume";

/**
 * Session construction + duration estimation engine (Phase 3).
 *
 * Constructs session layouts from planned exercises and estimates duration.
 *
 * Duration model:
 *   duration = warmup + Σ(exercise_setup + sets * (work + rest) + transition) + logging
 *
 * Every assumption is configurable and documented.
 */

// ---------------------------------------------------------------------------
// Duration estimation
// ---------------------------------------------------------------------------

/**
 * Estimate session duration from planned exercises.
 *
 * @param exercises - Planned exercises for the session.
 * @param sessionType - Type of session (full_body, upper, lower, push, pull, legs).
 * @param context - Training context for duration parameters.
 * @param goalProfile - Goal profile for rest time.
 * @param budget - Session duration budget.
 * @returns Duration estimate with breakdown.
 */
export function estimateSessionDuration(
  exercises: readonly PlannedExercise[],
  sessionType: string,
  context: Pick<TrainingContext, "maxSessionDurationMinutes" | "trainingExperience">,
  goalProfile: TrainingGoalProfile,
  budget: SessionDurationBudget = DEFAULT_SESSION_DURATION_BUDGET,
): {
  estimatedMinutes: number;
  targetMinutes: number;
  varianceMinutes: number;
  exceedsBudget: boolean;
  breakdown: DurationBreakdownItem[];
} {
  const warmupMinutes = budget.warmupMinutes + (WARMUP_MINUTES_BY_SESSION_TYPE[sessionType] ?? 0);
  const restSeconds = REST_SECONDS_BY_GOAL[goalProfile] ?? budget.restSecondsPerSet;
  const transitionSeconds = budget.transitionSecondsPerExercise;
  const loggingMinutes = budget.loggingMinutes;

  const breakdown: DurationBreakdownItem[] = [];

  // Warm-up
  breakdown.push({
    component: "warmup",
    minutes: warmupMinutes,
    detail: `Warm-up (${sessionType})`,
  });

  let exerciseTime = 0;

  for (const exercise of exercises) {
    const setCount = exercise.targetSets ?? 3;
    const setsPerExercise = Math.max(1, setCount);

    // Per-set time: work time (30s-60s depending on reps) + rest
    const avgReps = exercise.repMax ? Math.round((exercise.repMin ?? 8) + (exercise.repMax - (exercise.repMin ?? 8)) / 2) : 10;
    const workSecondsPerSet = Math.min(60, 20 + avgReps * 2); // 20s setup + 2s per rep
    const restSecondsPerSet = exercise.restSeconds ?? restSeconds;

    const exerciseDurationSeconds = setsPerExercise * (workSecondsPerSet + restSecondsPerSet) +
      transitionSeconds +
      60; // 60s for setup/transition to this exercise

    const exerciseMinutes = exerciseDurationSeconds / 60;
    exerciseTime += exerciseMinutes;

    breakdown.push({
      component: "exercise",
      minutes: Math.round(exerciseMinutes * 10) / 10,
      detail: `${exercise.name}: ${setsPerExercise} sets × ${exercise.repMin ?? 8}-${exercise.repMax ?? 15} reps, ${exercise.restSeconds ?? restSeconds}s rest`,
      exerciseId: exercise.exerciseId,
    });
  }

  const estimatedMinutes = warmupMinutes + exerciseTime + loggingMinutes;
  const targetMinutes = context.maxSessionDurationMinutes;
  const varianceMinutes = estimatedMinutes - targetMinutes;
  const exceedsBudget = varianceMinutes > 0;

  return {
    estimatedMinutes: Math.round(estimatedMinutes),
    targetMinutes,
    varianceMinutes: Math.round(varianceMinutes),
    exceedsBudget,
    breakdown,
  };
}

/**
 * Repair an over-budget session by reducing exercise count or sets.
 *
 * Repair order (documented in spec):
 * 1. Remove unnecessary redundancy
 * 2. Reduce low-priority accessory work
 * 3. Reduce sets on non-priority exercises
 * 4. Substitute shorter exercises (not implemented in this phase)
 *
 * @param exercises - Current planned exercises.
 * @param estimatedDuration - Current duration estimate.
 * @param targetMinutes - Target duration.
 * @param priorityMuscles - Muscles that should be prioritized (if any).
 * @param goalProfile - Goal profile for rep range adjustments.
 * @returns Repaired exercises and changes made.
 */
export function repairOverBudgetSession(
  exercises: readonly PlannedExercise[],
  estimatedDuration: number,
  targetMinutes: number,
  priorityMuscles: readonly string[] = [],
  goalProfile: TrainingGoalProfile = "hypertrophy",
): {
  repairedExercises: readonly PlannedExercise[];
  changes: readonly SessionRepairChange[];
  stillOverBudget: boolean;
  originalDuration: number;
  newDuration: number;
} {
  if (estimatedDuration <= targetMinutes) {
    return {
      repairedExercises: exercises,
      changes: [],
      stillOverBudget: false,
      originalDuration: estimatedDuration,
      newDuration: estimatedDuration,
    };
  }

  const changes: SessionRepairChange[] = [];
  // Work on copies so the caller's planned exercises stay untouched. Strategy 1
  // mutates these copies in place and Strategy 2 removes them by identity, so
  // the two strategies can never disagree about what is still in the session —
  // a repair that reports fewer sets but leaves the session unchanged would be
  // a silent lie (Phase 3.1 §16–§18).
  let currentExercises = exercises.map((exercise) => ({ ...exercise }));
  let currentDuration = estimatedDuration;

  // Calculate priority score for each exercise
  const priorityScore = (ex: PlannedExercise): number => {
    let score = 0;
    // Check if exercise targets a priority muscle
    if (ex.planRole) {
      for (const pm of priorityMuscles) {
        if (ex.planRole.toLowerCase().includes(pm.toLowerCase())) {
          score += 10;
        }
      }
    }
    // Lower rep ranges = more important (strength focus)
    if (ex.repMax && ex.repMax <= 6) score += 5;
    // More sets = more important
    score += (ex.targetSets ?? 3) * 0.5;
    return score;
  };

  // Sort by priority (highest first) — we'll keep the most important
  const sorted = [...currentExercises].sort((a, b) => priorityScore(b) - priorityScore(a));

  // Try to reduce to fit budget
  const targetReduction = currentDuration - targetMinutes;
  let reductionNeeded = targetReduction;

  // Strategy 1: Reduce sets on low-priority exercises
  // Strength/athletic goals keep at least 2 sets per exercise: stripping a
  // strength session to a single set destroys the stimulus it exists for.
  const minSets = goalProfile === "strength" || goalProfile === "athletic" ? 2 : 1;
  for (let i = sorted.length - 1; i >= 0 && reductionNeeded > 0; i--) {
    const exercise = sorted[i];
    if (!exercise) continue;
    const currentSets = exercise.targetSets ?? 3;

    if (currentSets > minSets) {
      // Estimate time saved per set reduction
      const setsReduced = Math.min(currentSets - minSets, Math.ceil(reductionNeeded / 3));
      if (setsReduced > 0) {
        const newSets = currentSets - setsReduced;
        changes.push({
          type: "reduce_sets",
          exerciseId: exercise.exerciseId,
          exerciseName: exercise.name,
          from: currentSets,
          to: newSets,
          estimatedTimeSaved: setsReduced * 2.5, // ~2.5 min per set
        });
        // Apply the reduction, not just record it: the session that is returned
        // must actually be the shorter one that was modelled.
        exercise.targetSets = newSets;
        reductionNeeded -= setsReduced * 2.5;
      }
    }
  }

  // Strategy 2: Remove low-priority exercises if still over budget
  if (reductionNeeded > 0) {
    for (let i = sorted.length - 1; i >= 0 && reductionNeeded > 0; i--) {
      const exercise = sorted[i];
      if (!exercise) continue;
      if (priorityScore(exercise) < 3) { // Low priority threshold
        changes.push({
          type: "remove_exercise",
          exerciseId: exercise.exerciseId,
          exerciseName: exercise.name,
          estimatedTimeSaved: estimateExerciseDuration(exercise),
        });
        reductionNeeded -= estimateExerciseDuration(exercise);
        // Mark for removal
        const idx = currentExercises.indexOf(exercise);
        if (idx !== -1) currentExercises.splice(idx, 1);
      }
    }
  }

  // Recalculate duration
  const newDuration = currentDuration - changes.reduce((sum, c) => sum + (c.estimatedTimeSaved ?? 0), 0);

  return {
    repairedExercises: currentExercises as PlannedExercise[],
    changes: changes as readonly SessionRepairChange[],
    stillOverBudget: newDuration > targetMinutes,
    originalDuration: estimatedDuration,
    newDuration: Math.round(newDuration),
  };
}

/**
 * Estimate duration for a single exercise.
 */
function estimateExerciseDuration(exercise: PlannedExercise): number {
  const sets = exercise.targetSets ?? 3;
  const avgReps = exercise.repMax ? Math.round((exercise.repMin ?? 8) + (exercise.repMax - (exercise.repMin ?? 8)) / 2) : 10;
  const workSeconds = sets * Math.min(60, 20 + avgReps * 2);
  const restSeconds = sets * (exercise.restSeconds ?? 90);
  const setupSeconds = 60;

  return (workSeconds + restSeconds + setupSeconds) / 60;
}

// ---------------------------------------------------------------------------
// Session construction from frequency assignment
// ---------------------------------------------------------------------------

/**
 * Build a session from frequency assignments.
 *
 * @param sessionIndex - Which session this is (0-indexed within the week).
 * @param assignments - Muscle-to-session assignments for this session.
 * @param exerciseCatalog - Available exercises for each muscle.
 * @param goalProfile - Goal profile.
 * @param experience - Training experience.
 * @param context - Training context.
 * @returns Constructed session with exercises.
 */
export function buildSessionFromAssignments(
  sessionIndex: number,
  assignments: readonly SessionAssignment[],
  exerciseCatalog: Readonly<Record<string, readonly ExerciseKnowledge[]>>, // muscleSlug → exercises
  goalProfile: TrainingGoalProfile,
  experience: TrainingExperience,
  context: Pick<
    TrainingContext,
    | "availableEquipmentIds"
    | "exercisePreferences"
    | "temporarilyUnavailableEquipmentIds"
    | "limitations"
    | "maxSessionDurationMinutes"
    | "trainingExperience"
  >,
): {
  sessionExercises: readonly PlannedExercise[];
  durationEstimate: ReturnType<typeof estimateSessionDuration>;
  warnings: readonly string[];
} {
  const sessionExercises: PlannedExercise[] = [];
  const warnings: string[] = [];

  // Group assignments by muscle
  const byMuscle = new Map<string, SessionAssignment[]>();
  for (const assignment of assignments) {
    const existing = byMuscle.get(assignment.muscleSlug) ?? [];
    existing.push(assignment);
    byMuscle.set(assignment.muscleSlug, existing);
  }

  let position = 0;

  for (const [muscleSlug, muscleAssignments] of byMuscle.entries()) {
    const availableExercises = exerciseCatalog[muscleSlug] ?? [];

    if (availableExercises.length === 0) {
      warnings.push(`No available exercises for muscle: ${muscleSlug}`);
      continue;
    }

    // Select exercises for this muscle
    const setsNeeded = muscleAssignments.reduce((sum, a) => sum + a.sets, 0);

    // Choose primary exercise (first in priority order)
    const primaryExercise = selectBestExercise(
      availableExercises,
      muscleSlug,
      goalProfile,
      experience,
      context,
    );

    if (primaryExercise) {
      position++;
      sessionExercises.push({
        id: `${muscleSlug}-${sessionIndex}-${position}`,
        exerciseId: primaryExercise.id,
        position,
        name: primaryExercise.name,
        variationLabel: primaryExercise.variationLabel,
        targetSets: Math.min(setsNeeded, getMaxSetsForMuscle(muscleSlug, goalProfile)),
        repMin: getRepRange(goalProfile).min,
        repMax: getRepRange(goalProfile).max,
        targetRir: getTargetRir(goalProfile),
        restSeconds: getRestSeconds(goalProfile),
        order: position,
        planRole: determinePlanRole(muscleSlug, primaryExercise, goalProfile),
        selectionReason: `Primary ${muscleSlug} exercise for ${goalProfile} goal.`,
        substitutionExerciseIds: getSubstitutionIds(primaryExercise, availableExercises),
        knowledgeVersion: primaryExercise.knowledgeVersion ?? 1,
      });
    } else {
      // Never silently skip a muscle: state why no exercise could be chosen.
      warnings.push(
        `No feasible ${muscleSlug} exercise given available equipment, temporary availability and preferences.`,
      );
      continue;
    }

    // Add secondary/accessory exercises if enough sets
    if (setsNeeded > getMaxSetsForMuscle(muscleSlug, goalProfile) && availableExercises.length > 1) {
      const remainingSets = setsNeeded - getMaxSetsForMuscle(muscleSlug, goalProfile);
      const secondaryExercise = selectBestExercise(
        availableExercises.filter(e => e.id !== primaryExercise?.id),
        muscleSlug,
        goalProfile,
        experience,
        context,
      );

      if (secondaryExercise && remainingSets > 0) {
        position++;
        sessionExercises.push({
          id: `${muscleSlug}-${sessionIndex}-${position}`,
          exerciseId: secondaryExercise.id,
          position,
          name: secondaryExercise.name,
          variationLabel: secondaryExercise.variationLabel,
          targetSets: Math.min(remainingSets, getMaxSetsForMuscle(muscleSlug, goalProfile) - 1),
          repMin: getRepRange(goalProfile).min,
          repMax: getRepRange(goalProfile).max,
          targetRir: getTargetRir(goalProfile),
          restSeconds: getRestSeconds(goalProfile),
          order: position,
          planRole: "supporting",
          selectionReason: `Secondary ${muscleSlug} exercise for variety and volume.`,
          substitutionExerciseIds: getSubstitutionIds(secondaryExercise, availableExercises),
          knowledgeVersion: secondaryExercise.knowledgeVersion ?? 1,
        });
      }
    }
  }

  // Sort by position
  sessionExercises.sort((a, b) => a.position - b.position);

  // Estimate duration
  const sessionType = getSessionTypeForIndex(sessionIndex);
  const durationEstimate = estimateSessionDuration(
    sessionExercises,
    sessionType,
    context,
    goalProfile,
  );

  return {
    sessionExercises,
    durationEstimate,
    warnings: warnings as readonly string[],
  };
}

// ---------------------------------------------------------------------------
// Exercise selection helpers
// ---------------------------------------------------------------------------

/**
 * Select the best exercise for a muscle from available options.
 */
function selectBestExercise(
  exercises: readonly ExerciseKnowledge[],
  muscleSlug: string,
  goalProfile: TrainingGoalProfile,
  experience: TrainingExperience,
  context: Pick<TrainingContext, "availableEquipmentIds" | "exercisePreferences" | "temporarilyUnavailableEquipmentIds">,
): ExerciseKnowledge | null {
  const scored = exercises
    .filter(e => {
      // Hard preference: an excluded exercise never appears (Part 17).
      if (context.exercisePreferences?.[e.id] === "excluded") return false;

      // Must have the target muscle
      const targetsMuscle = e.targets.some(t => t.muscleSlug === muscleSlug);
      if (!targetsMuscle) return false;

      // Must have required equipment
      const hasEquipment = e.requiredEquipmentIds.every(eq =>
        context.availableEquipmentIds.includes(eq)
      );
      if (!hasEquipment) return false;

      // Must not be temporarily unavailable
      const allTempUnavailable = e.requiredEquipmentIds.length > 0 &&
        e.requiredEquipmentIds.every(eq =>
          context.temporarilyUnavailableEquipmentIds?.includes(eq)
        );
      if (allTempUnavailable) return false;

      return true;
    })
    .map(e => ({
      exercise: e,
      score: scoreExerciseForMuscle(e, muscleSlug, goalProfile, experience) +
        preferenceAdjustment(context.exercisePreferences?.[e.id]),
    }))
    .sort((a, b) => b.score - a.score || a.exercise.id.localeCompare(b.exercise.id));

  return scored[0]?.exercise ?? null;
}

/**
 * Score an exercise for a specific muscle and goal.
 */
function scoreExerciseForMuscle(
  exercise: ExerciseKnowledge,
  muscleSlug: string,
  goalProfile: TrainingGoalProfile,
  experience: TrainingExperience,
): number {
  let score = 0;

  // Find the targeting entry for this muscle
  const target = exercise.targets.find(t => t.muscleSlug === muscleSlug);
  if (!target) return -1;

  // Role score: primary > secondary > supporting > stabilizer
  const roleScores: Record<string, number> = {
    primary_mover: 10,
    secondary_mover: 5,
    supporting: 2,
    stabilizer: 1,
  };
  score += roleScores[target.role] ?? 0;

  // Goal-role fit: does this exercise carry the role this goal values?
  const valuedRole = goalValuedRole(goalProfile);
  if (valuedRole && exercise.roles.includes(valuedRole)) score += 3;

  // Experience appropriateness
  if (experience === "untrained" || experience === "beginner") {
    if (exercise.stabilityDemand === "low") score += 2;
    if (exercise.stabilityDemand === "high") score -= 1;
  }

  // Stability demand appropriateness
  if (exercise.stabilityDemand === "moderate") score += 1;

  return score;
}

/**
 * Preference influences selection but never overrides safety/equipment hard
 * rules: preferred lifts a candidate, disliked demotes it, excluded removes
 * it entirely (handled in the filter above).
 */
function preferenceAdjustment(preference: ExercisePreferenceKind | undefined): number {
  switch (preference) {
    case "preferred":
      return 3;
    case "disliked":
      return -5;
    default:
      return 0;
  }
}

/**
 * The single Phase 2 exercise role each goal profile values most, used when
 * scoring exercise candidates for that goal.
 */
function goalValuedRole(goalProfile: TrainingGoalProfile): ExerciseRole | null {
  switch (goalProfile) {
    case "strength":
      return "primary_strength_movement";
    case "hypertrophy":
    case "v_taper":
    case "recomposition":
      return "hypertrophy_movement";
    case "athletic":
    case "general_fitness":
      return "compound_movement";
    default:
      return null;
  }
}

/**
 * Get max sets for a muscle in one session.
 */
function getMaxSetsForMuscle(muscleSlug: string, goalProfile: TrainingGoalProfile): number {
  // Large muscles can handle more sets per session
  const largeMuscles = ["quadriceps", "gluteus_maximus", "latissimus_dorsi", "pectoralis_major"];
  const smallMuscles = ["biceps_brachii", "triceps_brachii", "calves", "abdominals"];

  if (largeMuscles.includes(muscleSlug)) {
    return goalProfile === "strength" ? 6 : 5;
  }
  if (smallMuscles.includes(muscleSlug)) {
    return 4;
  }
  return 5;
}

/**
 * Get rep range for goal profile.
 */
function getRepRange(goalProfile: TrainingGoalProfile): { min: number; max: number } {
  switch (goalProfile) {
    case "strength":
      return { min: 3, max: 6 };
    case "hypertrophy":
    case "v_taper":
    case "recomposition":
      return { min: 8, max: 12 };
    case "athletic":
      return { min: 6, max: 10 };
    case "general_fitness":
      return { min: 10, max: 15 };
    default:
      return { min: 8, max: 12 };
  }
}

/**
 * Get target RIR for goal profile.
 */
function getTargetRir(goalProfile: TrainingGoalProfile): number {
  switch (goalProfile) {
    case "strength":
      return 1;
    case "hypertrophy":
    case "v_taper":
    case "recomposition":
      return 2;
    case "athletic":
      return 2;
    case "general_fitness":
      return 3;
    default:
      return 2;
  }
}

/**
 * Get rest seconds for goal profile.
 */
function getRestSeconds(goalProfile: TrainingGoalProfile): number {
  switch (goalProfile) {
    case "strength":
      return 180;
    case "hypertrophy":
    case "v_taper":
    case "recomposition":
      return 90;
    case "athletic":
      return 120;
    case "general_fitness":
      return 60;
    default:
      return 90;
  }
}

/**
 * Determine the plan role for an exercise.
 */
function determinePlanRole(muscleSlug: string, exercise: ExerciseKnowledge, goalProfile: TrainingGoalProfile): string {
  const target = exercise.targets.find(t => t.muscleSlug === muscleSlug);
  if (!target) return "accessory_movement";

  if (target.role === "primary_mover") {
    if (goalProfile === "strength") return "primary_strength_movement";
    if (goalProfile === "hypertrophy" || goalProfile === "v_taper") {
      if (exercise.rangeOfMotionCharacteristic === "stretch_emphasised") return "lengthened_position_emphasis";
      if (exercise.rangeOfMotionCharacteristic === "shortened_emphasised") return "shortened_position_emphasis";
      return "hypertrophy_movement";
    }
    return "compound_movement";
  }

  if (target.role === "secondary_mover") {
    return "secondary_hypertrophy_movement";
  }

  return "accessory_movement";
}

/**
 * Get substitution exercise IDs for an exercise.
 */
function getSubstitutionIds(exercise: ExerciseKnowledge, allExercises: readonly ExerciseKnowledge[]): readonly string[] {
  // Simple substitution: exercises targeting the same primary muscle
  const primaryMuscle = exercise.targets.find(t => t.role === "primary_mover");
  if (!primaryMuscle) return [];

  return allExercises
    .filter(e => e.id !== exercise.id)
    .filter(e => e.targets.some(t => t.muscleSlug === primaryMuscle.muscleSlug && t.role === "primary_mover"))
    .slice(0, 3)
    .map(e => e.id);
}

/**
 * Get session type name for an index.
 */
function getSessionTypeForIndex(index: number): string {
  const types = ["full_body", "upper", "lower", "push", "pull", "legs"];
  return types[index % types.length] ?? "full_body";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DurationBreakdownItem {
  component: "warmup" | "exercise" | "logging";
  minutes: number;
  detail: string;
  exerciseId?: string;
}

export interface SessionRepairChange {
  type: "reduce_sets" | "remove_exercise";
  exerciseId: string;
  exerciseName: string;
  from?: number;
  to?: number;
  estimatedTimeSaved: number;
}

/**
 * Apply bounded volume adjustments to planned exercises.
 *
 * The adaptation engine decides *how much* to change; this function applies it
 * with the smallest useful footprint:
 *
 *   - each adjustment's signed delta is spread one set at a time across the
 *     exercises that train the muscle as a primary mover, in stable
 *     exercise-id order,
 *   - muscles are processed in stable slug order and duplicate entries for the
 *     same muscle are summed first,
 *   - a set is never driven below `minSets` or above `maxSets`,
 *   - exercises with no primary-mover target for the muscle are untouched.
 *
 * Returns a new array of exercises; the engine never mutates its input.
 */
export function applyVolumeAdjustments(
  exercises: readonly PlannedExercise[],
  adjustments: readonly VolumeAdjustment[],
  catalog: readonly ExerciseKnowledge[],
  bounds: { minSets: number; maxSets: number } = { minSets: 1, maxSets: 8 },
): PlannedExercise[] {
  const catalogById = new Map(catalog.map((exercise) => [exercise.id, exercise]));
  const result = exercises.map((exercise) => ({ ...exercise }));

  const deltas = new Map<string, number>();
  for (const adjustment of adjustments) {
    const delta = adjustment.direction === "increase" ? adjustment.amount : -adjustment.amount;
    deltas.set(
      adjustment.muscleSlug,
      (deltas.get(adjustment.muscleSlug) ?? 0) + delta,
    );
  }

  for (const muscleSlug of [...deltas.keys()].sort((a, b) => a.localeCompare(b))) {
    let remaining = deltas.get(muscleSlug) ?? 0;
    if (remaining === 0) continue;

    const candidates = result
      .filter((exercise) =>
        (catalogById.get(exercise.exerciseId)?.targets ?? []).some(
          (target) => target.muscleSlug === muscleSlug && target.role === "primary_mover",
        ),
      )
      .sort((a, b) => a.exerciseId.localeCompare(b.exerciseId));
    if (candidates.length === 0) continue;

    const step = remaining > 0 ? 1 : -1;
    // Each pass moves one set per candidate; stop as soon as the delta is
    // consumed or no candidate can move without breaking the bounds.
    while (remaining !== 0) {
      let applied = false;
      for (const candidate of candidates) {
        if (remaining === 0) break;
        const next = candidate.targetSets + step;
        if (next < bounds.minSets || next > bounds.maxSets) continue;
        candidate.targetSets = next;
        remaining -= step;
        applied = true;
      }
      if (!applied) break;
    }
  }

  return result;
}
