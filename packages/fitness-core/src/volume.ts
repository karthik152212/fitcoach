import type { MuscleId, Workout } from "@fitcoach/domain";
import { NotImplementedError } from "./errors";

export interface MuscleVolumeSummary {
  muscleId: MuscleId;
  hardSets: number;
  /** Role-weighted estimate; null until the weighting model is calibrated. */
  estimatedEffectiveSets: number | null;
}

export interface VolumeReport {
  weeklyHardSetsByMuscle: readonly MuscleVolumeSummary[];
  totalWorkingSets: number;
}

/**
 * Compute realized training volume per muscle over a window of workouts.
 * This measures what the user actually did, as opposed to what the plan says.
 */
export function computeTrainingVolume(_workouts: readonly Workout[]): VolumeReport {
  throw new NotImplementedError("volume.computeTrainingVolume");
}
