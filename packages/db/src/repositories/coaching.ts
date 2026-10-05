import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  CalendarDate,
  DiagnosisId,
  DiagnosisStatus,
  Evidence,
  InterventionId,
  InterventionKind,
  InterventionParameters,
  InterventionStatus,
  OutcomeVerdict,
  RecommendationId,
  RecommendationStatus,
  Severity,
  Timestamp,
} from "@fitcoach/domain";
import { ConflictError, ConstraintValidationError, NotFoundError } from "../errors";
import { newUuidv7 } from "../ids";
import { decimalToNumber, toCalendarDate, toTimestamp } from "../mapping";
import { boundedLimit, runDb } from "./util";

// ---------------------------------------------------------------------------
// Evidence rows (immutable children of diagnoses and recommendations)
// ---------------------------------------------------------------------------

export interface EvidenceInput {
  id?: string;
  metric: string;
  window: string;
  observed: string;
  observedNumeric?: number;
  expected?: string;
}

export interface EvidenceRecord extends Evidence {
  id: string;
  observedNumeric?: number;
  position: number;
  createdAt: string;
}

interface EvidenceRow {
  id: string;
  metric: string;
  window: string;
  observed: string;
  observedNumeric: unknown;
  expected: string | null;
  position: number;
  createdAt: Date;
}

function evidenceRowToRecord(row: EvidenceRow): EvidenceRecord {
  return {
    id: row.id,
    metric: row.metric,
    window: row.window,
    observed: row.observed,
    observedNumeric: decimalToNumber(row.observedNumeric),
    expected: row.expected ?? undefined,
    position: row.position,
    createdAt: toTimestamp(row.createdAt),
  };
}

function evidenceCore(
  item: EvidenceInput,
  position: number,
): {
  id: string;
  position: number;
  metric: string;
  window: string;
  observed: string;
  observedNumeric: number | null;
  expected: string | null;
} {
  return {
    id: item.id ?? newUuidv7(),
    position,
    metric: item.metric,
    window: item.window,
    observed: item.observed,
    observedNumeric: item.observedNumeric ?? null,
    expected: item.expected ?? null,
  };
}

// ---------------------------------------------------------------------------
// Diagnoses
// ---------------------------------------------------------------------------

