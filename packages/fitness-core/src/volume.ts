import type {
  ExerciseMuscleTarget,
  MuscleRole,
} from "@fitcoach/domain";
import type {
  EffectiveSetContribution,
  EffectiveSetCoefficients,
  MuscleVolumeContribution,
  WeeklyVolumeReport,
  TrainingGoalProfile,
  TrainingExperience,
} from "@fitcoach/domain";
import { COVERAGE_THRESHOLDS } from "./coverage";
import type { ExerciseKnowledge } from "./knowledgeCatalog";
import {
  DEFAULT_EFFECTIVE_SET_COEFFICIENTS,
  getMuscleVolumeTarget,
} from "./trainingConfig";

export type { EffectiveSetContribution, MuscleVolumeContribution, WeeklyVolumeReport };

/**
 * Volume engine (Phase 3).
 *
 * Replaces the Phase 1/2 stub. Computes effective volume from planned sets,
 * exercise-muscle relationships, and configurable coefficients.
 *
 * The model is transparent and decomposable:
 *   effective_sets(muscle, set) = base_sets * role_coefficient * emphasis_bonus
 *
 * Every coefficient is documented in trainingConfig.ts.
 */

// ---------------------------------------------------------------------------
// Effective set calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the effective set contribution of one planned set to one muscle.
 *
 * @param exercise - The exercise being performed.
 * @param target - The resolved targeting entry for this muscle in this exercise.
 * @param setCount - Number of sets planned.
 * @param coefficients - Effective set coefficients.
 * @returns The effective set contribution.
 */
export function calculateEffectiveSetContribution(
  exercise: Pick<ExerciseKnowledge, "id">,
  target: ExerciseMuscleTarget,
  setCount: number,
  coefficients: EffectiveSetCoefficients = DEFAULT_EFFECTIVE_SET_COEFFICIENTS,
): EffectiveSetContribution {
  const coefficient = roleCoefficient(target.role, coefficients);
  const emphasisBonus = target.emphasis ? coefficients.emphasis : 0;

  return {
    exerciseId: exercise.id,
    muscleId: target.muscleId,
    plannedSetId: exercise.id + ":" + target.muscleId,
    relationshipRole: target.role,
    contributionCoefficient: coefficient + emphasisBonus,
    effectiveSets: setCount * (coefficient + emphasisBonus),
    rationale: `Role: ${target.role}, coefficient: ${coefficient}${emphasisBonus > 0 ? ` + emphasis(${emphasisBonus})` : ""}`,
  };
}

/**
 * Get the coefficient for a given muscle role.
 */
