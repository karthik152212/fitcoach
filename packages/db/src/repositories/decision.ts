import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  CalendarDate,
  ConfidenceLevel,
  DecisionAssumptionCategory,
  DecisionEvidenceId,
  DecisionEvidenceKind,
  DecisionKind,
  DecisionOutcomeVerdict,
  DecisionSnapshotId,
  DecisionSnapshotStatus,
  DiagnosisId,
  EntityId,
  ProvenanceClass,
  UnifiedStateId,
  UnifiedStateSourceKind,
  UserId,
} from "@fitcoach/domain";
import { NotFoundError } from "../errors";
import { newUuidv7 } from "../ids";
import { boundedLimit, runDb } from "./util";
import { toCalendarDate, toTimestamp } from "../mapping";

// ---------------------------------------------------------------------------
// Decision Snapshots
// ---------------------------------------------------------------------------

interface DecisionSnapshotRow {
  id: string;
  userId: string;
  decidedAt: Date;
  kind: string;
  status: string;
  unifiedStateId: string;
  diagnosesAddressed: string[];
  monitoringPlan: string[];
  configVersion: string;
  summary: string;
  confidence: string;
  supersedesId: string | null;
  warnings: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DecisionSnapshotRecord {
  id: DecisionSnapshotId;
  userId: UserId;
  decidedAt: CalendarDate;
  kind: DecisionKind;
  status: DecisionSnapshotStatus;
  unifiedStateId: UnifiedStateId;
  diagnosesAddressed: DiagnosisId[];
  monitoringPlan: string[];
  configVersion: string;
  summary: string;
  confidence: ConfidenceLevel;
  supersedesId?: DecisionSnapshotId;
  warnings: string[];
  createdAt: string;
  updatedAt: string;
}

function decisionSnapshotRowToRecord(row: DecisionSnapshotRow): DecisionSnapshotRecord {
  return {
    id: row.id,
    userId: row.userId,
    decidedAt: toCalendarDate(row.decidedAt),
    kind: row.kind as DecisionKind,
    status: row.status as DecisionSnapshotStatus,
    unifiedStateId: row.unifiedStateId,
    diagnosesAddressed: row.diagnosesAddressed as DiagnosisId[],
    monitoringPlan: row.monitoringPlan,
    configVersion: row.configVersion,
    summary: row.summary,
    confidence: row.confidence as ConfidenceLevel,
    supersedesId: row.supersedesId ?? undefined,
    warnings: row.warnings,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

export interface CreateDecisionSnapshotInput {
  id?: string;
  userId: UserId;
  decidedAt: CalendarDate;
  kind: DecisionKind;
  status?: DecisionSnapshotStatus;
  unifiedStateId: UnifiedStateId;
  diagnosesAddressed?: DiagnosisId[];
  monitoringPlan?: string[];
  configVersion: string;
  summary: string;
  confidence: ConfidenceLevel;
  supersedesId?: DecisionSnapshotId;
  warnings?: string[];
}

export interface ListDecisionsOptions {
  status?: DecisionSnapshotStatus;
  limit?: number;
  cursor?: string;
}

export interface DecisionSnapshotRepository {
  create(input: CreateDecisionSnapshotInput): Promise<DecisionSnapshotRecord>;
  updateStatus(id: DecisionSnapshotId, status: DecisionSnapshotStatus): Promise<DecisionSnapshotRecord>;
  findById(id: DecisionSnapshotId): Promise<DecisionSnapshotRecord | null>;
  findByIdWithRelations(
    id: DecisionSnapshotId,
  ): Promise<
    (DecisionSnapshotRecord & {
      interventions?: DecisionInterventionRecord[];
      evidence?: DecisionEvidenceRecord[];
      assumptions?: DecisionAssumptionRecord[];
      outcomes?: DecisionOutcomeRecord[];
    }) | null
  >;
  list(userId: UserId, options?: ListDecisionsOptions): Promise<DecisionSnapshotRecord[]>;
}

const SNAPSHOT_INCLUDE = {
  interventions: { orderBy: { createdAt: "asc" as const } },
  evidence: { orderBy: { createdAt: "asc" as const } },
  assumptions: { orderBy: { createdAt: "asc" as const } },
  outcomes: { orderBy: { evaluatedAt: "desc" as const } },
} as const;

export class PrismaDecisionSnapshotRepository implements DecisionSnapshotRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async load(id: string): Promise<DecisionSnapshotRecord | null> {
    const row = await this.prisma.decisionSnapshot.findUnique({ where: { id } });
    return row ? decisionSnapshotRowToRecord(row) : null;
  }

  private async loadWithRelations(id: string): Promise<
    (DecisionSnapshotRecord & {
      interventions?: DecisionInterventionRecord[];
      evidence?: DecisionEvidenceRecord[];
      assumptions?: DecisionAssumptionRecord[];
      outcomes?: DecisionOutcomeRecord[];
    }) | null
  > {
    const row = await this.prisma.decisionSnapshot.findUnique({
      where: { id },
      include: SNAPSHOT_INCLUDE,
    });
    if (!row) return null;

    return {
      ...decisionSnapshotRowToRecord(row),
      interventions: row.interventions?.map(decisionInterventionRowToRecord),
      evidence: row.evidence?.map(decisionEvidenceRowToRecord),
      assumptions: row.assumptions?.map(decisionAssumptionRowToRecord),
      outcomes: row.outcomes?.map(decisionOutcomeRowToRecord),
    };
  }

  async create(input: CreateDecisionSnapshotInput): Promise<DecisionSnapshotRecord> {
    const id = input.id ?? newUuidv7();
    return runDb(async () => {
      await this.prisma.decisionSnapshot.create({
        data: {
          id,
          userId: input.userId,
          decidedAt: new Date(`${input.decidedAt}T00:00:00.000Z`),
          kind: input.kind,
          status: input.status ?? "current",
          unifiedStateId: input.unifiedStateId,
          diagnosesAddressed: [...(input.diagnosesAddressed ?? [])],
          monitoringPlan: [...(input.monitoringPlan ?? [])],
          configVersion: input.configVersion,
          summary: input.summary,
          confidence: input.confidence,
          supersedesId: input.supersedesId ?? null,
          warnings: [...(input.warnings ?? [])],
        },
      });
      const created = await this.load(id);
      if (!created) throw new NotFoundError("decision snapshot disappeared after create");
      return created;
    });
  }

  async updateStatus(id: DecisionSnapshotId, status: DecisionSnapshotStatus): Promise<DecisionSnapshotRecord> {
    return runDb(async () => {
      await this.prisma.decisionSnapshot.update({
        where: { id },
        data: { status },
      });
      const updated = await this.load(id);
      if (!updated) throw new NotFoundError(`decision snapshot ${id} not found`);
      return updated;
    });
  }

  async findById(id: DecisionSnapshotId): Promise<DecisionSnapshotRecord | null> {
    return runDb(() => this.load(id));
  }

  async findByIdWithRelations(id: DecisionSnapshotId): Promise<
    (DecisionSnapshotRecord & {
      interventions?: DecisionInterventionRecord[];
      evidence?: DecisionEvidenceRecord[];
      assumptions?: DecisionAssumptionRecord[];
      outcomes?: DecisionOutcomeRecord[];
    }) | null
  > {
    return runDb(() => this.loadWithRelations(id));
  }

  async list(userId: UserId, options: ListDecisionsOptions = {}): Promise<DecisionSnapshotRecord[]> {
    return runDb(async () => {
      const where: Prisma.DecisionSnapshotWhereInput = {
        userId,
        ...(options.status ? { status: options.status } : {}),
      };
      const rows = await this.prisma.decisionSnapshot.findMany({
        where,
        orderBy: { decidedAt: "desc" },
        take: boundedLimit(options.limit, 50),
        ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      });
      return rows.map(decisionSnapshotRowToRecord);
    });
  }
}

// ---------------------------------------------------------------------------
// Decision Interventions
// ---------------------------------------------------------------------------

interface DecisionInterventionRow {
  id: string;
  decisionSnapshotId: string;
  kind: string;
  parameters: Prisma.JsonValue;
  rationale: string;
  expectedEffect: string;
  addressesDiagnoses: string[];
  reviewOn: Date | null;
  createdAt: Date;
}

export interface DecisionInterventionRecord {
  id: EntityId;
  decisionSnapshotId: DecisionSnapshotId;
  kind: string;
  parameters: Record<string, number | string | boolean | null>;
  rationale: string;
  expectedEffect: string;
  addressesDiagnoses: DiagnosisId[];
  reviewOn?: CalendarDate;
  createdAt: string;
}

function decisionInterventionRowToRecord(row: DecisionInterventionRow): DecisionInterventionRecord {
  return {
    id: row.id,
    decisionSnapshotId: row.decisionSnapshotId,
    kind: row.kind,
    parameters: (row.parameters ?? {}) as Record<string, number | string | boolean | null>,
    rationale: row.rationale,
    expectedEffect: row.expectedEffect,
    addressesDiagnoses: row.addressesDiagnoses as DiagnosisId[],
    reviewOn: row.reviewOn ? toCalendarDate(row.reviewOn) : undefined,
    createdAt: toTimestamp(row.createdAt),
  };
}

export interface CreateDecisionInterventionInput {
  id?: string;
  decisionSnapshotId: DecisionSnapshotId;
  kind: string;
  parameters?: Record<string, number | string | boolean | null>;
  rationale: string;
  expectedEffect: string;
  addressesDiagnoses?: DiagnosisId[];
  reviewOn?: CalendarDate;
}

export interface DecisionInterventionRepository {
  create(input: CreateDecisionInterventionInput): Promise<DecisionInterventionRecord>;
  listByDecisionSnapshot(decisionSnapshotId: DecisionSnapshotId): Promise<DecisionInterventionRecord[]>;
}

export class PrismaDecisionInterventionRepository implements DecisionInterventionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateDecisionInterventionInput): Promise<DecisionInterventionRecord> {
    const id = input.id ?? newUuidv7();
    return runDb(async () => {
      const row = await this.prisma.decisionIntervention.create({
        data: {
          id,
          decisionSnapshotId: input.decisionSnapshotId,
          kind: input.kind,
          parameters: (input.parameters ?? {}) as Prisma.InputJsonValue,
          rationale: input.rationale,
          expectedEffect: input.expectedEffect,
          addressesDiagnoses: [...(input.addressesDiagnoses ?? [])],
          reviewOn: input.reviewOn ? new Date(`${input.reviewOn}T00:00:00.000Z`) : null,
        },
      });
      return decisionInterventionRowToRecord(row);
    });
  }

