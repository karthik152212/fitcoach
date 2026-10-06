import type { ExerciseMuscleTarget } from "@fitcoach/domain";
import type { ExerciseKnowledge, MuscleTaxonomy } from "./knowledgeCatalog";

/**
 * Muscle coverage analysis (Phase 2, §10).
 *
 * Coverage is computed from resolved targeting, not from a count of exercises.
 * Three exercises that all hit the middle of the trapezius are NOT complete
 * upper-back coverage, and the analysis is built so it says exactly that:
 * every score is role-weighted, structure-level contributions roll up into
 * their parent muscle, and areas with no contribution are reported by name.
 *
 * The classification thresholds below are the model's stated conventions, not
 * physiological constants. They are exported so a caller can reason about them
 * and so a test can pin them.
 */
export const COVERAGE_THRESHOLDS = {
  covered: 8,
  partial: 3,
} as const;

export type CoverageStatus = "covered" | "partial" | "underrepresented" | "uncovered";

export interface StructureCoverage {
  structureId: string;
  structureSlug: string;
  displayName: string;
  score: number;
}

export interface CoverageEntry {
  muscleId: string;
  muscleSlug: string;
  displayName: string;
  /** Weighted contribution from primary-target relations. */
  directScore: number;
  /** Weighted contribution from secondary/supporting/stabilizing relations. */
  indirectScore: number;
  /** directScore + indirectScore, rounded. */
  direct: number;
  status: CoverageStatus;
  /** Per-head/region scores, so a muscle can be "covered but missing a head". */
  structures: StructureCoverage[];
  /** Exercise ids that contributed, sorted for determinism. */
  contributingExerciseIds: readonly string[];
}

export interface CoverageRequest {
  exercises: readonly ExerciseKnowledge[];
  taxonomy: MuscleTaxonomy;
  /**
   * exerciseId → working sets (or any positive weighting). When omitted every
   * exercise counts once. Weighting lets Phase 3 answer "what does this WEEK
   * actually cover" without Phase 2 inventing a volume prescription.
   */
  weights?: Readonly<Record<string, number>>;
  /**
   * Muscles the user actually asked to work. Only these are classified as
   * gaps; without it the engine would report every untrained muscle in the
   * taxonomy as a deficiency.
   */
  focusMuscleIds?: readonly string[];
  focusStructureIds?: readonly string[];
}

export interface CoverageReport {
  entries: readonly CoverageEntry[];
  coveredMuscleIds: readonly string[];
  partialMuscleIds: readonly string[];
  underrepresentedMuscleIds: readonly string[];
  uncoveredMuscleIds: readonly string[];
  /** Focus structures with no contribution at all. */
  missingStructureIds: readonly string[];
  /** Structures deliberately left uncovered, with the reason recorded. */
  redundantStructureIds: readonly string[];
  notes: readonly string[];
}

const DIRECT_ROLES = new Set(["primary_mover"]);
const INDIRECT_ROLES = new Set(["secondary_mover", "supporting", "stabilizer"]);

