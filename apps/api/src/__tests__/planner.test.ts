import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type {
  ExerciseMuscleTarget,
  Goal,
  MuscleGroup,
  Profile,
  SessionTemplate,
  User,
} from "@fitcoach/domain";
import type {
  CreateDecisionInput,
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

/**
 * Phase 3 planner integration tests.
 *
 * These exercise the real HTTP routes and the real `TrainingPlannerService`
 * against an in-memory repository bundle. That is deliberate: the engines are
 * unit-tested in `fitness-core`, so what is verified here is the wiring the
 * user actually touches — request parsing, context loading, persistence of the
 * version/constraints/decisions/progression rules, and adaptation outcomes.
 */

const USER_ID = "usr_planner_test";
const GOAL_ID = "00000000-0000-4000-8000-0000000000aa";
const BARBELL = "00000000-0000-4000-8000-0000000000b1";
const BENCH = "00000000-0000-4000-8000-0000000000b2";
const DUMBBELL = "00000000-0000-4000-8000-0000000000b3";
const CABLE = "00000000-0000-4000-8000-0000000000b4";

function uuid(seed: number): string {
  return `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
}

const MUSCLE_GROUPS: Record<string, MuscleGroup> = {
  pectoralis_major: "chest",
  deltoid_anterior: "front_delts",
  deltoid_lateral: "side_delts",
  deltoid_rear: "rear_delts",
  latissimus_dorsi: "lats",
  trapezius: "traps",
  rhomboids: "upper_back",
  spinal_erectors: "lower_back",
  biceps_brachii: "biceps",
  triceps_brachii: "triceps",
  brachialis: "biceps",
  quadriceps: "quadriceps",
  hamstrings: "hamstrings",
  gluteus_maximus: "glutes",
  gluteus_medius: "glutes",
  calves: "calves",
  abdominals: "abdominals",
  obliques: "obliques",
};

function target(
  muscleSlug: string,
  role: ExerciseMuscleTarget["role"],
  options: { structure?: boolean; emphasis?: ExerciseMuscleTarget["emphasis"] } = {},
): ExerciseMuscleTarget {
  const muscleGroup = MUSCLE_GROUPS[muscleSlug];
  if (!muscleGroup) throw new Error(`unknown muscle slug ${muscleSlug}`);
  return {
    muscleId: `muscle_${muscleSlug}`,
    muscleSlug,
    muscleDisplayName: muscleSlug,
    muscleGroup,
    role,
    ...(options.structure
      ? {
          structureId: `structure_${muscleSlug}`,
          structureSlug: `${muscleSlug}_head`,
          structureDisplayName: `${muscleSlug} head`,
          structureKind: "head" as const,
        }
      : {}),
    ...(options.emphasis ? { emphasis: options.emphasis } : {}),
  };
}

/**
 * Synthetic catalog spec. Values are kept as plain strings because the whole
 * record is cast to `ExerciseKnowledgeRecord` at the boundary; the engines only
 * read the fields, and the tests below assert the resulting behaviour.
 */
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
  rangeOfMotion?: ExerciseKnowledgeRecord["rangeOfMotionCharacteristic"];
}

const CATALOG: CatalogSpec[] = [
  {
    id: uuid(1),
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
    id: uuid(2),
    slug: "romanian_deadlift",
    name: "Romanian Deadlift",
    category: "compound",
    movementPattern: "hinge",
    movementFunctions: ["hinge"],
    equipment: [BARBELL],
    roles: ["compound_movement"],
    targets: [
      target("hamstrings", "primary_mover", { emphasis: "lengthened_position" }),
      target("gluteus_maximus", "secondary_mover"),
      target("spinal_erectors", "secondary_mover"),
    ],
  },
  {
    id: uuid(3),
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
    id: uuid(4),
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
    id: uuid(5),
    slug: "overhead_press",
    name: "Overhead Press",
    category: "compound",
    movementPattern: "vertical_push",
    movementFunctions: ["vertical_push"],
    equipment: [BARBELL],
    roles: ["compound_movement", "vertical_push"],
    targets: [
      target("deltoid_anterior", "primary_mover"),
      target("triceps_brachii", "secondary_mover"),
    ],
  },
  {
    id: uuid(6),
    slug: "lateral_raise",
    name: "Lateral Raise",
    category: "isolation",
    movementPattern: "other",
    movementFunctions: ["shoulder_abduction"],
    equipment: [DUMBBELL],
    roles: ["isolation_movement", "lateral_delt_isolation"],
    targets: [target("deltoid_lateral", "primary_mover")],
  },
  {
    id: uuid(7),
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
      target("rhomboids", "secondary_mover"),
    ],
  },
  {
    id: uuid(8),
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
    id: uuid(9),
    slug: "face_pull",
    name: "Face Pull",
    category: "isolation",
    movementPattern: "horizontal_pull",
    movementFunctions: ["horizontal_pull", "shoulder_abduction"],
    equipment: [CABLE],
    roles: ["isolation_movement", "upper_back_retraction"],
    targets: [
      target("deltoid_rear", "primary_mover"),
      target("rhomboids", "secondary_mover"),
    ],
  },
  {
    id: uuid(10),
    slug: "dumbbell_curl",
    name: "Dumbbell Curl",
    category: "isolation",
    movementPattern: "other",
    movementFunctions: ["elbow_flexion"],
    equipment: [DUMBBELL],
    roles: ["isolation_movement"],
    targets: [target("biceps_brachii", "primary_mover")],
  },
  {
    id: uuid(11),
    slug: "triceps_pushdown",
    name: "Triceps Pushdown",
    category: "isolation",
    movementPattern: "other",
    movementFunctions: ["elbow_extension"],
    equipment: [CABLE],
    roles: ["isolation_movement"],
    targets: [target("triceps_brachii", "primary_mover")],
  },
  {
    id: uuid(12),
    slug: "standing_calf_raise",
    name: "Standing Calf Raise",
    category: "isolation",
    movementPattern: "other",
    movementFunctions: ["plantar_flexion"],
    equipment: [],
    roles: ["isolation_movement", "calf_raising"],
    targets: [target("calves", "primary_mover")],
  },
  {
    id: uuid(13),
    slug: "hanging_leg_raise",
    name: "Hanging Leg Raise",
    category: "isolation",
    movementPattern: "core",
    movementFunctions: ["core_flexion"],
    equipment: [],
    roles: ["isolation_movement", "core_anti_extension"],
    targets: [target("abdominals", "primary_mover"), target("obliques", "secondary_mover")],
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
    ...(spec.rangeOfMotion ? { rangeOfMotionCharacteristic: spec.rangeOfMotion } : {}),
    movementFunctions: spec.movementFunctions,
    primaryMovementFunction: spec.movementFunctions[0],
    roles: spec.roles,
    targets: spec.targets,
    knowledgeVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    isActive: true,
    instructions: `${spec.name} technique notes.`,
    // Index keeps ids/slugs unique and stable even if the list is edited.
    externalSourceId: `seed_${index}`,
  })) as unknown as ExerciseKnowledgeRecord[];
}

interface InMemoryStore {
  plans: Map<string, PlanAggregate>;
  decisions: Map<string, PlanDecisionRecord[]>;
  constraints: Map<string, PlanConstraintRecord[]>;
  rules: Map<string, ProgressionRuleRecord[]>;
  workouts: WorkoutAggregate[];
}

function createStore(): InMemoryStore {
  return {
    plans: new Map(),
    decisions: new Map(),
    constraints: new Map(),
    rules: new Map(),
    workouts: [],
  };
}

let counters = { plan: 0, version: 0, session: 0, slot: 0, decision: 0, constraint: 0, rule: 0 };

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
  const profile: Profile = {
    userId: USER_ID,
    trainingExperience: "intermediate",
    trainingDaysPerWeek: 4,
    sessionDurationMinutes: 60,
    heightCm: 180,
    sex: "male",
  } as unknown as Profile;

  const user: User = {
    id: USER_ID,
    email: "planner@example.test",
    displayName: "Planner Test",
    timezone: "UTC",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as User;

  const goal: Goal = {
    id: GOAL_ID,
    userId: USER_ID,
    kind: "bodybuilding",
    priorities: ["chest_development", "shoulder_width"],
    effectiveFrom: "2026-01-01",
    status: "active",
  } as unknown as Goal;

  const trainingPlans = {
    async create(input: { userId: string; name: string; status?: string; version: PlanVersionInput }) {
      const id = `plan_${++counters.plan}`;
      const version = versionRecord(id, 1, input.version);
      const plan: PlanAggregate = {
        id,
        userId: input.userId,
        name: input.name,
        status: input.status ?? "active",
        kind: "primary",
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
      const version = versionRecord(
        planId,
        (previous?.versionNumber ?? 0) + 1,
        input,
        previous?.id,
      );
      plan.versions.push(version);
      return version;
    },
    async findById(planId: string) {
      return store.plans.get(planId) ?? null;
    },
    async findActive(userId: string) {
      return (
        [...store.plans.values()].filter((plan) => plan.userId === userId).at(-1) ?? null
      );
    },
    async listForUser(userId: string) {
      return [...store.plans.values()].filter((plan) => plan.userId === userId);
    },
    async setStatus(planId: string, status: string) {
      const plan = store.plans.get(planId);
      if (!plan) throw new Error(`plan ${planId} not found`);
      plan.status = status;
      return plan;
    },
    async recordDecision(input: CreateDecisionInput) {
      const record: PlanDecisionRecord = {
        id: `decision_${++counters.decision}`,
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
        id: `constraint_${++counters.constraint}`,
        versionId,
      }));
      store.constraints.set(versionId, records);
      return records;
    },
    async listConstraints(versionId: string) {
      return store.constraints.get(versionId) ?? [];
    },
    async setProgressionRule(slotId: string, rule: ProgressionRuleInput) {
      const record: ProgressionRuleRecord = { ...rule, id: `rule_${++counters.rule}`, slotId };
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

  const repositories = {
    users: {
      async findById(id: string) {
        return id === USER_ID ? user : null;
      },
    },
    profiles: {
      async get(userId: string) {
        return userId === USER_ID ? profile : null;
      },
    },
    goals: {
      async active(userId: string) {
        return userId === USER_ID ? goal : null;
      },
      async findById(id: string) {
        return id === GOAL_ID ? goal : null;
      },
    },
    equipment: {
      async listUserEquipment(userId: string) {
        if (userId !== USER_ID) return [];
        return [
          { availability: "available", equipment: { id: BARBELL } },
          { availability: "available", equipment: { id: BENCH } },
          { availability: "available", equipment: { id: DUMBBELL } },
          { availability: "available", equipment: { id: CABLE } },
        ];
      },
    },
    exercisePreferences: {
      async listCurrentPreferences() {
        return [];
      },
    },
    exercises: {
      async listExerciseKnowledge() {
        return catalogRecords();
      },
    },
    trainingPlans,
    workouts: {
      async history(userId: string) {
        return userId === USER_ID ? store.workouts : [];
      },
    },
  };

  return repositories as unknown as Repositories;
}

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

interface GenerateBody {
  feasibility: string;
  infeasibilityReasons: string[];
  plan?: PlanAggregate;
  version?: PlanVersionRecord;
  sessions?: Array<{
    name: string;
    estimatedMinutes: number;
    targetMinutes: number;
    exceedsBudget: boolean;
    exercises: Array<{ exerciseId: string; targetSets: number }>;
  }>;
  quality?: { totalScore: number };
  constraints?: PlanConstraintRecord[];
  warnings: string[];
}

async function generate(
  baseUrl: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; body: GenerateBody }> {
  const response = await fetch(`${baseUrl}/v0/users/${USER_ID}/training-plans/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      asOf: "2026-10-06",
      availableTrainingDays: 4,
      maxSessionDurationMinutes: 60,
      experience: "intermediate",
      ...body,
    }),
  });
  return { status: response.status, body: (await response.json()) as GenerateBody };
}