  async listByDecisionSnapshot(decisionSnapshotId: DecisionSnapshotId): Promise<DecisionInterventionRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.decisionIntervention.findMany({
        where: { decisionSnapshotId },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(decisionInterventionRowToRecord);
    });
  }
}

// ---------------------------------------------------------------------------
// Decision Evidence
// ---------------------------------------------------------------------------

interface DecisionEvidenceRow {
  id: string;
  decisionSnapshotId: string;
  sourceEngine: string;
  code: string;
  title: string;
  metric: string;
  analysisWindow: string;
  observed: string;
  observedNumeric: Prisma.Decimal | null;
  expected: string | null;
  confidence: string;
  provenanceClass: string;
  severity: string;
  sensitive: boolean;
  createdAt: Date;
}

export interface DecisionEvidenceRecord {
  id: DecisionEvidenceId;
  decisionSnapshotId: DecisionSnapshotId;
  sourceEngine: UnifiedStateSourceKind;
  code: string;
  title: string;
  metric: string;
  window: string;
  observed: string;
  observedNumeric?: number;
  expected?: string;
  confidence: ConfidenceLevel;
  provenanceClass: ProvenanceClass;
  severity: DecisionEvidenceKind;
  sensitive: boolean;
  createdAt: string;
}

function decisionEvidenceRowToRecord(row: DecisionEvidenceRow): DecisionEvidenceRecord {
  return {
    id: row.id,
    decisionSnapshotId: row.decisionSnapshotId,
    sourceEngine: row.sourceEngine as UnifiedStateSourceKind,
    code: row.code,
    title: row.title,
    metric: row.metric,
    window: row.analysisWindow,
    observed: row.observed,
    observedNumeric: row.observedNumeric ? Number(row.observedNumeric) : undefined,
    expected: row.expected ?? undefined,
    confidence: row.confidence as ConfidenceLevel,
    provenanceClass: row.provenanceClass as ProvenanceClass,
    severity: row.severity as DecisionEvidenceKind,
    sensitive: row.sensitive,
    createdAt: toTimestamp(row.createdAt),
  };
}

