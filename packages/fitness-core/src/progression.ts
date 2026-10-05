import type { ExerciseId, ExerciseSet } from "@fitcoach/domain";
import { NotImplementedError } from "./errors";

export interface ProgressionReview {
  exerciseId: ExerciseId;
  recentWorkingSets: readonly ExerciseSet[];
}

export type ProgressionAction =
  | "increase_load"
  | "increase_reps"
  | "add_set"
  | "hold"
  | "deload"
  | "regress_load";

export interface ProgressionRecommendation {
  exerciseId: ExerciseId;
  action: ProgressionAction;
  reasoning: string;
}

/** Recommend the next progression step for one exercise from logged sets. */
export function recommendProgression(
  _review: ProgressionReview,
): ProgressionRecommendation {
  throw new NotImplementedError("progression.recommendProgression");
}
