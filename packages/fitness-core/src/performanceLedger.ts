import type {
  CalendarDate,
  ExercisePerformanceSummary,
  PerformanceLoadKind,
  PerformanceObservation,
  PerformanceObservationSummary,
  PerformanceSource,
  ProgressionAction,
  ProgressionActualChange,
  ProgressionDecisionEvent,
  ProgressionEvaluation,
  ProgressionEvaluationOutcome,
  ProgressionLedgerEntry,
  ProgressionRecommendation,
  SessionClassification,
  TrainingEnvironmentKind,
  TrainingGoalProfile,
} from "@fitcoach/domain";
import {
  DEFAULT_PROGRESSION_LEDGER_CONFIGURATION,
  type ProgressionLedgerConfiguration,
} from "./trainingConfig";

/**
 * Performance & progression ledger engine (Phase 3.1).
 *
 * Phase 3 could persist a progression RULE per slot but had no evidence of what
 * the user actually did, so `progressionsCompleted` stayed at zero forever.
 * This module closes that gap with a deterministic chain:
 *
 *   performed set  →  observation
 *   observations   →  performance summary (best reps/load, trend)
 *   summary+target →  evaluation + recommendation
 *   recommendation →  decision (accepted / rejected / deferred)
 *   decision+later performance →  completed progression (or not)
 *
 * The distinction that matters most: a RECOMMENDATION is not a PROGRESSION.
 * A progression is only counted when the user accepted it AND a later recorded
 * performance actually shows the change. Everything here is a pure function of
 * its inputs — no clock, no randomness, no LLM.
 */

// ---------------------------------------------------------------------------
// Observation construction
// ---------------------------------------------------------------------------

/** The subset of a logged set the ledger needs. Structurally a repository row. */
export interface PerformanceSetInput {
  id: string;
  exerciseId: string;
  workoutId?: string;
  planVersionId?: string;
  slotId?: string;
  setKind: string;
  loadKg?: number;
  addedLoadKg?: number;
  assistanceKg?: number;
  reps?: number;
  distanceMeters?: number;
  durationSeconds?: number;
  rir?: number;
  rpe?: number;
  notes?: string;
  createdAt: string;
  /** Parent workout status; drives completion semantics, never load. */
  workoutStatus: string;
  targetRepMin?: number;
  targetRepMax?: number;
  environmentKind?: TrainingEnvironmentKind;
  classification?: SessionClassification;
  substitutedFromExerciseId?: string;
  source?: PerformanceSource;
  /** User-local day; derived from `createdAt` when absent. */
  localDate?: CalendarDate;
}

/**
 * Infer the load kind from the columns instead of demanding the caller declare
 * it. A bodyweight set is load, not missing data — that distinction is what
 * makes bodyweight progression possible at all.
 */
export function inferLoadKind(input: {
  loadKg?: number;
  addedLoadKg?: number;
  assistanceKg?: number;
  reps?: number;
  distanceMeters?: number;
  durationSeconds?: number;
}): PerformanceLoadKind {
  if (input.assistanceKg !== undefined) return "assisted_bodyweight";
  if (input.loadKg !== undefined && input.addedLoadKg !== undefined) return "weighted_bodyweight";
  if (input.loadKg !== undefined) return "external_load";
  if (input.addedLoadKg !== undefined) return "weighted_bodyweight";
  if ((input.reps ?? 0) > 0 || (input.distanceMeters ?? 0) > 0 || (input.durationSeconds ?? 0) > 0) {
    return "bodyweight";
  }
  return "none";
}

/** True when the set recorded measurable work. */
export function isCompletedSet(input: {
  reps?: number;
  distanceMeters?: number;
  durationSeconds?: number;
}): boolean {
  return (input.reps ?? 0) > 0 || (input.distanceMeters ?? 0) > 0 || (input.durationSeconds ?? 0) > 0;
}

function dayOf(timestamp: string): CalendarDate {
  const parsed = Date.parse(timestamp);
  const date = Number.isNaN(parsed) ? new Date(0) : new Date(parsed);
  return date.toISOString().slice(0, 10);
}

