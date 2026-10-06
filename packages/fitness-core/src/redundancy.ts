import type { ExerciseId, ExerciseMuscleRelation, MuscleId } from "@fitcoach/domain";
import type { ExerciseKnowledge } from "./knowledgeCatalog";

/**
 * Redundancy / overlap analysis (Phase 2, §14).
 *
 * Redundancy is a DECISION-SUPPORT SIGNAL, never an automatic deletion. Two
 * exercises can overlap heavily and both still belong in a session — a heavy
 * and a light version of the same lift is normal programming. The engine's job
 * is to say how much they overlap, on what, and why, so a planner (or a user)
 * can make the call.
 *
 * Five axes are measured independently and combined with declared weights:
 *
 *   * target muscle overlap   — how much of the same muscle work is repeated
 *   * structure (head) overlap — whether the same head/region is repeated
 *   * movement-pattern overlap — whether the joint path is the same
 *   * stimulus overlap         — whether the emphasis (lengthened vs shortened)
 *                               is the same, which is what makes two biceps
 *                               curls complementary rather than duplicated
 *   * fatigue overlap          — whether both cost the same systemic recovery
 *
 * Two rows with the same muscle but different emphasis therefore score
 * deliberately lower than two rows with the same muscle and the same emphasis.
 * That is the whole point of the structure/emphasis modelling.
 */

export type RedundancyFactorKey =
  | "target_muscle"
  | "structure_overlap"
  | "movement_pattern"
  | "stimulus_overlap"
  | "fatigue_overlap";

export interface RedundancyFactor {
  key: RedundancyFactorKey;
  /** Signed contribution to the combined overlap, already weighted. */
  contribution: number;
  detail: string;
}

export interface RedundancyFinding {
  exerciseAId: ExerciseId;
  exerciseBId: ExerciseId;
  /** 0..1 combined overlap. */
  overlapScore: number;
  sharedMuscleIds: readonly MuscleId[];
  sharedStructureIds: readonly string[];
  factors: readonly RedundancyFactor[];
  /** One sentence naming the decisive factor, suitable for direct display. */
  explanation: string;
}

/** Declared weights; the sum is normalised to 1 so the score stays in 0..1. */
export const REDUNDANCY_WEIGHTS: Readonly<Record<RedundancyFactorKey, number>> = {
  target_muscle: 0.3,
  structure_overlap: 0.2,
  movement_pattern: 0.15,
  // Stimulus overlap is weighted heavily on purpose: it is the factor that
  // distinguishes "the same lift twice" from "a deliberate complementary
  // pairing", which is the distinction the whole head/emphasis model exists to
  // express.
  stimulus_overlap: 0.25,
  fatigue_overlap: 0.1,
};

const ROLE_STRENGTH: Readonly<Record<string, number>> = {
  primary_mover: 1,
  secondary_mover: 0.45,
  supporting: 0.25,
  stabilizer: 0.1,
};

const FATIGUE_COST: Readonly<Record<string, number>> = {
  free_weight_multi_joint: 1,
  free_weight_single_joint: 0.6,
  machine_guided: 0.5,
  cable_variable: 0.55,
  cable_fixed: 0.5,
  bodyweight_external_load: 0.7,
  bodyweight_only: 0.6,
  elastic_tension: 0.5,
};

