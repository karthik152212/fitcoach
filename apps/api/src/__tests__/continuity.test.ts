/**
 * Phase 3.1 — training continuity integration journeys (§38).
 *
 * These exercise the real HTTP routes and the real planner + continuity
 * services against an in-memory repository bundle, covering the three
 * complete journeys from the spec:
 *
 *   Journey A — plan → log → evaluate → recommend → accept → evidence →
 *               progressionsCompleted becomes a REAL count.
 *   Journey B — gym plan → environment change → temporary home plan →
 *               home workout (adapted) → gym plan preserved → restore →
 *               history contains both environments.
 *   Journey C — planned session not performed → missed, never faked as
 *               completed, adherence stays correct.
 *
 * The engines themselves are unit-tested in fitness-core; what is verified
 * here is the wiring a user actually touches end to end.
 */

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type {
  ExerciseMuscleTarget,
  Goal,
  MuscleGroup,
  ProgressionDecisionEvent,
  ProgressionEvaluation,
  SessionTemplate,
  User,
  Profile,
  WorkoutStatus,
} from "@fitcoach/domain";
import type {
  AddExerciseOptions,
  AddSetInput,
  CreateDecisionInput,
  CreatePlanInput,
  CreateWorkoutInput,
  ExerciseKnowledgeRecord,
  PlanAggregate,
  PlanConstraintInput,
  PlanConstraintRecord,
  PlanDecisionRecord,
  PlanVersionInput,
  PlanVersionRecord,
  ProgressionRuleInput,
  ProgressionRuleRecord,
  Repositories,
  WorkoutAggregate,
} from "@fitcoach/db";
import { createServer } from "../server";
import { createServices } from "../services";

const USER_ID = "usr_continuity_test";
const GOAL_ID = "00000000-0000-4000-8000-0000000000aa";
const BARBELL = "00000000-0000-4000-8000-0000000000b1";
const BENCH = "00000000-0000-4000-8000-0000000000b2";
const DUMBBELL = "00000000-0000-4000-8000-0000000000b3";
const CABLE = "00000000-0000-4000-8000-0000000000b4";

