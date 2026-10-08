import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  ExercisePerformanceSummary,
  PerformanceObservationSummary,
  ProgressionActualChange,
  ProgressionDecisionEvent,
  ProgressionDecisionKind,
  ProgressionEvaluation,
  ProgressionEvaluationOutcome,
  ProgressionRecommendation,
  TrainingEnvironmentKind,
} from "@fitcoach/domain";
import { NotFoundError } from "../errors";
import { newUuidv7 } from "../ids";
import { toTimestamp } from "../mapping";
import { boundedLimit, runDb } from "./util";

/**
 * Progression ledger (Phase 3.1 §9–§10).
 *
 * Two append-only tables:
 *
 *   progression_evaluations     — what was evaluated, from what evidence, and
 *                                 the deterministic recommendation produced.
 *   progression_decision_events — what the user did about it (accepted /
 *                                 rejected / deferred) and, later, what the
 *                                 performance actually was.
 *
 * Neither table has an update path. A changed mind is a new event row; that is
 * precisely what makes "recommended", "accepted" and "actually performed"
 * distinguishable forever, and what makes `progressionsCompleted` a real count
 * rather than a counter someone increments.
 */

export interface RecordEvaluationInput {
  id?: string;
  userId: string;
  exerciseId: string;
  exerciseName: string;
  planId?: string;
  planVersionId?: string;
  slotId?: string;
  environmentKind?: TrainingEnvironmentKind;
  outcome: ProgressionEvaluationOutcome;
  currentObservation: PerformanceObservationSummary;
  previousObservation?: PerformanceObservationSummary;
  performance: ExercisePerformanceSummary;
  recommendation: ProgressionRecommendation;
  evidence?: readonly string[];
  /** Deterministic dedupe key; identical inputs produce the same key. */
  fingerprint: string;
  configVersion: string;
}

export interface RecordDecisionEventInput {
  id?: string;
  evaluationId: string;
  decision: ProgressionDecisionKind;
  reason?: string;
  /** Submission idempotency key; a retry does not create a second event. */
  idempotencyKey?: string;
  actualChange?: ProgressionActualChange;
  resultingPerformance?: PerformanceObservationSummary;
  evidence?: readonly string[];
}

export interface ProgressionLedgerQuery {
  exerciseId?: string;
  planId?: string;
  planVersionId?: string;
  limit?: number;
}

/** An evaluation with its (append-only) events, oldest event first. */
export interface ProgressionLedgerRow {
  evaluation: ProgressionEvaluation;
  events: ProgressionDecisionEvent[];
}

export interface ProgressionLedgerRepository {
  /** Idempotent on (userId, fingerprint): replays return the existing row. */
  recordEvaluation(input: RecordEvaluationInput): Promise<ProgressionEvaluation>;
  findEvaluation(userId: string, evaluationId: string): Promise<ProgressionEvaluation | null>;
  listEvaluations(userId: string, query?: ProgressionLedgerQuery): Promise<ProgressionEvaluation[]>;
  /** Idempotent on (evaluationId, idempotencyKey). */
  recordDecisionEvent(input: RecordDecisionEventInput): Promise<ProgressionDecisionEvent>;
  listEvents(evaluationId: string): Promise<ProgressionDecisionEvent[]>;
  /** Evaluations with their events, newest first — one query, no N+1. */
  listLedger(userId: string, query?: ProgressionLedgerQuery): Promise<ProgressionLedgerRow[]>;
  /** Latest events for several evaluations at once (bounded by the caller). */
  findLastEvent(evaluationId: string): Promise<ProgressionDecisionEvent | null>;
}

interface EvaluationRow {
  id: string;
  userId: string;
  exerciseId: string;
  exerciseName: string;
  planId: string | null;
  planVersionId: string | null;
  slotId: string | null;
  environmentKind: string | null;
  outcome: string;
  currentObservation: Prisma.JsonValue;
  previousObservation: Prisma.JsonValue | null;
  performance: Prisma.JsonValue;
  recommendation: Prisma.JsonValue;
  evidence: string[];
  fingerprint: string;
  configVersion: string;
  createdAt: Date;
}

