import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  CalendarDate,
  ExerciseSlot,
  SessionTemplate,
  SetKind,
  Timestamp,
  WorkoutStatus,
} from "@fitcoach/domain";
import { ConflictError, ImmutableRecordError, NotFoundError } from "../errors";
import { newUuidv7 } from "../ids";
import { decimalToNumber, toCalendarDate, toTimestamp } from "../mapping";
import { boundedLimit, runDb } from "./util";

// ---------------------------------------------------------------------------
// Plan records
// ---------------------------------------------------------------------------

interface PlanRow {
  id: string;
  userId: string;
  name: string;
  status: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PlanVersionRow {
  id: string;
  planId: string;
  versionNumber: number;
  startsOn: Date;
  endsOn: Date | null;
  rationaleNotes: string | null;
  createdAt: Date;
}

interface PlanSessionRow {
  id: string;
  versionId: string;
  name: string;
  weekdayHint: number | null;
  position: number;
}

interface PlanSlotRow {
  id: string;
  sessionId: string;
  exerciseId: string;
  targetSets: number | null;
  repMin: number | null;
  repMax: number | null;
  targetRir: unknown;
  restSeconds: number | null;
  position: number;
  substitutionExerciseIds: string[] | null;
  notes: string | null;
}

export interface PlanVersionRecord {
  id: string;
  planId: string;
  versionNumber: number;
  startsOn: CalendarDate;
  endsOn?: CalendarDate;
  rationaleNotes?: string;
  createdAt: string;
  sessions: SessionTemplate[];
}

export interface PlanAggregate {
  id: string;
  userId: string;
  name: string;
  status: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  versions: PlanVersionRecord[];
}

function slotRowToRecord(row: PlanSlotRow): ExerciseSlot {
  const hasRange = row.repMin !== null || row.repMax !== null;
  return {
    id: row.id,
    exerciseId: row.exerciseId,
    targetSets: row.targetSets ?? 0,
    targetRepRange:
      hasRange && row.repMin !== null && row.repMax !== null
        ? { min: row.repMin, max: row.repMax }
        : undefined,
    targetRir: decimalToNumber(row.targetRir),
    restSeconds: row.restSeconds ?? undefined,
    substitutionExerciseIds: row.substitutionExerciseIds ?? undefined,
    notes: row.notes ?? undefined,
  };
}

interface PlanSessionWithSlots extends PlanSessionRow {
  slots: PlanSlotRow[];
}

function sessionRowToRecord(row: PlanSessionWithSlots): SessionTemplate {
  return {
    id: row.id,
    name: row.name,
    weekdayHint: row.weekdayHint ?? undefined,
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
    versionNumber: row.versionNumber,
    startsOn: toCalendarDate(row.startsOn),
    endsOn: row.endsOn ? toCalendarDate(row.endsOn) : undefined,
    rationaleNotes: row.rationaleNotes ?? undefined,
    createdAt: toTimestamp(row.createdAt),
    sessions: row.sessions
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(sessionRowToRecord),
  };
}

interface PlanWithVersions extends PlanRow {
  versions: PlanVersionWithSessions[];
}

function planRowToRecord(row: PlanWithVersions): PlanAggregate {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    status: row.status,
    notes: row.notes ?? undefined,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
    versions: row.versions.slice().sort((a, b) => a.versionNumber - b.versionNumber).map(versionRowToRecord),
  };
}

