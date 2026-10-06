import type {
  ExercisePreferenceKind,
  MovementPattern,
  SuitabilityContext,
  SuitabilityScore,
  SuitabilityTier,
} from "@fitcoach/domain";
import { SUITABILITY_TIER_MEANINGS } from "@fitcoach/domain";
import type { ExerciseKnowledge } from "./knowledgeCatalog";
import { EMPHASIS_LABELS, MUSCLE_ROLE_LABELS, describeTargeting } from "./knowledgeCatalog";
import { analyseRedundancy } from "./redundancy";
import type { RedundancyFinding } from "./redundancy";
import { scoreExerciseSuitability } from "./suitability";
import type { SubstitutionCandidate } from "./substitution";
import { findSubstitutions } from "./substitution";

/**
 * Exercise decision object (Phase 2, §19/§20).
 *
 * This is NOT a workout-plan entity. It is the deterministic
 * selection-and-explanation record for ONE exercise in ONE context, which a
 * future planner can consume to build a plan and a future UI can render to
 * answer "why am I doing this?".
 *
 * Every field is either (a) catalog data, (b) a computed score, or (c) a reason
 * generated from (a) and (b). There is no free-text narrative invented here,
 * which is exactly what lets the same object drive an API response, an app
 * screen and an audit later.
 */
export interface ExerciseDecisionTarget {
  muscleId: string;
  muscleSlug: string;
  displayName: string;
  role: string;
  roleLabel: string;
  structureId?: string;
  structureSlug?: string;
  structureDisplayName?: string;
  emphasis?: string;
  emphasisLabel?: string;
  contributionWeight?: number;
  confidence?: number;
}

export interface ExerciseDecisionEquipment {
  requiredIds: readonly string[];
  availableIds: readonly string[];
  missingIds: readonly string[];
  temporarilyUnavailableIds: readonly string[];
  compatibility: "full" | "temporary" | "unavailable";
}

export interface ExerciseDecision {
  exerciseId: string;
  slug: string;
  name: string;
  variationKey?: string;
  variationLabel?: string;
  knowledgeVersion: number;
  goalProfile: SuitabilityContext["goalProfile"];
  movementPattern?: MovementPattern;
  movementFunctions: readonly string[];
  roles: readonly string[];
  targets: readonly ExerciseDecisionTarget[];
  emphasis?: string;
  tier: SuitabilityTier;
  tierMeaning: string;
  score: SuitabilityScore;
  equipment: ExerciseDecisionEquipment;
  /** Ordered, deterministic "why this exercise" reasons. */
  selectionReasons: readonly string[];
  redundancy: {
    /** Highest overlap with anything already selected, 0 when alone. */
    maxOverlapScore: number;
    findings: readonly RedundancyFinding[];
  };
  alternatives: readonly SubstitutionCandidate[];
  /** Why this exercise would NOT be selected. Empty when it was selected. */
  exclusions: readonly string[];
  confidence: {
    /** Mean reviewer confidence across the targeting used for this decision. */
    overall: number;
    weakestConfidence?: number;
    weakestTarget?: string;
  };
  provenance: {
    externalSourceId?: string;
    externalId?: string;
    /** Catalog version the decision was made against. */
    knowledgeVersion: number;
  };
}

export interface ExerciseDecisionRequest {
  exercise: ExerciseKnowledge;
  context: SuitabilityContext;
  catalog?: readonly ExerciseKnowledge[];
  alongsideExerciseIds?: readonly string[];
  preferences?: Readonly<Record<string, ExercisePreferenceKind>>;
  temporarilyUnavailableEquipmentIds?: readonly string[];
  limitations?: readonly string[];
  curatedSubstitutions?: Parameters<typeof findSubstitutions>[0]["curated"];
  targetMuscleIds?: readonly string[];
  targetMuscleSlugs?: readonly string[];
  targetStructureIds?: readonly string[];
  /** Whether to compute alternatives. Off for cheap list rendering. */
  includeAlternatives?: boolean;
  alternativeLimit?: number;
  /** Catalog-level provenance carried through unchanged. */
  externalSourceId?: string;
  externalId?: string;
}

