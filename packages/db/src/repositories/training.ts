import type { Prisma, PrismaClient } from "@prisma/client";
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
// Plan records
// ---------------------------------------------------------------------------

interface PlanRow {
  id: string;
  userId: string;
  name: string;
  status: string;
  notes: string | null;
  kind: string;
  environmentKind: string | null;
  effectiveUntil: Date | null;
  temporaryForVersionId: string | null;
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
  lifecycleStatus: string;
  generationReason: string | null;
  parentVersionId: string | null;
  supersededAt: Date | null;
  configVersion: string | null;
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
  /** Phase 3 lifecycle: only this and `supersededAt` may ever change. */
  lifecycleStatus: string;
  generationReason?: PlanGenerationReason;
  parentVersionId?: string;
  supersededAt?: Timestamp;
  configVersion?: string;
  createdAt: string;
  sessions: SessionTemplate[];
}

export interface PlanAggregate {
  id: string;
  userId: string;
  name: string;
  status: string;
  notes?: string;
  /** `primary` or `temporary_environment` (Phase 3.1 §21). */
  kind: string;
  /** Environment the plan is intended for; absent = gym default. */
  environmentKind?: string;
  /** Last user-local day a temporary plan applies (inclusive). */
  effectiveUntil?: CalendarDate;
  /** Plan version a temporary plan was adapted from. */
  temporaryForVersionId?: string;
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
    lifecycleStatus: row.lifecycleStatus,
    generationReason: (row.generationReason as PlanGenerationReason | null) ?? undefined,
    parentVersionId: row.parentVersionId ?? undefined,
    supersededAt: row.supersededAt ? toTimestamp(row.supersededAt) : undefined,
    configVersion: row.configVersion ?? undefined,
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
    kind: row.kind ?? "primary",
    ...(row.environmentKind ? { environmentKind: row.environmentKind } : {}),
    ...(row.effectiveUntil ? { effectiveUntil: toCalendarDate(row.effectiveUntil) } : {}),
    ...(row.temporaryForVersionId ? { temporaryForVersionId: row.temporaryForVersionId } : {}),
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
  /** Phase 3.1: declared or inferred load kind. */
  loadKind?: PerformanceLoadKind;
  /** Assistance that reduced effective load (assisted pull-ups, etc.). */
  assistanceLoadKg?: number;
  /** Set-level idempotency key. */
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
  /** Planned slot this group fulfilled (Phase 3.1 link). */
  slotId?: string;
  /** Exercise this one replaced, when performed as a substitution. */
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
  /** Environment the session was actually performed in. */
  environmentKind?: TrainingEnvironmentKind;
  /** planned | adapted | makeup | unplanned. */
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

/**
 * Infer the load kind from the recorded columns so a bodyweight set is stored
 * as bodyweight rather than as "no load". Mirrors the domain contract in
 * `@fitcoach/fitness-core` (`inferLoadKind`) without importing it, because the
 * persistence layer must not depend on the engine package.
 */
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
  /** Why this version exists (Phase 3); defaults to `plan_adjustment`. */
  generationReason?: PlanGenerationReason;
  /** Previous version this one supersedes; defaults to the current active one. */
  parentVersionId?: string;
  /** Training configuration version that produced this content. */
  configVersion?: string;
  sessions: readonly PlanSessionInput[];
}

export interface CreatePlanInput {
  id?: string;
  userId: string;
  name: string;
  status?: string;
  notes?: string;
  /** `primary` (default) or `temporary_environment` (Phase 3.1 §21). */
  kind?: "primary" | "temporary_environment";
  environmentKind?: string;
  /** Required (with `temporaryForVersionId`) when `kind` is temporary. */
  effectiveUntil?: CalendarDate;
  temporaryForVersionId?: string;
  version: PlanVersionInput;
}

/** Why a new plan version was created (Phase 3 §3). */
export type PlanGenerationReason =
  | "initial_plan"
  | "plan_adjustment"
  | "exercise_substitution"
  | "volume_adjustment"
  | "frequency_adjustment"
  | "split_adjustment"
  | "progression_adjustment"
  | "no_change";

