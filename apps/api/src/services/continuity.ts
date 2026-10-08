import type {
  CalendarDate,
  ExercisePerformanceSummary,
  PerformanceObservation,
  PerformanceObservationSummary,
  ProgressionActualChange,
  ProgressionDecisionKind,
  ProgressionEvaluation,
  ProgressionLedgerEntry,
  TrainingEnvironment,
  TrainingEnvironmentKind,
  TrainingEnvironmentPeriod,
} from "@fitcoach/domain";
import type {
  ExerciseKnowledgeRecord,
  PlanAggregate,
  Repositories,
  WorkoutExerciseRecord,
  WorkoutRecord,
  ExerciseSetRecord,
} from "@fitcoach/db";
import { ConstraintValidationError, NotFoundError } from "@fitcoach/db";
import {
  buildLedgerEntry,
  compareLedgerEntries,
  countCompletedProgressions,
  evaluateProgressionFromHistory,
  goalProfileFor,
  resolveTrainingEnvironment,
  sortObservations,
  summarizeExercisePerformance,
  summarizeObservation,
  toPerformanceObservation,
  type PerformanceSetInput,
  type ProgressionTarget as ProgressionTargetSpec,
} from "@fitcoach/fitness-core";
import { toKnowledge } from "./knowledge";

/**
 * Training continuity (Phase 3.1).
 *
 * The application layer for two connected capabilities:
 *
 *   A. the performance / progression ledger — what the user performed, what
 *      was recommended, what they decided, and what actually changed; and
 *   B. training environments — temporary environment periods, environment-
 *      adapted temporary plans, and restoration of the normal environment.
 *
 * All decisions are delegated to the deterministic engines in
 * `@fitcoach/fitness-core`; this service only loads rows, persists results and
 * enforces ownership. No LLM, no randomness, no clock in evaluation maths
 * (the wall clock is used only to default a read-model's `asOf` day).
 */

// ---------------------------------------------------------------------------
// Commands / results
// ---------------------------------------------------------------------------

export interface SetEnvironmentCommand {
  kind: TrainingEnvironmentKind;
  /** User-local day the environment starts (inclusive). */
  effectiveFrom: CalendarDate;
  /** User-local day it ends (exclusive). Absent = open-ended. */
  effectiveTo?: CalendarDate;
  reason?: string;
  /** Defaults to true: most environment changes are temporary (§13). */
  isTemporary?: boolean;
  availableEquipmentIds?: readonly string[];
  unavailableEquipmentIds?: readonly string[];
  notes?: string;
}

export interface SetEnvironmentResult {
  period: TrainingEnvironmentPeriod;
  environment: TrainingEnvironment;
  /** Temporary plans retired because the previous environment ended. */
  retiredPlanIds: readonly string[];
  /** True when an identical period already existed (idempotent replay). */
  replayed: boolean;
}

export interface RestoreEnvironmentResult {
  /** True only when a covering environment period was actually closed. */
  restored: boolean;
  reason: string;
  closedPeriod?: TrainingEnvironmentPeriod;
  environment: TrainingEnvironment;
  retiredPlanIds: readonly string[];
}

export interface EvaluateProgressionCommand {
  exerciseId: string;
  planId?: string;
  slotId?: string;
  /** Observation day whose environment should frame the evaluation. */
  asOf?: CalendarDate;
  /** Overrides the plan slot's prescription when given. */
  target?: ProgressionTargetSpec;
}

export interface EvaluateProgressionResult {
  /** False when nothing was persisted (no performed sets to evaluate). */
  persisted: boolean;
  reason?: string;
  evaluation?: ProgressionEvaluation;
  /** The evaluation with its decision events, ready for the UI. */
  entry?: ProgressionLedgerEntry;
}

export interface RecordProgressionDecisionCommand {
  evaluationId: string;
  decision: ProgressionDecisionKind;
  /** Idempotency key: a retry must not create a second event (§32). */
  idempotencyKey: string;
  reason?: string;
  actualChange?: ProgressionActualChange;
  resultingPerformance?: PerformanceObservationSummary;
  evidence?: readonly string[];
}