interface EventRow {
  id: string;
  evaluationId: string;
  decision: string;
  reason: string | null;
  idempotencyKey: string | null;
  actualChange: Prisma.JsonValue | null;
  resultingPerformance: Prisma.JsonValue | null;
  evidence: string[];
  createdAt: Date;
}

function evaluationRowToRecord(row: EvaluationRow): ProgressionEvaluation {
  return {
    id: row.id,
    userId: row.userId,
    exerciseId: row.exerciseId,
    exerciseName: row.exerciseName,
    ...(row.planId ? { planId: row.planId } : {}),
    ...(row.planVersionId ? { planVersionId: row.planVersionId } : {}),
    ...(row.slotId ? { slotId: row.slotId } : {}),
    ...(row.environmentKind
      ? { environmentKind: row.environmentKind as TrainingEnvironmentKind }
      : {}),
    current: row.currentObservation as unknown as PerformanceObservationSummary,
    ...(row.previousObservation
      ? { previous: row.previousObservation as unknown as PerformanceObservationSummary }
      : {}),
    performance: row.performance as unknown as ExercisePerformanceSummary,
    outcome: row.outcome as ProgressionEvaluationOutcome,
    recommendation: row.recommendation as unknown as ProgressionRecommendation,
    evidence: [...row.evidence],
    fingerprint: row.fingerprint,
    configVersion: row.configVersion,
    createdAt: toTimestamp(row.createdAt),
  };
}

function eventRowToRecord(row: EventRow): ProgressionDecisionEvent {
  return {
    id: row.id,
    evaluationId: row.evaluationId,
    ...(row.idempotencyKey ? { idempotencyKey: row.idempotencyKey } : {}),
    decision: row.decision as ProgressionDecisionKind,
    ...(row.reason ? { reason: row.reason } : {}),
    ...(row.actualChange
      ? { actualChange: row.actualChange as unknown as ProgressionActualChange }
      : {}),
    ...(row.resultingPerformance
      ? {
          resultingPerformance:
            row.resultingPerformance as unknown as PerformanceObservationSummary,
        }
      : {}),
    evidence: [...row.evidence],
    createdAt: toTimestamp(row.createdAt),
  };
}