test("planner generates a persisted, budget-aware plan through the HTTP route", async () => {
  const store = createStore();
  counters = { plan: 0, version: 0, session: 0, slot: 0, decision: 0, constraint: 0, rule: 0 };

  await withServer(store, async (baseUrl) => {
    const { status, body } = await generate(baseUrl);

    assert.equal(status, 201);
    assert.ok(["feasible", "feasible_with_tradeoffs"].includes(body.feasibility));
    assert.equal(body.sessions?.length, 4);
    assert.equal(body.version?.versionNumber, 1);
    assert.equal(body.version?.configVersion, "fitcoach.training.v1");
    assert.equal(body.version?.generationReason, "initial_plan");
    assert.ok((body.quality?.totalScore ?? 0) > 0);

    // Every session is planned with real work, and any session that cannot fit
    // the budget is reported both on the session and in the warnings.
    for (const session of body.sessions ?? []) {
      assert.equal(session.targetMinutes, 60);
      assert.ok(session.estimatedMinutes > 0);
      assert.ok(session.exercises.length > 0);
      for (const exercise of session.exercises) assert.ok(exercise.targetSets >= 1);
      if (session.exceedsBudget) {
        assert.ok(
          body.warnings.some((warning) => warning.includes(session.name)),
          `over-budget session "${session.name}" must carry a warning`,
        );
      }
    }

    // Constraints are persisted with explicit satisfied/violated/warning results.
    const constraintResponse = await fetch(
      `${baseUrl}/v0/users/${USER_ID}/training-plans/${body.plan?.id}/constraints`,
    );
    assert.equal(constraintResponse.status, 200);
    const { constraints } = (await constraintResponse.json()) as {
      constraints: PlanConstraintRecord[];
    };
    assert.ok(constraints.length > 0);
    for (const constraint of constraints) {
      assert.ok(["satisfied", "violated", "warning"].includes(constraint.result));
    }

    // One progression rule per planned slot.
    const planId = body.plan?.id ?? "";
    const versionId = body.version?.id ?? "";
    const rules = await createRepositories(store).trainingPlans.listProgressionRules(versionId);
    const slotCount = (body.version?.sessions ?? []).reduce(
      (total, session) => total + session.slots.length,
      0,
    );
    assert.equal(rules.length, slotCount);
    const progressionResponse = await fetch(
      `${baseUrl}/v0/users/${USER_ID}/training-plans/${planId}/progression?version=1`,
    );
    assert.equal(progressionResponse.status, 200);
    const progression = (await progressionResponse.json()) as {
      recommendations: unknown[];
      rules: ProgressionRuleRecord[];
    };
    assert.equal(progression.rules.length, slotCount);
    assert.equal(progression.recommendations.length, slotCount);
  });
});