export interface RecordProgressionDecisionResult {
  event: ProgressionDecisionEventView;
  entry: ProgressionLedgerEntry;
  /** True when the idempotency key replayed an existing event. */
  replayed: boolean;
}

/** The persisted event plus its provenance for API responses. */
interface ProgressionDecisionEventView {
  id: string;
  evaluationId: string;
  decision: ProgressionDecisionKind;
  idempotencyKey?: string;
  reason?: string;
  createdAt: string;
}

export interface PerformanceHistoryQuery {
  exerciseId?: string;
  limit?: number;
}

export interface PerformanceHistoryResult {
  summaries: Record<string, ExercisePerformanceSummary>;
  /** Ordered observations (performed date, then timestamp, then id). */
  observations: readonly PerformanceObservation[];
}

export interface ContinuityQuery {
  /** Defaults to the current UTC day; pass it explicitly for reproducibility. */
  asOf?: CalendarDate;
}

export interface TemporaryPlanSummary {
  id: string;
  name: string;
  status: string;
  environmentKind?: string;
  effectiveUntil?: CalendarDate;
  temporaryForVersionId?: string;
  createdAt: string;
}

export interface TrainingContinuityHistory {
  environment: TrainingEnvironment;
  periods: readonly TrainingEnvironmentPeriod[];
  temporaryPlans: readonly TemporaryPlanSummary[];
  sessions: {
    total: number;
    completed: number;
    adapted: number;
    home: number;
    skipped: number;
    open: number;
  };
  /**
   * Deterministic: planned sessions of the active primary version minus
   * completed sessions, floored at zero — same formula as `TrainingState`.
   */
  missedSessions: number;
  completedProgressions: Record<string, number>;
  totalCompletedProgressions: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const PROGRESSION_DECISIONS: readonly ProgressionDecisionKind[] = [
  "recommended",
  "accepted",
  "rejected",
  "deferred",
];

function todayUtc(): CalendarDate {
  return new Date().toISOString().slice(0, 10);
}

/** One performed set flattened from the workout rows it lives on. */
function toSetInput(
  workout: WorkoutRecord,
  group: WorkoutExerciseRecord,
  set: ExerciseSetRecord,
): PerformanceSetInput {
  return {
    id: set.id,
    exerciseId: group.exerciseId,
    workoutId: workout.id,
    ...(workout.planVersionId ? { planVersionId: workout.planVersionId } : {}),
    ...(group.slotId ? { slotId: group.slotId } : {}),
    setKind: set.kind,
    ...(set.loadKg !== undefined ? { loadKg: set.loadKg } : {}),
    ...(set.addedLoadKg !== undefined ? { addedLoadKg: set.addedLoadKg } : {}),
    ...(set.assistanceLoadKg !== undefined ? { assistanceKg: set.assistanceLoadKg } : {}),
    ...(set.reps !== undefined ? { reps: set.reps } : {}),
    ...(set.distanceMeters !== undefined ? { distanceMeters: set.distanceMeters } : {}),
    ...(set.durationSeconds !== undefined ? { durationSeconds: set.durationSeconds } : {}),
    ...(set.rir !== undefined ? { rir: set.rir } : {}),
    ...(set.rpe !== undefined ? { rpe: set.rpe } : {}),
    ...(set.notes !== undefined ? { notes: set.notes } : {}),
    createdAt: set.createdAt,
    workoutStatus: workout.status,
    ...(workout.environmentKind ? { environmentKind: workout.environmentKind } : {}),
    ...(workout.sessionClassification
      ? { classification: workout.sessionClassification }
      : {}),
    ...(group.substitutedFromExerciseId
      ? { substitutedFromExerciseId: group.substitutedFromExerciseId }
      : {}),
    ...(group.performanceSource ? { source: group.performanceSource } : {}),
  };
}

export class TrainingContinuityService {
  constructor(private readonly repos: Repositories) {}