function round(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Role-weighted overlap over shared muscles: cosine-like, in 0..1. */
function targetOverlap(a: ExerciseKnowledge, b: ExerciseKnowledge): { score: number; shared: string[] } {
  const weights = new Map<string, number>();
  for (const exercise of [a, b]) {
    for (const target of exercise.targets) {
      const strength = (ROLE_STRENGTH[target.role] ?? 0.2) * (target.contributionWeight ?? 0.5);
      weights.set(target.muscleId, (weights.get(target.muscleId) ?? 0) + strength);
    }
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const shared: string[] = [];
  for (const [muscleId] of weights) {
    const inA = exerciseStrength(a, muscleId);
    const inB = exerciseStrength(b, muscleId);
    normA += inA * inA;
    normB += inB * inB;
    dot += inA * inB;
    if (inA > 0 && inB > 0) shared.push(muscleId);
  }
  if (normA === 0 || normB === 0) return { score: 0, shared: [] };
  return { score: round(dot / (Math.sqrt(normA) * Math.sqrt(normB))), shared: shared.sort() };
}

function exerciseStrength(exercise: ExerciseKnowledge, muscleId: string): number {
  let total = 0;
  for (const target of exercise.targets) {
    if (target.muscleId !== muscleId) continue;
    const roleStrength = ROLE_STRENGTH[target.role] ?? 0.2;
    const weight = target.contributionWeight ?? 0.5;
    // A structure-level entry is extra evidence about part of that muscle, so
    // it adds a bounded amount rather than replacing the whole-muscle value.
    total += target.structureId ? roleStrength * weight * 0.4 : roleStrength * weight;
  }
  return total;
}

/**
 * Emphasis conflict test.
 *
 * Emphasis codes are compared SEMANTICALLY, not literally. `structure_biased`
 * and `lengthened_position` are not opposites — a variation can be biased
 * toward a head AND performed long. Only genuinely opposing positions count as
 * a conflict, and a missing emphasis is never a conflict: absence of a claim is
 * not a contradicting claim.
 */
export function emphasisConflict(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  if (a === b) return false;
  const opposing = (x: string, y: string): boolean =>
    (x === "lengthened_position" && y === "shortened_position") ||
    (x === "shortened_position" && y === "lengthened_position") ||
    (x === "upper_range_bias" && y === "lower_range_bias") ||
    (x === "lower_range_bias" && y === "upper_range_bias");
  return opposing(a, b);
}

/**
 * Structure overlap, weighted by whether the two exercises actually disagree
 * about that structure. Two curls that share both heads but disagree about
 * position are complementary, and this is where that shows up.
 */
/**
 * The emphasis that actually applies to a structure: its own if declared,
 * otherwise the emphasis declared for its parent muscle. Without this
 * inheritance an exercise that says "lengthened position" for biceps and then
 * says nothing about the long head would look like it made no claim at all,
 * which is not what the data means.
 */
function effectiveEmphasis(
  exercise: ExerciseKnowledge,
  structureId: string,
): string | undefined {
  const structureTarget = exercise.targets.find((target) => target.structureId === structureId);
  if (structureTarget?.emphasis !== undefined) return structureTarget.emphasis;
  const muscleId = structureTarget?.muscleId ?? exercise.targets.find((t) => t.structureId === structureId)?.muscleId;
  if (!muscleId) return undefined;
  const muscleTarget = exercise.targets.find(
    (target) => target.muscleId === muscleId && target.structureId === undefined,
  );
  return muscleTarget?.emphasis;
}

function structureOverlap(
  a: ExerciseKnowledge,
  b: ExerciseKnowledge,
): { score: number; shared: string[] } {
  const structuresA = new Map(
    a.targets
      .filter((t) => t.structureId)
      .map((t) => [t.structureId!, effectiveEmphasis(a, t.structureId!)]),
  );
  const structuresB = new Map(
    b.targets
      .filter((t) => t.structureId)
      .map((t) => [t.structureId!, effectiveEmphasis(b, t.structureId!)]),
  );
  if (structuresA.size === 0 && structuresB.size === 0) {
    return { score: 0, shared: [] };
  }
  const union = new Set([...structuresA.keys(), ...structuresB.keys()]);
  let agreement = 0;
  const shared: string[] = [];
  for (const id of union) {
    const inA = structuresA.has(id);
    const inB = structuresB.has(id);
    if (inA && inB) {
      shared.push(id);
      if (!emphasisConflict(structuresA.get(id), structuresB.get(id))) agreement += 1;
    } else if (inA || inB) {
      agreement += 0.5;
    }
  }
  return { score: round(agreement / union.size), shared };
}

function patternOverlap(a: ExerciseKnowledge, b: ExerciseKnowledge): number {
  if (a.movementPattern && a.movementPattern === b.movementPattern) return 1;
  const functionsA = new Set(a.movementFunctions);
  const shared = b.movementFunctions.filter((fn) => functionsA.has(fn));
  const union = new Set([...functionsA, ...b.movementFunctions]);
  return union.size === 0 ? 0 : round(shared.length / union.size);
}

/**
 * Stimulus overlap over shared muscles. A shared muscle with no positional
 * disagreement scores as agreement; a genuine position conflict (lengthened vs
 * shortened, upper vs lower range) is what makes two exercises complementary
 * rather than duplicated, and it is scored as such.
 */
function stimulusOverlap(
  a: ExerciseKnowledge,
  b: ExerciseKnowledge,
): { score: number; detail: string } {
  const emphasisA = new Map<string, string | undefined>();
  for (const target of a.targets) {
    if (!emphasisA.has(target.muscleId)) emphasisA.set(target.muscleId, target.emphasis);
  }
  let compared = 0;
  let conflicts = 0;
  const differences: string[] = [];
  for (const target of b.targets) {
    if (!emphasisA.has(target.muscleId)) continue;
    const other = emphasisA.get(target.muscleId);
    compared += 1;
    if (emphasisConflict(other, target.emphasis)) {
      conflicts += 1;
      if (differences.length < 3) {
        differences.push(`${target.muscleSlug}: ${other} vs ${target.emphasis}`);
      }
    }
  }
  if (compared === 0) {
    return { score: 0, detail: "no shared muscle declares a comparable emphasis" };
  }
  const score = round(1 - conflicts / compared);
  const detail =
    conflicts === 0
      ? `no emphasis conflict across ${compared} shared target(s)`
      : `complementary emphasis on ${conflicts} of ${compared} shared target(s) (${differences.join("; ")})`;
  return { score, detail };
}

function fatigueOverlap(a: ExerciseKnowledge, b: ExerciseKnowledge): number {
  const costA = FATIGUE_COST[a.loadingCharacteristic ?? "machine_guided"] ?? 0.5;
  const costB = FATIGUE_COST[b.loadingCharacteristic ?? "machine_guided"] ?? 0.5;
  return round(1 - Math.abs(costA - costB));
}

/** Full pairwise overlap analysis for two catalogued exercises. */
export function analyseRedundancy(a: ExerciseKnowledge, b: ExerciseKnowledge): RedundancyFinding {
  const muscle = targetOverlap(a, b);
  const structure = structureOverlap(a, b);
  const pattern = patternOverlap(a, b);
  const stimulus = stimulusOverlap(a, b);
  const fatigue = fatigueOverlap(a, b);

  const factors: RedundancyFactor[] = [
    {
      key: "target_muscle",
      contribution: round(muscle.score * REDUNDANCY_WEIGHTS.target_muscle),
      detail:
        muscle.shared.length === 0
          ? "no shared target muscle"
          : `shares ${muscle.shared.length} target muscle(s)`,
    },
    {
      key: "structure_overlap",
      contribution: round(structure.score * REDUNDANCY_WEIGHTS.structure_overlap),
      detail:
        structure.shared.length === 0
          ? "no shared head or region"
          : `shares ${structure.shared.length} head/region(s)`,
    },
    {
      key: "movement_pattern",
      contribution: round(pattern * REDUNDANCY_WEIGHTS.movement_pattern),
      detail:
        a.movementPattern && a.movementPattern === b.movementPattern
          ? `same movement pattern (${a.movementPattern})`
          : "different or unrelated movement patterns",
    },
    {
      key: "stimulus_overlap",
      contribution: round(stimulus.score * REDUNDANCY_WEIGHTS.stimulus_overlap),
      detail: stimulus.detail,
    },
    {
      key: "fatigue_overlap",
      contribution: round(fatigue * REDUNDANCY_WEIGHTS.fatigue_overlap),
      detail: `similar systemic cost (${a.loadingCharacteristic ?? "unknown"} vs ${b.loadingCharacteristic ?? "unknown"})`,
    },
  ];

  const overlapScore = round(
    Math.max(
      0,
      Math.min(1, factors.reduce((total, factor) => total + factor.contribution, 0)),
    ),
  );

  const decisive = [...factors].sort((x, y) => y.contribution - x.contribution)[0];
  const stimulusFactor = factors.find((factor) => factor.key === "stimulus_overlap");
  const complementary =
    stimulusFactor && stimulusFactor.contribution < REDUNDANCY_WEIGHTS.stimulus_overlap
      ? ` ${stimulusFactor.detail}.`
      : "";
  const band =
    overlapScore >= 0.6 ? "High overlap" : overlapScore >= 0.3 ? "Moderate overlap" : "Low overlap";
  const conflictsWithStimulus =
    stimulusFactor !== undefined &&
    stimulusFactor.contribution < REDUNDANCY_WEIGHTS.stimulus_overlap - 1e-9;
  const guidance = conflictsWithStimulus
    ? " Treat this as a deliberate complementary pairing rather than duplicated volume."
    : overlapScore >= 0.6
      ? " Consider changing one of the two."
      : "";
  const explanation = `${band} — ${decisive?.detail ?? "strong shared stimulus"}.${complementary}${guidance}`.replace(
    /\.\s+\./g,
    ".",
  );

  return {
    exerciseAId: a.id,
    exerciseBId: b.id,
    overlapScore,
    sharedMuscleIds: muscle.shared,
    sharedStructureIds: structure.shared,
    factors,
    explanation,
  };
}

/** Overlap of one exercise against a set of already-selected exercises. */
export function analyseRedundancyAgainst(
  exercise: ExerciseKnowledge,
  selected: readonly ExerciseKnowledge[],
): RedundancyFinding[] {
  return selected
    .filter((other) => other.id !== exercise.id)
    .map((other) => analyseRedundancy(exercise, other))
    .sort((x, y) => y.overlapScore - x.overlapScore || x.exerciseBId.localeCompare(y.exerciseBId));
}

/**
 * Phase 1 interface, implemented over the plain relation shape so callers that
 * only have relations (no resolved catalog) still get an overlap signal.
 * Retained unchanged in signature and behaviour contract.
 */
export function findRedundantExercises(
  relations: readonly ExerciseMuscleRelation[],
  candidateExerciseIds: readonly ExerciseId[],
): RedundancyFinding[] {
  const roleStrength: Record<string, number> = {
    primary_mover: 1,
    secondary_mover: 0.45,
    supporting: 0.25,
    stabilizer: 0.1,
  };
  const byExercise = new Map<string, Map<string, number>>();
  for (const relation of relations) {
    const map = byExercise.get(relation.exerciseId) ?? new Map<string, number>();
    const strength =
      (roleStrength[relation.role] ?? 0.2) * (relation.contributionWeight ?? 0.5);
    map.set(relation.muscleId, (map.get(relation.muscleId) ?? 0) + strength);
    byExercise.set(relation.exerciseId, map);
  }

  const ids = [...new Set(candidateExerciseIds)].sort();
  const findings: RedundancyFinding[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = byExercise.get(ids[i]!) ?? new Map<string, number>();
      const b = byExercise.get(ids[j]!) ?? new Map<string, number>();
      let dot = 0;
      let normA = 0;
      let normB = 0;
      const shared: string[] = [];
      for (const muscleId of new Set([...a.keys(), ...b.keys()])) {
        const va = a.get(muscleId) ?? 0;
        const vb = b.get(muscleId) ?? 0;
        dot += va * vb;
        normA += va * va;
        normB += vb * vb;
        if (va > 0 && vb > 0) shared.push(muscleId);
      }
      const overlapScore =
        normA === 0 || normB === 0 ? 0 : round(dot / (Math.sqrt(normA) * Math.sqrt(normB)));
      findings.push({
        exerciseAId: ids[i]!,
        exerciseBId: ids[j]!,
        overlapScore,
        sharedMuscleIds: shared.sort(),
        sharedStructureIds: [],
        factors: [
          {
            key: "target_muscle",
            contribution: round(overlapScore * REDUNDANCY_WEIGHTS.target_muscle),
            detail:
              shared.length === 0
                ? "no shared target muscle"
                : `shares ${shared.length} target muscle(s)`,
          },
        ],
        explanation:
          overlapScore >= 0.6
            ? "High overlap on target muscles."
            : overlapScore >= 0.3
              ? "Moderate overlap on target muscles."
              : "Low overlap on target muscles.",
      });
    }
  }
  return findings.sort(
    (x, y) => y.overlapScore - x.overlapScore || x.exerciseAId.localeCompare(y.exerciseAId),
  );
}