function round(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function equipmentFor(
  exercise: ExerciseKnowledge,
  context: SuitabilityContext,
  temporary: readonly string[],
): ExerciseDecisionEquipment {
  const available = new Set(context.availableEquipmentIds);
  const blocked = new Set(temporary);
  const requiredIds = [...exercise.requiredEquipmentIds].sort();
  const availableIds = requiredIds.filter((id) => available.has(id));
  const missingIds = requiredIds.filter((id) => !available.has(id) && !blocked.has(id));
  const temporarilyUnavailableIds = requiredIds.filter((id) => blocked.has(id));
  const compatibility: ExerciseDecisionEquipment["compatibility"] =
    missingIds.length > 0 ? "unavailable" : temporarilyUnavailableIds.length > 0 ? "temporary" : "full";
  return {
    requiredIds,
    availableIds,
    missingIds,
    temporarilyUnavailableIds,
    compatibility,
  };
}

/**
 * Build the deterministic decision object.
 *
 * When the exercise is not selectable in this context, the SAME object is still
 * produced — with populated `exclusions` instead of `selectionReasons`. That is
 * deliberate: "why was this not chosen" and "why was this chosen" are the same
 * computation, and keeping them one function is what guarantees they cannot
 * disagree.
 */
export function buildExerciseDecision(request: ExerciseDecisionRequest): ExerciseDecision {
  const { exercise, context } = request;
  const temporary = request.temporarilyUnavailableEquipmentIds ?? [];
  const preference = request.preferences?.[exercise.id];

  const alongside = (request.alongsideExerciseIds ?? [])
    .map((id) => (request.catalog ?? []).find((item) => item.id === id))
    .filter((item): item is ExerciseKnowledge => item !== undefined);
  const redundancyFindings = alongside
    .filter((other) => other.id !== exercise.id)
    .map((other) => analyseRedundancy(other, exercise));
  const maxOverlap = redundancyFindings.reduce(
    (max, finding) => Math.max(max, finding.overlapScore),
    0,
  );

  const score = scoreExerciseSuitability({
    exercise,
    context,
    redundancy: redundancyFindings,
    ...(request.targetMuscleIds !== undefined ? { targetMuscleIds: request.targetMuscleIds } : {}),
    ...(request.targetMuscleSlugs !== undefined ? { targetMuscleSlugs: request.targetMuscleSlugs } : {}),
    ...(request.targetStructureIds !== undefined ? { targetStructureIds: request.targetStructureIds } : {}),
    ...(preference !== undefined ? { preference } : {}),
    temporarilyUnavailableEquipmentIds: temporary,
    ...(request.limitations !== undefined ? { limitations: request.limitations } : {}),
  });

  const equipment = equipmentFor(exercise, context, temporary);
  const targets = exercise.targets
    .map((target) => ({
      muscleId: target.muscleId,
      muscleSlug: target.muscleSlug,
      displayName: target.muscleDisplayName,
      role: target.role,
      roleLabel: MUSCLE_ROLE_LABELS[target.role] ?? target.role,
      ...(target.structureId !== undefined ? { structureId: target.structureId } : {}),
      ...(target.structureSlug !== undefined ? { structureSlug: target.structureSlug } : {}),
      ...(target.structureDisplayName !== undefined
        ? { structureDisplayName: target.structureDisplayName }
        : {}),
      ...(target.emphasis !== undefined ? { emphasis: target.emphasis } : {}),
      ...(target.emphasis !== undefined
        ? { emphasisLabel: EMPHASIS_LABELS[target.emphasis] ?? target.emphasis }
        : {}),
      ...(target.contributionWeight !== undefined ? { contributionWeight: target.contributionWeight } : {}),
      ...(target.confidence !== undefined ? { confidence: target.confidence } : {}),
    }))
    .sort(byRoleThenSlug);

  const exclusions = buildExclusions(exercise, equipment, preference, request.limitations ?? [], maxOverlap);
  const selectionReasons = exclusions.length === 0 ? buildReasons(exercise, context, targets, maxOverlap) : [];

  const alternatives =
    request.includeAlternatives === false || !request.catalog
      ? []
      : findSubstitutions({
          exercise,
          catalog: request.catalog,
          context,
          ...(request.curatedSubstitutions !== undefined ? { curated: request.curatedSubstitutions } : {}),
          alongsideExerciseIds: request.alongsideExerciseIds ?? [],
          ...(request.preferences !== undefined ? { preferences: request.preferences } : {}),
          temporarilyUnavailableEquipmentIds: temporary,
          ...(request.limitations !== undefined ? { limitations: request.limitations } : {}),
          limit: request.alternativeLimit ?? 5,
        });

  const confidences = exercise.targets
    .map((target) => target.confidence)
    .filter((value): value is number => value !== undefined);
  let weakestTarget: string | undefined;
  let weakestConfidence: number | undefined;
  if (confidences.length > 0) {
    let worst = 1;
    for (const target of exercise.targets) {
      if (target.confidence !== undefined && target.confidence < worst) {
        worst = target.confidence;
        weakestConfidence = target.confidence;
        weakestTarget = describeTargeting(target);
      }
    }
  }
  const overallConfidence =
    confidences.length === 0
      ? 0.7
      : confidences.reduce((sum, value) => sum + value, 0) / confidences.length;

  return {
    exerciseId: exercise.id,
    slug: exercise.slug,
    name: exercise.name,
    ...(exercise.variationKey !== undefined ? { variationKey: exercise.variationKey } : {}),
    ...(exercise.variationLabel !== undefined ? { variationLabel: exercise.variationLabel } : {}),
    knowledgeVersion: exercise.knowledgeVersion,
    goalProfile: context.goalProfile,
    ...(exercise.movementPattern !== undefined ? { movementPattern: exercise.movementPattern } : {}),
    movementFunctions: [...exercise.movementFunctions].sort(),
    roles: [...exercise.roles],
    targets,
    ...(primaryEmphasis(exercise) !== undefined ? { emphasis: primaryEmphasis(exercise)! } : {}),
    tier: score.tier,
    tierMeaning: SUITABILITY_TIER_MEANINGS[score.tier],
    score,
    equipment,
    selectionReasons,
    redundancy: { maxOverlapScore: round(maxOverlap), findings: redundancyFindings },
    alternatives,
    exclusions,
    confidence: {
      overall: round(overallConfidence, 2),
      ...(weakestConfidence !== undefined ? { weakestConfidence: round(weakestConfidence, 2) } : {}),
      ...(weakestTarget !== undefined ? { weakestTarget } : {}),
    },
    provenance: {
      ...(request.externalSourceId !== undefined ? { externalSourceId: request.externalSourceId } : {}),
      ...(request.externalId !== undefined ? { externalId: request.externalId } : {}),
      knowledgeVersion: exercise.knowledgeVersion,
    },
  };
}

const ROLE_ORDER: Record<string, number> = {
  primary_mover: 0,
  secondary_mover: 1,
  supporting: 2,
  stabilizer: 3,
};

function byRoleThenSlug(
  a: ExerciseDecisionTarget,
  b: ExerciseDecisionTarget,
): number {
  if (ROLE_ORDER[a.role] !== ROLE_ORDER[b.role]) return ROLE_ORDER[a.role]! - ROLE_ORDER[b.role]!;
  if (a.muscleSlug !== b.muscleSlug) return a.muscleSlug.localeCompare(b.muscleSlug);
  return (a.structureSlug ?? "").localeCompare(b.structureSlug ?? "");
}

function primaryEmphasis(exercise: ExerciseKnowledge): string | undefined {
  const withEmphasis = exercise.targets.filter((target) => target.emphasis !== undefined);
  if (withEmphasis.length === 0) return undefined;
  const roleOrder = [...withEmphasis].sort((a, b) => ROLE_ORDER[a.role]! - ROLE_ORDER[b.role]!);
  return roleOrder[0]!.emphasis;
}

function buildExclusions(
  exercise: ExerciseKnowledge,
  equipment: ExerciseDecisionEquipment,
  preference: ExercisePreferenceKind | undefined,
  limitations: readonly string[],
  maxOverlap: number,
): string[] {
  const reasons: string[] = [];
  if (equipment.compatibility === "unavailable") {
    reasons.push(
      `Requires equipment that is not available: ${equipment.missingIds.length} item(s).`,
    );
  }
  if (preference === "excluded") reasons.push("You have excluded this exercise.");
  if (preference === "disliked") {
    reasons.push("You have marked this exercise as disliked.");
  }
  if (limitations.length > 0) {
    const matches = exercise.targets.filter((target) =>
      limitations.some((limitation) => {
        const needle = limitation.trim().toLowerCase();
        if (needle.length === 0) return false;
        return (
          target.muscleSlug.toLowerCase().includes(needle) ||
          needle.includes(target.muscleSlug.toLowerCase()) ||
          target.muscleDisplayName.toLowerCase().includes(needle)
        );
      }),
    );
    if (matches.length > 0) {
      reasons.push(
        `Touches a muscle you flagged as a limitation (${matches
          .map((target) => target.muscleDisplayName)
          .sort()
          .join(", ")}).`,
      );
    }
  }
  if (maxOverlap >= 0.6) {
    reasons.push(`Overlaps heavily (${round(maxOverlap, 2)}) with an exercise already selected.`);
  }
  return reasons;
}

function buildReasons(
  exercise: ExerciseKnowledge,
  context: SuitabilityContext,
  targets: readonly ExerciseDecisionTarget[],
  maxOverlap: number,
): string[] {
  const reasons: string[] = [];
  const primary = targets.filter((target) => target.role === "primary_mover");
  for (const target of primary.slice(0, 3)) {
    reasons.push(`Primary target: ${describeTargetingFromDecision(target)}.`);
  }
  const emphasised = targets.filter((target) => target.emphasis !== undefined);
  for (const target of emphasised.slice(0, 2)) {
    reasons.push(`Emphasis: ${target.displayName}${target.structureDisplayName ? ` (${target.structureDisplayName})` : ""} — ${target.emphasisLabel}.`);
  }
  if (exercise.roles.length > 0) {
    reasons.push(`Role in the program: ${exercise.roles.slice(0, 3).join(", ")}.`);
  }
  reasons.push(`Serves the ${context.goalProfile.replace("_", " ")} goal.`);
  if (exercise.rangeOfMotionCharacteristic) {
    reasons.push(`Range of motion: ${exercise.rangeOfMotionCharacteristic.replace(/_/g, " ")}.`);
  }
  if (maxOverlap > 0) {
    reasons.push(
      `Complements the rest of the session: highest measured overlap is ${round(maxOverlap, 2)}.`,
    );
  }
  return reasons;
}

function describeTargetingFromDecision(target: ExerciseDecisionTarget): string {
  const region = target.structureDisplayName ? ` (${target.structureDisplayName})` : "";
  const emphasis = target.emphasisLabel ? ` — ${target.emphasisLabel}` : "";
  return `${target.displayName}${region}: ${target.roleLabel}${emphasis}`;
}

/**
 * Structured explanation (Phase 2, §20).
 *
 * Every field comes from the decision object; nothing is generated as prose.
 * A future AI layer may rephrase these into conversational language, but it
 * may not add facts, because the structure it would rewrite is already the
 * answer.
 */
export interface ExerciseExplanation {
  exercise: string;
  variation?: string;
  tier: SuitabilityTier;
  tierMeaning: string;
  primaryTargets: ReadonlyArray<string>;
  secondaryTargets: ReadonlyArray<string>;
  emphasis?: string;
  whyThisExercise: ReadonlyArray<string>;
  roleInProgram: ReadonlyArray<string>;
  goalRelevance: string;
  equipment: {
    required: number;
    compatibility: ExerciseDecisionEquipment["compatibility"];
    note: string;
  };
  scoreBreakdown: ReadonlyArray<{
    component: string;
    value: number;
    explanation: string;
  }>;
  alternatives: ReadonlyArray<{ exercise: string; tier: SuitabilityTier; reason: string }>;
  exclusions: ReadonlyArray<string>;
  confidenceNote: string;
  /** Stated limitation of the model itself, surfaced with every explanation. */
  scientificCaveat: string;
}

export const SCIENTIFIC_CAVEAT =
  "Suitability is a FitCoach decision-support model for this specific goal and context. It is not an objective ranking, and no exercise isolates a single muscle.";

export function explainExerciseDecision(decision: ExerciseDecision): ExerciseExplanation {
  const primaryTargets = decision.targets
    .filter((target) => target.role === "primary_mover")
    .map(describeTargetingFromDecision);
  const secondaryTargets = decision.targets
    .filter((target) => target.role !== "primary_mover")
    .map(describeTargetingFromDecision);

  return {
    exercise: decision.name,
    ...(decision.variationLabel !== undefined ? { variation: decision.variationLabel } : {}),
    tier: decision.tier,
    tierMeaning: decision.tierMeaning,
    primaryTargets,
    secondaryTargets,
    ...(decision.emphasis !== undefined
      ? { emphasis: EMPHASIS_LABELS[decision.emphasis] ?? decision.emphasis }
      : {}),
    whyThisExercise: decision.exclusions.length > 0 ? [] : decision.selectionReasons,
    roleInProgram: decision.roles,
    goalRelevance: `Scored for the ${decision.goalProfile.replace("_", " ")} goal in this context.`,
    equipment: {
      required: decision.equipment.requiredIds.length,
      compatibility: decision.equipment.compatibility,
      note:
        decision.equipment.compatibility === "full"
          ? "All required equipment is available."
          : decision.equipment.compatibility === "temporary"
            ? "Some required equipment is temporarily unavailable."
            : "Some required equipment is not in the user's inventory.",
    },
    scoreBreakdown: decision.score.components.map((component) => ({
      component: component.key,
      value: component.value,
      explanation: component.detail,
    })),
    alternatives: decision.alternatives.map((alternative) => ({
      exercise: alternative.exercise.name,
      tier: alternative.tier,
      reason: alternative.reasons[0] ?? "Ranked substitute.",
    })),
    exclusions: decision.exclusions,
    confidenceNote:
      decision.confidence.overall >= 0.8
        ? "Targeting confidence is high."
        : `Targeting confidence is moderate (${decision.confidence.overall}); treat head-specific claims as a tendency, not a certainty.`,
    scientificCaveat: SCIENTIFIC_CAVEAT,
  };
}