  // -------------------------------------------------------------------------
  // Environments (§12–§13, §21–§22)
  // -------------------------------------------------------------------------

  /** Resolve the environment in force on a day (default: gym). */
  async resolveEnvironment(userId: string, asOf: CalendarDate): Promise<TrainingEnvironment> {
    const repo = this.repos.trainingEnvironments;
    const periods = repo ? await repo.listPeriods(userId) : [];
    const rows = await this.repos.equipment.listUserEquipment(userId, asOf);
    return resolveTrainingEnvironment({
      asOf,
      periods,
      ownedEquipment: rows.map((row) => ({ id: row.equipment.id, slug: row.equipment.slug })),
    });
  }

  /** All recorded environment periods, newest first — the continuity story. */
  async listEnvironmentPeriods(userId: string): Promise<TrainingEnvironmentPeriod[]> {
    const repo = this.repos.trainingEnvironments;
    if (!repo) return [];
    return repo.listPeriods(userId);
  }

  /**
   * Record a new environment period.
   *
   * Idempotent: replaying the same kind + effectiveFrom returns the existing
   * period instead of failing the unique constraint or writing a duplicate.
   * A previous open environment is closed by the repository (the interval is
   * the history), and any active temporary plan for the old environment is
   * retired — plans are never silently reused across environments.
   */
  async setEnvironment(
    userId: string,
    command: SetEnvironmentCommand,
  ): Promise<SetEnvironmentResult> {
    const repo = this.repos.trainingEnvironments;
    if (!repo) throw new ConstraintValidationError("training environments are unavailable");

    const existing = (await repo.listPeriods(userId)).find(
      (period) =>
        period.kind === command.kind && period.effectiveFrom === command.effectiveFrom,
    );
    if (existing) {
      return {
        period: existing,
        environment: await this.resolveEnvironment(userId, command.effectiveFrom),
        retiredPlanIds: [],
        replayed: true,
      };
    }

    const period = await repo.createPeriod({ userId, ...command });
    const retiredPlanIds = await this.retireTemporaryPlans(userId);
    return {
      period,
      environment: await this.resolveEnvironment(userId, command.effectiveFrom),
      retiredPlanIds,
      replayed: false,
    };
  }

  /**
   * Restore the normal environment: close whichever period covers `asOf`
   * (open or bounded) and retire active temporary plans so the primary plan
   * resumes. A period that starts on `asOf` cannot be closed on its own start
   * day — that is reported honestly instead of being faked.
   */
  async restoreEnvironment(
    userId: string,
    command: { asOf: CalendarDate },
  ): Promise<RestoreEnvironmentResult> {
    const repo = this.repos.trainingEnvironments;
    if (!repo) throw new ConstraintValidationError("training environments are unavailable");

    const covering = await repo.findActive(userId, command.asOf);
    let closed: TrainingEnvironmentPeriod | null = null;
    let reason: string;
    if (!covering) {
      reason = `No environment period covers ${command.asOf}; the default environment already applies.`;
    } else if (covering.effectiveFrom >= command.asOf) {
      reason = `The ${covering.kind} period starting ${covering.effectiveFrom} cannot end on or before its start day; it remains in force.`;
    } else {
      closed = await repo.closePeriod(covering.id, command.asOf);
      reason = `The ${closed.kind} period ended at ${command.asOf}; the normal training environment is in force again.`;
    }

    const retiredPlanIds = await this.retireTemporaryPlans(userId);
    return {
      restored: closed !== null,
      reason,
      ...(closed ? { closedPeriod: closed } : {}),
      environment: await this.resolveEnvironment(userId, command.asOf),
      retiredPlanIds,
    };
  }

  /** Retires every active temporary environment plan; returns their ids. */
  private async retireTemporaryPlans(userId: string): Promise<string[]> {
    const retired: string[] = [];
    for (const plan of await this.repos.trainingPlans.listTemporary(userId)) {
      if (plan.status === "active") {
        await this.repos.trainingPlans.setStatus(plan.id, "retired");
        retired.push(plan.id);
      }
    }
    return retired;
  }