interface DiagnosisRow {
  id: string;
  userId: string;
  activeGoalId: string | null;
  activePlanVersionId: string | null;
  code: string;
  title: string;
  summary: string;
  severity: string;
  status: string;
  analysisWindowDays: number | null;
  contextSnapshot: unknown;
  contributingFactors: string[];
  ruledOut: string[];
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DiagnosisRecord {
  id: DiagnosisId;
  userId: string;
  activeGoalId?: string;
  activePlanVersionId?: string;
  code: string;
  title: string;
  summary: string;
  severity: Severity;
  status: DiagnosisStatus;
  analysisWindowDays?: number;
  contextSnapshot?: Record<string, unknown>;
  contributingFactors: string[];
  ruledOut: string[];
  evidence: EvidenceRecord[];
  resolvedAt?: Timestamp;
  createdAt: string;
  updatedAt: string;
}

interface DiagnosisWithEvidence extends DiagnosisRow {
  evidence: EvidenceRow[];
}

function diagnosisRowToRecord(row: DiagnosisWithEvidence): DiagnosisRecord {
  return {
    id: row.id,
    userId: row.userId,
    activeGoalId: row.activeGoalId ?? undefined,
    activePlanVersionId: row.activePlanVersionId ?? undefined,
    code: row.code,
    title: row.title,
    summary: row.summary,
    severity: row.severity as Severity,
    status: row.status as DiagnosisStatus,
    analysisWindowDays: row.analysisWindowDays ?? undefined,
    contextSnapshot:
      row.contextSnapshot && typeof row.contextSnapshot === "object"
        ? (row.contextSnapshot as Record<string, unknown>)
        : undefined,
    contributingFactors: row.contributingFactors ?? [],
    ruledOut: row.ruledOut ?? [],
    evidence: row.evidence
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(evidenceRowToRecord),
    resolvedAt: row.resolvedAt ? toTimestamp(row.resolvedAt) : undefined,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

export interface CreateDiagnosisInput {
  id?: string;
  userId: string;
  /** Which goal was active when this conclusion was reached (§5 S3). */
  activeGoalId?: string;
  activePlanVersionId?: string;
  code: string;
  title: string;
  summary: string;
  severity: Severity;
  status?: DiagnosisStatus;
  analysisWindowDays?: number;
  contextSnapshot?: Record<string, unknown>;
  contributingFactors?: readonly string[];
  ruledOut?: readonly string[];
  evidence?: readonly EvidenceInput[];
}

export interface DiagnosisRepository {
  create(input: CreateDiagnosisInput): Promise<DiagnosisRecord>;
  /** Appends more immutable evidence rows to an existing diagnosis. */
  attachEvidence(diagnosisId: DiagnosisId, evidence: readonly EvidenceInput[]): Promise<DiagnosisRecord>;
  /** Lifecycle transition only (status/resolved_at) — content is frozen. */
  updateStatus(id: DiagnosisId, status: DiagnosisStatus, resolvedAt?: Timestamp): Promise<DiagnosisRecord>;
  findById(id: DiagnosisId): Promise<DiagnosisRecord | null>;
  list(userId: string, options?: { status?: DiagnosisStatus; limit?: number }): Promise<DiagnosisRecord[]>;
}

const DIAGNOSIS_INCLUDE = {
  evidence: { orderBy: { position: "asc" as const } },
} as const;

export class PrismaDiagnosisRepository implements DiagnosisRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async assertRefs(
    input: { activeGoalId?: string; activePlanVersionId?: string },
  ): Promise<void> {
    if (input.activeGoalId) {
      const goal = await this.prisma.goal.findUnique({
        where: { id: input.activeGoalId },
        select: { id: true },
      });
      if (!goal) throw new NotFoundError(`goal ${input.activeGoalId} not found`);
    }
    if (input.activePlanVersionId) {
      const version = await this.prisma.trainingPlanVersion.findUnique({
        where: { id: input.activePlanVersionId },
        select: { id: true },
      });
      if (!version) throw new NotFoundError(`plan version ${input.activePlanVersionId} not found`);
    }
  }

  private async load(id: string): Promise<DiagnosisRecord | null> {
    const row = await this.prisma.diagnosis.findUnique({
      where: { id },
      include: DIAGNOSIS_INCLUDE,
    });
    return row ? diagnosisRowToRecord(row) : null;
  }

  async create(input: CreateDiagnosisInput): Promise<DiagnosisRecord> {
    const id = input.id ?? newUuidv7();
    await this.assertRefs(input);
    return runDb(async () => {
      await this.prisma.diagnosis.create({
        data: {
          id,
          userId: input.userId,
          activeGoalId: input.activeGoalId ?? null,
          activePlanVersionId: input.activePlanVersionId ?? null,
          code: input.code,
          title: input.title,
          summary: input.summary,
          severity: input.severity,
          status: input.status ?? "open",
          analysisWindowDays: input.analysisWindowDays ?? null,
          contextSnapshot: (input.contextSnapshot ?? undefined) as Prisma.InputJsonValue | undefined,
          contributingFactors: [...(input.contributingFactors ?? [])],
          ruledOut: [...(input.ruledOut ?? [])],
          ...(input.evidence && input.evidence.length > 0
            ? {
                evidence: {
                  create: input.evidence.map((item, index) => evidenceCore(item, index)),
                },
              }
            : {}),
        },
      });
      const created = await this.load(id);
      if (!created) throw new NotFoundError("diagnosis disappeared after create");
      return created;
    });
  }

  async attachEvidence(
    diagnosisId: DiagnosisId,
    evidence: readonly EvidenceInput[],
  ): Promise<DiagnosisRecord> {
    if (evidence.length === 0) {
      throw new ConstraintValidationError("at least one evidence row is required");
    }
    return runDb(async () => {
      return this.prisma.$transaction(async (tx) => {
        const diagnosis = await tx.diagnosis.findUnique({
          where: { id: diagnosisId },
          include: { evidence: { select: { position: true } } },
        });
        if (!diagnosis) throw new NotFoundError(`diagnosis ${diagnosisId} not found`);
        const offset = diagnosis.evidence.reduce((max, row) => Math.max(max, row.position), -1) + 1;
        await tx.diagnosisEvidence.createMany({
          data: evidence.map((item, index) => ({
            diagnosisId,
            ...evidenceCore(item, offset + index),
          })),
        });
        const full = await tx.diagnosis.findUnique({
          where: { id: diagnosisId },
          include: DIAGNOSIS_INCLUDE,
        });
        if (!full) throw new NotFoundError(`diagnosis ${diagnosisId} not found`);
        return diagnosisRowToRecord(full);
      });
    });
  }

  async updateStatus(
    id: DiagnosisId,
    status: DiagnosisStatus,
    resolvedAt?: Timestamp,
  ): Promise<DiagnosisRecord> {
    return runDb(async () => {
      await this.prisma.diagnosis.update({
        where: { id },
        data: {
          status,
          resolvedAt: resolvedAt ? new Date(resolvedAt) : status === "resolved" ? new Date() : undefined,
        },
      });
      const updated = await this.load(id);
      if (!updated) throw new NotFoundError(`diagnosis ${id} not found`);
      return updated;
    });
  }

  async findById(id: DiagnosisId): Promise<DiagnosisRecord | null> {
    return runDb(() => this.load(id));
  }

  async list(
    userId: string,
    options: { status?: DiagnosisStatus; limit?: number } = {},
  ): Promise<DiagnosisRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.diagnosis.findMany({
        where: { userId, ...(options.status ? { status: options.status } : {}) },
        include: DIAGNOSIS_INCLUDE,
        orderBy: { createdAt: "desc" },
        take: boundedLimit(options.limit, 50),
      });
      return rows.map(diagnosisRowToRecord);
    });
  }
}