export function toPerformanceObservation(input: PerformanceSetInput): PerformanceObservation {
  return {
    id: input.id,
    exerciseId: input.exerciseId,
    ...(input.planVersionId !== undefined ? { planVersionId: input.planVersionId } : {}),
    ...(input.slotId !== undefined ? { slotId: input.slotId } : {}),
    ...(input.workoutId !== undefined ? { workoutId: input.workoutId } : {}),
    setKind: input.setKind,
    loadKind: inferLoadKind(input),
    ...(input.loadKg !== undefined ? { loadKg: input.loadKg } : {}),
    ...(input.addedLoadKg !== undefined ? { addedLoadKg: input.addedLoadKg } : {}),
    ...(input.assistanceKg !== undefined ? { assistanceKg: input.assistanceKg } : {}),
    ...(input.reps !== undefined ? { reps: input.reps } : {}),
    ...(input.targetRepMin !== undefined ? { targetRepMin: input.targetRepMin } : {}),
    ...(input.targetRepMax !== undefined ? { targetRepMax: input.targetRepMax } : {}),
    ...(input.rir !== undefined ? { rir: input.rir } : {}),
    ...(input.rpe !== undefined ? { rpe: input.rpe } : {}),
    completed: isCompletedSet(input),
    performedAt: input.createdAt,
    localDate: input.localDate ?? dayOf(input.createdAt),
    ...(input.environmentKind !== undefined ? { environmentKind: input.environmentKind } : {}),
    ...(input.classification !== undefined ? { classification: input.classification } : {}),
    ...(input.substitutedFromExerciseId !== undefined
      ? { substitutedFromExerciseId: input.substitutedFromExerciseId }
      : {}),
    source: input.source ?? "manual",
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  };
}

/**
 * Stable ordering: performed date, then timestamp, then set id. Two runs over
 * the same rows therefore produce the same history regardless of fetch order.
 */
export function sortObservations(
  observations: readonly PerformanceObservation[],
): PerformanceObservation[] {
  return [...observations].sort(
    (a, b) =>
      a.localDate.localeCompare(b.localDate) ||
      a.performedAt.localeCompare(b.performedAt) ||
      a.id.localeCompare(b.id),
  );
}

// ---------------------------------------------------------------------------
// Performance summary
// ---------------------------------------------------------------------------

/**
 * Deterministic trend over an ordered series. Half-split comparison matches the
 * planner's Phase 3 behaviour, so summaries and adaptation signals agree.
 */
export function detectPerformanceTrend(values: readonly number[]): string {
  if (values.length < 4) return "unknown";
  const half = Math.floor(values.length / 2);
  const earlier = values.slice(0, half);
  const recent = values.slice(half);
  const mean = (list: readonly number[]): number =>
    list.reduce((sum, value) => sum + value, 0) / Math.max(1, list.length);
  const earlierMean = mean(earlier);
  const recentMean = mean(recent);
  if (recentMean > earlierMean * 1.05) return "improving";
  if (recentMean < earlierMean * 0.95) return "declining";
  return "stable";
}

/** Which progression levers exist for a load kind. Pure, config-driven. */
export function progressionMechanismsFor(
  loadKind: PerformanceLoadKind | undefined,
  configuration: ProgressionLedgerConfiguration = DEFAULT_PROGRESSION_LEDGER_CONFIGURATION,
): readonly string[] {
  if (
    loadKind === "external_load" ||
    loadKind === "weighted_bodyweight" ||
    loadKind === "assisted_bodyweight"
  ) {
    return configuration.loadedMechanisms;
  }
  return configuration.bodyweightMechanisms;
}

/**
 * Summarize one exercise's observed performance. `distanceMeters`/duration-only
 * sets are counted for completeness but never given a fake rep count.
 */