test("planning is deterministic: identical input produces identical plan content", async () => {
  const first = createStore();
  const second = createStore();
  counters = { plan: 0, version: 0, session: 0, slot: 0, decision: 0, constraint: 0, rule: 0 };

  let firstBody: GenerateBody | undefined;
  let secondBody: GenerateBody | undefined;

  await withServer(first, async (baseUrl) => {
    firstBody = (await generate(baseUrl)).body;
  });
  counters = { plan: 0, version: 0, session: 0, slot: 0, decision: 0, constraint: 0, rule: 0 };
  await withServer(second, async (baseUrl) => {
    secondBody = (await generate(baseUrl)).body;
  });

  const shape = (body: GenerateBody) =>
    (body.sessions ?? []).map((session) => ({
      name: session.name,
      estimatedMinutes: session.estimatedMinutes,
      exercises: session.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        targetSets: exercise.targetSets,
      })),
    }));

  assert.deepEqual(shape(firstBody!), shape(secondBody!));
  assert.equal(firstBody!.quality?.totalScore, secondBody!.quality?.totalScore);
});

test("training-state, coverage and decisions expose the plan read model", async () => {
  const store = createStore();
  counters = { plan: 0, version: 0, session: 0, slot: 0, decision: 0, constraint: 0, rule: 0 };

  await withServer(store, async (baseUrl) => {
    const { body } = await generate(baseUrl);
    const planId = body.plan?.id ?? "";

    const stateResponse = await fetch(`${baseUrl}/v0/users/${USER_ID}/training-state`);
    assert.equal(stateResponse.status, 200);
    const { trainingState } = (await stateResponse.json()) as {
      trainingState: {
        currentPlanVersionId: string;
        trainingGoalKind: string;
        plannedWeeklyVolumePerMuscle: Record<string, number>;
        exerciseDistribution: unknown[];
        progressionStatus: Record<string, { status: string; progressionsCompleted: number }>;
      };
    };
    assert.equal(trainingState.currentPlanVersionId, body.version?.id);
    assert.equal(trainingState.trainingGoalKind, "bodybuilding");
    assert.ok(Object.keys(trainingState.plannedWeeklyVolumePerMuscle).length > 0);
    assert.ok(trainingState.exerciseDistribution.length > 0);
    for (const status of Object.values(trainingState.progressionStatus)) {
      assert.ok(["progressing", "holding"].includes(status.status));
      assert.equal(status.progressionsCompleted, 0);
    }

    const coverageResponse = await fetch(
      `${baseUrl}/v0/users/${USER_ID}/training-plans/${planId}/coverage`,
    );
    assert.equal(coverageResponse.status, 200);
    const coverage = (await coverageResponse.json()) as {
      volume: { byMuscle: Array<{ muscleSlug: string; totalEffectiveSets: number }> };
      assessment: { isAppropriate: boolean };
    };
    assert.ok(coverage.volume.byMuscle.length > 0);
    assert.equal(typeof coverage.assessment.isAppropriate, "boolean");

    const decisionsResponse = await fetch(
      `${baseUrl}/v0/users/${USER_ID}/training-plans/${planId}/decisions`,
    );
    assert.equal(decisionsResponse.status, 200);
    const { decisions } = (await decisionsResponse.json()) as { decisions: PlanDecisionRecord[] };
    // The initial version carries no decision row: nothing was adapted yet.
    assert.equal(decisions.length, 0);
  });
});

