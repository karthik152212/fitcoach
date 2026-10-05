import type { Exercise, ExerciseId, ExerciseMuscleRelation, MuscleId } from "@fitcoach/domain";
import { NotImplementedError } from "./errors";

export interface PlannedExerciseVolume {
  exerciseId: ExerciseId;
  weeklyWorkingSets: number;
}

export interface MuscleCoverageEntry {
  muscleId: MuscleId;
  primaryWeeklySets: number;
  secondaryWeeklySets: number;
}

export interface MuscleCoverageReport {
  perMuscle: readonly MuscleCoverageEntry[];
  /** Muscles receiving no direct planned work at all. */
  musclesWithoutDirectWork: readonly MuscleId[];
}

export interface MuscleCoverageRequest {
  exercises: readonly Exercise[];
  relations: readonly ExerciseMuscleRelation[];
  plannedWeeklyVolume: readonly PlannedExerciseVolume[];
}

/**
 * Compute how much weekly work each muscle receives under a plan. Indirect
 * stimulus from secondary roles must be accounted for without pretending it
 * equals direct work (PRODUCT_SPEC principle 5).
 */
export function assessMuscleCoverage(_request: MuscleCoverageRequest): MuscleCoverageReport {
  throw new NotImplementedError("muscleCoverage.assessMuscleCoverage");
}