  // -------------------------------------------------------------------------
  // Performance history (§4–§5)
  // -------------------------------------------------------------------------

  /**
   * All performed sets for a user, flattened into ledger observations.
   * Deterministically ordered: performed date, then timestamp, then id.
   */
  private async observations(
    userId: string,
    limit: number,
    exerciseId?: string,
  ): Promise<PerformanceObservation[]> {
    const history = await this.repos.workouts.history(userId, { limit });
    const out: PerformanceObservation[] = [];
    for (const aggregate of history) {
      for (const group of aggregate.exercises) {
        if (exerciseId !== undefined && group.exerciseId !== exerciseId) continue;
        for (const set of group.sets) {
          out.push(toPerformanceObservation(toSetInput(aggregate.workout, group, set)));
        }
      }
    }
    return sortObservations(out);
  }

  /** Retrieval of performance history, with deterministic summaries (§5). */
  async performanceHistory(
    userId: string,
    query: PerformanceHistoryQuery = {},
  ): Promise<PerformanceHistoryResult> {
    const observations = await this.observations(
      userId,
      Math.min(Math.max(query.limit ?? 200, 1), 500),
      query.exerciseId,
    );
    const byExercise = new Map<string, PerformanceObservation[]>();
    for (const observation of observations) {
      const bucket = byExercise.get(observation.exerciseId) ?? [];
      bucket.push(observation);
      byExercise.set(observation.exerciseId, bucket);
    }
    const summaries: Record<string, ExercisePerformanceSummary> = {};
    for (const [id, items] of byExercise) summaries[id] = summarizeExercisePerformance(id, items);
    return { summaries, observations };
  }

  // -------------------------------------------------------------------------
  // Progression ledger (§6–§10)
  // -------------------------------------------------------------------------

  /**
   * Evaluate progression for one exercise from its performed history and
   * persist the evaluation. Idempotent on the deterministic fingerprint:
   * replaying the same evidence returns the same evaluation row.
   */
  async evaluateProgression(
    userId: string,
    command: EvaluateProgressionCommand,
  ): Promise<EvaluateProgressionResult> {
    const observations = await this.observations(userId, 200, command.exerciseId);
    if (observations.length === 0) {
      return {
        persisted: false,
        reason: `No performed sets recorded for exercise ${command.exerciseId}; there is no evidence to evaluate.`,
      };
    }

    const exerciseName = await this.exerciseName(command.exerciseId);

    // Plan linkage: explicit ids win; otherwise the active primary plan's
    // matching slot supplies the prescription (rep range / RIR target).
    let planId = command.planId;
    let planVersionId: string | undefined;
    let slotId = command.slotId;
    let target = command.target;
    const plan: PlanAggregate | null = command.planId
      ? await this.requireOwnedPlan(userId, command.planId)
      : await this.repos.trainingPlans.findActive(userId);
    const version = plan?.versions.at(-1);
    if (plan && version) {
      const slots = version.sessions.flatMap((session) => session.slots);
      const slot = slotId
        ? slots.find((item) => item.id === slotId)
        : slots.find((item) => item.exerciseId === command.exerciseId);
      planId = plan.id;
      planVersionId = version.id;
      if (slot) {
        slotId = slot.id;
        target ??= {
          ...(slot.targetRepRange
            ? { repMin: slot.targetRepRange.min, repMax: slot.targetRepRange.max }
            : {}),
          ...(slot.targetRir !== undefined ? { targetRir: slot.targetRir } : {}),
        };
      } else {
        slotId = undefined;
      }
    }

    const goal = await this.repos.goals.active(userId);
    const goalProfile = goalProfileFor({
      kind: goal?.kind ?? "general_fitness",
      priorities: goal?.priorities ?? [],
    }).profile;

    // Frame the evaluation in the environment the performance happened in.
    const currentDay = observations.at(-1)!.localDate;
    const environment = await this.resolveEnvironment(
      userId,
      command.asOf ?? currentDay,
    );

    const result = evaluateProgressionFromHistory({
      exerciseId: command.exerciseId,
      exerciseName,
      goalProfile,
      observations,
      ...(target ? { target } : {}),
      ...(planId ? { planId } : {}),
      ...(planVersionId ? { planVersionId } : {}),
      ...(slotId ? { slotId } : {}),
      environmentKind: environment.kind,
    });
    if (!result.current) {
      return { persisted: false, reason: "The evaluation produced no current observation." };
    }

    const evaluation = await this.repos.progressionLedger.recordEvaluation({
      userId,
      exerciseId: command.exerciseId,
      exerciseName,
      ...(planId ? { planId } : {}),
      ...(planVersionId ? { planVersionId } : {}),
      ...(slotId ? { slotId } : {}),
      environmentKind: environment.kind,
      outcome: result.outcome,
      currentObservation: summarizeObservation(result.current),
      ...(result.previous
        ? { previousObservation: summarizeObservation(result.previous) }
        : {}),
      performance: result.performance,
      recommendation: result.recommendation,
      evidence: result.evidence,
      fingerprint: result.fingerprint,
      configVersion: result.recommendation.configVersion,
    });

    const events = await this.repos.progressionLedger.listEvents(evaluation.id);
    return {
      persisted: true,
      evaluation,
      entry: buildLedgerEntry(evaluation, events),
    };
  }