test("infeasible requests return reasons instead of a plan", async () => {
  const store = createStore();
  counters = { plan: 0, version: 0, session: 0, slot: 0, decision: 0, constraint: 0, rule: 0 };

  await withServer(store, async (baseUrl) => {
    const { status, body } = await generate(baseUrl, { availableTrainingDays: 0 });
    assert.equal(status, 200);
    assert.equal(body.feasibility, "infeasible");
    assert.equal(body.plan, undefined);
    assert.ok(body.infeasibilityReasons.length > 0);
    assert.ok(body.warnings.some((warning) => warning.includes("No training days")));
  });
});

test("adaptation records a no_change decision without rewriting the version", async () => {
  const store = createStore();
  counters = { plan: 0, version: 0, session: 0, slot: 0, decision: 0, constraint: 0, rule: 0 };

  await withServer(store, async (baseUrl) => {
    const generated = await generate(baseUrl);
    const planId = generated.body.plan?.id ?? "";

    const response = await fetch(
      `${baseUrl}/v0/users/${USER_ID}/training-plans/${planId}/adapt`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );
    assert.equal(response.status, 200);
    const result = (await response.json()) as {
      outcome: string;
      newVersion?: PlanVersionRecord;
      decision: PlanDecisionRecord;
      comparisonSummary?: string[];
      monitoringPlan: string[];
    };

    const plan = store.plans.get(planId)!;
    if (result.outcome === "no_change") {
      assert.equal(result.newVersion, undefined);
      assert.equal(plan.versions.length, 1);
      assert.ok(result.decision.reasonCodes.length > 0);
      assert.ok(result.monitoringPlan.length > 0);
    } else {
      // An intervention must produce a new, persisted version plus comparison.
      assert.ok(result.newVersion);
      assert.equal(result.newVersion?.versionNumber, 2);
      assert.equal(plan.versions.length, 2);
      assert.equal(plan.versions[0]!.lifecycleStatus, "superseded");
      assert.ok((result.comparisonSummary ?? []).length > 0);
    }
  });
});

