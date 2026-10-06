import type {
  ExercisePreferenceKind,
  SuitabilityContext,
  SuitabilityTier,
} from "@fitcoach/domain";
import type { ExerciseKnowledge } from "./knowledgeCatalog";
import { analyseRedundancyAgainst } from "./redundancy";
import { scoreExerciseSuitability } from "./suitability";

/**
 * Exercise substitution engine (Phase 2, §15/§16/§17).
 *
 * A substitute must preserve the PURPOSE of the original, not merely the muscle
 * name. "Same muscle = same exercise" is explicitly wrong: a preacher curl and
 * an incline curl both train biceps brachii and are *not* interchangeable,
 * because one works the shortened position and the other the lengthened one.
 *
 * So purpose is decomposed into the axes that make an exercise what it is, and
 * each axis is reported separately so a user can see exactly what a swap keeps
 * and what it changes:
 *
 *   1. target muscle            7. unilateral/bilateral
 *   2. target region/head       8. goal relevance
 *   3. movement pattern         9. user preference
 *   4. stimulus role           10. redundancy against the rest of the session
 *   5. equipment               11. tier
 *   6. stability
 *
 * "Same muscle = same exercise" fails axis 4, and the engine shows that.
 */

export type SubstitutionTrigger =
  | "generic"
  | "equipment_missing"
  | "equipment_changed"
  | "machine_busy"
  | "disliked";

export interface CuratedSubstitution {
  exerciseId: string;
  substituteExerciseId: string;
  trigger: SubstitutionTrigger;
  reason: string;
  rankHint: number;
}

/** How well each purpose axis is preserved, 0..1. */
export interface PurposePreservation {
  targetMuscle: number;
  structure: number;
  movement: number;
  stimulusRole: number;
  equipment: number;
  stability: number;
  unilateral: number;
  goalRelevance: number;
  /** Weighted summary across the axes above. */
  overall: number;
}

export interface SubstitutionCandidate {
  exercise: ExerciseKnowledge;
  /** Ranking score (0..1). Ordering is by this, then by slug. */
  rank: number;
  tier: SuitabilityTier;
  preservation: PurposePreservation;
  /** Ordered, human-readable reasons. Every candidate has at least one. */
  reasons: readonly string[];
  /** True when a curated, reviewer-authored edge backs this candidate. */
  curated: boolean;
  /** Equipment the candidate needs that the original did not, and vice versa. */
  extraEquipmentIds: readonly string[];
}

export interface SubstitutionRequest {
  exercise: ExerciseKnowledge;
  catalog: readonly ExerciseKnowledge[];
  context: SuitabilityContext;
  trigger?: SubstitutionTrigger;
  /** The exercises already in the session, for redundancy-aware ranking. */
  alongsideExerciseIds?: readonly string[];
  /** Reviewer-authored edges layered on top of the derivation. */
  curated?: readonly CuratedSubstitution[];
  preferences?: Readonly<Record<string, ExercisePreferenceKind>>;
  temporarilyUnavailableEquipmentIds?: readonly string[];
  limitations?: readonly string[];
  /** Candidates below this preservation score are dropped rather than ranked. */
  minPreservation?: number;
  limit?: number;
}

const PRESERVATION_WEIGHTS = {
  targetMuscle: 0.26,
  structure: 0.12,
  movement: 0.18,
  stimulusRole: 0.16,
  equipment: 0.12,
  stability: 0.06,
  unilateral: 0.04,
  goalRelevance: 0.06,
} as const;

const ROLE_STRENGTH: Readonly<Record<string, number>> = {
  primary_mover: 1,
  secondary_mover: 0.45,
  supporting: 0.25,
  stabilizer: 0.1,
};

function round(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function muscleProfile(exercise: ExerciseKnowledge): Map<string, number> {
  const profile = new Map<string, number>();
  for (const target of exercise.targets) {
    const strength = (ROLE_STRENGTH[target.role] ?? 0.2) * (target.contributionWeight ?? 0.5);
    profile.set(target.muscleId, (profile.get(target.muscleId) ?? 0) + strength);
  }
  return profile;
}

/** Weighted overlap of two role/muscle maps, 0..1. */
function cosine(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const value of a.values()) normA += value * value;
  for (const value of b.values()) normB += value * value;
  for (const [key, value] of a) dot += value * (b.get(key) ?? 0);
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Jaccard-style overlap of two unweighted sets, 0..1. */
function setOverlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return shared / new Set([...a, ...b]).size;
}