// ---------------------------------------------------------------------------
// Recommendations (evidence is a deliberate copy — §11)
// ---------------------------------------------------------------------------

interface RecommendationRow {
  id: string;
  userId: string;
  diagnosisId: string | null;
  interventionId: string | null;
  headline: string;
  explanation: string;
  alternativesConsidered: string[];
  presentedAt: Date;
  status: string;
  acknowledgedAt: Date | null;
  dismissedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecommendationRecord {
  id: RecommendationId;
  userId: string;
  diagnosisId?: DiagnosisId;
  interventionId?: InterventionId;
  headline: string;
  explanation: string;
  evidence: EvidenceRecord[];
  alternativesConsidered: string[];
  presentedAt: Timestamp;
  status: RecommendationStatus;
  acknowledgedAt?: Timestamp;
  dismissedAt?: Timestamp;
  createdAt: string;
  updatedAt: string;
}

interface RecommendationWithEvidence extends RecommendationRow {
  evidence: EvidenceRow[];
}

function recommendationRowToRecord(row: RecommendationWithEvidence): RecommendationRecord {
  return {
    id: row.id,
    userId: row.userId,
    diagnosisId: row.diagnosisId ?? undefined,
    interventionId: row.interventionId ?? undefined,
    headline: row.headline,
    explanation: row.explanation,
    evidence: row.evidence
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(evidenceRowToRecord),
    alternativesConsidered: row.alternativesConsidered ?? [],
    presentedAt: toTimestamp(row.presentedAt),
    status: row.status as RecommendationStatus,
    acknowledgedAt: row.acknowledgedAt ? toTimestamp(row.acknowledgedAt) : undefined,
    dismissedAt: row.dismissedAt ? toTimestamp(row.dismissedAt) : undefined,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

export interface CreateRecommendationInput {
  id?: string;
  userId: string;
  diagnosisId?: DiagnosisId;
  interventionId?: InterventionId;
  headline: string;
  explanation: string;
  /** Evidence as presented to the user — copied, never linked. */
  evidence?: readonly EvidenceInput[];
  alternativesConsidered?: readonly string[];
  presentedAt?: Timestamp;
  status?: RecommendationStatus;
}

export interface RecommendationRepository {
  create(input: CreateRecommendationInput): Promise<RecommendationRecord>;
  updateStatus(
    id: RecommendationId,
    status: RecommendationStatus,
    timestamps?: { acknowledgedAt?: Timestamp; dismissedAt?: Timestamp },
  ): Promise<RecommendationRecord>;
  findById(id: RecommendationId): Promise<RecommendationRecord | null>;
  list(userId: string, options?: { limit?: number }): Promise<RecommendationRecord[]>;
}

const RECOMMENDATION_INCLUDE = {
  evidence: { orderBy: { position: "asc" as const } },
} as const;

export class PrismaRecommendationRepository implements RecommendationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async load(id: string): Promise<RecommendationRecord | null> {
    const row = await this.prisma.recommendation.findUnique({
      where: { id },
      include: RECOMMENDATION_INCLUDE,
    });
    return row ? recommendationRowToRecord(row) : null;
  }

  async create(input: CreateRecommendationInput): Promise<RecommendationRecord> {
    const id = input.id ?? newUuidv7();
    return runDb(async () => {
      if (input.diagnosisId) {
        const diagnosis = await this.prisma.diagnosis.findUnique({
          where: { id: input.diagnosisId },
          select: { id: true },
        });
        if (!diagnosis) throw new NotFoundError(`diagnosis ${input.diagnosisId} not found`);
      }
      if (input.interventionId) {
        const intervention = await this.prisma.intervention.findUnique({
          where: { id: input.interventionId },
          select: { id: true },
        });
        if (!intervention) throw new NotFoundError(`intervention ${input.interventionId} not found`);
      }

      await this.prisma.recommendation.create({
        data: {
          id,
          userId: input.userId,
          diagnosisId: input.diagnosisId ?? null,
          interventionId: input.interventionId ?? null,
          headline: input.headline,
          explanation: input.explanation,
          alternativesConsidered: [...(input.alternativesConsidered ?? [])],
          ...(input.presentedAt ? { presentedAt: new Date(input.presentedAt) } : {}),
          status: input.status ?? "presented",
          ...(input.evidence && input.evidence.length > 0
            ? {
                evidence: {
                  create: input.evidence.map((item, index) => evidenceCore(item, index)),
                },
              }
            : {}),
        },
      });
      const created = await this.load(id);
      if (!created) throw new NotFoundError("recommendation disappeared after create");
      return created;
    });
  }

  async updateStatus(
    id: RecommendationId,
    status: RecommendationStatus,
    timestamps: { acknowledgedAt?: Timestamp; dismissedAt?: Timestamp } = {},
  ): Promise<RecommendationRecord> {
    return runDb(async () => {
      await this.prisma.recommendation.update({
        where: { id },
        data: {
          status,
          ...(timestamps.acknowledgedAt ? { acknowledgedAt: new Date(timestamps.acknowledgedAt) } : {}),
          ...(timestamps.dismissedAt ? { dismissedAt: new Date(timestamps.dismissedAt) } : {}),
        },
      });
      const updated = await this.load(id);
      if (!updated) throw new NotFoundError(`recommendation ${id} not found`);
      return updated;
    });
  }

  async findById(id: RecommendationId): Promise<RecommendationRecord | null> {
    return runDb(() => this.load(id));
  }

  async list(userId: string, options: { limit?: number } = {}): Promise<RecommendationRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.recommendation.findMany({
        where: { userId },
        include: RECOMMENDATION_INCLUDE,
        orderBy: { presentedAt: "desc" },
        take: boundedLimit(options.limit, 50),
      });
      return rows.map(recommendationRowToRecord);
    });
  }
}