function uuid(seed: number): string {
  return `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
}

// ---------------------------------------------------------------------------
// Synthetic catalog: gym-capable work plus equipment-free fallbacks so a
// no-equipment environment has real substitutions to offer (and real gaps to
// admit).
// ---------------------------------------------------------------------------

const MUSCLE_GROUPS: Record<string, MuscleGroup> = {
  pectoralis_major: "chest",
  deltoid_anterior: "front_delts",
  deltoid_lateral: "side_delts",
  latissimus_dorsi: "lats",
  trapezius: "traps",
  rhomboids: "upper_back",
  biceps_brachii: "biceps",
  triceps_brachii: "triceps",
  quadriceps: "quadriceps",
  hamstrings: "hamstrings",
  gluteus_maximus: "glutes",
  calves: "calves",
  abdominals: "abdominals",
};

function target(muscleSlug: string, role: ExerciseMuscleTarget["role"]): ExerciseMuscleTarget {
  const muscleGroup = MUSCLE_GROUPS[muscleSlug];
  if (!muscleGroup) throw new Error(`unknown muscle slug ${muscleSlug}`);
  return {
    muscleId: `muscle_${muscleSlug}`,
    muscleSlug,
    muscleDisplayName: muscleSlug,
    muscleGroup,
    role,
  };
}

interface CatalogSpec {
  id: string;
  slug: string;
  name: string;
  category: "compound" | "isolation";
  movementPattern: string;
  movementFunctions: string[];
  equipment: string[];
  roles: string[];
  targets: ExerciseMuscleTarget[];
}

const CATALOG: CatalogSpec[] = [
  {
    id: uuid(21),
    slug: "barbell_back_squat",
    name: "Barbell Back Squat",
    category: "compound",
    movementPattern: "squat",
    movementFunctions: ["squat", "knee_extension"],
    equipment: [BARBELL],
    roles: ["compound_movement"],
    targets: [target("quadriceps", "primary_mover"), target("gluteus_maximus", "secondary_mover")],
  },
  {
    id: uuid(22),
    slug: "barbell_bench_press",
    name: "Barbell Bench Press",
    category: "compound",
    movementPattern: "horizontal_push",
    movementFunctions: ["horizontal_press"],
    equipment: [BARBELL, BENCH],
    roles: ["compound_movement", "horizontal_push"],
    targets: [
      target("pectoralis_major", "primary_mover"),
      target("deltoid_anterior", "secondary_mover"),
      target("triceps_brachii", "secondary_mover"),
    ],
  },
  {
    id: uuid(23),
    slug: "barbell_row",
    name: "Barbell Row",
    category: "compound",
    movementPattern: "horizontal_pull",
    movementFunctions: ["horizontal_pull", "elbow_flexion"],
    equipment: [BARBELL],
    roles: ["compound_movement", "horizontal_pull"],
    targets: [
      target("latissimus_dorsi", "primary_mover"),
      target("rhomboids", "primary_mover"),
      target("trapezius", "secondary_mover"),
      target("biceps_brachii", "secondary_mover"),
    ],
  },
  {
    id: uuid(24),
    slug: "pull_up",
    name: "Pull-Up",
    category: "compound",
    movementPattern: "vertical_pull",
    movementFunctions: ["vertical_pull", "elbow_flexion"],
    equipment: [],
    roles: ["compound_movement", "vertical_pull"],
    targets: [
      target("latissimus_dorsi", "primary_mover"),
      target("biceps_brachii", "secondary_mover"),
    ],
  },
  {
    id: uuid(25),
    slug: "leg_press",
    name: "Leg Press",
    category: "compound",
    movementPattern: "squat",
    movementFunctions: ["squat", "knee_extension"],
    equipment: [],
    roles: ["compound_movement"],
    targets: [target("quadriceps", "primary_mover"), target("gluteus_maximus", "secondary_mover")],
  },
  {
    id: uuid(26),
    slug: "standing_calf_raise",
    name: "Standing Calf Raise",
    category: "isolation",
    movementPattern: "other",
    movementFunctions: ["plantar_flexion"],
    equipment: [],
    roles: ["isolation_movement"],
    targets: [target("calves", "primary_mover")],
  },
  {
    id: uuid(27),
    slug: "plank",
    name: "Plank",
    category: "isolation",
    movementPattern: "core",
    movementFunctions: ["anti_extension"],
    equipment: [],
    roles: ["isolation_movement"],
    targets: [target("abdominals", "primary_mover")],
  },
  {
    id: uuid(28),
    slug: "dumbbell_lateral_raise",
    name: "Dumbbell Lateral Raise",
    category: "isolation",
    movementPattern: "other",
    movementFunctions: ["shoulder_abduction"],
    equipment: [DUMBBELL],
    roles: ["isolation_movement"],
    targets: [target("deltoid_lateral", "primary_mover")],
  },
  {
    id: uuid(29),
    slug: "cable_pushdown",
    name: "Cable Pushdown",
    category: "isolation",
    movementPattern: "other",
    movementFunctions: ["elbow_extension"],
    equipment: [CABLE],
    roles: ["isolation_movement"],
    targets: [target("triceps_brachii", "primary_mover")],
  },
  {
    id: uuid(30),
    slug: "push_up",
    name: "Push-Up",
    category: "compound",
    movementPattern: "horizontal_push",
    movementFunctions: ["horizontal_press"],
    equipment: [],
    roles: ["compound_movement", "horizontal_push"],
    targets: [
      target("pectoralis_major", "primary_mover"),
      target("deltoid_anterior", "secondary_mover"),
      target("triceps_brachii", "secondary_mover"),
    ],
  },
  {
    id: uuid(31),
    slug: "bench_dips",
    name: "Bench Dips",
    category: "compound",
    movementPattern: "other",
    movementFunctions: ["elbow_extension"],
    equipment: [],
    roles: ["isolation_movement"],
    targets: [
      target("triceps_brachii", "primary_mover"),
      target("pectoralis_major", "secondary_mover"),
    ],
  },
  {
    id: uuid(32),
    slug: "side_lying_lateral_raise",
    name: "Side-Lying Lateral Raise",
    category: "isolation",
    movementPattern: "other",
    movementFunctions: ["shoulder_abduction"],
    equipment: [],
    roles: ["isolation_movement"],
    targets: [target("deltoid_lateral", "primary_mover")],
  },
];

function catalogRecords(): ExerciseKnowledgeRecord[] {
  return CATALOG.map((spec, index) => ({
    id: spec.id,
    slug: spec.slug,
    name: spec.name,
    aliases: [],
    category: spec.category,
    movementPattern: spec.movementPattern,
    unilateral: false,
    requiredEquipmentIds: spec.equipment,
    movementFunctions: spec.movementFunctions,
    primaryMovementFunction: spec.movementFunctions[0],
    roles: spec.roles,
    targets: spec.targets,
    knowledgeVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    isActive: true,
    instructions: `${spec.name} technique notes.`,
    externalSourceId: `seed_${index}`,
  })) as unknown as ExerciseKnowledgeRecord[];
}

const catalogSpec = (id: string): CatalogSpec | undefined =>
  CATALOG.find((spec) => spec.id === id);

// ---------------------------------------------------------------------------
// In-memory store + repositories
// ---------------------------------------------------------------------------

interface InMemoryStore {
  plans: Map<string, PlanAggregate>;
  decisions: Map<string, PlanDecisionRecord[]>;
  constraints: Map<string, PlanConstraintRecord[]>;
  rules: Map<string, ProgressionRuleRecord[]>;
  workouts: WorkoutAggregate[];
  periods: Array<{
    id: string;
    userId: string;
    kind: string;
    availableEquipmentIds: string[];
    unavailableEquipmentIds: string[];
    effectiveFrom: string;
    effectiveTo?: string;
    reason?: string;
    isTemporary: boolean;
    notes?: string;
    createdAt: string;
  }>;
  evaluations: Map<string, ProgressionEvaluation>;
  events: ProgressionDecisionEvent[];
}

function createStore(): InMemoryStore {
  return {
    plans: new Map(),
    decisions: new Map(),
    constraints: new Map(),
    rules: new Map(),
    workouts: [],
    periods: [],
    evaluations: new Map(),
    events: [],
  };
}

let counters = {
  plan: 0,
  version: 0,
  session: 0,
  slot: 0,
  decision: 0,
  constraint: 0,
  rule: 0,
  workout: 0,
  group: 0,
  set: 0,
  evaluation: 0,
  event: 0,
  period: 0,
};

function resetCounters(): void {
  counters = {
    plan: 0,
    version: 0,
    session: 0,
    slot: 0,
    decision: 0,
    constraint: 0,
    rule: 0,
    workout: 0,
    group: 0,
    set: 0,
    evaluation: 0,
    event: 0,
    period: 0,
  };
}

function versionRecord(
  planId: string,
  versionNumber: number,
  input: PlanVersionInput,
  parentVersionId?: string,
): PlanVersionRecord {
  const sessions: SessionTemplate[] = input.sessions.map((session) => ({
    id: uuid(1000 + ++counters.session),
    name: session.name,
    ...(session.weekdayHint !== undefined ? { weekdayHint: session.weekdayHint } : {}),
    slots: session.slots.map((slot) => ({
      id: uuid(2000 + ++counters.slot),
      exerciseId: slot.exerciseId,
      targetSets: slot.targetSets ?? 0,
      ...(slot.repMin !== undefined || slot.repMax !== undefined
        ? {
            targetRepRange: { min: slot.repMin ?? 0, max: slot.repMax ?? (slot.repMin ?? 0) + 5 },
          }
        : {}),
      ...(slot.targetRir !== undefined ? { targetRir: slot.targetRir } : {}),
      ...(slot.restSeconds !== undefined ? { restSeconds: slot.restSeconds } : {}),
      ...(slot.substitutionExerciseIds
        ? { substitutionExerciseIds: [...slot.substitutionExerciseIds] }
        : {}),
      ...(slot.notes !== undefined ? { notes: slot.notes } : {}),
    })),
  }));

  return {
    id: uuid(3000 + ++counters.version + versionNumber),
    planId,
    versionNumber,
    startsOn: input.startsOn,
    ...(input.endsOn !== undefined ? { endsOn: input.endsOn } : {}),
    ...(input.rationaleNotes !== undefined ? { rationaleNotes: input.rationaleNotes } : {}),
    lifecycleStatus: "active",
    ...(input.generationReason !== undefined ? { generationReason: input.generationReason } : {}),
    ...(parentVersionId !== undefined ? { parentVersionId } : {}),
    ...(input.configVersion !== undefined ? { configVersion: input.configVersion } : {}),
    createdAt: "2026-01-01T00:00:00.000Z",
    sessions,
  };
}

function createRepositories(store: InMemoryStore): Repositories {
  const profile = {
    userId: USER_ID,
    trainingExperience: "intermediate",
    trainingDaysPerWeek: 4,
    sessionDurationMinutes: 60,
  } as unknown as Profile;

  const user = {
    id: USER_ID,
    email: "continuity@example.test",
    displayName: "Continuity Test",
    timezone: "UTC",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as User;

  const goal = {
    id: GOAL_ID,
    userId: USER_ID,
    kind: "bodybuilding",
    priorities: ["chest_development", "shoulder_width"],
    effectiveFrom: "2026-01-01",
    status: "active",
  } as unknown as Goal;

  const trainingPlans = {
    async create(input: CreatePlanInput) {
      const id = uuid(5000 + ++counters.plan);
      const version = versionRecord(id, 1, input.version);
      const plan: PlanAggregate = {
        id,
        userId: input.userId,
        name: input.name,
        status: input.status ?? "active",
        kind: input.kind ?? "primary",
        ...(input.environmentKind ? { environmentKind: input.environmentKind } : {}),
        ...(input.effectiveUntil ? { effectiveUntil: input.effectiveUntil } : {}),
        ...(input.temporaryForVersionId ? { temporaryForVersionId: input.temporaryForVersionId } : {}),
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        versions: [version],
      };
      store.plans.set(id, plan);
      return plan;
    },
    async addVersion(planId: string, input: PlanVersionInput) {
      const plan = store.plans.get(planId);
      if (!plan) throw new Error(`plan ${planId} not found`);
      const previous = plan.versions.at(-1);
      if (previous) previous.lifecycleStatus = "superseded";
      const version = versionRecord(planId, (previous?.versionNumber ?? 0) + 1, input, previous?.id);
      plan.versions.push(version);
      return version;
    },
    async findById(planId: string) {
      return store.plans.get(planId) ?? null;
    },
    async findActive(userId: string) {
      // Primary program of record only: a temporary environment plan must
      // never become "the active plan" (§21).
      return (
        [...store.plans.values()]
          .filter(
            (plan) =>
              plan.userId === userId && plan.status === "active" && (plan.kind ?? "primary") === "primary",
          )
          .at(-1) ?? null
      );
    },
    async listForUser(userId: string) {
      return [...store.plans.values()].filter((plan) => plan.userId === userId);
    },
    async listTemporary(userId: string) {
      return [...store.plans.values()].filter(
        (plan) => plan.userId === userId && plan.kind === "temporary_environment",
      );
    },
    async setStatus(planId: string, status: string) {
      const plan = store.plans.get(planId);
      if (!plan) throw new Error(`plan ${planId} not found`);
      plan.status = status;
      return plan;
    },
    async recordDecision(input: CreateDecisionInput) {
      const record: PlanDecisionRecord = {
        id: uuid(7000 + ++counters.decision),
        versionId: input.versionId,
        decision: input.decision,
        reasonCodes: [...(input.reasonCodes ?? [])],
        evidence: input.evidence,
        satisfiedConstraints: [...(input.satisfiedConstraints ?? [])],
        violatedConstraints: [...(input.violatedConstraints ?? [])],
        affectedMuscles: [...(input.affectedMuscles ?? [])],
        affectedExercises: [...(input.affectedExercises ?? [])],
        ...(input.beforeSnapshot !== undefined ? { beforeSnapshot: input.beforeSnapshot } : {}),
        ...(input.afterSnapshot !== undefined ? { afterSnapshot: input.afterSnapshot } : {}),
        ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
        assumptions: [...(input.assumptions ?? [])],
        ...(input.configVersion !== undefined ? { configVersion: input.configVersion } : {}),
        createdAt: "2026-01-02T00:00:00.000Z",
      };
      const list = store.decisions.get(input.versionId) ?? [];
      list.push(record);
      store.decisions.set(input.versionId, list);
      return record;
    },
    async listDecisions(versionId: string) {
      return store.decisions.get(versionId) ?? [];
    },
    async replaceConstraints(versionId: string, inputs: readonly PlanConstraintInput[]) {
      const records = inputs.map((item) => ({
        ...item,
        id: uuid(8000 + ++counters.constraint),
        versionId,
      }));
      store.constraints.set(versionId, records);
      return records;
    },
    async listConstraints(versionId: string) {
      return store.constraints.get(versionId) ?? [];
    },
    async setProgressionRule(slotId: string, rule: ProgressionRuleInput) {
      const record: ProgressionRuleRecord = { ...rule, id: uuid(9000 + ++counters.rule), slotId };
      const list = store.rules.get(slotId) ?? [];
      list.push(record);
      store.rules.set(slotId, list);
      return record;
    },
    async listProgressionRules(versionId: string) {
      const version = [...store.plans.values()]
        .flatMap((plan) => plan.versions)
        .find((candidate) => candidate.id === versionId);
      if (!version) return [];
      return version.sessions.flatMap((session) =>
        session.slots.flatMap((slot) => store.rules.get(slot.id) ?? []),
      );
    },
  };

  const trainingEnvironments = {
    async createPeriod(input: {
      userId: string;
      kind: string;
      availableEquipmentIds?: readonly string[];
      unavailableEquipmentIds?: readonly string[];
      effectiveFrom: string;
      effectiveTo?: string;
      reason?: string;
      isTemporary?: boolean;
      notes?: string;
    }) {
      const open = store.periods
        .filter((row) => row.userId === input.userId && row.effectiveTo === undefined)
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
      if (open && open.effectiveFrom >= input.effectiveFrom) {
        throw new Error("a new environment must start after the currently open environment's start");
      }
      if (open) open.effectiveTo = input.effectiveFrom;
      if (
        store.periods.some(
          (row) =>
            row.userId === input.userId &&
            row.kind === input.kind &&
            row.effectiveFrom === input.effectiveFrom,
        )
      ) {
        const error = new Error("unique constraint") as Error & { code?: string };
        error.code = "P2002";
        throw error;
      }
      const record = {
        id: uuid(11000 + ++counters.period),
        userId: input.userId,
        kind: input.kind,
        availableEquipmentIds: [...(input.availableEquipmentIds ?? [])].sort(),
        unavailableEquipmentIds: [...(input.unavailableEquipmentIds ?? [])].sort(),
        effectiveFrom: input.effectiveFrom,
        ...(input.effectiveTo ? { effectiveTo: input.effectiveTo } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        isTemporary: input.isTemporary ?? true,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      store.periods.push(record);
      return { ...record };
    },
    async listPeriods(userId: string) {
      return store.periods
        .filter((row) => row.userId === userId)
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
        .map((row) => ({ ...row }));
    },
    async findActive(userId: string, asOf: string) {
      const covering = store.periods
        .filter(
          (row) =>
            row.userId === userId &&
            row.effectiveFrom <= asOf &&
            (row.effectiveTo === undefined || row.effectiveTo > asOf),
        )
        .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
      const active = covering.at(-1);
      return active ? { ...active } : null;
    },
    async closePeriod(periodId: string, effectiveTo: string) {
      const row = store.periods.find((candidate) => candidate.id === periodId);
      if (!row) throw new Error(`period ${periodId} not found`);
      if (effectiveTo <= row.effectiveFrom) {
        throw new Error("effectiveTo must be after effectiveFrom");
      }
      row.effectiveTo = effectiveTo;
      return { ...row };
    },
    async closeOpenPeriod(userId: string, effectiveTo: string) {
      const open = store.periods
        .filter((row) => row.userId === userId && row.effectiveTo === undefined)
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
      if (!open) return null;
      if (effectiveTo <= open.effectiveFrom) return { ...open };
      open.effectiveTo = effectiveTo;
      return { ...open };
    },
  };

  const progressionLedger = {
    async recordEvaluation(input: Parameters<Repositories["progressionLedger"]["recordEvaluation"]>[0]) {
      const existing = [...store.evaluations.values()].find(
        (row) => row.userId === input.userId && row.fingerprint === input.fingerprint,
      );
      if (existing) return existing;
      const record: ProgressionEvaluation = {
        id: uuid(12000 + ++counters.evaluation),
        userId: input.userId,
        exerciseId: input.exerciseId,
        exerciseName: input.exerciseName,
        ...(input.planId ? { planId: input.planId } : {}),
        ...(input.planVersionId ? { planVersionId: input.planVersionId } : {}),
        ...(input.slotId ? { slotId: input.slotId } : {}),
        ...(input.environmentKind ? { environmentKind: input.environmentKind } : {}),
        current: input.currentObservation,
        ...(input.previousObservation ? { previous: input.previousObservation } : {}),
        performance: input.performance,
        outcome: input.outcome,
        recommendation: input.recommendation,
        evidence: [...(input.evidence ?? [])],
        fingerprint: input.fingerprint,
        configVersion: input.configVersion,
        createdAt: "2026-01-02T00:00:00.000Z",
      };
      store.evaluations.set(record.id, record);
      return record;
    },
    async findEvaluation(userId: string, evaluationId: string) {
      const row = store.evaluations.get(evaluationId);
      return row && row.userId === userId ? row : null;
    },
    async listEvaluations(userId: string) {
      return [...store.evaluations.values()].filter((row) => row.userId === userId);
    },
    async recordDecisionEvent(
      input: Parameters<Repositories["progressionLedger"]["recordDecisionEvent"]>[0],
    ) {
      if (input.idempotencyKey) {
        const existing = store.events.find(
          (row) =>
            row.evaluationId === input.evaluationId &&
            row.idempotencyKey === input.idempotencyKey,
        );
        if (existing) return existing;
      }
      const record: ProgressionDecisionEvent = {
        id: uuid(13000 + ++counters.event),
        evaluationId: input.evaluationId,
        decision: input.decision,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.actualChange ? { actualChange: input.actualChange } : {}),
        ...(input.resultingPerformance
          ? { resultingPerformance: input.resultingPerformance }
          : {}),
        evidence: [...(input.evidence ?? [])],
        createdAt: `2026-10-0${Math.min(9, 1 + (counters.event % 9))}T12:00:00.000Z`,
      };
      store.events.push(record);
      return record;
    },
    async listEvents(evaluationId: string) {
      return store.events
        .filter((row) => row.evaluationId === evaluationId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    },
    async listLedger(userId: string, query?: { exerciseId?: string; limit?: number }) {
      const evaluations = [...store.evaluations.values()]
        .filter(
          (row) =>
            row.userId === userId &&
            (!query?.exerciseId || row.exerciseId === query.exerciseId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .slice(0, query?.limit ?? 100);
      const rows = [];
      for (const evaluation of evaluations) {
        const events = await progressionLedger.listEvents(evaluation.id);
        rows.push({ evaluation, events });
      }
      return rows;
    },
    async findLastEvent(evaluationId: string) {
      const events = await progressionLedger.listEvents(evaluationId);
      return events.at(-1) ?? null;
    },
  };

  const workouts = {
    async create(input: CreateWorkoutInput) {
      if (input.clientRequestId) {
        const existing = store.workouts.find(
          (aggregate) =>
            aggregate.workout.userId === input.userId &&
            aggregate.workout.clientRequestId === input.clientRequestId,
        );
        if (existing) return existing.workout;
      }
      const id = uuid(14000 + ++counters.workout);
      const workout = {
        id,
        userId: input.userId,
        ...(input.planId ? { planId: input.planId } : {}),
        ...(input.planVersionId ? { planVersionId: input.planVersionId } : {}),
        ...(input.planSessionId ? { planSessionId: input.planSessionId } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        status: input.status ?? "in_progress",
        startedAt: input.startedAt,
        ...(input.endedAt ? { endedAt: input.endedAt } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
        ...(input.environmentKind ? { environmentKind: input.environmentKind } : {}),
        ...(input.sessionClassification
          ? { sessionClassification: input.sessionClassification }
          : {}),
        createdAt: input.startedAt,
        updatedAt: input.startedAt,
      };
      store.workouts.push({ workout, exercises: [] });
      return workout;
    },
    async addExercise(
      workoutId: string,
      exerciseId: string,
      position?: number,
      notes?: string,
      options?: AddExerciseOptions,
    ) {
      const aggregate = store.workouts.find((item) => item.workout.id === workoutId);
      if (!aggregate) throw new Error(`workout ${workoutId} not found`);
      const group = {
        id: uuid(15000 + ++counters.group),
        workoutId,
        exerciseId,
        position: position ?? aggregate.exercises.length,
        ...(notes !== undefined ? { notes } : {}),
        ...(options?.slotId ? { slotId: options.slotId } : {}),
        ...(options?.substitutedFromExerciseId
          ? { substitutedFromExerciseId: options.substitutedFromExerciseId }
          : {}),
        ...(options?.performanceSource
          ? { performanceSource: options.performanceSource }
          : {}),
        ...(options?.substitutionReason
          ? { substitutionReason: options.substitutionReason }
          : {}),
        sets: [],
        createdAt: aggregate.workout.startedAt,
        updatedAt: aggregate.workout.startedAt,
      };
      aggregate.exercises.push(group);
      return group;
    },
    async addSet(input: AddSetInput) {
      const aggregate = store.workouts.find((item) =>
        item.exercises.some((group) => group.id === input.workoutExerciseId),
      );
      const group = aggregate?.exercises.find((item) => item.id === input.workoutExerciseId);
      if (!aggregate || !group) throw new Error(`workout exercise ${input.workoutExerciseId} not found`);
      if (input.clientRequestId) {
        const existing = group.sets.find((set) => set.clientRequestId === input.clientRequestId);
        if (existing) return existing;
      }
      const set = {
        id: uuid(16000 + ++counters.set),
        workoutExerciseId: input.workoutExerciseId,
        exerciseId: group.exerciseId,
        position: input.position ?? group.sets.length,
        kind: input.kind,
        ...(input.loadKg !== undefined ? { loadKg: input.loadKg } : {}),
        ...(input.addedLoadKg !== undefined ? { addedLoadKg: input.addedLoadKg } : {}),
        ...(input.reps !== undefined ? { reps: input.reps } : {}),
        ...(input.distanceMeters !== undefined ? { distanceMeters: input.distanceMeters } : {}),
        ...(input.durationSeconds !== undefined ? { durationSeconds: input.durationSeconds } : {}),
        ...(input.rir !== undefined ? { rir: input.rir } : {}),
        ...(input.rpe !== undefined ? { rpe: input.rpe } : {}),
        ...(input.loadKind !== undefined ? { loadKind: input.loadKind } : {}),
        ...(input.assistanceLoadKg !== undefined ? { assistanceLoadKg: input.assistanceLoadKg } : {}),
        ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        createdAt: aggregate.workout.startedAt,
        updatedAt: aggregate.workout.startedAt,
      };
      group.sets.push(set);
      return set;
    },
    async complete(workoutId: string, status: WorkoutStatus = "completed", endedAt?: string) {
      const aggregate = store.workouts.find((item) => item.workout.id === workoutId);
      if (!aggregate) throw new Error(`workout ${workoutId} not found`);
      aggregate.workout.status = status;
      if (endedAt) aggregate.workout.endedAt = endedAt;
      return aggregate.workout;
    },
    async findById(workoutId: string) {
      return store.workouts.find((item) => item.workout.id === workoutId) ?? null;
    },
    async history(userId: string) {
      return store.workouts.filter((item) => item.workout.userId === userId);
    },
  };

  const repositories = {
    users: { async findById(id: string) { return id === USER_ID ? user : null; } },
    profiles: { async get(userId: string) { return userId === USER_ID ? profile : null; } },
    goals: {
      async active(userId: string) { return userId === USER_ID ? goal : null; },
      async findById(id: string) { return id === GOAL_ID ? goal : null; },
    },
    equipment: {
      async listUserEquipment(userId: string) {
        if (userId !== USER_ID) return [];
        return [
          { availability: "available", equipment: { id: BARBELL, slug: "barbell" } },
          { availability: "available", equipment: { id: BENCH, slug: "bench" } },
          { availability: "available", equipment: { id: DUMBBELL, slug: "dumbbells" } },
          { availability: "available", equipment: { id: CABLE, slug: "cable_machine" } },
        ];
      },
    },
    exercisePreferences: { async listCurrentPreferences() { return []; } },
    exercises: { async listExerciseKnowledge() { return catalogRecords(); } },
    trainingPlans,
    trainingEnvironments,
    progressionLedger,
    workouts,
  };

  return repositories as unknown as Repositories;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function withServer(
  store: InMemoryStore,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const services = createServices(createRepositories(store));
  const server = createServer({ services });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  try {
    const { port } = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

interface ApiResponse<T = any> {
  status: number;
  body: T;
}

async function call<T = any>(
  baseUrl: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<ApiResponse<T>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as T };
}

async function generateGymPlan(baseUrl: string, asOf = "2026-10-06") {
  const response = await call(baseUrl, "POST", `/v0/users/${USER_ID}/training-plans/generate`, {
    asOf,
    availableTrainingDays: 4,
    maxSessionDurationMinutes: 60,
    experience: "intermediate",
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body as {
    plan: PlanAggregate;
    version: PlanVersionRecord;
    sessions: Array<{
      name: string;
      estimatedMinutes: number;
      targetMinutes: number;
      exceedsBudget: boolean;
      exercises: Array<{ exerciseId: string; targetSets: number }>;
    }>;
  };
}

interface LoggedSet {
  loadKg?: number;
  reps: number;
  rir?: number;
  clientRequestId: string;
}

/** Create → exercises → sets → complete, exactly as a client would. */
async function logSession(
  baseUrl: string,
  options: {
    planId?: string;
    exerciseId: string;
    startedAt: string;
    clientRequestId: string;
    sets: LoggedSet[];
    environmentKind?: string;
    sessionClassification?: string;
  },
): Promise<string> {
  const workout = await call(baseUrl, "POST", `/v0/users/${USER_ID}/workouts`, {
    ...(options.planId ? { planId: options.planId } : {}),
    startedAt: options.startedAt,
    status: "in_progress",
    clientRequestId: options.clientRequestId,
    ...(options.environmentKind ? { environmentKind: options.environmentKind } : {}),
    ...(options.sessionClassification
      ? { sessionClassification: options.sessionClassification }
      : {}),
  });
  assert.equal(workout.status, 201, JSON.stringify(workout.body));
  const workoutId = workout.body.workout.id as string;

  const group = await call(
    baseUrl,
    "POST",
    `/v0/users/${USER_ID}/workouts/${workoutId}/exercises`,
    { exerciseId: options.exerciseId },
  );
  assert.equal(group.status, 201, JSON.stringify(group.body));
  const workoutExerciseId = group.body.workoutExercise.id as string;

  for (const set of options.sets) {
    const recorded = await call(
      baseUrl,
      "POST",
      `/v0/users/${USER_ID}/workouts/${workoutId}/sets`,
      {
        workoutExerciseId,
        kind: "working",
        ...(set.loadKg !== undefined ? { loadKg: set.loadKg } : {}),
        reps: set.reps,
        ...(set.rir !== undefined ? { rir: set.rir } : {}),
        clientRequestId: set.clientRequestId,
      },
    );
    assert.equal(recorded.status, 201, JSON.stringify(recorded.body));
  }

  const completed = await call(
    baseUrl,
    "POST",
    `/v0/users/${USER_ID}/workouts/${workoutId}/complete`,
    { status: "completed", endedAt: options.startedAt },
  );
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  return workoutId;
}

// ---------------------------------------------------------------------------
// Journey A — the progression loop
// ---------------------------------------------------------------------------

test("Journey A: log, evaluate, accept, evidence — progressionsCompleted becomes real", async () => {
  const store = createStore();
  resetCounters();

  await withServer(store, async (baseUrl) => {
    const generated = await generateGymPlan(baseUrl);
    const planId = generated.plan.id;
    const firstSession = generated.sessions[0];
    assert.ok(firstSession, "the generated plan must contain sessions");
    const exerciseId = firstSession.exercises[0]?.exerciseId;
    assert.ok(exerciseId, "the generated plan must contain exercises");

    // 1–3. Three sessions with rising reps at target effort (§5 trajectory).
    const trajectory: Array<[string, number]> = [
      ["2026-10-01T10:00:00.000Z", 8],
      ["2026-10-03T10:00:00.000Z", 9],
      ["2026-10-05T10:00:00.000Z", 10],
    ];
    for (const [index, [startedAt, reps]] of trajectory.entries()) {
      await logSession(baseUrl, {
        planId,
        exerciseId,
        startedAt,
        clientRequestId: `wa_session_${index}`,
        sets: [{ loadKg: 60, reps, rir: 2, clientRequestId: `wa_set_${index}` }],
      });
    }

    // Performance history is retrievable and deterministic (§5).
    const history = await call(
      baseUrl,
      "GET",
      `/v0/users/${USER_ID}/performance-history?exerciseId=${exerciseId}`,
    );
    assert.equal(history.status, 200);
    assert.equal(history.body.summaries[exerciseId].completedSets, 3);
    assert.equal(history.body.observations.length, 3);
    assert.equal(history.body.summaries[exerciseId].bestLoadKg, 60);

    // Duplicate submission of the same set key cannot double-record (§32).
    const replaySet = await call(
      baseUrl,
      "POST",
      `/v0/users/${USER_ID}/workouts`,
      {
        startedAt: "2026-10-01T10:00:00.000Z",
        clientRequestId: "wa_session_0",
        status: "in_progress",
      },
    );
    assert.equal(replaySet.status, 201);
    const replayHistory = await call(
      baseUrl,
      "GET",
      `/v0/users/${USER_ID}/performance-history?exerciseId=${exerciseId}`,
    );
    assert.equal(
      replayHistory.body.observations.length,
      3,
      "a replayed workout creation must not duplicate sets",
    );

    // 4. Deterministic evaluation → persisted recommendation.
    const evaluate = async () =>
      call(baseUrl, "POST", `/v0/users/${USER_ID}/progression/evaluate`, {
        exerciseId,
        planId,
        target: { repMin: 8, repMax: 10, targetRir: 2 },
      });
    const first = await evaluate();
    assert.equal(first.status, 200);
    assert.equal(first.body.persisted, true);
    assert.equal(first.body.evaluation.outcome, "increase_load");
    assert.equal(first.body.evaluation.recommendation.targetLoadKg, 62.5);
    assert.equal(first.body.entry.decision, "recommended");
    assert.equal(first.body.entry.completed, false);

    // Same evidence → the SAME evaluation row (idempotent fingerprint).
    const replay = await evaluate();
    assert.equal(replay.body.evaluation.id, first.body.evaluation.id);

    // 5. The user accepts; a retry does not duplicate history.
    const evaluationId = first.body.evaluation.id as string;
    const accept = await call(
      baseUrl,
      "POST",
      `/v0/users/${USER_ID}/progression/ledger/${evaluationId}/events`,
      { decision: "accepted", idempotencyKey: "wa_accept_1", reason: "feels doable" },
    );
    assert.equal(accept.status, 201);
    assert.equal(accept.body.entry.decision, "accepted");
    assert.equal(accept.body.entry.completed, false, "acceptance alone is not a progression (§8)");

    const acceptRetry = await call(
      baseUrl,
      "POST",
      `/v0/users/${USER_ID}/progression/ledger/${evaluationId}/events`,
      { decision: "accepted", idempotencyKey: "wa_accept_1", reason: "feels doable" },
    );
    assert.equal(acceptRetry.status, 200);
    assert.equal(acceptRetry.body.replayed, true);

    const ledger = await call(
      baseUrl,
      "GET",
      `/v0/users/${USER_ID}/progression/ledger?exerciseId=${exerciseId}`,
    );
    assert.equal(ledger.body.entries.length, 1);
    assert.equal(
      ledger.body.entries[0].events.length,
      1,
      "the replayed acceptance must not create a second event",
    );

    // 6. The next workout performs the recommended load.
    await logSession(baseUrl, {
      planId,
      exerciseId,
      startedAt: "2026-10-06T10:00:00.000Z",
      clientRequestId: "wa_session_3",
      sets: [{ loadKg: 62.5, reps: 8, rir: 2, clientRequestId: "wa_set_3" }],
    });

    // 7. Evidence closes the loop: accepted + actual change + result.
    const evidenced = await call(
      baseUrl,
      "POST",
      `/v0/users/${USER_ID}/progression/ledger/${evaluationId}/events`,
      {
        decision: "accepted",
        idempotencyKey: "wa_evidence_1",
        actualChange: { kind: "load", loadDeltaKg: 2.5 },
        resultingPerformance: {
          loadKind: "external_load",
          loadKg: 62.5,
          reps: 8,
          rir: 2,
          localDate: "2026-10-06",
        },
      },
    );
    assert.equal(evidenced.status, 201);
    assert.equal(evidenced.body.entry.completed, true);

    // 8. TrainingState now reports a REAL count (§10) — not a placeholder.
    const state = await call(baseUrl, "GET", `/v0/users/${USER_ID}/training-state`);
    assert.equal(state.status, 200);
    assert.equal(state.body.trainingState.completedProgressions[exerciseId], 1);
    assert.equal(
      state.body.trainingState.progressionStatus[exerciseId].progressionsCompleted,
      1,
      "progressionsCompleted must be evidence-backed, not hardcoded zero",
    );
    assert.equal(state.body.trainingState.performanceHistory[exerciseId].completedSets, 4);
    // The recommendation is now decided, so nothing is outstanding.
    assert.ok(Array.isArray(state.body.trainingState.progressionRecommendations));
  });
});

// ---------------------------------------------------------------------------
// Journey B — environment change, temporary plan, restoration
// ---------------------------------------------------------------------------

test("Journey B: temporary home plan preserves the gym plan and the training history", async () => {
  const store = createStore();
  resetCounters();

  await withServer(store, async (baseUrl) => {
    const gym = await generateGymPlan(baseUrl);
    const gymPlanId = gym.plan.id;
    const gymVersionId = gym.version.id;
    const originalSessionShape = gym.version.sessions.map((session) => ({
      name: session.name,
      exercises: session.slots.map((slot) => slot.exerciseId),
    }));

    // 1. The user cannot get to the gym for a week (§25).
    const environment = await call(baseUrl, "POST", `/v0/users/${USER_ID}/training-environments`, {
      kind: "home_no_equipment",
      effectiveFrom: "2026-10-10",
      reason: "gym closed for maintenance",
      isTemporary: true,
    });
    assert.equal(environment.status, 201, JSON.stringify(environment.body));
    assert.equal(environment.body.environment.kind, "home_no_equipment");

    // Idempotent replay: the same declaration is the same period.
    const replay = await call(baseUrl, "POST", `/v0/users/${USER_ID}/training-environments`, {
      kind: "home_no_equipment",
      effectiveFrom: "2026-10-10",
      reason: "gym closed for maintenance",
      isTemporary: true,
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.period.id, environment.body.period.id);

    const active = await call(
      baseUrl,
      "GET",
      `/v0/users/${USER_ID}/training-environments/active?asOf=2026-10-11`,
    );
    assert.equal(active.body.environment.kind, "home_no_equipment");
    assert.equal(active.body.environment.constrained, true);
    assert.ok(active.body.environment.limitations.length > 0);

    // 2. Generate the temporary plan from the gym plan (§15).
    const temporary = await call(
      baseUrl,
      "POST",
      `/v0/users/${USER_ID}/training-plans/generate-temporary`,
      {
        asOf: "2026-10-11",
        availableTrainingDays: 4,
        maxSessionDurationMinutes: 60,
        experience: "intermediate",
      },
    );
    assert.equal(temporary.status, 201, JSON.stringify(temporary.body));
    assert.equal(temporary.body.needed, true);
    assert.equal(temporary.body.sourcePlanId, gymPlanId);
    assert.equal(temporary.body.sourceVersionId, gymVersionId);
    const tempPlan = temporary.body.result.plan as PlanAggregate;
    const tempVersion = temporary.body.result.version as PlanVersionRecord;
    assert.equal(tempPlan.kind, "temporary_environment");
    assert.equal(tempPlan.environmentKind, "home_no_equipment");
    assert.equal(tempPlan.temporaryForVersionId, gymVersionId);
    assert.equal(tempVersion.generationReason, "exercise_substitution");
    assert.ok(temporary.body.result.limitations.length > 0, "limitations must be stated (§16)");
    assert.ok(
      temporary.body.result.progressionMechanisms.includes("reps"),
      "home progression uses reps (§17)",
    );
    assert.ok(!temporary.body.result.progressionMechanisms.includes("load"));

    // 3. Every temporary session is performable and inside the same budget.
    for (const session of temporary.body.result.sessions as Array<{
      name: string;
      exercises: Array<{ exerciseId: string; targetSets: number }>;
      estimatedMinutes: number;
      targetMinutes: number;
      exceedsBudget: boolean;
    }>) {
      assert.ok(session.exercises.length > 0, `${session.name} must not be empty`);
      assert.equal(session.targetMinutes, 60);
      assert.ok(
        session.estimatedMinutes <= 60,
        `${session.name} estimated ${session.estimatedMinutes}min must respect the 60min budget`,
      );
      for (const exercise of session.exercises) {
        const spec = catalogSpec(exercise.exerciseId);
        assert.ok(spec, `exercise ${exercise.exerciseId} must exist in the catalog`);
        assert.deepEqual(
          spec.equipment,
          [],
          `${spec.slug} must be performable with no equipment`,
        );
      }
    }

    // Determinism: generating again yields identical content (§33/§36.19).
    const temporaryAgain = await call(
      baseUrl,
      "POST",
      `/v0/users/${USER_ID}/training-plans/generate-temporary`,
      {
        asOf: "2026-10-11",
        availableTrainingDays: 4,
        maxSessionDurationMinutes: 60,
        experience: "intermediate",
      },
    );
    assert.equal(temporaryAgain.status, 201);
    const shapeOf = (result: any) =>
      (result.sessions as Array<{ name: string; exercises: Array<{ exerciseId: string }> }>).map(
        (session) => ({
          name: session.name,
          exercises: session.exercises.map((exercise) => exercise.exerciseId),
        }),
      );
    assert.deepEqual(shapeOf(temporaryAgain.body.result), shapeOf(temporary.body.result));

    // 4. The gym plan is untouched: same id, status, version, content (§21).
    const rereadGym = await call(baseUrl, "GET", `/v0/users/${USER_ID}/training-plans/${gymPlanId}`);
    assert.equal(rereadGym.status, 200);
    assert.equal(rereadGym.body.plan.status, "active");
    assert.equal(rereadGym.body.plan.kind, "primary");
    assert.equal(rereadGym.body.plan.versions.length, 1);
    assert.equal(rereadGym.body.plan.versions[0].id, gymVersionId);
    const currentShape = rereadGym.body.plan.versions[0].sessions.map((session: any) => ({
      name: session.name,
      exercises: session.slots.map((slot: any) => slot.exerciseId),
    }));
    assert.deepEqual(currentShape, originalSessionShape);
    const activePlan = await call(baseUrl, "GET", `/v0/users/${USER_ID}/training-plans/active`);
    assert.equal(activePlan.body.plan.id, gymPlanId, "the primary plan stays the active plan");

    // Constraints of the temporary plan state the environment honestly.
    const constraints = await call(
      baseUrl,
      "GET",
      `/v0/users/${USER_ID}/training-plans/${tempPlan.id}/constraints`,
    );
    const keys = (constraints.body.constraints as PlanConstraintRecord[]).map(
      (constraint) => constraint.constraintKey,
    );
    assert.ok(keys.includes("environment_equipment"));
    assert.ok(keys.includes("environment_substitution"));
    assert.ok(keys.includes("environment_limitations"));
    const equipmentConstraint = (
      constraints.body.constraints as PlanConstraintRecord[]
    ).find((constraint) => constraint.constraintKey === "environment_equipment");
    assert.equal(equipmentConstraint?.result, "satisfied");

    // 5. A home workout happens — ADAPTED, not missed (§23).
    const temporarySessions = temporary.body.result.sessions as Array<{
      exercises: Array<{ exerciseId: string }>;
    }>;
    const firstHomeSession = temporarySessions[0];
    assert.ok(firstHomeSession, "the temporary plan must contain sessions");
    const homeExercise = firstHomeSession.exercises[0]?.exerciseId;
    assert.ok(homeExercise, "the temporary plan must contain exercises");
    const homeWorkoutId = await logSession(baseUrl, {
      planId: tempPlan.id,
      exerciseId: homeExercise,
      startedAt: "2026-10-11T18:00:00.000Z",
      clientRequestId: "wb_home_1",
      sets: [{ reps: 12, rir: 2, clientRequestId: "wb_home_set_1" }],
      environmentKind: "home_no_equipment",
      sessionClassification: "adapted",
    });

    const duringStay = await call(
      baseUrl,
      "GET",
      `/v0/users/${USER_ID}/training-continuity?asOf=2026-10-11`,
    );
    assert.equal(duringStay.status, 200);
    assert.equal(duringStay.body.environment.kind, "home_no_equipment");
    assert.equal(duringStay.body.sessions.adapted, 1, "an adapted session counts as training");
    assert.equal(duringStay.body.sessions.home, 1);
    assert.equal(duringStay.body.sessions.completed, 1);
    assert.equal(duringStay.body.temporaryPlans.length, 1);
    assert.equal(duringStay.body.temporaryPlans[0].status, "active");
    assert.equal(duringStay.body.temporaryPlans[0].temporaryForVersionId, gymVersionId);
    assert.equal(duringStay.body.periods.length, 1);

    // 6. Gym access returns → explicit restoration (§22).
    const restored = await call(
      baseUrl,
      "POST",
      `/v0/users/${USER_ID}/training-environments/restore`,
      { asOf: "2026-10-18" },
    );
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    assert.equal(restored.body.restored, true);
    assert.equal(restored.body.environment.kind, "gym");
    assert.deepEqual(restored.body.retiredPlanIds, [tempPlan.id]);
    assert.equal(restored.body.closedPeriod.effectiveTo, "2026-10-18");

    const afterRestore = await call(
      baseUrl,
      "GET",
      `/v0/users/${USER_ID}/training-environments/active?asOf=2026-10-18`,
    );
    assert.equal(afterRestore.body.environment.kind, "gym");

    // 7. History keeps BOTH environments; the gym plan resumes (§22).
    const continuity = await call(
      baseUrl,
      "GET",
      `/v0/users/${USER_ID}/training-continuity?asOf=2026-10-18`,
    );
    assert.equal(continuity.body.environment.kind, "gym");
    assert.equal(continuity.body.sessions.adapted, 1, "home training history is never erased");
    assert.equal(continuity.body.sessions.home, 1);
    assert.equal(continuity.body.temporaryPlans[0].status, "retired");
    assert.equal(continuity.body.periods.length, 1);
    assert.equal(continuity.body.periods[0].kind, "home_no_equipment");

    const gymPlanAfter = await call(baseUrl, "GET", `/v0/users/${USER_ID}/training-plans/active`);
    assert.equal(gymPlanAfter.body.plan.id, gymPlanId);
    assert.equal(gymPlanAfter.body.plan.versions.length, 1, "one week away never rewrites v1");

    // The performed home session still knows what it was.
    const homeWorkout = await call(
      baseUrl,
      "GET",
      `/v0/users/${USER_ID}/workouts/${homeWorkoutId}`,
    );
    assert.equal(homeWorkout.body.workout.workout.environmentKind, "home_no_equipment");
    assert.equal(homeWorkout.body.workout.workout.sessionClassification, "adapted");
  });
});

// ---------------------------------------------------------------------------
// Journey C — a missed session stays missed
// ---------------------------------------------------------------------------

test("Journey C: a session the user skips stays missed — no false completion", async () => {
  const store = createStore();
  resetCounters();

  await withServer(store, async (baseUrl) => {
    const gym = await generateGymPlan(baseUrl);
    const plannedSessions = gym.version.sessions.length;
    assert.ok(plannedSessions > 0);

    // The user records the intent: today, no training happens.
    const skipped = await call(baseUrl, "POST", `/v0/users/${USER_ID}/workouts`, {
      planId: gym.plan.id,
      startedAt: "2026-10-07T18:00:00.000Z",
      status: "skipped",
      clientRequestId: "wc_skipped_1",
      notes: "Gym unavailable and no home session performed",
    });
    assert.equal(skipped.status, 201);
    assert.equal(skipped.body.workout.status, "skipped");

    // Nothing about that workout is completable history.
    const reread = await call(
      baseUrl,
      "GET",
      `/v0/users/${USER_ID}/workouts/${skipped.body.workout.id}`,
    );
    assert.equal(reread.body.workout.workout.status, "skipped");

    const continuity = await call(
      baseUrl,
      "GET",
      `/v0/users/${USER_ID}/training-continuity?asOf=2026-10-07`,
    );
    assert.equal(continuity.body.sessions.completed, 0);
    assert.equal(continuity.body.sessions.adapted, 0, "nothing was adapted — nothing was done");
    assert.equal(continuity.body.sessions.home, 0);
    assert.equal(continuity.body.sessions.skipped, 1);
    assert.equal(
      continuity.body.missedSessions,
      plannedSessions,
      "every planned session of the week is missed",
    );
    assert.deepEqual(continuity.body.completedProgressions, {});
    assert.equal(continuity.body.totalCompletedProgressions, 0);

    // TrainingState tells the same story: missed, not failed, not adapted.
    const state = await call(baseUrl, "GET", `/v0/users/${USER_ID}/training-state`);
    assert.equal(state.body.trainingState.missedSessions, plannedSessions);
    assert.equal(state.body.trainingState.adaptedSessions, 0);
    assert.equal(state.body.trainingState.homeSessions, 0);

    // No plan mutation happened merely because a session was missed (§37).
    const plan = await call(
      baseUrl,
      "GET",
      `/v0/users/${USER_ID}/training-plans/${gym.plan.id}`,
    );
    assert.equal(plan.body.plan.versions.length, 1);
    assert.equal(plan.body.plan.versions[0].lifecycleStatus, "active");
  });
});