export class PrismaProgressionLedgerRepository implements ProgressionLedgerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async findByFingerprint(
    userId: string,
    fingerprint: string,
  ): Promise<ProgressionEvaluation | null> {
    const row = await this.prisma.progressionEvaluation.findFirst({
      where: { userId, fingerprint },
    });
    return row ? evaluationRowToRecord(row as EvaluationRow) : null;
  }

  async recordEvaluation(input: RecordEvaluationInput): Promise<ProgressionEvaluation> {
    const id = input.id ?? newUuidv7();
    return runDb(async () => {
      const existing = await this.findByFingerprint(input.userId, input.fingerprint);
      if (existing) return existing;

      try {
        const row = await this.prisma.progressionEvaluation.create({
          data: {
            id,
            userId: input.userId,
            exerciseId: input.exerciseId,
            exerciseName: input.exerciseName,
            planId: input.planId ?? null,
            planVersionId: input.planVersionId ?? null,
            slotId: input.slotId ?? null,
            environmentKind: input.environmentKind ?? null,
            outcome: input.outcome,
            currentObservation: input.currentObservation as unknown as Prisma.InputJsonValue,
            previousObservation: (input.previousObservation ?? undefined) as
              | Prisma.InputJsonValue
              | undefined,
            performance: input.performance as unknown as Prisma.InputJsonValue,
            recommendation: input.recommendation as unknown as Prisma.InputJsonValue,
            evidence: [...(input.evidence ?? [])],
            fingerprint: input.fingerprint,
            configVersion: input.configVersion,
          },
        });
        return evaluationRowToRecord(row as EvaluationRow);
      } catch (error) {
        // Lost idempotency race: another request wrote the same fingerprint.
        if (
          typeof error === "object" &&
          error !== null &&
          (error as { code?: string }).code === "P2002"
        ) {
          const existing = await this.findByFingerprint(input.userId, input.fingerprint);
          if (existing) return existing;
        }
        throw error;
      }
    });
  }

  async findEvaluation(
    userId: string,
    evaluationId: string,
  ): Promise<ProgressionEvaluation | null> {
    return runDb(async () => {
      const row = await this.prisma.progressionEvaluation.findUnique({
        where: { id: evaluationId },
      });
      if (!row) return null;
      const record = evaluationRowToRecord(row as EvaluationRow);
      // Ownership is part of the read model: a mismatched user sees nothing.
      return record.userId === userId ? record : null;
    });
  }

  async listEvaluations(
    userId: string,
    query: ProgressionLedgerQuery = {},
  ): Promise<ProgressionEvaluation[]> {
    return runDb(async () => {
      const rows = await this.prisma.progressionEvaluation.findMany({
        where: {
          userId,
          ...(query.exerciseId ? { exerciseId: query.exerciseId } : {}),
          ...(query.planId ? { planId: query.planId } : {}),
          ...(query.planVersionId ? { planVersionId: query.planVersionId } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: boundedLimit(query.limit, 100),
      });
      return rows.map((row) => evaluationRowToRecord(row as EvaluationRow));
    });
  }

  async recordDecisionEvent(input: RecordDecisionEventInput): Promise<ProgressionDecisionEvent> {
    const id = input.id ?? newUuidv7();
    return runDb(async () => {
      const evaluation = await this.prisma.progressionEvaluation.findUnique({
        where: { id: input.evaluationId },
        select: { id: true },
      });
      if (!evaluation) {
        throw new NotFoundError(`progression evaluation ${input.evaluationId} not found`);
      }

      if (input.idempotencyKey) {
        const existing = await this.prisma.progressionDecisionEvent.findFirst({
          where: { evaluationId: input.evaluationId, idempotencyKey: input.idempotencyKey },
        });
        if (existing) return eventRowToRecord(existing as EventRow);
      }

      try {
        const row = await this.prisma.progressionDecisionEvent.create({
          data: {
            id,
            evaluationId: input.evaluationId,
            decision: input.decision,
            reason: input.reason ?? null,
            idempotencyKey: input.idempotencyKey ?? null,
            actualChange: (input.actualChange ?? undefined) as Prisma.InputJsonValue | undefined,
            resultingPerformance: (input.resultingPerformance ?? undefined) as
              | Prisma.InputJsonValue
              | undefined,
            evidence: [...(input.evidence ?? [])],
          },
        });
        return eventRowToRecord(row as EventRow);
      } catch (error) {
        if (
          input.idempotencyKey &&
          typeof error === "object" &&
          error !== null &&
          (error as { code?: string }).code === "P2002"
        ) {
          const existing = await this.prisma.progressionDecisionEvent.findFirst({
            where: { evaluationId: input.evaluationId, idempotencyKey: input.idempotencyKey },
          });
          if (existing) return eventRowToRecord(existing as EventRow);
        }
        throw error;
      }
    });
  }

  async listEvents(evaluationId: string): Promise<ProgressionDecisionEvent[]> {
    return runDb(async () => {
      const rows = await this.prisma.progressionDecisionEvent.findMany({
        where: { evaluationId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return rows.map((row) => eventRowToRecord(row as EventRow));
    });
  }

  async findLastEvent(evaluationId: string): Promise<ProgressionDecisionEvent | null> {
    return runDb(async () => {
      const row = await this.prisma.progressionDecisionEvent.findFirst({
        where: { evaluationId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      return row ? eventRowToRecord(row as EventRow) : null;
    });
  }

  async listLedger(
    userId: string,
    query: ProgressionLedgerQuery = {},
  ): Promise<ProgressionLedgerRow[]> {
    return runDb(async () => {
      const rows = await this.prisma.progressionEvaluation.findMany({
        where: {
          userId,
          ...(query.exerciseId ? { exerciseId: query.exerciseId } : {}),
          ...(query.planId ? { planId: query.planId } : {}),
          ...(query.planVersionId ? { planVersionId: query.planVersionId } : {}),
        },
        include: {
          events: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: boundedLimit(query.limit, 100),
      });
      return rows.map((row) => ({
        evaluation: evaluationRowToRecord(row as EvaluationRow),
        events: (row.events as EventRow[]).map(eventRowToRecord),
      }));
    });
  }
}
