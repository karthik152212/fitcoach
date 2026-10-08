import type {
  CalendarDate,
  EnvironmentEquivalence,
  EnvironmentLimitation,
  ExercisePreferenceKind,
  PlannedExercise,
  TrainingEnvironment,
  TrainingEnvironmentKind,
} from "@fitcoach/domain";
import {
  DEFAULT_ENVIRONMENT_CONFIGURATION,
  getEnvironmentConfiguration,
  type EnvironmentConfiguration,
  type EnvironmentEquipmentAllowance,
} from "./trainingConfig";
import type { ExerciseKnowledge } from "./knowledgeCatalog";

/**
 * Training environment engine (Phase 3.1).
 *
 * A temporary loss of gym access used to mean only one thing: a missed workout.
 * That is the wrong answer. This engine treats the environment as a first-class
 * input — like equipment or a goal — and derives, deterministically:
 *
 *   environment kind → allowed equipment → exercise universe
 *                    → substitutions → explicit limitations
 *
 * The hard rule is scientific honesty: a no-equipment home setup genuinely
 * cannot reproduce loaded pulling. The engine therefore REPORTS what it loses
 * (muscle coverage, movement patterns, load progression) instead of pretending
 * a push-up is a bench press or a floor movement is a lat pulldown.
 */

// ---------------------------------------------------------------------------
// Environment resolution
// ---------------------------------------------------------------------------

export interface EnvironmentPeriodLike {
  id: string;
  kind: TrainingEnvironmentKind;
  availableEquipmentIds: readonly string[];
  unavailableEquipmentIds: readonly string[];
  effectiveFrom: CalendarDate;
  effectiveTo?: CalendarDate | null;
  reason?: string;
  isTemporary: boolean;
}

export interface OwnedEquipmentLike {
  id: string;
  slug: string;
}

export interface EnvironmentResolutionInput {
  asOf: CalendarDate;
  periods: readonly EnvironmentPeriodLike[];
  /** Everything the user owns at `asOf`, with catalog slugs. */
  ownedEquipment: readonly OwnedEquipmentLike[];
  /** Kind assumed when no period covers `asOf`. */
  defaultKind?: TrainingEnvironmentKind;
  configuration?: EnvironmentConfiguration;
}

/** Equipment ids permitted by an allowance, given what the user owns. */
function allowedEquipmentIds(
  allowance: EnvironmentEquipmentAllowance,
  owned: readonly OwnedEquipmentLike[],
): string[] {
  if (allowance === "*") return owned.map((item) => item.id).sort();
  const allowed = new Set(allowance);
  return owned
    .filter((item) => allowed.has(item.slug))
    .map((item) => item.id)
    .sort();
}

/**
 * Build the structured limitations for an environment. Order is fixed so two
 * runs produce byte-identical output.
 */
export function environmentLimitations(
  kind: TrainingEnvironmentKind,
  input: {
    missingEquipmentIds?: readonly string[];
    configuration?: EnvironmentConfiguration;
  } = {},
): EnvironmentLimitation[] {
  const configuration = input.configuration ?? DEFAULT_ENVIRONMENT_CONFIGURATION;
  const profile = getEnvironmentConfiguration(kind, configuration);
  const limitations: EnvironmentLimitation[] = [];

  for (const slug of [...profile.constrainedMuscleSlugs].sort()) {
    limitations.push({
      kind: "muscle_coverage",
      subject: slug,
      description: `${slug} stimulus is materially reduced in a ${kind} environment.`,
      retainedStimulus: 0.5,
    });
  }

  for (const pattern of [...profile.unsupportedMovementPatterns].sort()) {
    limitations.push({
      kind: "movement_pattern",
      subject: pattern,
      description: `${pattern} cannot be trained in a ${kind} environment without equipment.`,
      retainedStimulus: 0,
    });
  }

  if (!profile.loadProgressionAvailable) {
    limitations.push({
      kind: "load_progression",
      subject: "external_load",
      description:
        "External-load progression is unavailable; progression must use reps, effort, variation, range of motion or tempo.",
      retainedStimulus: 0.5,
    });
  }

  for (const equipmentId of [...(input.missingEquipmentIds ?? [])].sort()) {
    limitations.push({
      kind: "equipment",
      subject: equipmentId,
      description: `Equipment ${equipmentId} is not available in a ${kind} environment.`,
      retainedStimulus: 0,
    });
  }

  return limitations;
}

/**
 * Resolve the environment in force on a day.
 *
 * Later periods win; a period covers `asOf` when `effectiveFrom <= asOf` and
 * `effectiveTo` is absent or strictly after `asOf` (exclusive end). Ties are
 * broken by `effectiveFrom` then id, so the answer never depends on row order.
 */