export function roleCoefficient(role: MuscleRole, coefficients: EffectiveSetCoefficients): number {
  switch (role) {
    case "primary_mover":
      return coefficients.direct;
    case "secondary_mover":
      return Math.min(coefficients.indirect, coefficients.compoundIndirectCap);
    case "supporting":
      return coefficients.supporting;
    case "stabilizer":
      return coefficients.stabilizer;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Volume per muscle
// ---------------------------------------------------------------------------

/**
 * Calculate muscle volume contributions for a set of exercises with planned sets.
 *
 * @param exercises - The exercise catalog (with resolved targeting).
 * @param plannedSets - Map of exerciseId → number of weekly sets.
 * @param coefficients - Effective set coefficients.
 * @returns Volume contributions per muscle.
 */
export function calculateMuscleVolume(
  exercises: readonly ExerciseKnowledge[],
  plannedSets: Readonly<Record<string, number>>,
  coefficients: EffectiveSetCoefficients = DEFAULT_EFFECTIVE_SET_COEFFICIENTS,
): readonly MuscleVolumeContribution[] {
  const byMuscle = new Map<string, MuscleVolumeContribution>();

  for (const exercise of exercises) {
    const setCount = plannedSets[exercise.id] ?? 0;
    if (setCount <= 0) continue;

    // Group this exercise's entries per muscle: a whole-muscle entry plus one
    // or more head/region entries describe ONE exposure, not several.
    const entriesByMuscle = new Map<string, ExerciseMuscleTarget[]>();
    for (const target of exercise.targets) {
      const list = entriesByMuscle.get(target.muscleSlug);
      if (list) list.push(target);
      else entriesByMuscle.set(target.muscleSlug, [target]);
    }

    for (const [muscleSlug, entries] of entriesByMuscle) {
      const aggregated = aggregateExerciseMuscleContribution(entries, setCount, coefficients);
      const existing = byMuscle.get(muscleSlug);
      const muscleId = entries[0]?.muscleId ?? muscleSlug;

      if (!existing) {
        byMuscle.set(muscleSlug, {
          muscleId,
          muscleSlug,
          directEffectiveSets: aggregated.role === "primary_mover" ? aggregated.baseSets : 0,
          indirectEffectiveSets: aggregated.role === "secondary_mover" ? aggregated.baseSets : 0,
          supportingEffectiveSets: aggregated.role === "supporting" ? aggregated.baseSets : 0,
          stabilizingEffectiveSets: aggregated.role === "stabilizer" ? aggregated.baseSets : 0,
          emphasisEffectiveSets: aggregated.emphasisSets,
          totalEffectiveSets: aggregated.effectiveSets,
          contributingExercises: [exercise.slug],
        });
        continue;
      }

      switch (aggregated.role) {
        case "primary_mover":
          existing.directEffectiveSets += aggregated.baseSets;
          break;
        case "secondary_mover":
          existing.indirectEffectiveSets += aggregated.baseSets;
          break;
        case "supporting":
          existing.supportingEffectiveSets += aggregated.baseSets;
          break;
        case "stabilizer":
          existing.stabilizingEffectiveSets += aggregated.baseSets;
          break;
        default:
          break;
      }
      existing.emphasisEffectiveSets += aggregated.emphasisSets;
      existing.totalEffectiveSets += aggregated.effectiveSets;
      if (!existing.contributingExercises.includes(exercise.slug)) {
        existing.contributingExercises = [...existing.contributingExercises, exercise.slug];
      }
    }
  }

  return [...byMuscle.values()].sort((a, b) => a.muscleSlug.localeCompare(b.muscleSlug));
}

/**
 * Combine one exercise's entries for one muscle into a single exposure.
 *
 * Rules (documented modeling assumptions):
 * - The whole-muscle entry carries the exercise's base contribution; the
 *   strongest one wins when several are listed.
 * - Head/region entries never add a second full set for the same muscle —
 *   doing so would double-count one performed set. They add a single
 *   documented emphasis bonus (`coefficients.emphasis`) instead.
 * - If an exercise lists only head/region entries for a muscle, its base
 *   contribution is taken from the strongest of those so no work is lost.
 */
function aggregateExerciseMuscleContribution(
  entries: readonly ExerciseMuscleTarget[],
  setCount: number,
  coefficients: EffectiveSetCoefficients,
): { baseSets: number; emphasisSets: number; effectiveSets: number; role: MuscleRole } {
  const wholeMuscle = entries.filter((entry) => !entry.structureId);
  const structureEntries = entries.filter((entry) => entry.structureId);
  const pool = wholeMuscle.length > 0 ? wholeMuscle : structureEntries;

  let representative: ExerciseMuscleTarget = pool[0] ?? entries[0]!;
  let bestCoefficient = -Infinity;
  for (const entry of pool) {
    const bonus = wholeMuscle.length > 0 && entry.emphasis ? coefficients.emphasis : 0;
    const candidate = roleCoefficient(entry.role, coefficients) + bonus;
    if (candidate > bestCoefficient) {
      bestCoefficient = candidate;
      representative = entry;
    }
  }

  const baseSets = setCount * bestCoefficient;
  const emphasisSets = structureEntries.length > 0 ? setCount * coefficients.emphasis : 0;

  return {
    baseSets,
    emphasisSets,
    effectiveSets: baseSets + emphasisSets,
    role: representative.role,
  };
}

// ---------------------------------------------------------------------------
// Weekly volume report
// ---------------------------------------------------------------------------

/**
 * Generate a weekly volume report for a planned week.
 *
 * @param exercises - Exercise catalog with resolved targeting.
 * @param plannedVolume - Map of exerciseId → weekly working sets.
 * @param goalProfile - Goal profile for volume target lookup.
 * @param experience - Training experience level.
 * @param coefficients - Effective set coefficients.
 * @returns Weekly volume report with target comparison.
 */
export function generateWeeklyVolumeReport(
  exercises: readonly ExerciseKnowledge[],
  plannedVolume: Readonly<Record<string, number>>,
  goalProfile: TrainingGoalProfile,
  experience: TrainingExperience,
  coefficients: EffectiveSetCoefficients = DEFAULT_EFFECTIVE_SET_COEFFICIENTS,
): WeeklyVolumeReport {
  const byMuscle = calculateMuscleVolume(exercises, plannedVolume, coefficients);

  const underTargetMuscles: string[] = [];
  const potentiallyExcessiveMuscles: string[] = [];
  const redundantExposure: string[] = [];

  for (const entry of byMuscle) {
    const target = getMuscleVolumeTarget(entry.muscleSlug, experience, goalProfile);
    if (!target) continue;

    const fractionOfPreferred = target.preferred > 0 ? entry.totalEffectiveSets / target.preferred : 0;

    if (fractionOfPreferred < COVERAGE_THRESHOLDS.partial / 10) {
      underTargetMuscles.push(entry.muscleSlug);
    } else if (fractionOfPreferred > target.max / target.preferred) {
      potentiallyExcessiveMuscles.push(entry.muscleSlug);
    }

    // Check for redundancy: multiple exercises contributing similar amounts
    if (entry.contributingExercises.length > 2 && entry.totalEffectiveSets > target.preferred * 1.5) {
      redundantExposure.push(entry.muscleSlug);
    }
  }

  const totalPlannedSets = Object.values(plannedVolume).reduce((sum, sets) => sum + sets, 0);
  const totalEffectiveSets = byMuscle.reduce((sum, entry) => sum + entry.totalEffectiveSets, 0);

  return {
    byMuscle,
    totalPlannedSets,
    totalEffectiveSets,
    underTargetMuscles,
    potentiallyExcessiveMuscles,
    redundantExposure,
  };
}

// ---------------------------------------------------------------------------
// Volume assessment
// ---------------------------------------------------------------------------

/**
 * Assess whether planned volume is appropriate for the goal and context.
 *
 * @param volumeReport - The weekly volume report.
 * @param goalProfile - Goal profile.
 * @param experience - Training experience.
 * @returns Assessment with actionable findings.
 */
export function assessVolumeAppropriateness(
  volumeReport: WeeklyVolumeReport,
  goalProfile: TrainingGoalProfile,
  experience: TrainingExperience,
): {
  isAppropriate: boolean;
  issues: readonly string[];
  warnings: readonly string[];
  summary: string;
} {
  const issues: string[] = [];
  const warnings: string[] = [];

  // Check for under-target muscles
  if (volumeReport.underTargetMuscles.length > 0) {
    issues.push(
      `Under-target muscles: ${volumeReport.underTargetMuscles.join(", ")} — these may not receive sufficient stimulus for the goal.`,
    );
  }

  // Check for potentially excessive muscles
  if (volumeReport.potentiallyExcessiveMuscles.length > 0) {
    warnings.push(
      `Potentially excessive volume for: ${volumeReport.potentiallyExcessiveMuscles.join(", ")} — consider whether this is intentional specialization or unwarranted overload.`,
    );
  }

  // Check for redundancy
  if (volumeReport.redundantExposure.length > 0) {
    warnings.push(
      `Possible redundancy in: ${volumeReport.redundantExposure.join(", ")} — review whether multiple exercises are providing distinct value.`,
    );
  }

  // Overall assessment
  const isAppropriate =
    volumeReport.underTargetMuscles.length === 0 &&
    volumeReport.potentiallyExcessiveMuscles.length === 0;

  const summary = isAppropriate
    ? `Volume is within appropriate ranges for the "${goalProfile}" goal at "${experience}" experience level.`
    : `Volume assessment for "${goalProfile}" goal (${experience} experience): ${issues.length} issue(s), ${warnings.length} warning(s).`;

  return { isAppropriate, issues: issues as readonly string[], warnings: warnings as readonly string[], summary };
}

// ---------------------------------------------------------------------------
// Volume recommendation
// ---------------------------------------------------------------------------

/**
 * Recommend volume adjustments based on the current plan and history.
 *
 * @param currentReport - Current weekly volume report.
 * @param history - Recent training history (optional).
 * @param goalProfile - Goal profile.
 * @param experience - Training experience.
 * @returns Recommended adjustments.
 */
export function recommendVolumeAdjustments(
  currentReport: WeeklyVolumeReport,
  history?: {
    recentEffectiveVolume?: Readonly<Record<string, number>>;
    recentSessions?: readonly unknown[];
    adherence?: number;
  },
  goalProfile: TrainingGoalProfile = "hypertrophy",
  experience: TrainingExperience = "intermediate",
): {
  adjustments: readonly VolumeAdjustment[];
  reasoning: string;
} {
  const adjustments: VolumeAdjustment[] = [];
  const reasons: string[] = [];

  // Do not recommend adding volume when the user is not completing what is
  // already prescribed: first restore consistency, then grow the plan.
  const adherence = history?.adherence;
  if (adherence !== undefined && adherence < 0.7) {
    return {
      adjustments: [],
      reasoning: `Recent session adherence is ${Math.round(adherence * 100)}% (<70%); volume is held constant until the current plan is being completed.`,
    };
  }

  for (const entry of currentReport.byMuscle) {
    const target = getMuscleVolumeTarget(entry.muscleSlug, experience, goalProfile);
    if (!target) continue;

    const gapToPreferred = target.preferred - entry.totalEffectiveSets;

    if (gapToPreferred > target.preferred * 0.3 && entry.totalEffectiveSets < target.min) {
      adjustments.push({
        muscleSlug: entry.muscleSlug,
        direction: "increase",
        amount: Math.round(gapToPreferred / 2),
        rationale: `${entry.muscleSlug} is ${Math.round((gapToPreferred / target.preferred) * 100)}% below preferred volume.`,
      });
      reasons.push(`Increasing ${entry.muscleSlug} volume by ~${Math.round(gapToPreferred / 2)} effective sets.`);
    } else if (gapToPreferred < -target.preferred * 0.3 && entry.totalEffectiveSets > target.max) {
      adjustments.push({
        muscleSlug: entry.muscleSlug,
        direction: "decrease",
        amount: Math.round(-gapToPreferred / 2),
        rationale: `${entry.muscleSlug} exceeds the upper caution boundary.`,
      });
      reasons.push(`Decreasing ${entry.muscleSlug} volume by ~${Math.round(-gapToPreferred / 2)} effective sets to stay within caution range.`);
    }
  }

  // Check if overall volume is adequate
  if (adjustments.length === 0 && currentReport.underTargetMuscles.length === 0) {
    reasons.push("Current volume is within appropriate ranges. No adjustments recommended.");
  }

  // Recent completed volume can suppress an increase: if the user already
  // performed close to the proposed change for that muscle, keep it as is.
  // Suppression is per muscle, so one covered muscle never hides another.
  const recentVolume = history?.recentEffectiveVolume;
  if (!recentVolume) {
    return { adjustments, reasoning: reasons.join(" ") };
  }

  const suppressed: string[] = [];
  const remaining = adjustments.filter((adjustment) => {
    if (adjustment.direction !== "increase") return true;
    const recent = recentVolume[adjustment.muscleSlug] ?? 0;
    if (recent >= adjustment.amount) {
      suppressed.push(adjustment.muscleSlug);
      return false;
    }
    return true;
  });

  if (suppressed.length > 0 && remaining.length === 0) {
    return {
      adjustments: [],
      reasoning: "Recent completed volume is already close to the planned targets; no volume change recommended.",
    };
  }
  if (suppressed.length > 0) {
    reasons.push(
      `Suppressed increase for ${suppressed.join(", ")}: recent completed volume already covers the proposed change.`,
    );
  }

  return {
    adjustments: remaining,
    reasoning: reasons.join(" "),
  };
}

export interface VolumeAdjustment {
  muscleSlug: string;
  direction: "increase" | "decrease";
  amount: number; // effective sets
  rationale: string;
}

// ---------------------------------------------------------------------------
// Deprecated: backward compatibility with Phase 1 stub signature
// ---------------------------------------------------------------------------

/**
 * @deprecated Use generateWeeklyVolumeReport instead. This signature is kept
 * for backward compatibility with any code that may have imported the stub.
 */
export function computeTrainingVolume(
  plannedSets: readonly { exerciseId: string; weeklyWorkingSets: number }[],
): number {
  return plannedSets.reduce((sum, item) => sum + item.weeklyWorkingSets, 0);
}