export function summarizeExercisePerformance(
  exerciseId: string,
  observations: readonly PerformanceObservation[],
  configuration: ProgressionLedgerConfiguration = DEFAULT_PROGRESSION_LEDGER_CONFIGURATION,
): ExercisePerformanceSummary {
  const ordered = sortObservations(observations.filter((item) => item.exerciseId === exerciseId));
  const completed = ordered.filter((item) => item.completed);
  const failed = ordered.filter((item) => !item.completed);

  const sessions = new Set<string>();
  for (const item of completed) sessions.add(item.workoutId ?? item.localDate);
  const attemptedSessions = new Set<string>();
  for (const item of failed) attemptedSessions.add(item.workoutId ?? item.localDate);

  let bestReps: number | undefined;
  let bestLoadKg: number | undefined;
  const repSeries: number[] = [];
  for (const item of completed) {
    if (item.reps !== undefined) {
      bestReps = bestReps === undefined ? item.reps : Math.max(bestReps, item.reps);
      repSeries.push(item.reps);
    }
    if (item.loadKg !== undefined) {
      bestLoadKg = bestLoadKg === undefined ? item.loadKg : Math.max(bestLoadKg, item.loadKg);
    }
  }

  const latest = ordered.at(-1);
  const latestRir = [...ordered].reverse().find((item) => item.rir !== undefined)?.rir;

  return {
    exerciseId,
    completedSets: completed.length,
    incompleteSessions: [...attemptedSessions].filter((id) => !sessions.has(id)).length,
    sessionsObserved: new Set([...sessions, ...attemptedSessions]).size,
    ...(bestReps !== undefined ? { bestReps } : {}),
    ...(bestLoadKg !== undefined ? { bestLoadKg } : {}),
    ...(latest?.loadKind !== undefined ? { latestLoadKind: latest.loadKind } : {}),
    ...(latestRir !== undefined ? { latestRir } : {}),
    ...(latest !== undefined ? { latestLocalDate: latest.localDate } : {}),
    trend: detectPerformanceTrend(repSeries),
    mechanisms: progressionMechanismsFor(latest?.loadKind, configuration),
  };
}