export function resolveTrainingEnvironment(input: EnvironmentResolutionInput): TrainingEnvironment {
  const configuration = input.configuration ?? DEFAULT_ENVIRONMENT_CONFIGURATION;
  const covering = input.periods
    .filter(
      (period) =>
        period.effectiveFrom.localeCompare(input.asOf) <= 0 &&
        (period.effectiveTo === undefined ||
          period.effectiveTo === null ||
          input.asOf.localeCompare(period.effectiveTo) < 0),
    )
    .sort(
      (a, b) =>
        a.effectiveFrom.localeCompare(b.effectiveFrom) || a.id.localeCompare(b.id),
    );
  const active = covering.at(-1);

  if (!active) {
    const kind = input.defaultKind ?? "gym";
    const profile = getEnvironmentConfiguration(kind, configuration);
    const available =
      profile.allowedEquipmentSlugs === "*"
        ? input.ownedEquipment.map((item) => item.id).sort()
        : allowedEquipmentIds(profile.allowedEquipmentSlugs, input.ownedEquipment);
    return {
      kind,
      availableEquipmentIds: available,
      unavailableEquipmentIds: [],
      effectiveFrom: input.asOf,
      isTemporary: false,
      constrained: kind !== "gym",
      source: "default",
      limitations: environmentLimitations(kind, { configuration }),
    };
  }

  const profile = getEnvironmentConfiguration(active.kind, configuration);
  const unavailable = [...new Set(active.unavailableEquipmentIds)].sort();
  const unavailableSet = new Set(unavailable);
  const allowed =
    active.availableEquipmentIds.length > 0
      ? [...new Set(active.availableEquipmentIds)].sort()
      : allowedEquipmentIds(profile.allowedEquipmentSlugs, input.ownedEquipment);
  // Explicitly unavailable equipment is removed from the universe — it is
  // never "available but flagged" (§37: unavailable equipment is never
  // required without explicit conflict).
  const derived = allowed.filter((id) => !unavailableSet.has(id));

  const ownedIds = new Set(input.ownedEquipment.map((item) => item.id));
  const missing = [...ownedIds].filter(
    (id) => !derived.includes(id) || unavailable.includes(id),
  );

  return {
    kind: active.kind,
    availableEquipmentIds: derived,
    unavailableEquipmentIds: unavailable,
    effectiveFrom: active.effectiveFrom,
    ...(active.effectiveTo !== undefined ? { effectiveTo: active.effectiveTo } : {}),
    ...(active.reason !== undefined ? { reason: active.reason } : {}),
    isTemporary: active.isTemporary,
    constrained: active.kind !== "gym",
    source: "period",
    limitations: environmentLimitations(active.kind, {
      missingEquipmentIds: missing,
      configuration,
    }),
  };
}

/** Deterministic inventory of what an environment can and cannot train. */
export function summarizeEnvironmentConstraint(
  environment: TrainingEnvironment,
  configuration: EnvironmentConfiguration = DEFAULT_ENVIRONMENT_CONFIGURATION,
): {
  kind: TrainingEnvironmentKind;
  loadProgressionAvailable: boolean;
  unsupportedMovementPatterns: readonly string[];
  constrainedMuscleSlugs: readonly string[];
  honestyNote: string;
  constrained: boolean;
} {
  const profile = getEnvironmentConfiguration(environment.kind, configuration);
  return {
    kind: environment.kind,
    loadProgressionAvailable: profile.loadProgressionAvailable,
    unsupportedMovementPatterns: profile.unsupportedMovementPatterns,
    constrainedMuscleSlugs: profile.constrainedMuscleSlugs,
    honestyNote: profile.honestyNote,
    constrained: environment.constrained,
  };
}

/** True when the plan's environment and the day's environment differ. */
export function environmentChangeNeeded(
  planEnvironmentKind: TrainingEnvironmentKind | undefined,
  activeEnvironmentKind: TrainingEnvironmentKind,
): boolean {
  if (planEnvironmentKind === undefined) return false;
  return planEnvironmentKind !== activeEnvironmentKind;
}

// ---------------------------------------------------------------------------
// Exercise adaptation
// ---------------------------------------------------------------------------

export interface EnvironmentSubstitution {
  originalExerciseId: string;
  originalExerciseName: string;
  replacementExerciseId: string;
  replacementExerciseName: string;
  reason: string;
  equivalence: EnvironmentEquivalence;
  stimulusSimilarity: number;
  musclesPreserved: readonly string[];
  musclesLost: readonly string[];
  relationship: string;
}

export interface EnvironmentAdaptationInput {
  exercises: readonly PlannedExercise[];
  catalog: readonly ExerciseKnowledge[];
  environment: TrainingEnvironment;
  preferences?: Readonly<Record<string, ExercisePreferenceKind>>;
  /** Minimum similarity a replacement must reach; below this the slot is dropped. */
  minSimilarity?: number;
  configuration?: EnvironmentConfiguration;
}

