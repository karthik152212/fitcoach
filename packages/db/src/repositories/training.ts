import type { PrismaClient } from "@prisma/client";
import type {
  CalendarDate,
  ExerciseSlot,
  PerformanceLoadKind,
  PerformanceSource,
  SessionClassification,
  SessionTemplate,
  SetKind,
  Timestamp,
  TrainingEnvironmentKind,
  WorkoutStatus,
} from "@fitcoach/domain";
import { ConflictError, ImmutableRecordError, NotFoundError } from "../errors";
import { newUuidv7 } from "../ids";
import { decimalToNumber, toCalendarDate, toTimestamp } from "../mapping";
import { boundedLimit, runDb } from "./util";

// ---------------------------------------------------------------------------
// Plan records — match Prisma schema
// ---------------------------------------------------------------------------

interface PlanRow {
  id: string;
  userId: string;
  name: string;
  status: string;
  description: string | null;
  activeFrom: Date | null;
  activeUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PlanVersionRow {
  id: string;
  planId: string;
  status: string;
  planJson: string;
  configVersion: string | null;
  supersedesId: string | null;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PlanSessionRow {
  id: string;
  versionId: string;
  dayOfWeek: number;
  name: string | null;
  notes: string | null;
  estimatedDurationMinutes: number | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PlanSlotRow {
  id: string;
  sessionId: string;
  exerciseId: string;
  position: number;
  targetSets: number;
  targetReps: string;
  targetRir: unknown;
  loadPrescription: string;
  loadValue: unknown;
  progressionRule: { id: string; slotId: string; trigger: string; condition: string; action: string; bounds: string; resetBehavior: string | null; rationale: string; configVersion: string | null } | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanVersionRecord {
  id: string;
  planId: string;
  status: string;
  planJson: string;
  configVersion?: string;
  supersedesId?: string;
  effectiveFrom: CalendarDate;
  effectiveUntil?: CalendarDate;
  startsOn?: CalendarDate;
  versionNumber?: number;
  rationaleNotes?: string;
  createdAt: string;
  updatedAt: string;
  sessions: SessionTemplate[];
}

export interface PlanAggregate {
  id: string;
  userId: string;
  name: string;
  status: string;
  description?: string;
  activeFrom?: CalendarDate;
  activeUntil?: CalendarDate;
  /** Plan kind: "primary" or "temporary_environment". */
  kind?: "primary" | "temporary_environment";
  /** Environment kind for temporary plans. */
  environmentKind?: string;
  /** Last day the temporary plan applies. */
  effectiveUntil?: CalendarDate;
  /** Version ID the temporary plan was adapted from. */
  temporaryForVersionId?: string;
  createdAt: string;
  updatedAt: string;
  versions: PlanVersionRecord[];
}

function slotRowToRecord(row: PlanSlotRow): ExerciseSlot {
  return {
    id: row.id,
    exerciseId: row.exerciseId,
    targetSets: row.targetSets,
    targetRepRange: row.targetReps ? parseRepRange(row.targetReps) : undefined,
    targetRir: decimalToNumber(row.targetRir),
    restSeconds: undefined,
    substitutionExerciseIds: undefined,
    notes: row.notes ?? undefined,
  };
}

function parseRepRange(targetReps: string): { min: number; max: number } | undefined {
  const match = targetReps.match(/^(\d+)-(\d+)$/);
  if (match && match[1] && match[2]) {
    return { min: parseInt(match[1], 10), max: parseInt(match[2], 10) };
  }
  return undefined;
}

interface PlanSessionWithSlots extends PlanSessionRow {
  slots: PlanSlotRow[];
}

function sessionRowToRecord(row: PlanSessionWithSlots): SessionTemplate {
  return {
    id: row.id,
    name: row.name ?? "",
    weekdayHint: row.dayOfWeek ?? 0,
    slots: row.slots
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(slotRowToRecord),
  };
}

interface PlanVersionWithSessions extends PlanVersionRow {
  sessions: PlanSessionWithSlots[];
}

function versionRowToRecord(row: PlanVersionWithSessions): PlanVersionRecord {
  return {
    id: row.id,
    planId: row.planId,
    status: row.status,
    planJson: row.planJson,
    configVersion: row.configVersion ?? undefined,
    supersedesId: row.supersedesId ?? undefined,
    effectiveFrom: toCalendarDate(row.effectiveFrom),
    effectiveUntil: row.effectiveUntil ? toCalendarDate(row.effectiveUntil) : undefined,
    startsOn: row.effectiveFrom ? toCalendarDate(row.effectiveFrom) : undefined,
    versionNumber: undefined,
    rationaleNotes: undefined,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
    sessions: row.sessions
      .slice()
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
      .map(sessionRowToRecord),
  };
}

interface PlanWithVersions extends PlanRow {
  versions: PlanVersionWithSessions[];
}

function planRowToRecord(row: PlanWithVersions): PlanAggregate {
  const latestVersion = row.versions
    .slice()
    .sort((a, b) => (a.effectiveFrom > b.effectiveFrom ? 1 : -1))[0];
  let planJson: { kind?: string; environmentKind?: string; temporaryForVersionId?: string; effectiveUntil?: string } = {};
  if (latestVersion) {
    try {
      planJson = JSON.parse(latestVersion.planJson);
    } catch {
      // ignore parse errors
    }
  }
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    status: row.status,
    description: row.description ?? undefined,
    activeFrom: row.activeFrom ? toCalendarDate(row.activeFrom) : undefined,
    activeUntil: row.activeUntil ? toCalendarDate(row.activeUntil) : undefined,
    kind: planJson.kind as "primary" | "temporary_environment" | undefined,
    environmentKind: planJson.environmentKind,
    temporaryForVersionId: planJson.temporaryForVersionId,
    effectiveUntil: planJson.effectiveUntil,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
    versions: row.versions
      .slice()
      .sort((a, b) => (a.effectiveFrom > b.effectiveFrom ? 1 : -1))
      .map(versionRowToRecord),
  };
}

const PLAN_INCLUDE = {
  versions: {
    include: {
      sessions: {
        include: { slots: { include: { progressionRule: true }, orderBy: { position: "asc" as const } } },
        orderBy: { dayOfWeek: "asc" as const },
      },
    },
    orderBy: { effectiveFrom: "asc" as const },
  },
} as const;

// ---------------------------------------------------------------------------
// Workout records
// ---------------------------------------------------------------------------

interface WorkoutRow {
  id: string;
  userId: string;
  planId: string | null;
  planVersionId: string | null;
  planSessionId: string | null;
  title: string | null;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  notes: string | null;
  clientRequestId: string | null;
  environmentKind: string | null;
  sessionClassification: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SetRow {
  id: string;
  workoutExerciseId: string;
  position: number;
  kind: string;
  loadKg: unknown;
  addedLoadKg: unknown;
  reps: number | null;
  distanceMeters: unknown;
  durationSeconds: number | null;
  rir: unknown;
  rpe: unknown;
  notes: string | null;
  loadKind: string | null;
  assistanceLoadKg: unknown;
  clientRequestId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface WorkoutExerciseRow {
  id: string;
  workoutId: string;
  exerciseId: string;
  position: number;
  notes: string | null;
  slotId: string | null;
  substitutedFromExerciseId: string | null;
  performanceSource: string | null;
  substitutionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExerciseSetRecord {
  id: string;
  workoutExerciseId: string;
  exerciseId: string;
  position: number;
  kind: SetKind;
  loadKg?: number;
  addedLoadKg?: number;
  reps?: number;
  distanceMeters?: number;
  durationSeconds?: number;
  rir?: number;
  rpe?: number;
  loadKind?: PerformanceLoadKind;
  assistanceLoadKg?: number;
  clientRequestId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkoutExerciseRecord {
  id: string;
  workoutId: string;
  exerciseId: string;
  position: number;
  notes?: string;
  slotId?: string;
  substitutedFromExerciseId?: string;
  performanceSource?: PerformanceSource;
  substitutionReason?: string;
  sets: ExerciseSetRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkoutRecord {
  id: string;
  userId: string;
  planId?: string;
  planVersionId?: string;
  planSessionId?: string;
  title?: string;
  status: WorkoutStatus;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  notes?: string;
  clientRequestId?: string;
  environmentKind?: TrainingEnvironmentKind;
  sessionClassification?: SessionClassification;
  createdAt: string;
  updatedAt: string;
}

export interface WorkoutAggregate {
  workout: WorkoutRecord;
  exercises: WorkoutExerciseRecord[];
}

function setRowToRecord(row: SetRow, exerciseId: string): ExerciseSetRecord {
  return {
    id: row.id,
    workoutExerciseId: row.workoutExerciseId,
    exerciseId,
    position: row.position,
    kind: row.kind as SetKind,
    loadKg: decimalToNumber(row.loadKg),
    addedLoadKg: decimalToNumber(row.addedLoadKg),
    reps: row.reps ?? undefined,
    distanceMeters: decimalToNumber(row.distanceMeters),
    durationSeconds: row.durationSeconds ?? undefined,
    rir: decimalToNumber(row.rir),
    rpe: decimalToNumber(row.rpe),
    ...(row.loadKind ? { loadKind: row.loadKind as PerformanceLoadKind } : {}),
    ...(decimalToNumber(row.assistanceLoadKg) !== undefined
      ? { assistanceLoadKg: decimalToNumber(row.assistanceLoadKg) }
      : {}),
    ...(row.clientRequestId ? { clientRequestId: row.clientRequestId } : {}),
    notes: row.notes ?? undefined,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

interface WorkoutExerciseWithSets extends WorkoutExerciseRow {
  sets: SetRow[];
}

function workoutExerciseRowToRecord(row: WorkoutExerciseWithSets): WorkoutExerciseRecord {
  return {
    id: row.id,
    workoutId: row.workoutId,
    exerciseId: row.exerciseId,
    position: row.position,
    notes: row.notes ?? undefined,
    ...(row.slotId ? { slotId: row.slotId } : {}),
    ...(row.substitutedFromExerciseId
      ? { substitutedFromExerciseId: row.substitutedFromExerciseId }
      : {}),
    ...(row.performanceSource
      ? { performanceSource: row.performanceSource as PerformanceSource }
      : {}),
    ...(row.substitutionReason ? { substitutionReason: row.substitutionReason } : {}),
    sets: row.sets
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((set) => setRowToRecord(set, row.exerciseId)),
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

function workoutRowToRecord(row: WorkoutRow): WorkoutRecord {
  return {
    id: row.id,
    userId: row.userId,
    planId: row.planId ?? undefined,
    planVersionId: row.planVersionId ?? undefined,
    planSessionId: row.planSessionId ?? undefined,
    title: row.title ?? undefined,
    status: row.status as WorkoutStatus,
    startedAt: toTimestamp(row.startedAt),
    endedAt: row.endedAt ? toTimestamp(row.endedAt) : undefined,
    notes: row.notes ?? undefined,
    clientRequestId: row.clientRequestId ?? undefined,
    ...(row.environmentKind
      ? { environmentKind: row.environmentKind as TrainingEnvironmentKind }
      : {}),
    ...(row.sessionClassification
      ? { sessionClassification: row.sessionClassification as SessionClassification }
      : {}),
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

function inferLoadKindFromColumns(input: {
  loadKg?: number;
  addedLoadKg?: number;
  assistanceLoadKg?: number;
  reps?: number;
  distanceMeters?: number;
  durationSeconds?: number;
}): PerformanceLoadKind {
  if (input.assistanceLoadKg !== undefined) return "assisted_bodyweight";
  if (input.loadKg !== undefined && input.addedLoadKg !== undefined) return "weighted_bodyweight";
  if (input.loadKg !== undefined) return "external_load";
  if (input.addedLoadKg !== undefined) return "weighted_bodyweight";
  if ((input.reps ?? 0) > 0 || (input.distanceMeters ?? 0) > 0 || (input.durationSeconds ?? 0) > 0) {
    return "bodyweight";
  }
  return "none";
}

interface WorkoutWithExercises extends WorkoutRow {
  exercises: WorkoutExerciseWithSets[];
}

function workoutAggregateRowToRecord(row: WorkoutWithExercises): WorkoutAggregate {
  return {
    workout: workoutRowToRecord(row),
    exercises: row.exercises.slice().sort((a, b) => a.position - b.position).map(workoutExerciseRowToRecord),
  };
}

const WORKOUT_INCLUDE = {
  exercises: {
    include: {
      sets: { orderBy: { position: "asc" as const } },
    },
    orderBy: { position: "asc" as const },
  },
} as const;

const FINAL_WORKOUT_STATUSES: readonly string[] = ["completed", "partial", "skipped"];

// ---------------------------------------------------------------------------
// Contracts + implementations
// ---------------------------------------------------------------------------

export interface PlanSlotInput {
  exerciseId: string;
  targetSets?: number;
  targetReps?: string;
  targetRir?: number;
  loadPrescription?: string;
  loadValue?: number;
  repMin?: number;
  repMax?: number;
  progressionRule?: ProgressionRuleInput;
  notes?: string;
}

export interface PlanSessionInput {
  name: string;
  dayOfWeek: number;
  notes?: string;
  estimatedDurationMinutes?: number;
  slots: readonly PlanSlotInput[];
}

export interface PlanVersionInput {
  status?: "active" | "superseded" | "draft";
  planJson: string;
  configVersion?: string;
  supersedesId?: string;
  effectiveFrom: CalendarDate;
  effectiveUntil?: CalendarDate;
  startsOn?: CalendarDate;
  sessions: readonly PlanSessionInput[];
}

export interface CreatePlanInput {
  id?: string;
  userId: string;
  name: string;
  status?: string;
  description?: string;
  activeFrom?: CalendarDate;
  activeUntil?: CalendarDate;
  /** Plan kind: "primary" or "temporary_environment". */
  kind?: "primary" | "temporary_environment";
  /** Environment kind for temporary plans. */
  environmentKind?: string;
  /** Last day the temporary plan applies. */
  effectiveUntil?: CalendarDate;
  /** Version ID the temporary plan was adapted from. */
  temporaryForVersionId?: string;
  version: PlanVersionInput;
}

export interface PlanConstraintInput {
  kind: string;
  parameters: Record<string, unknown>;
  rationale: string;
}

export interface PlanConstraintRecord extends PlanConstraintInput {
  id: string;
  versionId: string;
  createdAt: string;
  result: string;
}

export interface PlanDecisionInput {
  kind: string;
  rationale: string;
  parameters: Record<string, unknown>;
}

export interface PlanDecisionRecord extends PlanDecisionInput {
  id: string;
  versionId: string;
  createdAt: string;
}

export type PlanGenerationReason =
  | "volume_adjustment"
  | "frequency_adjustment"
  | "exercise_substitution"
  | "split_adjustment"
  | "progression_adjustment"
  | "no_change"
  | "plan_adjustment";

export interface TrainingPlanRepository {
  create(input: CreatePlanInput): Promise<PlanAggregate>;
  addVersion(planId: string, version: PlanVersionInput): Promise<PlanVersionRecord>;
  findById(planId: string): Promise<PlanAggregate | null>;
  findActive(userId: string): Promise<PlanAggregate | null>;
  listForUser(userId: string): Promise<PlanAggregate[]>;
  /** Lists temporary environment plans for a user. */
  listTemporary(userId: string): Promise<PlanAggregate[]>;
  setStatus(planId: string, status: string): Promise<PlanAggregate>;
  setProgressionRule(slotId: string, rule: ProgressionRuleInput): Promise<ProgressionRuleRecord>;
  listProgressionRules(versionId: string): Promise<ProgressionRuleRecord[]>;
  replaceConstraints(versionId: string, constraints: PlanConstraintInput[]): Promise<PlanConstraintRecord[]>;
  recordDecision(versionId: string, decision: PlanDecisionInput): Promise<PlanDecisionRecord>;
  listDecisions(versionId: string): Promise<PlanDecisionRecord[]>;
  listConstraints(versionId: string): Promise<PlanConstraintRecord[]>;
  listByUser(userId: string): Promise<PlanAggregate[]>;
}

export interface ProgressionRuleInput {
  trigger: string;
  condition: string;
  action: string;
  bounds: string;
  resetBehavior?: string;
  rationale: string;
  configVersion?: string;
}

export interface ProgressionRuleRecord extends ProgressionRuleInput {
  id: string;
  slotId: string;
}

function ruleRowToRecord(row: {
  id: string;
  slotId: string;
  trigger: string;
  condition: string;
  action: string;
  bounds: string;
  resetBehavior: string | null;
  rationale: string;
  configVersion: string | null;
}): ProgressionRuleRecord {
  return {
    id: row.id,
    slotId: row.slotId,
    trigger: row.trigger,
    condition: row.condition,
    action: row.action,
    bounds: row.bounds,
    resetBehavior: row.resetBehavior ?? undefined,
    rationale: row.rationale,
    configVersion: row.configVersion ?? undefined,
  };
}

export class PrismaTrainingPlanRepository implements TrainingPlanRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreatePlanInput): Promise<PlanAggregate> {
    const planId = input.id ?? newUuidv7();
    const versionId = newUuidv7();
    return runDb(async () => {
      return this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } });
        if (!user) throw new NotFoundError(`user ${input.userId} not found`);

        const exerciseIds = input.version.sessions.flatMap((session) =>
          session.slots.map((slot) => slot.exerciseId),
        );
        const found = await tx.exercise.findMany({
          where: { id: { in: exerciseIds } },
          select: { id: true },
        });
        if (found.length !== new Set(exerciseIds).size) {
          throw new NotFoundError("one or more slot exercises do not exist");
        }

        const effectiveFrom = new Date(`${input.version.effectiveFrom}T00:00:00.000Z`);
        const effectiveUntil = input.version.effectiveUntil
          ? new Date(`${input.version.effectiveUntil}T00:00:00.000Z`)
          : null;

        // Merge temporary plan metadata into planJson
        let planJson: Record<string, unknown>;
        try {
          planJson = JSON.parse(input.version.planJson);
        } catch {
          planJson = {};
        }
        if (input.kind) planJson.kind = input.kind;
        if (input.environmentKind) planJson.environmentKind = input.environmentKind;
        if (input.temporaryForVersionId) planJson.temporaryForVersionId = input.temporaryForVersionId;
        if (input.effectiveUntil) planJson.effectiveUntil = input.effectiveUntil;

        await tx.trainingPlan.create({
          data: {
            id: planId,
            userId: input.userId,
            name: input.name,
            status: input.status ?? "draft",
            description: input.description ?? null,
            activeFrom: input.activeFrom ? new Date(`${input.activeFrom}T00:00:00.000Z`) : null,
            activeUntil: input.activeUntil ? new Date(`${input.activeUntil}T00:00:00.000Z`) : null,
          },
        });

        await tx.trainingPlanVersion.create({
          data: {
            id: versionId,
            planId,
            status: input.version.status ?? "active",
            planJson: JSON.stringify(planJson),
            configVersion: input.version.configVersion ?? null,
            supersedesId: input.version.supersedesId ?? null,
            effectiveFrom,
            effectiveUntil,
          },
        });

        for (const sessionInput of input.version.sessions) {
          const sessionRow = await tx.trainingPlanSession.create({
            data: {
              id: newUuidv7(),
              versionId,
              dayOfWeek: sessionInput.dayOfWeek,
              name: sessionInput.name,
              notes: sessionInput.notes ?? null,
              estimatedDurationMinutes: sessionInput.estimatedDurationMinutes ?? null,
            },
          });

          for (const [slotIndex, slotInput] of sessionInput.slots.entries()) {
            const slotRow = await tx.trainingPlanExerciseSlot.create({
              data: {
                id: newUuidv7(),
                sessionId: sessionRow.id,
                exerciseId: slotInput.exerciseId,
                position: slotIndex,
                targetSets: slotInput.targetSets ?? 3,
                targetReps: slotInput.targetReps ?? "8-12",
                targetRir: slotInput.targetRir ?? 2,
                loadPrescription: slotInput.loadPrescription ?? "rpe",
                loadValue: slotInput.loadValue ?? null,
                notes: slotInput.notes ?? null,
              },
            });

            if (slotInput.progressionRule) {
              await tx.trainingPlanProgressionRule.create({
                data: {
                  id: newUuidv7(),
                  slotId: slotRow.id,
                  trigger: slotInput.progressionRule.trigger,
                  condition: slotInput.progressionRule.condition,
                  action: slotInput.progressionRule.action,
                  bounds: slotInput.progressionRule.bounds,
                  resetBehavior: slotInput.progressionRule.resetBehavior ?? null,
                  rationale: slotInput.progressionRule.rationale,
                  configVersion: slotInput.progressionRule.configVersion ?? null,
                },
              });
            }
          }
        }

        const created = await tx.trainingPlan.findUnique({
          where: { id: planId },
          include: PLAN_INCLUDE,
        });
        if (!created) throw new NotFoundError("plan disappeared after create");
        return planRowToRecord(created);
      });
    });
  }

  async addVersion(planId: string, version: PlanVersionInput): Promise<PlanVersionRecord> {
    const versionId = newUuidv7();
    return runDb(async () => {
      return this.prisma.$transaction(async (tx) => {
        const plan = await tx.trainingPlan.findUnique({ where: { id: planId } });
        if (!plan) throw new NotFoundError(`training plan ${planId} not found`);

        const exerciseIds = version.sessions.flatMap((session) =>
          session.slots.map((slot) => slot.exerciseId),
        );
        const found = await tx.exercise.findMany({
          where: { id: { in: exerciseIds } },
          select: { id: true },
        });
        if (found.length !== new Set(exerciseIds).size) {
          throw new NotFoundError("one or more slot exercises do not exist");
        }

        const effectiveFrom = new Date(`${version.effectiveFrom}T00:00:00.000Z`);
        const effectiveUntil = version.effectiveUntil
          ? new Date(`${version.effectiveUntil}T00:00:00.000Z`)
          : null;

        const previousActive = await tx.trainingPlanVersion.findFirst({
          where: { planId, status: "active" },
          orderBy: { effectiveFrom: "desc" },
          select: { id: true },
        });
        if (previousActive) {
          await tx.trainingPlanVersion.update({
            where: { id: previousActive.id },
            data: { status: "superseded" },
          });
        }

        await tx.trainingPlanVersion.create({
          data: {
            id: versionId,
            planId,
            status: version.status ?? "active",
            planJson: version.planJson,
            configVersion: version.configVersion ?? null,
            supersedesId: version.supersedesId ?? previousActive?.id ?? null,
            effectiveFrom,
            effectiveUntil,
          },
        });

        for (const sessionInput of version.sessions) {
          const sessionRow = await tx.trainingPlanSession.create({
            data: {
              id: newUuidv7(),
              versionId,
              dayOfWeek: sessionInput.dayOfWeek,
              name: sessionInput.name,
              notes: sessionInput.notes ?? null,
              estimatedDurationMinutes: sessionInput.estimatedDurationMinutes ?? null,
            },
          });

          for (const [slotIndex, slotInput] of sessionInput.slots.entries()) {
            const slotRow = await tx.trainingPlanExerciseSlot.create({
              data: {
                id: newUuidv7(),
                sessionId: sessionRow.id,
                exerciseId: slotInput.exerciseId,
                position: slotIndex,
                targetSets: slotInput.targetSets ?? 3,
                targetReps: slotInput.targetReps ?? "8-12",
                targetRir: slotInput.targetRir ?? 2,
                loadPrescription: slotInput.loadPrescription ?? "rpe",
                loadValue: slotInput.loadValue ?? null,
                notes: slotInput.notes ?? null,
              },
            });

            if (slotInput.progressionRule) {
              await tx.trainingPlanProgressionRule.create({
                data: {
                  id: newUuidv7(),
                  slotId: slotRow.id,
                  trigger: slotInput.progressionRule.trigger,
                  condition: slotInput.progressionRule.condition,
                  action: slotInput.progressionRule.action,
                  bounds: slotInput.progressionRule.bounds,
                  resetBehavior: slotInput.progressionRule.resetBehavior ?? null,
                  rationale: slotInput.progressionRule.rationale,
                  configVersion: slotInput.progressionRule.configVersion ?? null,
                },
              });
            }
          }
        }

        const created = await tx.trainingPlanVersion.findUnique({
          where: { id: versionId },
          include: {
            sessions: {
              include: { slots: { include: { progressionRule: true }, orderBy: { position: "asc" } } },
              orderBy: { dayOfWeek: "asc" },
            },
          },
        });
        if (!created) throw new NotFoundError("version disappeared after create");
        return versionRowToRecord(created);
      });
    });
  }

  async findById(planId: string): Promise<PlanAggregate | null> {
    return runDb(async () => {
      const row = await this.prisma.trainingPlan.findUnique({
        where: { id: planId },
        include: PLAN_INCLUDE,
      });
      return row ? planRowToRecord(row) : null;
    });
  }

  async findActive(userId: string): Promise<PlanAggregate | null> {
    return runDb(async () => {
      // Fetch all active plans for the user and return the primary one.
      // Temporary plans have temporaryForVersionId set in planJson.
      const rows = await this.prisma.trainingPlan.findMany({
        where: { userId, status: "active" },
        include: PLAN_INCLUDE,
      });
      const all = rows.map(planRowToRecord);
      // Prefer primary plan (kind !== "temporary_environment") over temporary.
      const primary = all.find((p) => p.kind !== "temporary_environment");
      return primary ?? all[0] ?? null;
    });
  }

  async listForUser(userId: string): Promise<PlanAggregate[]> {
    return runDb(async () => {
      const rows = await this.prisma.trainingPlan.findMany({
        where: { userId },
        include: PLAN_INCLUDE,
        orderBy: { createdAt: "desc" },
      });
      return rows.map(planRowToRecord);
    });
  }

  async listTemporary(userId: string): Promise<PlanAggregate[]> {
    return runDb(async () => {
      const rows = await this.prisma.trainingPlan.findMany({
        where: { userId },
        include: PLAN_INCLUDE,
        orderBy: { createdAt: "desc" },
      });
      const allPlans = rows.map(planRowToRecord);
      return allPlans.filter((plan) => plan.kind === "temporary_environment");
    });
  }

  async setStatus(planId: string, status: string): Promise<PlanAggregate> {
    return runDb(async () => {
      await this.prisma.trainingPlan.update({ where: { id: planId }, data: { status } });
      const row = await this.prisma.trainingPlan.findUnique({
        where: { id: planId },
        include: PLAN_INCLUDE,
      });
      if (!row) throw new NotFoundError(`training plan ${planId} not found`);
      return planRowToRecord(row);
    });
  }

  async setProgressionRule(slotId: string, rule: ProgressionRuleInput): Promise<ProgressionRuleRecord> {
    return runDb(async () => {
      return this.prisma.$transaction(async (tx) => {
        const slot = await tx.trainingPlanExerciseSlot.findUnique({
          where: { id: slotId },
          select: { id: true },
        });
        if (!slot) throw new NotFoundError(`plan slot ${slotId} not found`);

        await tx.trainingPlanProgressionRule.deleteMany({ where: { slotId } });
        const row = await tx.trainingPlanProgressionRule.create({
          data: {
            id: newUuidv7(),
            slotId,
            trigger: rule.trigger,
            condition: rule.condition,
            action: rule.action,
            bounds: rule.bounds,
            resetBehavior: rule.resetBehavior ?? null,
            rationale: rule.rationale,
            configVersion: rule.configVersion ?? null,
          },
        });
        return ruleRowToRecord(row);
      });
    });
  }

  async listProgressionRules(versionId: string): Promise<ProgressionRuleRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.trainingPlanProgressionRule.findMany({
        where: { slot: { session: { versionId } } },
        orderBy: { slotId: "asc" },
      });
      return rows.map(ruleRowToRecord);
    });
  }

  async replaceConstraints(versionId: string, constraints: PlanConstraintInput[]): Promise<PlanConstraintRecord[]> {
    return runDb(async () => {
      await this.prisma.trainingPlanConstraint.deleteMany({ where: { versionId } });
      const rows = await this.prisma.$transaction(
        constraints.map((c) =>
          this.prisma.trainingPlanConstraint.create({
            data: {
              id: newUuidv7(),
              versionId,
              constraintKey: c.kind,
              label: c.rationale,
              result: "satisfied",
              isHard: true,
              violationDetail: null,
              warningDetail: null,
            },
          })
        )
      );
      return rows.map((row) => ({
        id: row.id,
        versionId: row.versionId,
        kind: row.constraintKey,
        rationale: row.label,
        result: row.result,
        parameters: { isHard: row.isHard, violationDetail: row.violationDetail, warningDetail: row.warningDetail },
        createdAt: toTimestamp(row.createdAt),
      }));
    });
  }

  async recordDecision(versionId: string, decision: PlanDecisionInput): Promise<PlanDecisionRecord> {
    return runDb(async () => {
      const row = await this.prisma.trainingPlanDecision.create({
        data: {
          id: newUuidv7(),
          versionId,
          kind: decision.kind,
          rationale: decision.rationale,
          parameters: decision.parameters as any,
        },
      });
      return {
        id: row.id,
        versionId: row.versionId,
        kind: row.kind,
        rationale: row.rationale,
        parameters: row.parameters as Record<string, unknown>,
        createdAt: toTimestamp(row.createdAt),
      };
    });
  }

  async listDecisions(versionId: string): Promise<PlanDecisionRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.trainingPlanDecision.findMany({
        where: { versionId },
        orderBy: { createdAt: "asc" },
      });
      return rows.map((row) => ({
        id: row.id,
        versionId: row.versionId,
        kind: row.kind,
        rationale: row.rationale,
        parameters: (row.parameters as Record<string, unknown>) ?? {},
        createdAt: toTimestamp(row.createdAt),
      }));
    });
  }

  async listConstraints(versionId: string): Promise<PlanConstraintRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.trainingPlanConstraint.findMany({
        where: { versionId },
        orderBy: { createdAt: "asc" },
      });
      return rows.map((row) => ({
        id: row.id,
        versionId: row.versionId,
        kind: row.constraintKey,
        rationale: row.label,
        result: row.result,
        parameters: { isHard: row.isHard, violationDetail: row.violationDetail, warningDetail: row.warningDetail },
        createdAt: toTimestamp(row.createdAt),
      }));
    });
  }

  async listByUser(userId: string): Promise<PlanAggregate[]> {
    return runDb(async () => {
      const rows = await this.prisma.trainingPlan.findMany({
        where: { userId },
        include: PLAN_INCLUDE,
        orderBy: { createdAt: "desc" },
      });
      return rows.map(planRowToRecord);
    });
  }
}