/** Reduce an observation to the compact shape stored on an evaluation. */
export function summarizeObservation(
  observation: PerformanceObservation,
): PerformanceObservationSummary {
  return {
    loadKind: observation.loadKind,
    ...(observation.loadKg !== undefined ? { loadKg: observation.loadKg } : {}),
    ...(observation.addedLoadKg !== undefined ? { addedLoadKg: observation.addedLoadKg } : {}),
    ...(observation.assistanceKg !== undefined ? { assistanceKg: observation.assistanceKg } : {}),
    ...(observation.reps !== undefined ? { reps: observation.reps } : {}),
    ...(observation.rir !== undefined ? { rir: observation.rir } : {}),
    localDate: observation.localDate,
    ...(observation.environmentKind !== undefined
      ? { environmentKind: observation.environmentKind }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Progression evaluation
// ---------------------------------------------------------------------------

export interface ProgressionTarget {
  /** Prescribed rep range; absent means the evaluator uses the goal default. */
  repMin?: number;
  repMax?: number;
  targetRir?: number;
}

export interface ProgressionEvaluationInput {
  exerciseId: string;
  exerciseName: string;
  goalProfile: TrainingGoalProfile;
  observations: readonly PerformanceObservation[];
  target?: ProgressionTarget;
  planId?: string;
  planVersionId?: string;
  slotId?: string;
  environmentKind?: TrainingEnvironmentKind;
  planIdForFingerprint?: string;
  configuration?: ProgressionLedgerConfiguration;
}

export interface ProgressionEvaluationResult {
  outcome: ProgressionEvaluationOutcome;
  recommendation: ProgressionRecommendation;
  performance: ExercisePerformanceSummary;
  current?: PerformanceObservation;
  previous?: PerformanceObservation;
  evidence: readonly string[];
  fingerprint: string;
  /** True when the outcome would ask the user to change something. */
  shouldProgress: boolean;
}

const OUTCOME_TO_ACTION: Readonly<Record<ProgressionEvaluationOutcome, ProgressionAction>> = {
  increase_load: "progress_load",
  increase_reps: "progress_reps",
  maintain: "maintain",
  repeat: "repeat",
  reduce_load: "reduce_stimulus",
  reduce_target: "modify_target",
  modify_rep_range: "modify_target",
  modify_rir_target: "modify_target",
  change_exercise: "modify_target",
  no_change: "maintain",
  insufficient_data: "hold",
};

export function actionForOutcome(outcome: ProgressionEvaluationOutcome): ProgressionAction {
  return OUTCOME_TO_ACTION[outcome];
}

/** True when accepting the outcome is a real, checkable progression. */
export function isProgressionOutcome(outcome: ProgressionEvaluationOutcome): boolean {
  return outcome === "increase_load" || outcome === "increase_reps" || outcome === "change_exercise";
}

function defaultRepRange(goalProfile: TrainingGoalProfile): { min: number; max: number } {
  switch (goalProfile) {
    case "strength":
      return { min: 3, max: 6 };
    case "athletic":
      return { min: 6, max: 10 };
    case "general_fitness":
      return { min: 10, max: 15 };
    default:
      return { min: 8, max: 12 };
  }
}

/**
 * Deterministic fingerprint. Identical inputs produce identical keys, which is
 * what makes evaluation recording idempotent.
 */
export function progressionFingerprint(input: {
  exerciseId: string;
  slotId?: string;
  planVersionId?: string;
  localDate?: CalendarDate;
  loadKind?: PerformanceLoadKind;
  loadKg?: number;
  reps?: number;
  outcome: ProgressionEvaluationOutcome;
  configVersion: string;
}): string {
  return [
    input.exerciseId,
    input.slotId ?? "-",
    input.planVersionId ?? "-",
    input.localDate ?? "-",
    input.loadKind ?? "-",
    input.loadKg === undefined ? "-" : String(input.loadKg),
    input.reps === undefined ? "-" : String(input.reps),
    input.outcome,
    input.configVersion,
  ].join("|");
}

/**
 * Evaluate progression for one exercise from its performed history.
 *
 * Order matters and is fixed:
 *   1. not enough evidence                      → insufficient_data
 *   2. repeated hard failure                     → change_exercise
 *   3. declining performance                     → reduce_load / reduce_target
 *   4. at the top of the range at target effort  → increase_load / increase_reps
 *   5. above the range with target effort        → change_exercise (harder variation)
 *   6. below the bottom of the range             → repeat
 *   7. easier than the target effort             → increase_load / increase_reps
 *   8. everything else                           → maintain
 */
export function evaluateProgressionFromHistory(
  input: ProgressionEvaluationInput,
): ProgressionEvaluationResult {
  const configuration = input.configuration ?? DEFAULT_PROGRESSION_LEDGER_CONFIGURATION;
  const ordered = sortObservations(
    input.observations.filter((item) => item.exerciseId === input.exerciseId),
  );
  const performance = summarizeExercisePerformance(
    input.exerciseId,
    ordered,
    configuration,
  );
  const goalRange = defaultRepRange(input.goalProfile);
  const repMin = input.target?.repMin ?? goalRange.min;
  const repMax = input.target?.repMax ?? goalRange.max;
  const targetRir = input.target?.targetRir ?? 2;

  const completed = ordered.filter((item) => item.completed);
  const current = ordered.at(-1);
  const previous = ordered.length > 1 ? ordered[ordered.length - 2] : undefined;
  const lastCompleted = completed.at(-1);
  const loadKind = lastCompleted?.loadKind ?? current?.loadKind;
  const mechanisms = progressionMechanismsFor(loadKind, configuration);
  const loadAvailable = mechanisms.includes("load");
  const evidence: string[] = [];

  const finish = (
    outcome: ProgressionEvaluationOutcome,
    fields: Partial<ProgressionRecommendation>,
  ): ProgressionEvaluationResult => {
    const recommendation: ProgressionRecommendation = {
      outcome,
      action: actionForOutcome(outcome),
      mechanisms,
      rationale: fields.rationale ?? "",
      evidence: fields.evidence ?? evidence,
      confidence: fields.confidence ?? configuration.partialEvidenceConfidence,
      configVersion: configuration.version,
      ...(fields.targetLoadKg !== undefined ? { targetLoadKg: fields.targetLoadKg } : {}),
      ...(fields.targetAddedLoadKg !== undefined
        ? { targetAddedLoadKg: fields.targetAddedLoadKg }
        : {}),
      ...(fields.targetRepMin !== undefined ? { targetRepMin: fields.targetRepMin } : {}),
      ...(fields.targetRepMax !== undefined ? { targetRepMax: fields.targetRepMax } : {}),
      ...(fields.targetRir !== undefined ? { targetRir: fields.targetRir } : {}),
      ...(fields.targetExerciseId !== undefined ? { targetExerciseId: fields.targetExerciseId } : {}),
    };
    const fingerprint = progressionFingerprint({
      exerciseId: input.exerciseId,
      ...(input.slotId !== undefined ? { slotId: input.slotId } : {}),
      ...(input.planVersionId !== undefined ? { planVersionId: input.planVersionId } : {}),
      ...(current?.localDate !== undefined ? { localDate: current.localDate } : {}),
      ...(loadKind !== undefined ? { loadKind } : {}),
      ...(current?.loadKg !== undefined ? { loadKg: current.loadKg } : {}),
      ...(current?.reps !== undefined ? { reps: current.reps } : {}),
      outcome,
      configVersion: configuration.version,
    });
    return {
      outcome,
      recommendation,
      performance,
      ...(current !== undefined ? { current } : {}),
      ...(previous !== undefined ? { previous } : {}),
      evidence: recommendation.evidence,
      fingerprint,
      shouldProgress: isProgressionOutcome(outcome),
    };
  };

  // 1. Evidence gate.
  if (performance.sessionsObserved < configuration.minSessionsForEvidence) {
    evidence.push(
      `Only ${performance.sessionsObserved} session(s) of evidence for ${input.exerciseName} (need ${configuration.minSessionsForEvidence}).`,
    );
    return finish("insufficient_data", {
      rationale:
        "Not enough performed sets to judge progression; repeating the current prescription is the only defensible answer.",
      confidence: 0.3,
    });
  }

  // 2. Repeated hard failure → change the exercise, not the target.
  if (performance.incompleteSessions >= configuration.failuresBeforeVariationChange) {
    evidence.push(
      `${performance.incompleteSessions} session(s) attempted without completing a working set.`,
    );
    return finish("change_exercise", {
      rationale: `Repeated failure to complete ${input.exerciseName} points at the exercise, not the number. Consider a variation that can be completed.`,
      confidence: configuration.partialEvidenceConfidence,
    });
  }

  // 3. Declining performance.
  if (performance.trend === "declining") {
    evidence.push(`Trend over ${completed.length} completed set(s) is declining.`);
    if (loadAvailable) {
      const target = lastCompleted?.loadKg;
      return finish("reduce_load", {
        rationale: `Performance on ${input.exerciseName} is declining; reduce the load before adding anything.`,
        ...(target !== undefined ? { targetLoadKg: Math.max(0, round(target * 0.9)) } : {}),
        confidence: 0.6,
      });
    }
    return finish("reduce_target", {
      rationale: `Performance on ${input.exerciseName} is declining without external load to reduce; lower the rep target rather than adding work.`,
      ...(lastCompleted?.reps !== undefined
        ? { targetRepMin: Math.max(1, lastCompleted.reps - configuration.bodyweightRepStep) }
        : {}),
      confidence: 0.5,
    });
  }

  const bestReps = lastCompleted?.reps;
  const atTop = bestReps !== undefined && bestReps >= repMax - configuration.topOfRangeTolerance;
  const effortOk =
    lastCompleted?.rir !== undefined
      ? lastCompleted.rir <= targetRir
      : true; // No RIR logged is not a reason to invent one.
  const wellAbove = bestReps !== undefined && bestReps >= repMax + configuration.bodyweightRepStep * 2;
  const belowRange = bestReps !== undefined && bestReps < repMin;

  // 4. At the top of the range with target effort, repeatedly.
  if (
    atTop &&
    effortOk &&
    performance.completedSets >= configuration.sessionsAtTopRequired &&
    !wellAbove
  ) {
    evidence.push(
      `Last completed ${bestReps} reps (range ${repMin}-${repMax}) at RIR ${lastCompleted?.rir ?? "not logged"} ≤ ${targetRir}.`,
    );
    evidence.push(`${performance.completedSets} completed working set(s) at that level.`);
    if (loadAvailable) {
      const base = lastCompleted?.loadKg ?? 0;
      return finish("increase_load", {
        rationale: `Top of the rep range reached at the target effort for ${configuration.sessionsAtTopRequired} sessions: add ${configuration.loadIncrementKg}kg and reset to the bottom of the range.`,
        targetLoadKg: round(base + configuration.loadIncrementKg),
        targetRepMin: repMin,
        targetRepMax: repMax,
        confidence: configuration.fullEvidenceConfidence,
      });
    }
    return finish("increase_reps", {
      rationale: `No external load available for ${input.exerciseName}; add ${configuration.bodyweightRepStep} reps per set instead.`,
      targetRepMin: (bestReps ?? repMax) + configuration.bodyweightRepStep,
      targetRepMax: (bestReps ?? repMax) + configuration.bodyweightRepStep + 2,
      confidence: configuration.fullEvidenceConfidence,
    });
  }

  // 5. Well above the range → harder variation (leverage / unilateral / ROM).
  if (wellAbove && effortOk) {
    evidence.push(`Last completed ${bestReps} reps, well above the ${repMax}-rep ceiling.`);
    evidence.push(`Available levers: ${mechanisms.join(", ")}.`);
    return finish("change_exercise", {
      rationale: `Reps have outgrown the prescription for ${input.exerciseName}; a harder variation (${mechanisms.filter((m) => m !== "reps" && m !== "rir").join(", ") || "leverage"}) is the next lever.`,
      confidence: 0.6,
    });
  }

  // 6. Below the bottom of the range → repeat.
  if (belowRange) {
    evidence.push(`Last completed ${bestReps} reps, below the ${repMin}-rep floor.`);
    return finish("repeat", {
      rationale: `Below the target range for ${input.exerciseName}; repeat the same prescription until it is completed in range.`,
      confidence: 0.5,
    });
  }

  // 7. Easier than the target effort → progress.
  if (atTop && lastCompleted?.rir !== undefined && lastCompleted.rir > targetRir) {
    evidence.push(
      `Last completed ${bestReps} reps at RIR ${lastCompleted.rir}, easier than the target RIR ${targetRir}.`,
    );
    if (loadAvailable) {
      const base = lastCompleted.loadKg ?? 0;
      return finish("increase_load", {
        rationale: `Effort was below target for ${input.exerciseName}; a small load increase keeps the set in the intended effort range.`,
        targetLoadKg: round(base + configuration.loadIncrementKg),
        confidence: configuration.partialEvidenceConfidence,
      });
    }
    return finish("increase_reps", {
      rationale: `Effort was below target and no load is available for ${input.exerciseName}; add reps instead.`,
      targetRepMin: (bestReps ?? repMax) + configuration.bodyweightRepStep,
      confidence: configuration.partialEvidenceConfidence,
    });
  }

  // 8. Nothing to change.
  evidence.push(
    `In-range performance for ${input.exerciseName} (best ${bestReps ?? "unknown"} reps vs ${repMin}-${repMax}).`,
  );
  return finish("maintain", {
    rationale: `${input.exerciseName} is inside its prescription; no change is the smallest useful intervention.`,
    confidence: configuration.partialEvidenceConfidence,
  });
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

// ---------------------------------------------------------------------------
// Decision → completed progression
// ---------------------------------------------------------------------------

/**
 * What actually changed, given a recommendation and the performance that
 * followed it. Absent evidence means "no change observed", never "assume yes".
 */
export function deriveActualChange(
  recommendation: ProgressionRecommendation,
  baseline: PerformanceObservationSummary | undefined,
  performed: PerformanceObservation | undefined,
): ProgressionActualChange | undefined {
  if (!performed) return undefined;

  if (recommendation.outcome === "increase_load") {
    const before = baseline?.loadKg;
    const after = performed.loadKg;
    if (after === undefined) return undefined;
    if (before === undefined) {
      return after > 0 ? { kind: "load", loadDeltaKg: after } : { kind: "none" };
    }
    const delta = after - before;
    return delta > 0 ? { kind: "load", loadDeltaKg: round(delta) } : { kind: "none" };
  }

  if (recommendation.outcome === "increase_reps") {
    const before = baseline?.reps;
    const after = performed.reps;
    if (after === undefined) return undefined;
    const delta = before === undefined ? after : after - before;
    return delta > 0 ? { kind: "reps", repsDelta: delta } : { kind: "none" };
  }

  if (recommendation.outcome === "change_exercise") {
    return {
      kind: "variation",
      ...(recommendation.targetExerciseId !== undefined
        ? { toExerciseId: recommendation.targetExerciseId }
        : {}),
    };
  }

  return { kind: "none" };
}

/**
 * A progression is COMPLETE only when:
 *   - the recommendation was accepted,
 *   - the outcome was a real progression (not maintain/repeat),
 *   - an actual change was recorded, and
 *   - the resulting performance is at least as good as the recommendation asked.
 *
 * A recommendation that was rejected, deferred, ignored or not evidenced stays
 * incomplete forever. This is the whole point of the ledger.
 */
export function isCompletedProgression(entry: ProgressionLedgerEntry): boolean {
  const { evaluation, decision, resultingPerformance, actualChange } = entry;
  if (decision !== "accepted") return false;
  if (!isProgressionOutcome(evaluation.outcome)) return false;
  if (!actualChange || actualChange.kind === "none") return false;
  if (!resultingPerformance) return false;

  if (evaluation.outcome === "increase_load") {
    const before = evaluation.current.loadKg ?? 0;
    const after = resultingPerformance.loadKg;
    if (after === undefined) return false;
    const target = evaluation.recommendation.targetLoadKg ?? before;
    // The user must have reached at least halfway to the recommended load; a
    // token 0.25kg bump is not the progression that was proposed.
    const required = before + Math.max(0, (target - before) * 0.5);
    return after > before && after + 1e-9 >= required;
  }

  if (evaluation.outcome === "increase_reps") {
    const before = evaluation.current.reps ?? 0;
    const after = resultingPerformance.reps;
    if (after === undefined) return false;
    const target = evaluation.recommendation.targetRepMin ?? before + 1;
    const required = before + Math.max(1, Math.ceil((target - before) * 0.5));
    return after > before && after >= required;
  }

  if (evaluation.outcome === "change_exercise") {
    // A variation change is evidenced by actually performing the harder
    // movement at least as well as the original.
    const after = resultingPerformance.reps;
    const before = evaluation.current.reps;
    if (after === undefined) return false;
    return before === undefined || after >= before;
  }

  return false;
}

/**
 * Count completed progressions per exercise. Order-independent and free of any
 * counter state: the same ledger always produces the same counts.
 */
export function countCompletedProgressions(
  entries: readonly ProgressionLedgerEntry[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of [...entries].sort(compareLedgerEntries)) {
    if (!isCompletedProgression(entry)) continue;
    const exerciseId = entry.evaluation.exerciseId;
    counts[exerciseId] = (counts[exerciseId] ?? 0) + 1;
  }
  return counts;
}

/** Stable ledger ordering: creation time, then evaluation id. */
export function compareLedgerEntries(a: ProgressionLedgerEntry, b: ProgressionLedgerEntry): number {
  return (
    a.evaluation.createdAt.localeCompare(b.evaluation.createdAt) ||
    a.evaluation.id.localeCompare(b.evaluation.id)
  );
}

/**
 * Assemble a ledger entry from an evaluation plus its decision events. Pure:
 * the caller supplies the rows, including their ids.
 */
export function buildLedgerEntry(
  evaluation: ProgressionEvaluation,
  events: readonly ProgressionDecisionEvent[],
): ProgressionLedgerEntry {
  const ordered = [...events].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  const relevant = ordered.filter((event) => event.decision !== "recommended");
  const latest = relevant.at(-1);
  const decidedChange = [...relevant]
    .reverse()
    .map((event) => event.actualChange)
    .find((change) => change !== undefined && change.kind !== "none");
  const evidenced = [...relevant]
    .reverse()
    .map((event) => event.resultingPerformance)
    .find((observation) => observation !== undefined);

  const entry: ProgressionLedgerEntry = {
    evaluation,
    events: ordered,
    decision: latest?.decision ?? "recommended",
    ...(decidedChange !== undefined ? { actualChange: decidedChange } : {}),
    ...(evidenced !== undefined ? { resultingPerformance: evidenced } : {}),
    completed: false,
  };
  return { ...entry, completed: isCompletedProgression(entry) };
}