function structureProfile(exercise: ExerciseKnowledge): Set<string> {
  return new Set(exercise.targets.filter((t) => t.structureId).map((t) => t.structureId!));
}

function movementProfile(exercise: ExerciseKnowledge): Set<string> {
  return new Set(exercise.movementFunctions);
}

function rolesProfile(exercise: ExerciseKnowledge): Set<string> {
  return new Set(exercise.roles);
}

function emphasisProfile(exercise: ExerciseKnowledge): Map<string, string> {
  const profile = new Map<string, string>();
  for (const target of exercise.targets) {
    if (target.emphasis) profile.set(target.muscleId, target.emphasis);
  }
  return profile;
}

function stimulusRolePreservation(original: ExerciseKnowledge, candidate: ExerciseKnowledge): number {
  const roleScore = setOverlap(rolesProfile(original), rolesProfile(candidate));
  const originalEmphasis = emphasisProfile(original);
  const candidateEmphasis = emphasisProfile(candidate);
  if (originalEmphasis.size === 0 && candidateEmphasis.size === 0) return round(roleScore);

  let shared = 0;
  let matched = 0;
  for (const [muscleId, emphasis] of originalEmphasis) {
    const other = candidateEmphasis.get(muscleId);
    if (!other) continue;
    shared += 1;
    if (other === emphasis) matched += 1;
  }
  const emphasisScore = shared === 0 ? 0.5 : matched / shared;
  // A substitute that flips the emphasis keeps its value but is a weaker swap;
  // that penalty is the mechanism that separates "complementary" from "equal".
  return round(0.5 * roleScore + 0.5 * emphasisScore);
}

function equipmentPreservation(
  candidate: ExerciseKnowledge,
  available: ReadonlySet<string>,
): number {
  const needed = candidate.requiredEquipmentIds.filter((id) => available.has(id));
  if (candidate.requiredEquipmentIds.length === 0) return 1;
  return round(needed.length / candidate.requiredEquipmentIds.length);
}

export function computePreservation(
  original: ExerciseKnowledge,
  candidate: ExerciseKnowledge,
  context: SuitabilityContext,
  temporarilyUnavailable: ReadonlySet<string>,
): PurposePreservation {
  const targetMuscle = round(cosine(muscleProfile(original), muscleProfile(candidate)));
  const originalStructures = structureProfile(original);
  const candidateStructures = structureProfile(candidate);
  const sharedStructures = [...originalStructures].filter((id) => candidateStructures.has(id));
  const unionStructures = new Set([...originalStructures, ...candidateStructures]);
  const structure = round(
    originalStructures.size === 0 && candidateStructures.size === 0
      ? 1
      : unionStructures.size === 0
        ? 0
        : sharedStructures.length / unionStructures.size,
  );
  const originalMovement = movementProfile(original);
  const candidateMovement = movementProfile(candidate);
  const sharedMovement = [...originalMovement].filter((fn) => candidateMovement.has(fn));
  const movementUnion = new Set([...originalMovement, ...candidateMovement]);
  const movement = round(
    movementUnion.size === 0 ? 0 : sharedMovement.length / movementUnion.size,
  );
  const stimulusRole = stimulusRolePreservation(original, candidate);
  const available = new Set(context.availableEquipmentIds);
  const equipment = equipmentPreservation(candidate, available);
  const stability = round(
    1 - Math.abs(
      (STABILITY_COST[original.stabilityDemand ?? "moderate"] ?? 0.8) -
        (STABILITY_COST[candidate.stabilityDemand ?? "moderate"] ?? 0.8),
    ),
  );
  const unilateral =
    Boolean(original.unilateral) === Boolean(candidate.unilateral)
      ? 1
      : original.unilateral || candidate.unilateral
        ? 0.4
        : 0.7;
  const goalRelevance = round(setOverlap(rolesProfile(original), rolesProfile(candidate)));

  const overall = round(
    targetMuscle * PRESERVATION_WEIGHTS.targetMuscle +
      structure * PRESERVATION_WEIGHTS.structure +
      movement * PRESERVATION_WEIGHTS.movement +
      stimulusRole * PRESERVATION_WEIGHTS.stimulusRole +
      equipment * PRESERVATION_WEIGHTS.equipment +
      stability * PRESERVATION_WEIGHTS.stability +
      unilateral * PRESERVATION_WEIGHTS.unilateral +
      goalRelevance * PRESERVATION_WEIGHTS.goalRelevance,
  );

  // `temporarilyUnavailable` is accepted here so the signature stays stable for
  // callers that pre-compute it; it does not change the preservation maths
  // (a busy machine is an availability problem, not a purpose problem).
  void temporarilyUnavailable;

  return {
    targetMuscle,
    structure,
    movement,
    stimulusRole,
    equipment,
    stability,
    unilateral,
    goalRelevance,
    overall,
  };
}