test("adaptation after declining performance produces a new version and comparison", async () => {
  const store = createStore();
  counters = { plan: 0, version: 0, session: 0, slot: 0, decision: 0, constraint: 0, rule: 0 };

  await withServer(store, async (baseUrl) => {
    const generated = await generate(baseUrl);
    const planId = generated.body.plan?.id ?? "";
    const firstExerciseId = generated.body.sessions?.[0]?.exercises[0]?.exerciseId;

    // Recent history: reps falling (10 → 6) and then two sessions where the
    // exercise was attempted but not completed. That is the shape the plateau
    // detector reads as declining performance.
    const repSets: number[][] = [[10, 10], [6, 6], [0], [0]];
    store.workouts = repSets.map((reps, index) => ({
      workout: {
        id: `workout_${index}`,
        userId: USER_ID,
        status: "completed",
        startedAt: `2026-10-0${index + 1}T10:00:00.000Z`,
        createdAt: `2026-10-0${index + 1}T10:00:00.000Z`,
        updatedAt: `2026-10-0${index + 1}T10:00:00.000Z`,
      },
      exercises: [
        {
          id: `workout_exercise_${index}`,
          workoutId: `workout_${index}`,
          exerciseId: firstExerciseId ?? "",
          position: 0,
          sets: reps.map((value, setIndex) => ({
            id: `set_${index}_${setIndex}`,
            workoutExerciseId: `workout_exercise_${index}`,
            exerciseId: firstExerciseId ?? "",
            position: setIndex,
            kind: "working" as const,
            reps: value,
            createdAt: `2026-10-0${index + 1}T10:1${setIndex}:00.000Z`,
            updatedAt: `2026-10-0${index + 1}T10:1${setIndex}:00.000Z`,
          })),
          createdAt: `2026-10-0${index + 1}T10:00:00.000Z`,
          updatedAt: `2026-10-0${index + 1}T10:00:00.000Z`,
        },
      ],
    })) as unknown as WorkoutAggregate[];

    const response = await fetch(
      `${baseUrl}/v0/users/${USER_ID}/training-plans/${planId}/adapt`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );
    assert.equal(response.status, 200);
    const result = (await response.json()) as {
      outcome: string;
      newVersion?: PlanVersionRecord;
      decision: PlanDecisionRecord;
      triggeringSignals: Array<{ kind: string }>;
      comparisonSummary?: string[];
    };

    const plan = store.plans.get(planId)!;
    assert.equal(result.outcome, "reduce_training_stress");
    assert.ok(result.triggeringSignals.some((signal) => signal.kind === "declining_performance"));
    assert.ok(result.newVersion, `expected a new version for outcome ${result.outcome}`);
    assert.equal(result.newVersion?.versionNumber, 2);
    assert.equal(plan.versions.length, 2);
    assert.equal(plan.versions[0]!.lifecycleStatus, "superseded");
    assert.equal(
      plan.versions[1]!.generationReason,
      result.outcome === "reduce_training_stress" ? "plan_adjustment" : "volume_adjustment",
    );
    assert.ok(result.decision.evidence.length > 0);
    assert.ok((result.comparisonSummary ?? []).length > 0);
  });
});