/** The structured, reproducible decision behind a plan version (Phase 3 §23). */
export interface PlanDecisionRecord {
  id: string;
  versionId: string;
  decision: string;
  reasonCodes: string[];
  evidence: string;
  satisfiedConstraints: string[];
  violatedConstraints: string[];
  affectedMuscles: string[];
  affectedExercises: string[];
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
  confidence?: number;
  assumptions: string[];
  configVersion?: string;
  createdAt: string;
}

export interface CreateDecisionInput {
  versionId: string;
  decision: string;
  reasonCodes?: readonly string[];
  evidence: string;
  satisfiedConstraints?: readonly string[];
  violatedConstraints?: readonly string[];
  affectedMuscles?: readonly string[];
  affectedExercises?: readonly string[];
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
  confidence?: number;
  assumptions?: readonly string[];
  configVersion?: string;
}

/** One constraint evaluated for a version (Phase 3 §15). */
export interface PlanConstraintInput {
  constraintKey: string;
  kind: string;
  label: string;
  isHard?: boolean;
  result: "satisfied" | "violated" | "warning";
  violationDetail?: string;
  warningDetail?: string;
}

export interface PlanConstraintRecord extends PlanConstraintInput {
  id: string;
  versionId: string;
}

/** Deterministic progression rule attached to one planned slot (Phase 3 §19). */
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