export interface CreateDecisionEvidenceInput {
  id?: string;
  decisionSnapshotId: DecisionSnapshotId;
  sourceEngine: UnifiedStateSourceKind;
  code: string;
  title: string;
  metric: string;
  window: string;
  observed: string;
  observedNumeric?: number;
  expected?: string;
  confidence: ConfidenceLevel;
  provenanceClass: ProvenanceClass;
  severity: DecisionEvidenceKind;
  sensitive?: boolean;
}

export interface DecisionEvidenceRepository {
  create(input: CreateDecisionEvidenceInput): Promise<DecisionEvidenceRecord>;
  listByDecisionSnapshot(decisionSnapshotId: DecisionSnapshotId): Promise<DecisionEvidenceRecord[]>;
}

export class PrismaDecisionEvidenceRepository implements DecisionEvidenceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateDecisionEvidenceInput): Promise<DecisionEvidenceRecord> {
    const id = input.id ?? newUuidv7();
    return runDb(async () => {
      const row = await this.prisma.decisionEvidence.create({
        data: {
          id,
          decisionSnapshotId: input.decisionSnapshotId,
          sourceEngine: input.sourceEngine,
          code: input.code,
          title: input.title,
          metric: input.metric,
          analysisWindow: input.window,
          observed: input.observed,
          observedNumeric: input.observedNumeric ?? null,
          expected: input.expected ?? null,
          confidence: input.confidence,
          provenanceClass: input.provenanceClass,
          severity: input.severity,
          sensitive: input.sensitive ?? false,
        },
      });
      return decisionEvidenceRowToRecord(row);
    });
  }

  async listByDecisionSnapshot(decisionSnapshotId: DecisionSnapshotId): Promise<DecisionEvidenceRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.decisionEvidence.findMany({
        where: { decisionSnapshotId },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(decisionEvidenceRowToRecord);
    });
  }
}