// ---------------------------------------------------------------------------
// Workouts
// ---------------------------------------------------------------------------

export interface CreateWorkoutInput {
  id?: string;
  userId: string;
  planId?: string;
  planVersionId?: string;
  planSessionId?: string;
  title?: string;
  status?: WorkoutStatus;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  notes?: string;
  clientRequestId?: string;
  environmentKind?: TrainingEnvironmentKind;
  sessionClassification?: SessionClassification;
}

export interface AddSetInput {
  id?: string;
  workoutExerciseId: string;
  position?: number;
  kind: SetKind;
  loadKg?: number;
  addedLoadKg?: number;
  reps?: number;
  distanceMeters?: number;
  durationSeconds?: number;
  rir?: number;
  rpe?: number;
  loadKind?: PerformanceLoadKind;
  assistanceLoadKg?: number;
  notes?: string;
  clientRequestId?: string;
}

export interface AddExerciseOptions {
  slotId?: string;
  substitutedFromExerciseId?: string;
  performanceSource?: PerformanceSource;
  substitutionReason?: string;
}

export interface WorkoutHistoryQuery {
  limit?: number;
  from?: Timestamp;
  to?: Timestamp;
}

export interface WorkoutRepository {
  create(input: CreateWorkoutInput): Promise<WorkoutRecord>;
  addExercise(
    workoutId: string,
    exerciseId: string,
    position?: number,
    notes?: string,
    options?: AddExerciseOptions,
  ): Promise<WorkoutExerciseRecord>;
  addSet(input: AddSetInput): Promise<ExerciseSetRecord>;
  complete(workoutId: string, status?: WorkoutStatus, endedAt?: Timestamp): Promise<WorkoutRecord>;
  findById(workoutId: string): Promise<WorkoutAggregate | null>;
  history(userId: string, query?: WorkoutHistoryQuery): Promise<WorkoutAggregate[]>;
}

