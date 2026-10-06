import type {
  EquipmentId,
  Exercise,
  ExerciseId,
  ExercisePreferenceKind,
  MuscleId,
  MovementPattern,
  SuitabilityContext,
  TrainingExperience,
} from "@fitcoach/domain";
import type { ExerciseKnowledge } from "./knowledgeCatalog";
import { buildExerciseUniverse } from "./exerciseUniverse";
import { analyseRedundancyAgainst } from "./redundancy";
import { scoreExerciseSuitability } from "./suitability";

/**
 * Exercise selection (Phase 1 contract, Phase 2 implementation).
 *
 * The Phase 1 boundary is now real rather than a stub, but it is deliberately a
 * THIN facade: it accepts the original criteria shape and delegates to the
 * Phase 2 universe and suitability engines. That keeps one implementation of
 * "which exercises are good for this user" instead of two that could disagree.
 */
export interface ExerciseSelectionCriteria {
  /** Equipment the user actually has (their gym inventory). */
  availableEquipmentIds: readonly EquipmentId[];
  targetMuscleIds: readonly MuscleId[];
  excludedExerciseIds: readonly ExerciseId[];
  excludedMovementPatterns: readonly MovementPattern[];
  experienceLevel?: TrainingExperience;
  maxResults?: number;
  /** Goal profile the ranking is judged against. */
  goalProfile?: SuitabilityContext["goalProfile"];
  /** exerciseId → preference, already resolved to the applicable date. */
  preferences?: Readonly<Record<string, ExercisePreferenceKind>>;
  /** Equipment the user owns but cannot use right now. */
  temporarilyUnavailableEquipmentIds?: readonly EquipmentId[];
  /** All known exercises with resolved targeting. */
  catalog?: readonly ExerciseKnowledge[];
}

export interface RankedExerciseCandidate {
  exercise: Exercise;
  score: number;
  coveredTargetMuscleIds: readonly MuscleId[];
  /** Reasons a candidate was rejected despite matching targets. */
  disqualifications: readonly string[];
  /** Deterministic tier in the caller's context. */
  tier: ReturnType<typeof scoreExerciseSuitability>["tier"];
  /** Every component of the score, for explainability. */
  scoreComponents: ReturnType<typeof scoreExerciseSuitability>["components"];
}

const DEFAULT_CONTEXT: Omit<SuitabilityContext, "goalProfile"> = {
  goalPriorities: [],
  availableEquipmentIds: [],
};

/**
 * Rank catalog exercises for a user given their equipment and goals.
 *
 * Deterministic and explainable: the returned order is by score, then slug, so
 * two identical calls can never differ. The AI layer may present these results
 * but never invent them.
 */