// ---------------------------------------------------------------------------
// Decision Assumptions
// ---------------------------------------------------------------------------

interface DecisionAssumptionRow {
  id: string;
  decisionSnapshotId: string;
  code: string;
  description: string;
  category: string;
  value: string;
  sensitive: boolean;
  source: string;
  createdAt: Date;
}

export interface DecisionAssumptionRecord {
  id: string;
  decisionSnapshotId: DecisionSnapshotId;
  code: string;
  description: string;
  category: DecisionAssumptionCategory;
  value: string;
  sensitive: boolean;
  source: string;
  createdAt: string;
}

function decisionAssumptionRowToRecord(row: DecisionAssumptionRow): DecisionAssumptionRecord {
  return {
    id: row.id,
    decisionSnapshotId: row.decisionSnapshotId,
    code: row.code,
    description: row.description,
    category: row.category as DecisionAssumptionCategory,
    value: row.value,
    sensitive: row.sensitive,
    source: row.source,
    createdAt: toTimestamp(row.createdAt),
  };
}

export interface CreateDecisionAssumptionInput {
  id?: string;
  decisionSnapshotId: DecisionSnapshotId;
  code: string;
  description: string;
  category: DecisionAssumptionCategory;
  value: string;
  sensitive?: boolean;
  source: string;
}

export interface DecisionAssumptionRepository {
  create(input: CreateDecisionAssumptionInput): Promise<DecisionAssumptionRecord>;
  listByDecisionSnapshot(decisionSnapshotId: DecisionSnapshotId): Promise<DecisionAssumptionRecord[]>;
}

export class PrismaDecisionAssumptionRepository implements DecisionAssumptionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateDecisionAssumptionInput): Promise<DecisionAssumptionRecord> {
    const id = input.id ?? newUuidv7();
    return runDb(async () => {
      const row = await this.prisma.decisionAssumption.create({
        data: {
          id,
          decisionSnapshotId: input.decisionSnapshotId,
          code: input.code,
          description: input.description,
          category: input.category,
          value: input.value,
          sensitive: input.sensitive ?? false,
          source: input.source,
        },
      });
      return decisionAssumptionRowToRecord(row);
    });
  }

  async listByDecisionSnapshot(decisionSnapshotId: DecisionSnapshotId): Promise<DecisionAssumptionRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.decisionAssumption.findMany({
        where: { decisionSnapshotId },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(decisionAssumptionRowToRecord);
    });
  }
}

// ---------------------------------------------------------------------------
// Decision Outcomes
// ---------------------------------------------------------------------------

interface DecisionOutcomeRow {
  id: string;
  userId: string;
  decisionSnapshotId: string;
  evaluatedAt: Date;
  evaluationWindow: string;
  verdict: string;
  interventionVerdicts: Prisma.JsonValue;
  observations: string[];
  explanation: string;
  followUpDiagnosisIds: string[];
  triggersReevaluation: boolean;
  createdAt: Date;
}