function round(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function contributionOf(target: ExerciseMuscleTarget): number {
  return target.contributionWeight ?? 0.5;
}

export function assessCoverage(request: CoverageRequest): CoverageReport {
  const { exercises, taxonomy } = request;
  const weights = request.weights ?? {};

  const muscleIds = new Set<string>();
  const structureIds = new Set<string>();

  for (const exercise of exercises) {
    const weight = weights[exercise.id] ?? 1;
    if (weight <= 0) continue;
    for (const target of exercise.targets) {
      muscleIds.add(target.muscleId);
      if (target.structureId) structureIds.add(target.structureId);
    }
  }

  // Focus-only by default; without focus, report everything that was touched.
  const focusMuscles = new Set(request.focusMuscleIds ?? [...muscleIds]);
  const focusStructures = new Set(request.focusStructureIds ?? []);

  const entries: CoverageEntry[] = [];
  for (const muscle of taxonomy.muscles) {
    if (!focusMuscles.has(muscle.id) && !muscleIds.has(muscle.id)) continue;
    entries.push({
      muscleId: muscle.id,
      muscleSlug: muscle.slug,
      displayName: muscle.displayName,
      directScore: 0,
      indirectScore: 0,
      direct: 0,
      status: "uncovered",
      structures: [],
      contributingExerciseIds: [],
    });
  }
  entries.sort((a, b) => a.muscleSlug.localeCompare(b.muscleSlug));

  const contributors = new Map<string, Set<string>>();
  const addContributor = (muscleId: string, exerciseId: string): void => {
    const set = contributors.get(muscleId) ?? new Set<string>();
    set.add(exerciseId);
    contributors.set(muscleId, set);
  };

  for (const exercise of exercises) {
    const weight = weights[exercise.id] ?? 1;
    if (weight <= 0) continue;
    for (const target of exercise.targets) {
      const entry = entries.find((item) => item.muscleId === target.muscleId);
      if (!entry) continue;
      const contribution = contributionOf(target) * weight;
      if (DIRECT_ROLES.has(target.role)) {
        entry.directScore += contribution;
      } else if (INDIRECT_ROLES.has(target.role)) {
        entry.indirectScore += contribution * 0.5;
      }
      if (target.structureId) {
        const structure = taxonomy.structures.find((item) => item.id === target.structureId);
        if (structure) {
          const existing = entry.structures.find((item) => item.structureId === structure.id);
          const score = contribution * (DIRECT_ROLES.has(target.role) ? 1 : 0.5);
          if (existing) {
            existing.score = round(existing.score + score);
          } else {
            entry.structures.push({
              structureId: structure.id,
              structureSlug: structure.slug,
              displayName: structure.displayName,
              score: round(score),
            });
          }
        }
      }
      addContributor(target.muscleId, exercise.id);
    }
  }

  for (const entry of entries) {
    entry.directScore = round(entry.directScore);
    entry.indirectScore = round(entry.indirectScore);
    entry.direct = round(entry.directScore + entry.indirectScore);
    entry.structures.sort(
      (a: StructureCoverage, b: StructureCoverage) => a.structureSlug.localeCompare(b.structureSlug),
    );
    entry.contributingExerciseIds = [...(contributors.get(entry.muscleId) ?? [])].sort();
    entry.status = classify(entry.direct);
  }

  const covered = entries.filter((e) => e.status === "covered").map((e) => e.muscleId);
  const partial = entries.filter((e) => e.status === "partial").map((e) => e.muscleId);
  const under = entries.filter((e) => e.status === "underrepresented").map((e) => e.muscleId);
  const uncovered = entries.filter((e) => e.status === "uncovered").map((e) => e.muscleId);

  const touchedStructures = new Set<string>();
  for (const entry of entries) {
    for (const structure of entry.structures) touchedStructures.add(structure.structureId);
  }
  const missingStructures = focusStructures.size
    ? [...focusStructures].filter((id) => !touchedStructures.has(id)).sort()
    : [];

  const notes: string[] = [];
  if (covered.length === 0 && partial.length === 0) {
    notes.push("No target muscle reached the partial-coverage threshold for this selection.");
  }
  const coveredButPartialStructures = entries.filter(
    (entry) => entry.status === "covered" && entry.structures.some((s) => s.score < 1),
  );
  for (const entry of coveredButPartialStructures) {
    notes.push(
      `${entry.displayName} is covered overall but weak on ${entry.structures
        .filter((s) => s.score < 1)
        .map((s) => s.displayName)
        .join(", ")}.`,
    );
  }

  return {
    entries,
    coveredMuscleIds: covered,
    partialMuscleIds: partial,
    underrepresentedMuscleIds: under,
    uncoveredMuscleIds: uncovered,
    missingStructureIds: missingStructures,
    redundantStructureIds: [],
    notes,
  };
}

function classify(directScore: number): CoverageStatus {
  if (directScore >= COVERAGE_THRESHOLDS.covered) return "covered";
  if (directScore >= COVERAGE_THRESHOLDS.partial) return "partial";
  if (directScore > 0) return "underrepresented";
  return "uncovered";
}

/**
 * How much of one muscle each exercise covers, for explaining a coverage bar
 * chart. Returns a 0..1 fraction of the "covered" threshold, which is what a
 * workout-level visual summary renders as a bar length.
 */
export function coverageFractions(report: CoverageReport): Array<{
  muscleId: string;
  muscleSlug: string;
  displayName: string;
  fraction: number;
  status: CoverageStatus;
}> {
  return report.entries
    .map((entry) => ({
      muscleId: entry.muscleId,
      muscleSlug: entry.muscleSlug,
      displayName: entry.displayName,
      fraction: Math.max(0, Math.min(1, entry.direct / COVERAGE_THRESHOLDS.covered)),
      status: entry.status,
    }))
    .sort((a, b) => b.fraction - a.fraction || a.muscleSlug.localeCompare(b.muscleSlug));
}
