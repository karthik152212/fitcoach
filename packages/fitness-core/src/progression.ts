import type {
  ProgressionAction,
  ProgressionRule,
  ProgressionConfiguration,
  ExercisePerformance,
  ProgressionStatus,
  TrainingGoalProfile,
} from "@fitcoach/domain";
import { DEFAULT_PROGRESSION_CONFIGURATION, TRAINING_CONFIG_VERSION } from "./trainingConfig";

/**
 * Progression engine (Phase 3).
 *
 * Replaces the Phase 1/2 stub. Implements deterministic progression rules for
 * load, reps, RIR, and rep-range progression.
 *
 * Principles:
 * - Bounded progression: users don't add weight every session forever
 * - Performance-based: progression requires evidence of capability
 * - Explainable: every progression decision has a rationale
 * - Configurable: thresholds are centralized in trainingConfig
 */

// ---------------------------------------------------------------------------
// Progression rule construction
// ---------------------------------------------------------------------------

/**
 * Build a default progression rule for an exercise based on goal and context.
 */
export function buildProgressionRule(
  exerciseId: string,
  exerciseName: string,
  goalProfile: TrainingGoalProfile,
  configuration: ProgressionConfiguration = DEFAULT_PROGRESSION_CONFIGURATION,
): ProgressionRule {
  const isStrength = goalProfile === "strength" || goalProfile === "athletic";

  return {
    id: exerciseId + ":progression",
    exerciseId,
    trigger: isStrength ? "complete_top_of_rep_range_at_target_rir" : "complete_sessions_at_top_of_rep_range",
    condition: isStrength
      ? "All working sets completed at top of strength rep range (≤6 reps) with RIR ≤ target"
      : "All working sets completed at top of hypertrophy rep range with target RIR for configured sessions",
    action: isStrength ? "progress_load" : "progress_reps",
    bounds: isStrength
      ? `Load progression bounded by exercise-specific max; increment ≤${configuration.loadIncrementKg}kg per progression`
      : `Rep progression bounded by ${configuration.hypertrophyRepMax} reps; after reaching top, increase load and reset reps`,
    resetBehavior: isStrength
      ? "After load progression, continue at lower rep range"
      : "After reaching rep max, increase load by ~5-10% and reset to rep range bottom",
    rationale: `Goal profile "${goalProfile}" prioritizes ${isStrength ? "specificity and loadability" : "stimulus and control"} for ${exerciseName}. Progression follows the appropriate pattern for this goal.`,
    configurationVersion: configuration.version ?? TRAINING_CONFIG_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Progression evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate whether progression is warranted for an exercise based on performance.
 *
 * @param exerciseId - Exercise identifier.
 * @param exerciseName - Exercise name for reporting.
 * @param performance - Exercise performance history.
 * @param goalProfile - Goal profile (affects progression style).
 * @param configuration - Progression configuration.
 * @returns Progression evaluation with recommendation.
 */
export function evaluateProgression(
  exerciseId: string,
  exerciseName: string,
  performance: ExercisePerformance,
  goalProfile: TrainingGoalProfile,
  configuration: ProgressionConfiguration = DEFAULT_PROGRESSION_CONFIGURATION,
): {
  action: ProgressionAction;
  shouldProgress: boolean;
  reasoning: string;
  evidence: string[];
  rule: ProgressionRule;
} {
  const rule = buildProgressionRule(exerciseId, exerciseName, goalProfile, configuration);
  const evidence: string[] = [];
  let action: ProgressionAction = "maintain";
  let shouldProgress = false;

  // Check for insufficient data
  if (performance.completedSessions < 2) {
    evidence.push("Insufficient performance history (<2 completed sessions).");
    return {
      action: "hold",
      shouldProgress: false,
      reasoning: "Waiting for more performance data before progressing.",
      evidence,
      rule,
    };
  }

  // Strength goal: check if user is at top of rep range with good RIR
  if (goalProfile === "strength" || goalProfile === "athletic") {
    const atTopOfRange = performance.bestReps !== undefined &&
      performance.bestReps <= configuration.strengthRepMax;
    const goodRir = performance.recentRir !== undefined &&
      performance.recentRir <= configuration.minRirForProgression;

    if (atTopOfRange && goodRir) {
      evidence.push(
        `At top of strength rep range (${performance.bestReps} reps ≤ ${configuration.strengthRepMax}) ` +
        `with RIR ${performance.recentRir} ≤ ${configuration.minRirForProgression}.`,
      );
      shouldProgress = true;
      action = "progress_load";
    } else {
      evidence.push(
        `Not yet at progression threshold: best reps ${performance.bestReps ?? "unknown"}, ` +
        `recent RIR ${performance.recentRir ?? "unknown"}.`,
      );
    }
  }
  // Hypertrophy/other goals: check sessions at top of rep range
  else {
    const atTopOfRange = performance.bestReps !== undefined &&
      performance.bestReps >= configuration.hypertrophyRepMax;
    const sessionsAtTop = performance.completedSessions; // Simplified: all sessions at current rep range

    if (atTopOfRange && performance.recentRir !== undefined &&
        performance.recentRir <= configuration.minRirForProgression) {
      evidence.push(
        `Completed reps at top of hypertrophy range (≥${configuration.hypertrophyRepMax}) ` +
        `with RIR ${performance.recentRir} ≤ ${configuration.minRirForProgression} ` +
        `for ${sessionsAtTop} session(s).`,
      );
      shouldProgress = true;
      action = configuration.sessionsAtTopBeforeProgress >= 2 ? "progress_reps" : "progress_load";
    } else if (atTopOfRange) {
      evidence.push(
        `At top of rep range but RIR ${performance.recentRir ?? "unknown"} > ${configuration.minRirForProgression}.`,
      );
    } else {
      evidence.push(
        `Best reps ${performance.bestReps ?? "unknown"} not yet at top of range (${configuration.hypertrophyRepMax}).`,
      );
    }
  }

  // Check for stalled/regressing performance
  if (performance.trend === "declining") {
    evidence.push("Performance trend is declining.");
    if (performance.incompleteSessions >= configuration.deloadStalledSessionThreshold) {
      action = "reduce_stimulus";
      shouldProgress = false;
      evidence.push(
        `Exercise stalled for ${performance.incompleteSessions} session(s) ` +
        `(threshold: ${configuration.deloadStalledSessionThreshold}). Consider reducing volume or load.`,
      );
    }
  } else if (performance.trend === "stable" && performance.completedSessions >= 4) {
    evidence.push("Performance has been stable for multiple sessions.");
    if (performance.recentRir !== undefined && performance.recentRir > 3) {
      evidence.push("RIR is consistently >3, indicating the load may be too light.");
      action = "progress_load";
      shouldProgress = true;
    }
  }

  // Respect max progressions per week (would be checked at plan level, not per exercise)
  if (shouldProgress && action === "progress_load") {
    evidence.push(
      `Load increment: ≤${configuration.loadIncrementKg}kg ` +
      `(configuration: loadIncrementKg).`,
    );
  }

  if (action === "progress_reps") {
    evidence.push(
      `Rep increment: +${configuration.repsToAddBeforeLoad} rep(s) ` +
      `(configuration: repsToAddBeforeLoad).`,
    );
  }

  const reasoning = buildProgressionReasoning(action, shouldProgress, evidence, rule);

  return { action, shouldProgress, reasoning, evidence, rule };
}

/**
 * Build human-readable reasoning for a progression decision.
 */
function buildProgressionReasoning(
  action: ProgressionAction,
  shouldProgress: boolean,
  evidence: string[],
  rule: ProgressionRule,
): string {
  if (!shouldProgress) {
    return `No progression recommended for this exercise (rule trigger: ${rule.trigger}). ${evidence.slice(0, 2).join(" ")}`;
  }

  switch (action) {
    case "progress_load":
      return `Progress load: ${evidence.join(" ")}`;
    case "progress_reps":
      return `Progress reps: ${evidence.join(" ")}`;
    case "maintain":
      return `Maintain current prescription: ${evidence.join(" ")}`;
    case "hold":
      return `Hold progression: ${evidence.join(" ")}`;
    case "reduce_stimulus":
      return `Reduce training stress: ${evidence.join(" ")}`;
    default:
      return `Action: ${action}. ${evidence.join(" ")}`;
  }
}

// ---------------------------------------------------------------------------
// Progression status computation
// ---------------------------------------------------------------------------

/**
 * Compute progression status for an exercise from performance data.
 */
export function computeProgressionStatus(
  exerciseId: string,
  exerciseName: string,
  performance: ExercisePerformance,
  lastProgressionDate: string | null,
  currentLoadKg?: number,
  currentRepMin?: number,
  currentRepMax?: number,
  currentRirTarget?: number,
): ProgressionStatus {
  const trend = performance.trend ?? "unknown";

  let status: ProgressionStatus["status"] = "unknown";
  let nextTarget = "Continue current prescription";

  if (trend === "improving") {
    status = "progressing";
    nextTarget = "Continue progressing within current parameters";
  } else if (trend === "declining") {
    status = "regressing";
    nextTarget = "Consider reducing load or volume; evaluate recovery";
  } else if (trend === "stable") {
    if (performance.completedSessions >= 4 && performance.recentRir !== undefined && performance.recentRir <= 1) {
      status = "progressing";
      nextTarget = "Ready to progress — performance is stable at high intensity";
    } else if (performance.completedSessions >= 2) {
      status = "holding";
      nextTarget = "Maintain current load and reps; progress when performance improves";
    } else {
      status = "stalled";
      nextTarget = "Performance is stable but not progressing; assess if load is appropriate";
    }
  }

  if (performance.completedSessions === 0) {
    status = "unknown";
    nextTarget = "No performance data yet; begin with conservative targets";
  }

  return {
    exerciseId,
    exerciseName,
    currentLoadKg,
    currentRepRange: currentRepMin !== undefined && currentRepMax !== undefined
      ? `${currentRepMin}–${currentRepMax}`
      : undefined,
    currentRirTarget,
    lastProgressionDate,
    progressionsCompleted: performance.completedSessions,
    status,
    nextProgressionTarget: nextTarget,
  };
}

// ---------------------------------------------------------------------------
// Deload evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a deload is warranted based on training stress signals.
 */
export function evaluateDeloadNeed(
  performanceByExercise: Readonly<Record<string, ExercisePerformance>>,
  configuration: ProgressionConfiguration = DEFAULT_PROGRESSION_CONFIGURATION,
): {
  shouldDeload: boolean;
  reasoning: string;
  affectedExercises: string[];
  severity: "none" | "mild" | "moderate" | "severe";
} {
  const affectedExercises: string[] = [];
  let severity: "none" | "mild" | "moderate" | "severe" = "none";

  for (const [exerciseId, performance] of Object.entries(performanceByExercise)) {
    if (
      performance.trend === "declining" &&
      performance.incompleteSessions >= configuration.deloadStalledSessionThreshold - 1
    ) {
      affectedExercises.push(exerciseId);
    }
  }

  if (affectedExercises.length === 0) {
    return { shouldDeload: false, reasoning: "No exercises show declining performance.", affectedExercises, severity: "none" };
  }

  if (affectedExercises.length === 1) {
    severity = "mild";
  } else if (affectedExercises.length <= 3) {
    severity = "moderate";
  } else {
    severity = "severe";
  }

  return {
    shouldDeload: affectedExercises.length > 0,
    reasoning: `Declining performance on ${affectedExercises.length} exercise(s): ${affectedExercises.join(", ")}.`,
    affectedExercises,
    severity,
  };
}

// ---------------------------------------------------------------------------
// Phase 1/2 review-shape adapter
// ---------------------------------------------------------------------------

export interface ProgressionReview {
  exerciseId: string;
  recentWorkingSets: readonly {
    reps?: number;
    loadKg?: number;
    rir?: number;
  }[];
}

export interface ProgressionRecommendation {
  exerciseId: string;
  action: ProgressionAction;
  reasoning: string;
}

/**
 * Recommend the next progression step for one exercise from logged sets.
 *
 * This is the Phase 1/2 review shape, which carries sets but no session
 * boundaries. Each logged set therefore counts as one completed exposure;
 * callers that can distinguish sessions should use `evaluateProgression`
 * with a real `ExercisePerformance` instead.
 */
export function recommendProgression(review: ProgressionReview): ProgressionRecommendation {
  const sets = review.recentWorkingSets;
  const bestReps = sets.reduce<number | undefined>(
    (best, set) => (set.reps !== undefined && (best === undefined || set.reps > best) ? set.reps : best),
    undefined,
  );
  const lastRir = [...sets].reverse().find((set) => set.rir !== undefined)?.rir;

  const performance: ExercisePerformance = {
    bestReps,
    recentRir: lastRir,
    completedSessions: sets.length,
    incompleteSessions: 0,
  };

  const evaluation = evaluateProgression(review.exerciseId, review.exerciseId, performance, "hypertrophy");

  return {
    exerciseId: review.exerciseId,
    action: evaluation.action,
    reasoning: evaluation.reasoning,
  };
}