export interface DecisionOutcomeRecord {
  id: EntityId;
  userId: UserId;
  decisionSnapshotId: DecisionSnapshotId;
  evaluatedAt: string;
  evaluationWindow: string;
  verdict: DecisionOutcomeVerdict;
  interventionVerdicts: Array<{
    interventionIndex: number;
    verdict: DecisionOutcomeVerdict;
    observations: string[];
  }>;
  observations: string[];
  explanation: string;
  followUpDiagnosisIds: DiagnosisId[];
  triggersReevaluation: boolean;
  createdAt: string;
}

function decisionOutcomeRowToRecord(row: DecisionOutcomeRow): DecisionOutcomeRecord {
  return {
    id: row.id,
    userId: row.userId,
    decisionSnapshotId: row.decisionSnapshotId,
    evaluatedAt: toTimestamp(row.evaluatedAt),
    evaluationWindow: row.evaluationWindow,
    verdict: row.verdict as DecisionOutcomeVerdict,
    interventionVerdicts: (row.interventionVerdicts as Array<{
      interventionIndex: number;
      verdict: DecisionOutcomeVerdict;
      observations: string[];
    }>) ?? [],
    observations: row.observations,
    explanation: row.explanation,
    followUpDiagnosisIds: row.followUpDiagnosisIds as DiagnosisId[],
    triggersReevaluation: row.triggersReevaluation,
    createdAt: toTimestamp(row.createdAt),
  };
}

export interface CreateDecisionOutcomeInput {
  id?: string;
  userId: UserId;
  decisionSnapshotId: DecisionSnapshotId;
  evaluatedAt?: string;
  evaluationWindow: string;
  verdict: DecisionOutcomeVerdict;
  interventionVerdicts: Array<{
    interventionIndex: number;
    verdict: DecisionOutcomeVerdict;
    observations: string[];
  }>;
  observations?: string[];
  explanation: string;
  followUpDiagnosisIds?: DiagnosisId[];
  triggersReevaluation?: boolean;
}

export interface ListDecisionOutcomesOptions {
  evaluationWindow?: string;
  limit?: number;
}

export interface DecisionOutcomeRepository {
  create(input: CreateDecisionOutcomeInput): Promise<DecisionOutcomeRecord>;
  list(decisionSnapshotId: DecisionSnapshotId, options?: ListDecisionOutcomesOptions): Promise<DecisionOutcomeRecord[]>;
}

export class PrismaDecisionOutcomeRepository implements DecisionOutcomeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateDecisionOutcomeInput): Promise<DecisionOutcomeRecord> {
    const id = input.id ?? newUuidv7();
    return runDb(async () => {
      try {
        const row = await this.prisma.decisionOutcome.create({
          data: {
            id,
            userId: input.userId,
            decisionSnapshotId: input.decisionSnapshotId,
            evaluatedAt: input.evaluatedAt ? new Date(input.evaluatedAt) : new Date(),
            evaluationWindow: input.evaluationWindow,
            verdict: input.verdict,
            interventionVerdicts: input.interventionVerdicts as Prisma.InputJsonValue,
            observations: [...(input.observations ?? [])],
            explanation: input.explanation,
            followUpDiagnosisIds: [...(input.followUpDiagnosisIds ?? [])],
            triggersReevaluation: input.triggersReevaluation ?? false,
          },
        });
        return decisionOutcomeRowToRecord(row);
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          (error as { code?: string }).code === "P2002"
        ) {
          throw new Error(`an outcome for window "${input.evaluationWindow}" already exists`);
        }
        throw error;
      }
    });
  }

  async list(decisionSnapshotId: DecisionSnapshotId, options: ListDecisionOutcomesOptions = {}): Promise<DecisionOutcomeRecord[]> {
    return runDb(async () => {
      const where: Prisma.DecisionOutcomeWhereInput = {
        decisionSnapshotId,
        ...(options.evaluationWindow ? { evaluationWindow: options.evaluationWindow } : {}),
      };
      const rows = await this.prisma.decisionOutcome.findMany({
        where,
        orderBy: { evaluatedAt: "desc" },
        take: boundedLimit(options.limit, 50),
      });
      return rows.map(decisionOutcomeRowToRecord);
    });
  }
}