const PLAN_INCLUDE = {
  versions: {
    include: {
      sessions: {
        include: { slots: { orderBy: { position: "asc" as const } } },
        orderBy: { position: "asc" as const },
      },
    },
    orderBy: { versionNumber: "asc" as const },
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
  createdAt: Date;
  updatedAt: Date;
}

interface WorkoutExerciseRow {
  id: string;
  workoutId: string;
  exerciseId: string;
  position: number;
  notes: string | null;
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
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
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
  repMin?: number;
  repMax?: number;
  targetRir?: number;
  restSeconds?: number;
  substitutionExerciseIds?: readonly string[];
  notes?: string;
}

export interface PlanSessionInput {
  name: string;
  weekdayHint?: number;
  slots: readonly PlanSlotInput[];
}

export interface PlanVersionInput {
  startsOn: CalendarDate;
  endsOn?: CalendarDate;
  rationaleNotes?: string;
  sessions: readonly PlanSessionInput[];
}

export interface CreatePlanInput {
  id?: string;
  userId: string;
  name: string;
  status?: string;
  notes?: string;
  version: PlanVersionInput;
}

export interface TrainingPlanRepository {
  create(input: CreatePlanInput): Promise<PlanAggregate>;
  /** Appends version N+1 with frozen content (§7). */
  addVersion(planId: string, version: PlanVersionInput): Promise<PlanVersionRecord>;
  findById(planId: string): Promise<PlanAggregate | null>;
  findActive(userId: string): Promise<PlanAggregate | null>;
  listForUser(userId: string): Promise<PlanAggregate[]>;
  setStatus(planId: string, status: string): Promise<PlanAggregate>;
}

function parseDate(value: CalendarDate): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

async function createVersionRows(
  tx: Prisma.TransactionClient,
  versionId: string,
  version: PlanVersionInput,
): Promise<void> {
  for (const [sessionIndex, session] of version.sessions.entries()) {
    const sessionRow = await tx.trainingPlanSession.create({
      data: {
        id: newUuidv7(),
        versionId,
        name: session.name,
        weekdayHint: session.weekdayHint ?? null,
        position: sessionIndex,
      },
    });
    for (const [slotIndex, slot] of session.slots.entries()) {
      await tx.trainingPlanExerciseSlot.create({
        data: {
          id: newUuidv7(),
          sessionId: sessionRow.id,
          exerciseId: slot.exerciseId,
          targetSets: slot.targetSets ?? null,
          repMin: slot.repMin ?? null,
          repMax: slot.repMax ?? null,
          targetRir: slot.targetRir ?? null,
          restSeconds: slot.restSeconds ?? null,
          position: slotIndex,
          substitutionExerciseIds: slot.substitutionExerciseIds
            ? [...slot.substitutionExerciseIds]
            : [],
          notes: slot.notes ?? null,
        },
      });
    }
  }
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

        await tx.trainingPlan.create({
          data: {
            id: planId,
            userId: input.userId,
            name: input.name,
            status: input.status ?? "draft",
            notes: input.notes ?? null,
          },
        });
        await tx.trainingPlanVersion.create({
          data: {
            id: versionId,
            planId,
            versionNumber: 1,
            startsOn: parseDate(input.version.startsOn),
            endsOn: input.version.endsOn ? parseDate(input.version.endsOn) : null,
            rationaleNotes: input.version.rationaleNotes ?? null,
          },
        });
        await createVersionRows(tx, versionId, input.version);

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

        const highest = await tx.trainingPlanVersion.aggregate({
          where: { planId },
          _max: { versionNumber: true },
        });
        const nextNumber = (highest._max.versionNumber ?? 0) + 1;

        await tx.trainingPlanVersion.create({
          data: {
            id: versionId,
            planId,
            versionNumber: nextNumber,
            startsOn: parseDate(version.startsOn),
            endsOn: version.endsOn ? parseDate(version.endsOn) : null,
            rationaleNotes: version.rationaleNotes ?? null,
          },
        });
        await createVersionRows(tx, versionId, version);

        const created = await tx.trainingPlanVersion.findUnique({
          where: { id: versionId },
          include: {
            sessions: {
              include: { slots: { orderBy: { position: "asc" } } },
              orderBy: { position: "asc" },
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
      const row = await this.prisma.trainingPlan.findFirst({
        where: { userId, status: "active" },
        include: PLAN_INCLUDE,
      });
      return row ? planRowToRecord(row) : null;
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
  /** Idempotency key (§15): a retry with the same key returns the same row. */
  clientRequestId?: string;
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
  notes?: string;
}

export interface WorkoutHistoryQuery {
  limit?: number;
  from?: Timestamp;
  to?: Timestamp;
}

export interface WorkoutRepository {
  /** Idempotent on (userId, clientRequestId); returns the existing row on replay. */
  create(input: CreateWorkoutInput): Promise<WorkoutRecord>;
  /** Appends an exercise group; position defaults to the next slot. */
  addExercise(workoutId: string, exerciseId: string, position?: number, notes?: string): Promise<WorkoutExerciseRecord>;
  addSet(input: AddSetInput): Promise<ExerciseSetRecord>;
  /** Transitions an open workout to a final status. */
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
          },
        });
        return workoutRowToRecord(row);
      } catch (error) {
        // Lost idempotency race: another request created the same key.
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
            },
          });
          return {
            id: row.id,
            workoutId: row.workoutId,
            exerciseId: row.exerciseId,
            position: row.position,
            notes: row.notes ?? undefined,
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

        let position = input.position;
        if (position === undefined) {
          position = await tx.exerciseSet.count({
            where: { workoutExerciseId: input.workoutExerciseId },
          });
        }

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
            },
          });
          return setRowToRecord(row, group.exerciseId);
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            (error as { code?: string }).code === "P2002"
          ) {
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
