import type {
  EquipmentId,
  Exercise,
  ExerciseId,
  MuscleId,
  MovementPattern,
  TrainingExperience,
} from "@fitcoach/domain";
import { NotImplementedError } from "./errors";

export interface ExerciseSelectionCriteria {
  /** Equipment the user actually has (their gym inventory). */
  availableEquipmentIds: readonly EquipmentId[];
  targetMuscleIds: readonly MuscleId[];
  excludedExerciseIds: readonly ExerciseId[];
  excludedMovementPatterns: readonly MovementPattern[];
  experienceLevel?: TrainingExperience;
  maxResults?: number;
}

export interface RankedExerciseCandidate {
  exercise: Exercise;
  score: number;
  coveredTargetMuscleIds: readonly MuscleId[];
  /** Reasons a candidate was rejected despite matching targets. */
  disqualifications: readonly string[];
}

/**
 * Rank catalog exercises for a user given their equipment and goals.
 * Selection must be deterministic and explainable; the AI layer may present
 * these results but never invent them.
 */
export function rankExerciseCandidates(
  _catalog: readonly Exercise[],
  _criteria: ExerciseSelectionCriteria,
): RankedExerciseCandidate[] {
  throw new NotImplementedError("exerciseSelection.rankExerciseCandidates");
}