const STABILITY_COST: Readonly<Record<string, number>> = {
  low: 0.2,
  moderate: 0.55,
  high: 0.9,
};

function describe(original: ExerciseKnowledge, candidate: ExerciseKnowledge): string[] {
  const reasons: string[] = [];
  const originalPrimaries = original.targets
    .filter((t) => t.role === "primary_mover")
    .map((t) => t.muscleDisplayName)
    .sort();
  const candidatePrimaries = candidate.targets
    .filter((t) => t.role === "primary_mover")
    .map((t) => t.muscleDisplayName)
    .sort();
  const sharedPrimaries = originalPrimaries.filter((name) => candidatePrimaries.includes(name));
  if (sharedPrimaries.length > 0) {
    reasons.push(`Keeps ${sharedPrimaries.join(" and ")} as the primary target.`);
  } else {
    reasons.push(
      `Shifts the primary target from ${originalPrimaries.join(", ") || "unspecified"} to ${candidatePrimaries.join(", ") || "unspecified"}.`,
    );
  }
  if (original.movementPattern && original.movementPattern === candidate.movementPattern) {
    reasons.push(`Same movement path (${original.movementPattern}).`);
  } else if (original.movementPattern && candidate.movementPattern) {
    reasons.push(`Different movement path (${original.movementPattern} → ${candidate.movementPattern}).`);
  }
  const sharedRoles = candidate.roles.filter((role) => original.roles.includes(role));
  if (sharedRoles.length > 0) {
    reasons.push(`Serves the same role(s): ${sharedRoles.slice(0, 3).join(", ")}.`);
  }
  const originalEmphasis = [...new Set(original.targets.map((t) => t.emphasis).filter(Boolean))].sort();
  const candidateEmphasis = [...new Set(candidate.targets.map((t) => t.emphasis).filter(Boolean))].sort();
  if (
    originalEmphasis.length > 0 &&
    candidateEmphasis.length > 0 &&
    originalEmphasis.join() === candidateEmphasis.join()
  ) {
    reasons.push(`Same emphasis (${originalEmphasis.join(", ")}).`);
  } else if (originalEmphasis.length > 0) {
    reasons.push(
      `Different emphasis (${originalEmphasis.join(", ")} → ${candidateEmphasis.join(", ") || "none declared"}) — check whether that suits the session.`,
    );
  }
  return reasons;
}

/**
 * Ranked substitutes for one exercise.
 *
 * The trigger changes which candidates are *eligible*, never how they are
 * ranked: "the machine is busy" removes the busy station from eligibility, and
 * "the user dislikes it" removes the disliked exercise — the ordering stays a
 * pure function of purpose preservation, so a machine-busy list is a subset of
 * the general list rather than a differently-biased one.
 */
