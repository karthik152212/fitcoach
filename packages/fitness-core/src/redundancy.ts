import type { ExerciseId, ExerciseMuscleRelation, MuscleId } from "@fitcoach/domain";
import { NotImplementedError } from "./errors";

export interface RedundancyFinding {
  exerciseAId: ExerciseId;
  exerciseBId: ExerciseId;
  /** 0..1 estimated overlap; threshold policy is decided at implementation time. */
  overlapScore: number;
  sharedMuscleIds: readonly MuscleId[];
}

/**
 * Detect exercises that duplicate the same stimulus so redundant volume can
 * be minimized (PRODUCT_SPEC principle 6).
 */
export function findRedundantExercises(
  _relations: readonly ExerciseMuscleRelation[],
  _candidateExerciseIds: readonly ExerciseId[],
): RedundancyFinding[] {
  throw new NotImplementedError("redundancy.findRedundantExercises");
}