export interface TrainingPlanRepository {
  create(input: CreatePlanInput): Promise<PlanAggregate>;
  /** Appends version N+1 with frozen content (§7); supersedes the active one. */
  addVersion(planId: string, version: PlanVersionInput): Promise<PlanVersionRecord>;
  findById(planId: string): Promise<PlanAggregate | null>;
  findActive(userId: string): Promise<PlanAggregate | null>;
  listForUser(userId: string): Promise<PlanAggregate[]>;
  /** Temporary environment-adapted plans, newest first (Phase 3.1 §21). */
  listTemporary(userId: string): Promise<PlanAggregate[]>;
  setStatus(planId: string, status: string): Promise<PlanAggregate>;
  /** Appends the structured decision behind a version (Phase 3 §23). */
  recordDecision(input: CreateDecisionInput): Promise<PlanDecisionRecord>;
  /** Decisions for one version, oldest first — the auditable trail. */
  listDecisions(versionId: string): Promise<PlanDecisionRecord[]>;
  /** Replaces the version's constraint evaluation (delete + insert, §7). */
  replaceConstraints(versionId: string, constraints: readonly PlanConstraintInput[]): Promise<PlanConstraintRecord[]>;
  listConstraints(versionId: string): Promise<PlanConstraintRecord[]>;
  /** Attaches (or replaces) the progression rule for one planned slot. */
  setProgressionRule(slotId: string, rule: ProgressionRuleInput): Promise<ProgressionRuleRecord>;
  listProgressionRules(versionId: string): Promise<ProgressionRuleRecord[]>;
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

// ---------------------------------------------------------------------------
// Phase 3 rows: decisions, constraints, progression rules
// ---------------------------------------------------------------------------

function decisionRowToRecord(row: {
  id: string;
  versionId: string;
  decision: string;
  reasonCodes: string[];
  evidence: string;
  satisfiedConstraints: string[];
  violatedConstraints: string[];
  affectedMuscles: string[];
  affectedExercises: string[];
  beforeSnapshot: Prisma.JsonValue | null;
  afterSnapshot: Prisma.JsonValue | null;
  confidence: unknown;
  assumptions: string[];
  configVersion: string | null;
  createdAt: Date;
}): PlanDecisionRecord {
  return {
    id: row.id,
    versionId: row.versionId,
    decision: row.decision,
    reasonCodes: [...row.reasonCodes],
    evidence: row.evidence,
    satisfiedConstraints: [...row.satisfiedConstraints],
    violatedConstraints: [...row.violatedConstraints],
    affectedMuscles: [...row.affectedMuscles],
    affectedExercises: [...row.affectedExercises],
    beforeSnapshot: row.beforeSnapshot ?? undefined,
    afterSnapshot: row.afterSnapshot ?? undefined,
    confidence: decimalToNumber(row.confidence),
    assumptions: [...row.assumptions],
    configVersion: row.configVersion ?? undefined,
    createdAt: toTimestamp(row.createdAt),
  };
}

function constraintRowToRecord(row: {
  id: string;
  versionId: string;
  constraintKey: string;
  kind: string;
  label: string;
  isHard: boolean;
  result: string;
  violationDetail: string | null;
  warningDetail: string | null;
}): PlanConstraintRecord {
  return {
    id: row.id,
    versionId: row.versionId,
    constraintKey: row.constraintKey,
    kind: row.kind,
    label: row.label,
    isHard: row.isHard,
    result: row.result as PlanConstraintInput["result"],
    violationDetail: row.violationDetail ?? undefined,
    warningDetail: row.warningDetail ?? undefined,
  };
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

        await tx.trainingPlan.create({
          data: {
            id: planId,
            userId: input.userId,
            name: input.name,
            status: input.status ?? "draft",
            notes: input.notes ?? null,
            kind: input.kind ?? "primary",
            environmentKind: input.environmentKind ?? null,
            effectiveUntil: input.effectiveUntil ? parseDate(input.effectiveUntil) : null,
            temporaryForVersionId: input.temporaryForVersionId ?? null,
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
            lifecycleStatus: "active",
            generationReason: input.version.generationReason ?? "initial_plan",
            parentVersionId: null,
            configVersion: input.version.configVersion ?? null,
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

        // Phase 3: supersede the previously active version. Only the two
        // lifecycle columns move — the old version's content stays frozen
        // (trigger `training_plan_versions_lifecycle_only`).
        const previousActive = await tx.trainingPlanVersion.findFirst({
          where: { planId, lifecycleStatus: "active" },
          orderBy: { versionNumber: "desc" },
          select: { id: true },
        });
        if (previousActive) {
          await tx.trainingPlanVersion.updateMany({
            where: { id: previousActive.id },
            data: { lifecycleStatus: "superseded", supersededAt: new Date() },
          });
        }

        await tx.trainingPlanVersion.create({
          data: {
            id: versionId,
            planId,
            versionNumber: nextNumber,
            startsOn: parseDate(version.startsOn),
            endsOn: version.endsOn ? parseDate(version.endsOn) : null,
            rationaleNotes: version.rationaleNotes ?? null,
            lifecycleStatus: "active",
            generationReason:
              version.generationReason ?? (nextNumber === 1 ? "initial_plan" : "plan_adjustment"),
            parentVersionId: version.parentVersionId ?? previousActive?.id ?? null,
            configVersion: version.configVersion ?? null,
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
      // Only the program of record: a temporary environment plan (Phase 3.1)
      // must never become "the active plan" — the gym plan stays authoritative
      // and is simply resumed when the environment changes back.
      const row = await this.prisma.trainingPlan.findFirst({
        where: { userId, status: "active", kind: "primary" },
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

  async listTemporary(userId: string): Promise<PlanAggregate[]> {
    return runDb(async () => {
      const rows = await this.prisma.trainingPlan.findMany({
        where: { userId, kind: "temporary_environment" },
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

  async recordDecision(input: CreateDecisionInput): Promise<PlanDecisionRecord> {
    const id = newUuidv7();
    return runDb(async () => {
      const version = await this.prisma.trainingPlanVersion.findUnique({
        where: { id: input.versionId },
        select: { id: true },
      });
      if (!version) throw new NotFoundError(`plan version ${input.versionId} not found`);

      const row = await this.prisma.trainingPlanDecision.create({
        data: {
          id,
          versionId: input.versionId,
          decision: input.decision,
          reasonCodes: [...(input.reasonCodes ?? [])],
          evidence: input.evidence,
          satisfiedConstraints: [...(input.satisfiedConstraints ?? [])],
          violatedConstraints: [...(input.violatedConstraints ?? [])],
          affectedMuscles: [...(input.affectedMuscles ?? [])],
          affectedExercises: [...(input.affectedExercises ?? [])],
          beforeSnapshot: (input.beforeSnapshot ?? undefined) as Prisma.InputJsonValue | undefined,
          afterSnapshot: (input.afterSnapshot ?? undefined) as Prisma.InputJsonValue | undefined,
          confidence: input.confidence,
          assumptions: [...(input.assumptions ?? [])],
          configVersion: input.configVersion ?? null,
        },
      });
      return decisionRowToRecord(row);
    });
  }

  async listDecisions(versionId: string): Promise<PlanDecisionRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.trainingPlanDecision.findMany({
        where: { versionId },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(decisionRowToRecord);
    });
  }

  async replaceConstraints(
    versionId: string,
    constraints: readonly PlanConstraintInput[],
  ): Promise<PlanConstraintRecord[]> {
    return runDb(async () => {
      return this.prisma.$transaction(async (tx) => {
        const version = await tx.trainingPlanVersion.findUnique({
          where: { id: versionId },
          select: { id: true },
        });
        if (!version) throw new NotFoundError(`plan version ${versionId} not found`);

        // The table rejects updates, so a re-evaluation is delete + insert.
        await tx.trainingPlanConstraint.deleteMany({ where: { versionId } });
        for (const constraint of constraints) {
          await tx.trainingPlanConstraint.create({
            data: {
              id: newUuidv7(),
              versionId,
              constraintKey: constraint.constraintKey,
              kind: constraint.kind,
              label: constraint.label,
              isHard: constraint.isHard ?? true,
              result: constraint.result,
              violationDetail: constraint.violationDetail ?? null,
              warningDetail: constraint.warningDetail ?? null,
            },
          });
        }
        const rows = await tx.trainingPlanConstraint.findMany({
          where: { versionId },
          orderBy: { constraintKey: "asc" },
        });
        return rows.map(constraintRowToRecord);
      });
    });
  }

  async listConstraints(versionId: string): Promise<PlanConstraintRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.trainingPlanConstraint.findMany({
        where: { versionId },
        orderBy: { constraintKey: "asc" },
      });
      return rows.map(constraintRowToRecord);
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

        // Rules are frozen with their slot: replace rather than update.
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
  /** Environment the session was performed in (Phase 3.1). */
  environmentKind?: TrainingEnvironmentKind;
  /** planned | adapted | makeup | unplanned. */
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
  /** Explicit load kind; inferred from the columns when omitted. */
  loadKind?: PerformanceLoadKind;
  /** Assistance load for assisted bodyweight work. */
  assistanceLoadKg?: number;
  notes?: string;
  /** Set-level idempotency key (§32): replays return the same set. */
  clientRequestId?: string;
}

/** Optional Phase 3.1 metadata for a workout-exercise group. */
export interface AddExerciseOptions {
  /** Planned slot this group fulfils. */
  slotId?: string;
  /** Exercise this one replaced, when performed as a substitution. */
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
  /** Idempotent on (userId, clientRequestId); returns the existing row on replay. */
  create(input: CreateWorkoutInput): Promise<WorkoutRecord>;
  /** Appends an exercise group; position defaults to the next slot. */
  addExercise(
    workoutId: string,
    exerciseId: string,
    position?: number,
    notes?: string,
    options?: AddExerciseOptions,
  ): Promise<WorkoutExerciseRecord>;
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
            environmentKind: input.environmentKind ?? null,
            sessionClassification: input.sessionClassification ?? null,
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

        // Set-level idempotency (§32): a retried submission returns the row it
        // already wrote instead of recording the set twice.
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
            // Lost idempotency race: another submission wrote the same key.
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