// ---------------------------------------------------------------------------
// Interventions + outcomes (§12: 'no_change' is first-class)
// ---------------------------------------------------------------------------

interface InterventionRow {
  id: string;
  userId: string;
  diagnosisId: string | null;
  supersededByInterventionId: string | null;
  activeGoalId: string | null;
  activePlanVersionId: string | null;
  kind: string;
  parameters: unknown;
  rationale: string;
  expectedEffect: string;
  reviewOn: Date | null;
  status: string;
  acceptedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InterventionRecord {
  id: InterventionId;
  userId: string;
  diagnosisId?: DiagnosisId;
  supersededByInterventionId?: InterventionId;
  activeGoalId?: string;
  activePlanVersionId?: string;
  kind: InterventionKind;
  parameters: InterventionParameters;
  rationale: string;
  expectedEffect: string;
  reviewOn?: CalendarDate;
  status: InterventionStatus;
  acceptedAt?: Timestamp;
  completedAt?: Timestamp;
  createdAt: string;
  updatedAt: string;
}

function interventionRowToRecord(row: InterventionRow): InterventionRecord {
  return {
    id: row.id,
    userId: row.userId,
    diagnosisId: row.diagnosisId ?? undefined,
    supersededByInterventionId: row.supersededByInterventionId ?? undefined,
    activeGoalId: row.activeGoalId ?? undefined,
    activePlanVersionId: row.activePlanVersionId ?? undefined,
    kind: row.kind as InterventionKind,
    parameters: (row.parameters ?? {}) as InterventionParameters,
    rationale: row.rationale,
    expectedEffect: row.expectedEffect,
    reviewOn: row.reviewOn ? toCalendarDate(row.reviewOn) : undefined,
    status: row.status as InterventionStatus,
    acceptedAt: row.acceptedAt ? toTimestamp(row.acceptedAt) : undefined,
    completedAt: row.completedAt ? toTimestamp(row.completedAt) : undefined,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

interface OutcomeRow {
  id: string;
  interventionId: string;
  followUpDiagnosisId: string | null;
  evaluatedAt: Date;
  evaluationWindow: string;
  verdict: string;
  observations: string[];
  explanation: string;
  createdAt: Date;
}

export interface InterventionOutcomeRecord {
  id: string;
  interventionId: InterventionId;
  followUpDiagnosisId?: DiagnosisId;
  evaluatedAt: Timestamp;
  evaluationWindow: string;
  verdict: OutcomeVerdict;
  observations: string[];
  explanation: string;
  createdAt: string;
}

function outcomeRowToRecord(row: OutcomeRow): InterventionOutcomeRecord {
  return {
    id: row.id,
    interventionId: row.interventionId,
    followUpDiagnosisId: row.followUpDiagnosisId ?? undefined,
    evaluatedAt: toTimestamp(row.evaluatedAt),
    evaluationWindow: row.evaluationWindow,
    verdict: row.verdict as OutcomeVerdict,
    observations: row.observations ?? [],
    explanation: row.explanation,
    createdAt: toTimestamp(row.createdAt),
  };
}

export interface CreateInterventionInput {
  id?: string;
  userId: string;
  diagnosisId?: DiagnosisId;
  activeGoalId?: string;
  activePlanVersionId?: string;
  kind: InterventionKind;
  parameters?: InterventionParameters;
  rationale: string;
  expectedEffect: string;
  reviewOn?: CalendarDate;
  status?: InterventionStatus;
}

export interface RecordOutcomeInput {
  id?: string;
  interventionId: InterventionId;
  evaluatedAt?: Timestamp;
  evaluationWindow: string;
  verdict: OutcomeVerdict;
  observations?: readonly string[];
  explanation: string;
  followUpDiagnosisId?: DiagnosisId;
}

export interface InterventionRepository {
  create(input: CreateInterventionInput): Promise<InterventionRecord>;
  updateStatus(id: InterventionId, status: InterventionStatus): Promise<InterventionRecord>;
  /** Chains replacement: old becomes 'superseded', pointing at the new one. */
  supersede(oldId: InterventionId, replacementId: InterventionId): Promise<InterventionRecord>;
  /**
   * Records an evaluation. UNIQUE (intervention_id, evaluation_window):
   * re-evaluating the same window is a conflict — use a new window label.
   */
  recordOutcome(input: RecordOutcomeInput): Promise<InterventionOutcomeRecord>;
  findById(id: InterventionId): Promise<InterventionRecord | null>;
  list(userId: string, options?: { status?: InterventionStatus; limit?: number }): Promise<InterventionRecord[]>;
  outcomes(interventionId: InterventionId): Promise<InterventionOutcomeRecord[]>;
}

export class PrismaInterventionRepository implements InterventionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateInterventionInput): Promise<InterventionRecord> {
    const id = input.id ?? newUuidv7();
    return runDb(async () => {
      if (input.diagnosisId) {
        const diagnosis = await this.prisma.diagnosis.findUnique({
          where: { id: input.diagnosisId },
          select: { id: true },
        });
        if (!diagnosis) throw new NotFoundError(`diagnosis ${input.diagnosisId} not found`);
      }
      if (input.activeGoalId) {
        const goal = await this.prisma.goal.findUnique({
          where: { id: input.activeGoalId },
          select: { id: true },
        });
        if (!goal) throw new NotFoundError(`goal ${input.activeGoalId} not found`);
      }
      if (input.activePlanVersionId) {
        const version = await this.prisma.trainingPlanVersion.findUnique({
          where: { id: input.activePlanVersionId },
          select: { id: true },
        });
        if (!version) throw new NotFoundError(`plan version ${input.activePlanVersionId} not found`);
      }

      const row = await this.prisma.intervention.create({
        data: {
          id,
          userId: input.userId,
          diagnosisId: input.diagnosisId ?? null,
          activeGoalId: input.activeGoalId ?? null,
          activePlanVersionId: input.activePlanVersionId ?? null,
          kind: input.kind,
          parameters: (input.parameters ?? {}) as Prisma.InputJsonValue,
          rationale: input.rationale,
          expectedEffect: input.expectedEffect,
          reviewOn: input.reviewOn ? new Date(`${input.reviewOn}T00:00:00.000Z`) : null,
          status: input.status ?? "proposed",
        },
      });
      return interventionRowToRecord(row);
    });
  }

  async updateStatus(id: InterventionId, status: InterventionStatus): Promise<InterventionRecord> {
    return runDb(async () => {
      const row = await this.prisma.intervention.update({
        where: { id },
        data: {
          status,
          ...(status === "accepted" ? { acceptedAt: new Date() } : {}),
          ...(status === "completed" ? { completedAt: new Date() } : {}),
        },
      });
      return interventionRowToRecord(row);
    });
  }

  async supersede(
    oldId: InterventionId,
    replacementId: InterventionId,
  ): Promise<InterventionRecord> {
    if (oldId === replacementId) {
      throw new ConflictError("an intervention cannot supersede itself");
    }
    return runDb(async () => {
      const replacement = await this.prisma.intervention.findUnique({
        where: { id: replacementId },
        select: { id: true },
      });
      if (!replacement) throw new NotFoundError(`intervention ${replacementId} not found`);
      const row = await this.prisma.intervention.update({
        where: { id: oldId },
        data: { status: "superseded", supersededByInterventionId: replacementId },
      });
      return interventionRowToRecord(row);
    });
  }

  async recordOutcome(input: RecordOutcomeInput): Promise<InterventionOutcomeRecord> {
    const id = input.id ?? newUuidv7();
    return runDb(async () => {
      const intervention = await this.prisma.intervention.findUnique({
        where: { id: input.interventionId },
        select: { id: true },
      });
      if (!intervention) {
        throw new NotFoundError(`intervention ${input.interventionId} not found`);
      }
      if (input.followUpDiagnosisId) {
        const diagnosis = await this.prisma.diagnosis.findUnique({
          where: { id: input.followUpDiagnosisId },
          select: { id: true },
        });
        if (!diagnosis) throw new NotFoundError(`diagnosis ${input.followUpDiagnosisId} not found`);
      }
      try {
        const row = await this.prisma.interventionOutcome.create({
          data: {
            id,
            interventionId: input.interventionId,
            followUpDiagnosisId: input.followUpDiagnosisId ?? null,
            evaluatedAt: input.evaluatedAt ? new Date(input.evaluatedAt) : new Date(),
            evaluationWindow: input.evaluationWindow,
            verdict: input.verdict,
            observations: [...(input.observations ?? [])],
            explanation: input.explanation,
          },
        });
        return outcomeRowToRecord(row);
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          (error as { code?: string }).code === "P2002"
        ) {
          throw new ConflictError(
            `an outcome for window "${input.evaluationWindow}" already exists`,
            { cause: error },
          );
        }
        throw error;
      }
    });
  }

  async findById(id: InterventionId): Promise<InterventionRecord | null> {
    return runDb(async () => {
      const row = await this.prisma.intervention.findUnique({ where: { id } });
      return row ? interventionRowToRecord(row) : null;
    });
  }

  async list(
    userId: string,
    options: { status?: InterventionStatus; limit?: number } = {},
  ): Promise<InterventionRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.intervention.findMany({
        where: { userId, ...(options.status ? { status: options.status } : {}) },
        orderBy: { createdAt: "desc" },
        take: boundedLimit(options.limit, 50),
      });
      return rows.map(interventionRowToRecord);
    });
  }

  async outcomes(interventionId: InterventionId): Promise<InterventionOutcomeRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.interventionOutcome.findMany({
        where: { interventionId },
        orderBy: { evaluatedAt: "desc" },
      });
      return rows.map(outcomeRowToRecord);
    });
  }
}