export class PrismaWorkoutRepository implements WorkoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async findByIdempotencyKey(
    userId: string,
    clientRequestId: string,
  ): Promise<WorkoutRecord | null> {
    const row = await this.prisma.workout.findFirst({
      where: { userId, clientRequestId },
    });
    return row ? workoutRowToRecord(row) : null;
  }

  async create(input: CreateWorkoutInput): Promise<WorkoutRecord> {
    const id = input.id ?? newUuidv7();
    return runDb(async () => {
      if (input.clientRequestId) {
        const existing = await this.findByIdempotencyKey(input.userId, input.clientRequestId);
        if (existing) return existing;
      }

      try {
        const row = await this.prisma.workout.create({
          data: {
            id,
            userId: input.userId,
            planId: input.planId ?? null,
            planVersionId: input.planVersionId ?? null,
            planSessionId: input.planSessionId ?? null,
            title: input.title ?? null,
            status: input.status ?? "planned",
            startedAt: new Date(input.startedAt),
            endedAt: input.endedAt ? new Date(input.endedAt) : null,
            notes: input.notes ?? null,
            clientRequestId: input.clientRequestId ?? null,
            environmentKind: input.environmentKind ?? null,
            sessionClassification: input.sessionClassification ?? null,
          },
        });
        return workoutRowToRecord(row);
      } catch (error) {
        if (
          input.clientRequestId &&
          typeof error === "object" &&
          error !== null &&
          (error as { code?: string }).code === "P2002"
        ) {
          const existing = await this.findByIdempotencyKey(input.userId, input.clientRequestId);
          if (existing) return existing;
        }
        throw error;
      }
    });
  }

  async addExercise(
    workoutId: string,
    exerciseId: string,
    position?: number,
    notes?: string,
    options: AddExerciseOptions = {},
  ): Promise<WorkoutExerciseRecord> {
    return runDb(async () => {
      return this.prisma.$transaction(async (tx) => {
        const workout = await tx.workout.findUnique({ where: { id: workoutId } });
        if (!workout) throw new NotFoundError(`workout ${workoutId} not found`);
        if (FINAL_WORKOUT_STATUSES.includes(workout.status)) {
          throw new ImmutableRecordError("workout is finished; its exercises are frozen");
        }
        const exercise = await tx.exercise.findUnique({ where: { id: exerciseId } });
        if (!exercise) throw new NotFoundError(`exercise ${exerciseId} not found`);
        if (options.slotId) {
          const slot = await tx.trainingPlanExerciseSlot.findUnique({
            where: { id: options.slotId },
            select: { id: true },
          });
          if (!slot) throw new NotFoundError(`plan slot ${options.slotId} not found`);
        }

        let targetPosition = position;
        if (targetPosition === undefined) {
          const count = await tx.workoutExercise.count({ where: { workoutId } });
          targetPosition = count;
        }

        try {
          const row = await tx.workoutExercise.create({
            data: {
              id: newUuidv7(),
              workoutId,
              exerciseId,
              position: targetPosition,
              notes: notes ?? null,
              slotId: options.slotId ?? null,
              substitutedFromExerciseId: options.substitutedFromExerciseId ?? null,
              performanceSource: options.performanceSource ?? null,
              substitutionReason: options.substitutionReason ?? null,
            },
          });
          return {
            id: row.id,
            workoutId: row.workoutId,
            exerciseId: row.exerciseId,
            position: row.position,
            notes: row.notes ?? undefined,
            ...(row.slotId ? { slotId: row.slotId } : {}),
            ...(row.substitutedFromExerciseId
              ? { substitutedFromExerciseId: row.substitutedFromExerciseId }
              : {}),
            ...(row.performanceSource
              ? { performanceSource: row.performanceSource as PerformanceSource }
              : {}),
            ...(row.substitutionReason ? { substitutionReason: row.substitutionReason } : {}),
            sets: [],
            createdAt: toTimestamp(row.createdAt),
            updatedAt: toTimestamp(row.updatedAt),
          };
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            (error as { code?: string }).code === "P2002"
          ) {
            throw new ConflictError(`position ${targetPosition} already used in this workout`, {
              cause: error,
            });
          }
          throw error;
        }
      });
    });
  }

  async addSet(input: AddSetInput): Promise<ExerciseSetRecord> {
    const id = input.id ?? newUuidv7();
    return runDb(async () => {
      return this.prisma.$transaction(async (tx) => {
        const group = await tx.workoutExercise.findUnique({
          where: { id: input.workoutExerciseId },
          include: { workout: { select: { status: true } } },
        });
        if (!group) throw new NotFoundError(`workout exercise ${input.workoutExerciseId} not found`);
        if (FINAL_WORKOUT_STATUSES.includes(group.workout.status)) {
          throw new ImmutableRecordError("workout is finished; its sets are frozen");
        }

        if (input.clientRequestId) {
          const existing = await tx.exerciseSet.findFirst({
            where: {
              workoutExerciseId: input.workoutExerciseId,
              clientRequestId: input.clientRequestId,
            },
          });
          if (existing) return setRowToRecord(existing, group.exerciseId);
        }

        let position = input.position;
        if (position === undefined) {
          position = await tx.exerciseSet.count({
            where: { workoutExerciseId: input.workoutExerciseId },
          });
        }

        const loadKind =
          input.loadKind ?? inferLoadKindFromColumns(input);

        try {
          const row = await tx.exerciseSet.create({
            data: {
              id,
              workoutExerciseId: input.workoutExerciseId,
              position,
              kind: input.kind,
              loadKg: input.loadKg ?? null,
              addedLoadKg: input.addedLoadKg ?? null,
              reps: input.reps ?? null,
              distanceMeters: input.distanceMeters ?? null,
              durationSeconds: input.durationSeconds ?? null,
              rir: input.rir ?? null,
              rpe: input.rpe ?? null,
              notes: input.notes ?? null,
              loadKind,
              assistanceLoadKg: input.assistanceLoadKg ?? null,
              clientRequestId: input.clientRequestId ?? null,
            },
          });
          return setRowToRecord(row, group.exerciseId);
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            (error as { code?: string }).code === "P2002"
          ) {
            if (input.clientRequestId) {
              const existing = await tx.exerciseSet.findFirst({
                where: {
                  workoutExerciseId: input.workoutExerciseId,
                  clientRequestId: input.clientRequestId,
                },
              });
              if (existing) return setRowToRecord(existing, group.exerciseId);
            }
            throw new ConflictError(`position ${position} already used for this exercise`, {
              cause: error,
            });
          }
          throw error;
        }
      });
    });
  }

  async complete(
    workoutId: string,
    status: WorkoutStatus = "completed",
    endedAt?: Timestamp,
  ): Promise<WorkoutRecord> {
    return runDb(async () => {
      const workout = await this.prisma.workout.findUnique({ where: { id: workoutId } });
      if (!workout) throw new NotFoundError(`workout ${workoutId} not found`);
      if (FINAL_WORKOUT_STATUSES.includes(workout.status)) {
        throw new ConflictError(`workout already finished with status ${workout.status}`);
      }
      const row = await this.prisma.workout.update({
        where: { id: workoutId },
        data: {
          status,
          endedAt: endedAt ? new Date(endedAt) : workout.endedAt ?? new Date(),
        },
      });
      return workoutRowToRecord(row);
    });
  }

  async findById(workoutId: string): Promise<WorkoutAggregate | null> {
    return runDb(async () => {
      const row = await this.prisma.workout.findUnique({
        where: { id: workoutId },
        include: WORKOUT_INCLUDE,
      });
      return row ? workoutAggregateRowToRecord(row) : null;
    });
  }

  async history(userId: string, query: WorkoutHistoryQuery = {}): Promise<WorkoutAggregate[]> {
    return runDb(async () => {
      const rows = await this.prisma.workout.findMany({
        where: {
          userId,
          ...(query.from || query.to
            ? {
                startedAt: {
                  ...(query.from ? { gte: new Date(query.from) } : {}),
                  ...(query.to ? { lte: new Date(query.to) } : {}),
                },
              }
            : {}),
        },
        include: WORKOUT_INCLUDE,
        orderBy: { startedAt: "desc" },
        take: boundedLimit(query.limit, 50),
      });
      return rows.map(workoutAggregateRowToRecord);
    });
  }
}