export function findSubstitutions(request: SubstitutionRequest): SubstitutionCandidate[] {
  const trigger = request.trigger ?? "generic";
  const available = new Set(request.context.availableEquipmentIds);
  const temporary = new Set(request.temporarilyUnavailableEquipmentIds ?? []);
  const preferences = request.preferences ?? {};
  const alongside = (request.alongsideExerciseIds ?? [])
    .map((id) => request.catalog.find((item) => item.id === id))
    .filter((item): item is ExerciseKnowledge => item !== undefined);
  const minPreservation = request.minPreservation ?? 0.4;
  // A substitute for a muscle-targeted exercise must at least touch the same
  // muscles. Without this gate "same muscle = same exercise" is replaced by the
  // opposite failure: every exercise looks like a substitute for every other
  // one, because scoring averages away the difference.
  const originalMuscleIds = new Set(request.exercise.targets.map((target) => target.muscleId));
  const originalPrimaryMuscleSlugs = [
    ...new Set(
      request.exercise.targets
        .filter((target) => target.role === "primary_mover")
        .map((target) => target.muscleSlug),
    ),
  ].sort();

  const candidates: SubstitutionCandidate[] = [];

  for (const candidate of request.catalog) {
    if (candidate.id === request.exercise.id) continue;

    const preference = preferences[candidate.id];
    if (trigger === "disliked" && preference !== "disliked") continue;
    if (preference === "excluded") continue;

    const blocked = candidate.requiredEquipmentIds.filter((id) => temporary.has(id));
    const missing = candidate.requiredEquipmentIds.filter(
      (id) => !available.has(id) && !temporary.has(id),
    );
    const fullyAvailable = missing.length === 0 && blocked.length === 0;
    // "The machine is busy" and "the equipment is gone" both mean: the
    // replacement must be performable right now. That makes the answer a
    // SUBSET of the general ranking rather than a differently-biased one.
    if ((trigger === "equipment_missing" || trigger === "machine_busy") && !fullyAvailable) continue;
    // Under a generic trigger (or "I dislike this one"), an exercise the user
    // cannot perform is still offered — explicitly, with its extra equipment
    // named — because the knowledge layer must not silently drop it.
    if (trigger === "generic" && missing.length > 0) continue;

    if (!candidate.targets.some((target) => originalMuscleIds.has(target.muscleId))) continue;

    const preservation = computePreservation(
      request.exercise,
      candidate,
      request.context,
      temporary,
    );
    if (preservation.overall < minPreservation) continue;

    // Redundancy is measured against what the user is KEEPING. The exercise
    // being replaced is not part of the session any more, so including it here
    // would penalise every substitute for overlapping with the thing it
    // replaces — which is the opposite of what a substitute is for.
    const redundancy = analyseRedundancyAgainst(candidate, alongside);
    const suitability = scoreExerciseSuitability({
      exercise: candidate,
      context: request.context,
      // Candidates are scored against the ORIGINAL's primary targets, so the
      // tier on a substitute answers "is this as good as the thing it replaces
      // for the same purpose", which is the question actually being asked.
      targetMuscleSlugs: originalPrimaryMuscleSlugs,
      redundancy,
      ...(preference !== undefined ? { preference } : {}),
      temporarilyUnavailableEquipmentIds: [...temporary],
      ...(request.limitations !== undefined ? { limitations: request.limitations } : {}),
    });

    const curatedEdge = (request.curated ?? []).find(
      (edge) => edge.substituteExerciseId === candidate.id && edge.trigger === trigger,
    );
    const curatedBoost = curatedEdge ? 0.1 + curatedEdge.rankHint * 0.01 : 0;

    const rank = clamp(0.6 * preservation.overall + 0.4 * (suitability.total / 110) + curatedBoost, 0, 1);

    const reasons = describe(request.exercise, candidate);
    if (curatedEdge) reasons.push(`Reviewed: ${curatedEdge.reason}`);
    if (blocked.length > 0) reasons.push(`Currently unavailable: ${blocked.length} item(s) in use.`);
    if (missing.length > 0) {
      reasons.push(
        `Requires equipment you do not have (${missing.length} item(s)) — offered as an alternative requiring different equipment.`,
      );
    }
    reasons.push(`Suitability ${suitability.tier} in this context.`);

    const extra = candidate.requiredEquipmentIds
      .filter((id) => !request.exercise.requiredEquipmentIds.includes(id))
      .sort();

    candidates.push({
      exercise: candidate,
      rank: round(rank),
      tier: suitability.tier,
      preservation,
      reasons,
      curated: curatedEdge !== undefined,
      extraEquipmentIds: extra,
    });
  }

  return candidates
    .sort((a, b) => b.rank - a.rank || a.exercise.slug.localeCompare(b.exercise.slug))
    .slice(0, request.limit ?? 10);
}