export function rankExerciseCandidates(
  catalog: readonly Exercise[],
  criteria: ExerciseSelectionCriteria,
): RankedExerciseCandidate[] {
  // The Phase 1 shape carries no targeting detail, so the Phase 2 read model is
  // required. Without it there is nothing to reason about and the honest answer
  // is an empty ranking rather than a guess.
  if (!criteria.catalog || criteria.catalog.length === 0) return [];

  // The Phase 1 contract returns the caller's own `Exercise` objects; the
  // Phase 2 catalog supplies the intelligence. Both sides carry the same id.
  const domainById = new Map(catalog.map((item) => [item.id, item]));

  const context: SuitabilityContext = {
    ...DEFAULT_CONTEXT,
    goalProfile: criteria.goalProfile ?? "general_fitness",
    availableEquipmentIds: criteria.availableEquipmentIds,
    ...(criteria.experienceLevel !== undefined ? { trainingExperience: criteria.experienceLevel } : {}),
  };

  const universe = buildExerciseUniverse(criteria.catalog, {
    equipment: {
      availableEquipmentIds: criteria.availableEquipmentIds,
      ...(criteria.temporarilyUnavailableEquipmentIds !== undefined
        ? { temporarilyUnavailableEquipmentIds: criteria.temporarilyUnavailableEquipmentIds }
        : {}),
    },
    filters: {
      targetMuscleIds: criteria.targetMuscleIds,
      ...(criteria.excludedMovementPatterns.length > 0
        ? { movementPatterns: criteria.excludedMovementPatterns }
        : {}),
      excludeExerciseIds: criteria.excludedExerciseIds,
    },
    ...(criteria.preferences !== undefined ? { preferences: criteria.preferences } : {}),
  });

  const candidates: RankedExerciseCandidate[] = [];
  for (const entry of universe) {
    const knowledge = entry.exercise;
    const domainExercise = domainById.get(knowledge.id);
    if (!domainExercise) continue;
    const score = scoreExerciseSuitability({
      exercise: knowledge,
      context,
      targetMuscleIds: criteria.targetMuscleIds,
      redundancy: [],
      ...(entry.preference !== undefined ? { preference: entry.preference } : {}),
      ...(criteria.temporarilyUnavailableEquipmentIds !== undefined
        ? {
            temporarilyUnavailableEquipmentIds:
              criteria.temporarilyUnavailableEquipmentIds,
          }
        : {}),
    });

    const disqualifications: string[] = [];
    if (!entry.available) {
      disqualifications.push(
        entry.temporarilyBlockedEquipmentIds.length > 0
          ? "required equipment is temporarily unavailable"
          : "requires equipment the user does not have",
      );
    }
    if (entry.excluded) disqualifications.push("the user has excluded this exercise");

    const covered = knowledge.targets
      .filter(
        (target) =>
          criteria.targetMuscleIds.includes(target.muscleId) && target.role === "primary_mover",
      )
      .map((target) => target.muscleId);

    candidates.push({
      exercise: domainExercise,
      score: score.total,
      coveredTargetMuscleIds: [...new Set(covered)].sort(),
      disqualifications,
      tier: score.tier,
      scoreComponents: score.components,
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name));
  return criteria.maxResults === undefined ? candidates : candidates.slice(0, criteria.maxResults);
}

/**
 * Redundancy-aware selection helper for the Phase 3 planner: rank candidates
 * and return the overlap of each against the ones ranked above it, so a planner
 * composing a session can see where the cost of adding one more exercise rises.
 */
export function rankWithOverlap(
  catalog: readonly ExerciseKnowledge[],
  criteria: ExerciseSelectionCriteria,
): Array<{ exercise: ExerciseKnowledge; score: number; maxOverlapWithEarlier: number }> {
  const entries = buildExerciseUniverse(catalog, {
    equipment: {
      availableEquipmentIds: criteria.availableEquipmentIds,
      ...(criteria.temporarilyUnavailableEquipmentIds !== undefined
        ? { temporarilyUnavailableEquipmentIds: criteria.temporarilyUnavailableEquipmentIds }
        : {}),
    },
    filters: { targetMuscleIds: criteria.targetMuscleIds },
  });

  const scored = entries
    .filter((entry) => entry.available && !entry.excluded)
    .map((entry) => ({
      exercise: entry.exercise,
      score: scoreExerciseSuitability({
        exercise: entry.exercise,
        context: {
          goalProfile: criteria.goalProfile ?? "general_fitness",
          goalPriorities: [],
          availableEquipmentIds: criteria.availableEquipmentIds,
          ...(criteria.experienceLevel !== undefined
            ? { trainingExperience: criteria.experienceLevel }
            : {}),
        },
        targetMuscleIds: criteria.targetMuscleIds,
      }).total,
    }))
    .sort((a, b) => b.score - a.score || a.exercise.slug.localeCompare(b.exercise.slug));

  const chosen: ExerciseKnowledge[] = [];
  const result: Array<{ exercise: ExerciseKnowledge; score: number; maxOverlapWithEarlier: number }> = [];
  for (const item of scored) {
    const overlap = analyseRedundancyAgainst(item.exercise, chosen).reduce(
      (max, finding) => Math.max(max, finding.overlapScore),
      0,
    );
    result.push({ ...item, maxOverlapWithEarlier: overlap });
    chosen.push(item.exercise);
  }
  return result;
}
