import type { Exercise, ExerciseId, ExerciseMuscleRelation, MuscleId } from "@fitcoach/domain";
import type { CoverageEntry, CoverageReport } from "./coverage";
import { assessCoverage } from "./coverage";
import type { ExerciseKnowledge, MuscleTaxonomy } from "./knowledgeCatalog";

/**
 * Muscle coverage (Phase 1 contract, Phase 2 implementation).
 *
 * The Phase 1 boundary took an unweighted list of planned volume. Phase 2 adds
 * resolved head/region targeting underneath it, so this stays a thin
 * projection of `assessCoverage` rather than a second implementation.
 */
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
  /**
   * Phase 2 addition: the resolved catalog and taxonomy. When supplied, the
   * report is computed from head-level targeting rather than the flat relation
   * list, which is what lets it distinguish "covered" from "covered but missing
   * the long head".
   */
  knowledge?: readonly ExerciseKnowledge[];
  taxonomy?: MuscleTaxonomy;
}

function roleIsPrimary(role: string): boolean {
  return role === "primary_mover";
}

/**
 * Compute how much weekly work each muscle receives under a plan. Indirect
 * stimulus from secondary roles must be accounted for without pretending it
 * equals direct work (PRODUCT_SPEC principle 5).
 */
export function assessMuscleCoverage(request: MuscleCoverageRequest): MuscleCoverageReport {
  const weights: Record<string, number> = {};
  for (const volume of request.plannedWeeklyVolume) {
    weights[volume.exerciseId] = volume.weeklyWorkingSets;
  }

  if (request.knowledge && request.taxonomy) {
    const report = assessCoverage({
      exercises: request.knowledge,
      taxonomy: request.taxonomy,
      weights,
    });
    return project(report);
  }

  // Flat-relation fallback: direct work is weighted sets from primary roles,
  // secondary work is weighted sets from every other role.
  const perMuscle = new Map<string, { primary: number; secondary: number }>();
  for (const relation of request.relations) {
    const sets = weights[relation.exerciseId] ?? 0;
    if (sets <= 0) continue;
    const entry = perMuscle.get(relation.muscleId) ?? { primary: 0, secondary: 0 };
    const contribution = sets * (relation.contributionWeight ?? 1);
    if (roleIsPrimary(relation.role)) entry.primary += contribution;
    else entry.secondary += contribution;
    perMuscle.set(relation.muscleId, entry);
  }

  const entries: MuscleCoverageEntry[] = [...perMuscle.entries()]
    .map(([muscleId, value]) => ({
      muscleId,
      primaryWeeklySets: round(value.primary),
      secondaryWeeklySets: round(value.secondary),
    }))
    .sort((a, b) => a.muscleId.localeCompare(b.muscleId));

  return {
    perMuscle: entries,
    musclesWithoutDirectWork: entries.filter((e) => e.primaryWeeklySets === 0).map((e) => e.muscleId),
  };
}

function round(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function project(report: CoverageReport): MuscleCoverageReport {
  const perMuscle: MuscleCoverageEntry[] = report.entries.map((entry: CoverageEntry) => ({
    muscleId: entry.muscleId,
    primaryWeeklySets: entry.directScore,
    secondaryWeeklySets: entry.indirectScore,
  }));
  return {
    perMuscle,
    musclesWithoutDirectWork: perMuscle
      .filter((entry) => entry.primaryWeeklySets === 0)
      .map((entry) => entry.muscleId),
  };
}