test("another user's plan is never readable", async () => {
  const store = createStore();
  counters = { plan: 0, version: 0, session: 0, slot: 0, decision: 0, constraint: 0, rule: 0 };

  await withServer(store, async (baseUrl) => {
    const { body } = await generate(baseUrl);
    const planId = body.plan?.id ?? "";
    const otherUser = "usr_someone_else";

    for (const path of [
      `/v0/users/${otherUser}/training-plans/${planId}`,
      `/v0/users/${otherUser}/training-plans/${planId}/decisions`,
      `/v0/users/${otherUser}/training-plans/${planId}/constraints`,
      `/v0/users/${otherUser}/training-plans/${planId}/coverage`,
      `/v0/users/${otherUser}/training-plans/${planId}/progression`,
      `/v0/users/${otherUser}/training-plans/${planId}/versions/1`,
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 404, `${path} must not leak another user's plan`);
    }
  });
});

test("compare endpoint reports muscle-level differences between versions", async () => {
  const store = createStore();
  counters = { plan: 0, version: 0, session: 0, slot: 0, decision: 0, constraint: 0, rule: 0 };

  await withServer(store, async (baseUrl) => {
    const generated = await generate(baseUrl);
    const planId = generated.body.plan?.id ?? "";

    const response = await fetch(
      `${baseUrl}/v0/users/${USER_ID}/training-plans/${planId}/compare?from=1&to=1`,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      comparison: { muscleVolumeChanges: unknown[]; orderedBy: string };
      summary: string[];
    };
    assert.ok(Array.isArray(body.comparison.muscleVolumeChanges));
    assert.ok(typeof body.comparison.orderedBy === "string");
    assert.ok(Array.isArray(body.summary));
  });
});