export interface EnvironmentAdaptationResult {
  exercises: readonly PlannedExercise[];
  substitutions: readonly EnvironmentSubstitution[];
  limitations: readonly EnvironmentLimitation[];
  muscleCoverageLost: readonly string[];
  muscleCoveragePreserved: readonly string[];
  loadProgressionAvailable: boolean;
  honestyNote: string;
  warnings: readonly string[];
}

function primaryMuscleSlugs(exercise: ExerciseKnowledge | undefined): string[] {
  if (!exercise) return [];
  return [
    ...new Set(
      exercise.targets
        .filter((target) => target.role === "primary_mover" && target.structureId === undefined)
        .map((target) => target.muscleSlug),
    ),
  ].sort();
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function recall(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0) return 0;
  const other = new Set(b);
  const shared = a.filter((item) => other.has(item)).length;
  return shared / a.length;
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 0;
  let shared = 0;
  for (const item of setA) if (setB.has(item)) shared += 1;
  return shared / union.size;
}

function equivalenceFor(
  preserved: readonly string[],
  total: readonly string[],
  sameMovement: boolean,
  loadAvailable: boolean,
): EnvironmentEquivalence {
  if (total.length > 0 && preserved.length < total.length) return "reduced";
  if (!sameMovement || !loadAvailable) return "partial";
  return "equivalent";
}

function relationshipLabel(equivalence: EnvironmentEquivalence, loadAvailable: boolean): string {
  switch (equivalence) {
    case "equivalent":
      return "equivalent substitution: same primary muscles, same movement function, load progression preserved";
    case "partial":
      return loadAvailable
        ? "partial substitution: primary muscles preserved, movement pattern differs"
        : "partial substitution: primary muscles preserved, external-load progression unavailable";
    default:
      return "reduced substitution: some of the original stimulus cannot be reproduced";
  }
}

/**
 * Adapt a set of planned exercises to an environment.
 *
 * Deterministic in every step: candidates are filtered by a hard availability
 * gate, scored by muscle recall + movement-function overlap + category match,
 * and ordered by score then slug. Ties never fall back to catalog order.
 */