  /**
   * Record what the user did about a recommendation: accepted, rejected or
   * deferred — optionally with the actual change and the performance that
   * resulted. Ownership-checked; idempotent on (evaluation, idempotencyKey).
   */
  async recordProgressionDecision(
    userId: string,
    command: RecordProgressionDecisionCommand,
  ): Promise<RecordProgressionDecisionResult> {
    if (!PROGRESSION_DECISIONS.includes(command.decision)) {
      throw new ConstraintValidationError(
        `decision must be one of ${PROGRESSION_DECISIONS.join(", ")}`,
      );
    }
    const evaluation = await this.repos.progressionLedger.findEvaluation(
      userId,
      command.evaluationId,
    );
    if (!evaluation) {
      // Cross-user access is never permitted (§41).
      throw new NotFoundError(`progression evaluation ${command.evaluationId} not found`);
    }

    const before = await this.repos.progressionLedger.listEvents(evaluation.id);
    const event = await this.repos.progressionLedger.recordDecisionEvent({
      evaluationId: evaluation.id,
      decision: command.decision,
      idempotencyKey: command.idempotencyKey,
      ...(command.reason !== undefined ? { reason: command.reason } : {}),
      ...(command.actualChange ? { actualChange: command.actualChange } : {}),
      ...(command.resultingPerformance
        ? { resultingPerformance: command.resultingPerformance }
        : {}),
      evidence: command.evidence ?? [],
    });
    const after = await this.repos.progressionLedger.listEvents(evaluation.id);
    const replayed =
      before.length === after.length &&
      before.some((existing) => existing.id === event.id);

    return {
      event: {
        id: event.id,
        evaluationId: event.evaluationId,
        decision: event.decision,
        ...(event.idempotencyKey ? { idempotencyKey: event.idempotencyKey } : {}),
        ...(event.reason ? { reason: event.reason } : {}),
        createdAt: event.createdAt,
      },
      entry: buildLedgerEntry(evaluation, after),
      replayed,
    };
  }

  /** The ledger read model: evaluations with their decision events. */
  async getLedger(
    userId: string,
    query: { exerciseId?: string; planId?: string; planVersionId?: string; limit?: number } = {},
  ): Promise<ProgressionLedgerEntry[]> {
    const repo = this.repos.progressionLedger;
    if (!repo) return [];
    const rows = await repo.listLedger(userId, {
      ...(query.exerciseId ? { exerciseId: query.exerciseId } : {}),
      ...(query.planId ? { planId: query.planId } : {}),
      ...(query.planVersionId ? { planVersionId: query.planVersionId } : {}),
      limit: Math.min(Math.max(query.limit ?? 100, 1), 500),
    });
    return rows
      .map((row) => buildLedgerEntry(row.evaluation, row.events))
      .sort(compareLedgerEntries);
  }