export function adaptExercisesToEnvironment(
  input: EnvironmentAdaptationInput,
): EnvironmentAdaptationResult {
  const configuration = input.configuration ?? DEFAULT_ENVIRONMENT_CONFIGURATION;
  const profile = getEnvironmentConfiguration(input.environment.kind, configuration);
  const available = new Set(input.environment.availableEquipmentIds);
  const unsupported = new Set(profile.unsupportedMovementPatterns);
  const minSimilarity = input.minSimilarity ?? 0.35;
  const preferences = input.preferences ?? {};

  const byId = new Map(input.catalog.map((exercise) => [exercise.id, exercise]));
  const warnings: string[] = [];
  const substitutions: EnvironmentSubstitution[] = [];
  const muscleCoverageLost = new Set<string>();
  const muscleCoveragePreserved = new Set<string>();
  const result: PlannedExercise[] = [];

  for (const exercise of input.exercises) {
    const knowledge = byId.get(exercise.exerciseId);
    const required = knowledge?.requiredEquipmentIds ?? [];
    const missing = required.filter((id) => !available.has(id));
    const patternBlocked =
      knowledge?.movementPattern !== undefined && unsupported.has(knowledge.movementPattern);

    if (!knowledge || (missing.length === 0 && !patternBlocked)) {
      // Nothing to change: record what the slot still trains.
      for (const slug of primaryMuscleSlugs(knowledge)) muscleCoveragePreserved.add(slug);
      result.push({ ...exercise });
      continue;
    }

    const originalPrimaries = primaryMuscleSlugs(knowledge);
    const originalFunctions = knowledge.movementFunctions;

    const candidates = input.catalog
      .filter((candidate) => candidate.id !== exercise.exerciseId)
      .filter((candidate) => preferences[candidate.id] !== "excluded")
      .filter((candidate) => candidate.requiredEquipmentIds.every((id) => available.has(id)))
      .filter(
        (candidate) =>
          candidate.movementPattern === undefined || !unsupported.has(candidate.movementPattern),
      )
      .filter((candidate) =>
        candidate.targets.some(
          (target) => target.role === "primary_mover" && originalPrimaries.includes(target.muscleSlug),
        ),
      )
      .map((candidate) => {
        const candidatePrimaries = primaryMuscleSlugs(candidate);
        const preserved = originalPrimaries.filter((slug) => candidatePrimaries.includes(slug));
        const muscleScore = recall(originalPrimaries, candidatePrimaries);
        const movementScore = jaccard(originalFunctions, candidate.movementFunctions);
        const categoryScore = candidate.category === knowledge.category ? 1 : 0.5;
        return {
          candidate,
          preserved,
          muscleScore,
          score: round(0.6 * muscleScore + 0.25 * movementScore + 0.15 * categoryScore),
        };
      })
      .filter((entry) => entry.score >= minSimilarity)
      .sort(
        (a, b) => b.score - a.score || a.candidate.slug.localeCompare(b.candidate.slug),
      );

    const best = candidates[0];
    if (!best) {
      for (const slug of originalPrimaries) muscleCoverageLost.add(slug);
      warnings.push(
        `No eligible replacement for ${exercise.name} in a ${input.environment.kind} environment; the slot was removed rather than faked.`,
      );
      continue;
    }

    const candidatePrimaries = primaryMuscleSlugs(best.candidate);
    const sameMovement =
      knowledge.movementPattern !== undefined &&
      knowledge.movementPattern === best.candidate.movementPattern;
    const equivalence = equivalenceFor(
      best.preserved,
      originalPrimaries,
      sameMovement,
      profile.loadProgressionAvailable,
    );
    const musclesLost = originalPrimaries.filter((slug) => !candidatePrimaries.includes(slug));
    for (const slug of best.preserved) muscleCoveragePreserved.add(slug);
    for (const slug of musclesLost) muscleCoverageLost.add(slug);

    const reason = missing.length > 0 ? "equipment_unavailable" : "movement_pattern_unsupported";
    substitutions.push({
      originalExerciseId: exercise.exerciseId,
      originalExerciseName: exercise.name,
      replacementExerciseId: best.candidate.id,
      replacementExerciseName: best.candidate.name,
      reason,
      equivalence,
      stimulusSimilarity: best.score,
      musclesPreserved: [...best.preserved].sort(),
      musclesLost: [...musclesLost].sort(),
      relationship: relationshipLabel(equivalence, profile.loadProgressionAvailable),
    });

    result.push({
      ...exercise,
      exerciseId: best.candidate.id,
      name: best.candidate.name,
      ...(best.candidate.variationLabel !== undefined
        ? { variationLabel: best.candidate.variationLabel }
        : {}),
      selectionReason: `${exercise.selectionReason} Substituted for ${exercise.name} because a ${input.environment.kind} environment cannot perform it (${reason}); ${relationshipLabel(equivalence, profile.loadProgressionAvailable)}.`,
      exerciseDecisionSnapshot: {
        exerciseId: best.candidate.id,
        tier: exercise.exerciseDecisionSnapshot?.tier ?? "acceptable",
        score: exercise.exerciseDecisionSnapshot?.score ?? 0,
        primaryTargets: [...best.preserved],
        secondaryTargets: exercise.exerciseDecisionSnapshot?.secondaryTargets ?? [],
        equipmentCompatibility: "environment_available",
        roles: [...best.candidate.roles],
        movementFunctions: [...best.candidate.movementFunctions],
        knowledgeVersion: best.candidate.knowledgeVersion,
        selectionReasons: [
          `Available in a ${input.environment.kind} environment`,
          `Substituted for ${exercise.name}`,
        ],
        confidence: best.score,
        environmentKind: input.environment.kind,
        substitutedFromExerciseId: exercise.exerciseId,
        stimulusSimilarity: best.score,
        coveragePreserved: [...best.preserved].sort(),
        coverageLost: [...musclesLost].sort(),
        equivalence,
      },
    });
  }

  const environmentLimitationsForPlan = [
    ...input.environment.limitations,
    ...(profile.unsupportedMovementPatterns.length > 0 && !profile.loadProgressionAvailable
      ? [
          {
            kind: "muscle_coverage" as const,
            subject: "back",
            description:
              "Loaded pulling cannot be reproduced without equipment; back stimulus is expected to fall short of the gym plan.",
            retainedStimulus: 0.4,
          },
        ]
      : []),
  ];

  return {
    exercises: result,
    substitutions,
    limitations: environmentLimitationsForPlan,
    muscleCoverageLost: [...muscleCoverageLost].sort(),
    muscleCoveragePreserved: [...muscleCoveragePreserved].sort(),
    loadProgressionAvailable: profile.loadProgressionAvailable,
    honestyNote: profile.honestyNote,
    warnings,
  };
}

/**
 * The progression levers a plan exercises when external load is missing.
 * Exposed separately so the API can explain *how* a temporary plan progresses
 * without claiming it progresses the same way as the gym plan.
 */
export function environmentProgressionMechanisms(
  environment: TrainingEnvironment,
  configuration: EnvironmentConfiguration = DEFAULT_ENVIRONMENT_CONFIGURATION,
): readonly string[] {
  const profile = getEnvironmentConfiguration(environment.kind, configuration);
  return profile.loadProgressionAvailable
    ? ["load", "reps", "rir", "sets"]
    : ["reps", "rir", "variation", "rom", "tempo", "sets"];
}