  /** Ledger entries plus the evidence-backed completion counts (§10). */
  async getLedgerView(
    userId: string,
    query: { exerciseId?: string; planId?: string; planVersionId?: string; limit?: number } = {},
  ): Promise<{
    entries: ProgressionLedgerEntry[];
    completedProgressions: Record<string, number>;
    totalCompletedProgressions: number;
  }> {
    const entries = await this.getLedger(userId, query);
    const completedProgressions = countCompletedProgressions(entries);
    const totalCompletedProgressions = Object.values(completedProgressions).reduce(
      (sum, count) => sum + count,
      0,
    );
    return { entries, completedProgressions, totalCompletedProgressions };
  }

  // -------------------------------------------------------------------------
  // Continuity read model (§22–§24, §28)
  // -------------------------------------------------------------------------

  /**
   * Everything the future Unified FitCoach Mind needs to understand the
   * difference between "the user failed their program" and "the user's
   * environment changed and FitCoach adapted" (§28).
   */
  async continuity(
    userId: string,
    query: ContinuityQuery = {},
  ): Promise<TrainingContinuityHistory> {
    const asOf = query.asOf ?? todayUtc();
    const environment = await this.resolveEnvironment(userId, asOf);
    const periods = await this.listEnvironmentPeriods(userId);

    const temporaryPlans: TemporaryPlanSummary[] = (
      await this.repos.trainingPlans.listTemporary(userId)
    ).map((plan) => ({
      id: plan.id,
      name: plan.name,
      status: plan.status,
      ...(plan.environmentKind ? { environmentKind: plan.environmentKind } : {}),
      ...(plan.effectiveUntil ? { effectiveUntil: plan.effectiveUntil } : {}),
      ...(plan.temporaryForVersionId
        ? { temporaryForVersionId: plan.temporaryForVersionId }
        : {}),
      createdAt: plan.createdAt,
    }));

    const workouts = await this.repos.workouts.history(userId, { limit: 100 });
    const completed = workouts.filter(
      (aggregate) =>
        aggregate.workout.status === "completed" || aggregate.workout.status === "partial",
    );
    const sessions = {
      total: workouts.length,
      completed: completed.length,
      adapted: completed.filter(
        (aggregate) => aggregate.workout.sessionClassification === "adapted",
      ).length,
      home: completed.filter(
        (aggregate) =>
          aggregate.workout.environmentKind !== undefined &&
          aggregate.workout.environmentKind !== "gym",
      ).length,
      skipped: workouts.filter((aggregate) => aggregate.workout.status === "skipped")
        .length,
      open: workouts.filter(
        (aggregate) =>
          aggregate.workout.status === "planned" ||
          aggregate.workout.status === "in_progress",
      ).length,
    };

    const activePlan = await this.repos.trainingPlans.findActive(userId);
    const plannedSessions = activePlan?.versions.at(-1)?.sessions.length ?? 0;
    const missedSessions = Math.max(0, plannedSessions - completed.length);

    const ledger = await this.getLedger(userId, { limit: 200 });
    const completedProgressions = countCompletedProgressions(ledger);
    const totalCompletedProgressions = Object.values(completedProgressions).reduce(
      (sum, count) => sum + count,
      0,
    );

    return {
      environment,
      periods,
      temporaryPlans,
      sessions,
      missedSessions,
      completedProgressions,
      totalCompletedProgressions,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async requireOwnedPlan(userId: string, planId: string): Promise<PlanAggregate> {
    const plan = await this.repos.trainingPlans.findById(planId);
    if (!plan || plan.userId !== userId) {
      throw new NotFoundError(`training plan ${planId} not found`);
    }
    return plan;
  }

  private async exerciseName(exerciseId: string): Promise<string> {
    const records: ExerciseKnowledgeRecord[] = await this.repos.exercises.listExerciseKnowledge();
    const record = records.find((item) => item.id === exerciseId);
    return record ? toKnowledge(record).name : exerciseId;
  }
}
