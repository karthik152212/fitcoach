import assert from "node:assert/strict";
import { test, describe } from "node:test";
import type { AddressInfo } from "node:net";
import type { Repositories } from "@fitcoach/db";
import type {
  WorkoutRecord,
  WorkoutExerciseRecord,
  ExerciseSetRecord,
  DailyNutritionRecord,
  BodyMeasurementRecord,
  ActivityRecordRow,
  RecoveryIndicatorRecord,
  SleepObservationRecord,
  MealRecord,
  FoodRecord,
  PlanAggregate,
} from "@fitcoach/db";
import type {
  UserId,
  CalendarDate,
  MessageId,
  ActionId,
  Goal,
  Profile,
  User,
} from "@fitcoach/domain";
import type {
  CoachingResponse,
  ProposedAction,
} from "@fitcoach/ai";
import { createServer } from "../server";
import { createServices } from "../services";
import { ConversationOrchestrator, CoachingError } from "../services/aiCoaching/orchestrator";
import { PersonalContextBuilder } from "../services/aiCoaching/contextBuilder";
import { TypedActionRegistry } from "../services/aiCoaching/actionRegistry";
import { ResponseValidator } from "../services/aiCoaching/responseValidator";

/** Anchor date for all fixtures (user-local "today"). */
const TODAY: CalendarDate = "2026-11-12";
const USER_ID: UserId = "usr_ai_coach_1";
const OTHER_USER_ID: UserId = "usr_ai_coach_2";

function iso(date: CalendarDate, hhmm: string): string {
  return `${date}T${hhmm}:00.000Z`;
}

function uuid(seed: number): string {
  return `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
}

// ---------------------------------------------------------------------------
// In-memory test store
// ---------------------------------------------------------------------------

interface TestStore {
  user: User;
  profile: Profile | null;
  goal: Goal | null;
  plan: PlanAggregate | null;
  workouts: Map<string, WorkoutRecord>;
  workoutExercises: Map<string, WorkoutExerciseRecord>;
  progressionEvaluations: Array<{
    exerciseId: string;
    exerciseName: string;
    outcome: string;
  }>;
  dailyNutrition: Map<string, DailyNutritionRecord>;
  activityRecords: Map<string, ActivityRecordRow>;
  recoveryRecords: Map<string, RecoveryIndicatorRecord>;
  sleepRecords: Map<string, SleepObservationRecord>;
  bodyMeasurements: Map<string, BodyMeasurementRecord>;
  decisionSnapshots: Map<string, unknown>;
  decisionEvidence: Map<string, unknown>;
  decisionInterventions: Map<string, unknown>;
  decisionAssumptions: Map<string, unknown>;
  decisionOutcomes: Map<string, unknown>;
  conversations: Map<string, unknown>;
  conversationMessages: Map<string, unknown>;
  meals: Map<string, MealRecord>;
  foods: Map<string, FoodRecord>;
}

function makeStore(): TestStore {
  const user: User = {
    id: USER_ID,
    email: "ai-coach@example.test",
    displayName: "AI Coach Test",
    timezone: "UTC",
    profile: {
      birthDate: "1985-01-01",
      sex: "male",
      heightCm: 180,
      trainingExperience: "intermediate",
      trainingDaysPerWeek: 4,
      sessionDurationMinutes: 60,
      limitations: [],
      unitSystem: "metric",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const profile: Profile = {
    birthDate: "1985-01-01",
    sex: "male",
    heightCm: 180,
    trainingExperience: "intermediate",
    trainingDaysPerWeek: 4,
    sessionDurationMinutes: 60,
    limitations: [],
    unitSystem: "metric",
  };
  const goal: Goal = {
    id: uuid(100),
    userId: USER_ID,
    kind: "bodybuilding",
    priorities: ["chest_size", "strength"],
    physiqueTarget: {
      bodyWeightKg: 80,
      bodyFatPercent: 15,
      waistCm: 82,
      chestCm: 105,
      shoulderCircumferenceCm: 120,
      armCm: 40,
      thighCm: 58,
      calfCm: 40,
      notes: "Hypertrophy goal",
    },
    effectiveFrom: "2026-01-01",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const plan: PlanAggregate = {
    id: uuid(200),
    userId: USER_ID,
    name: "Hypertrophy Phase 1",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    versions: [
      {
        id: uuid(201),
        planId: uuid(200),
        status: "active",
        planJson: "{}",
        effectiveFrom: "2026-01-01",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        sessions: [
          {
            id: uuid(300),
            name: "Upper A",
            weekdayHint: 0,
            slots: [
              {
                id: uuid(310),
                exerciseId: "ex_barbell_bench_press",
                targetSets: 3,
                targetRepRange: { min: 8, max: 12 },
                targetRir: 2,
                restSeconds: undefined,
                substitutionExerciseIds: undefined,
                notes: undefined,
              },
              {
                id: uuid(311),
                exerciseId: "ex_barbell_row",
                targetSets: 3,
                targetRepRange: { min: 8, max: 12 },
                targetRir: 2,
              },
            ],
          },
        ],
      },
    ],
  };

  return {
    user,
    profile,
    goal,
    plan,
    workouts: new Map(),
    workoutExercises: new Map(),
    progressionEvaluations: [],
    dailyNutrition: new Map(),
    activityRecords: new Map(),
    recoveryRecords: new Map(),
    sleepRecords: new Map(),
    bodyMeasurements: new Map(),
    decisionSnapshots: new Map(),
    decisionEvidence: new Map(),
    decisionInterventions: new Map(),
    decisionAssumptions: new Map(),
    decisionOutcomes: new Map(),
    conversations: new Map(),
    conversationMessages: new Map(),
    meals: new Map(),
    foods: new Map(),
  };
}

function addWorkout(
  store: TestStore,
  id: string,
  startedAt: string,
  status: WorkoutRecord["status"] = "completed",
  endedAt?: string,
): void {
  const now = new Date().toISOString();
  const workout: WorkoutRecord = {
    id,
    userId: USER_ID,
    planId: store.plan?.id,
    planVersionId: store.plan?.versions[0]?.id,
    planSessionId: store.plan?.versions[0]?.sessions[0]?.id,
    title: `Workout ${id}`,
    status,
    startedAt,
    endedAt: endedAt ?? iso(TODAY, "10:00"),
    notes: undefined,
    clientRequestId: undefined,
    environmentKind: undefined,
    sessionClassification: undefined,
    createdAt: now,
    updatedAt: now,
  };
  store.workouts.set(id, workout);
}

function addBenchSets(
  store: TestStore,
  workoutId: string,
  exerciseId: string,
  reps: number,
  loadKg: number,
  rir: number,
): void {
  const now = new Date().toISOString();
  const exId = `wex_${workoutId}`;
  const sets: ExerciseSetRecord[] = [
    { id: `s_${exId}_1`, workoutExerciseId: exId, exerciseId, position: 0, kind: "working", reps, loadKg, rir, createdAt: now, updatedAt: now },
    { id: `s_${exId}_2`, workoutExerciseId: exId, exerciseId, position: 1, kind: "working", reps, loadKg, rir, createdAt: now, updatedAt: now },
  ];
  const exercise: WorkoutExerciseRecord = {
    id: exId,
    workoutId,
    exerciseId,
    position: 0,
    notes: undefined,
    slotId: undefined,
    substitutedFromExerciseId: undefined,
    performanceSource: undefined,
    substitutionReason: undefined,
    sets,
    createdAt: now,
    updatedAt: now,
  };
  store.workoutExercises.set(exId, exercise);
}

function addRecoveryAndSleep(store: TestStore, readinessScore = 78): void {
  for (let i = 0; i < 14; i++) {
    const date = new Date(new Date(`${TODAY}T00:00:00.000Z`).getTime() - (13 - i) * 86400000).toISOString().split("T")[0] as CalendarDate;
    store.recoveryRecords.set(`r_${i}`, {
      id: `r_${i}`, userId: USER_ID, date, hrvMs: 45, restingHeartRateBpm: 58, sleepScore: 78,
      readinessScore, muscleSoreness: 2, fatigue: 2, sleepQuality: 78, readinessSubjective: 75,
      source: "manual", externalId: "", confidence: "measured", notes: undefined,
      createdAt: nowStr(), updatedAt: nowStr(),
    } as any);
    store.sleepRecords.set(`s_${i}`, {
      id: `s_${i}`, userId: USER_ID, date, startedAt: iso(date, "22:00"), endedAt: iso(addDays(date, 1), "06:00"),
      timeInBedMinutes: 480, asleepMinutes: 450, efficiency: 0.94, latencyMinutes: 15,
      deepMinutes: 100, remMinutes: 110, lightMinutes: undefined, awakeMinutes: undefined, awakenings: undefined,
      source: "manual", externalId: undefined, confidence: "measured", notes: undefined,
      createdAt: nowStr(), updatedAt: nowStr(),
    } as any);
  }
}

function addDailyNutrition(
  store: TestStore,
  localDate: CalendarDate,
  caloriesKcal: number,
  proteinGrams: number,
): void {
  const record: DailyNutritionRecord = {
    id: `${USER_ID}:${localDate}`,
    userId: USER_ID,
    localDate,
    totals: { caloriesKcal, proteinGrams, carbohydrateGrams: 240, fatGrams: 65 },
    targetsSnapshot: { caloriesKcal: 2400, proteinGrams: 180, carbohydrateGrams: 250, fatGrams: 70 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.dailyNutrition.set(record.id, record);
}

function stalledProgressStore(): TestStore {
  const store = makeStore();
  store.plan = {
    ...makeStore().plan!,
    versions: [
      {
        ...makeStore().plan!.versions[0]!,
        sessions: [
          {
            id: uuid(300),
            name: "Upper A",
            weekdayHint: 0,
            slots: [
              { id: uuid(310), exerciseId: "ex_barbell_bench_press", targetSets: 3, targetRepRange: { min: 8, max: 12 }, targetRir: 2 },
              { id: uuid(311), exerciseId: "ex_barbell_row", targetSets: 3, targetRepRange: { min: 8, max: 12 }, targetRir: 2 },
            ],
          },
          { id: uuid(301), name: "Lower A", weekdayHint: 2, slots: [] },
          { id: uuid(302), name: "Push", weekdayHint: 4, slots: [] },
          { id: uuid(303), name: "Pull", weekdayHint: 6, slots: [] },
        ],
      },
    ],
  };

  // Three completed workouts in the last 14 days, bench press stalled at 60kg x 8.
  addWorkout(store, uuid(400), "2026-10-30T09:00:00.000Z");
  addWorkout(store, uuid(401), "2026-11-01T09:00:00.000Z");
  addWorkout(store, uuid(402), "2026-11-05T09:00:00.000Z");
  for (const id of store.workouts.keys()) {
    const workout = store.workouts.get(id)!;
    addBenchSets(store, workout.id, "ex_barbell_bench_press", 8, 60, 2);
  }

  store.progressionEvaluations = [
    {
      exerciseId: "ex_barbell_bench_press",
      exerciseName: "Barbell Bench Press",
      outcome: "stalled",
      current: { loadKg: 60, reps: 8, rir: 2, localDate: "2026-11-05", loadKind: "external_load" },
      progressionsCompleted: 0,
    } as any,
  ];

  for (let d = 5; d >= 0; d--) {
    const date = new Date(new Date(`${TODAY}T00:00:00.000Z`).getTime() - d * 86400000).toISOString().split("T")[0] as CalendarDate;
    addDailyNutrition(store, date, 2280, 140);
  }

  // Recovery and body history so the stalled-progress context is complete.
  for (let i = 0; i < 14; i++) {
    const date = new Date(new Date(`${TODAY}T00:00:00.000Z`).getTime() - (13 - i) * 86400000).toISOString().split("T")[0] as CalendarDate;
    store.recoveryRecords.set(`r_${i}`, {
      id: `r_${i}`, userId: USER_ID, date, hrvMs: 45, restingHeartRateBpm: 58, sleepScore: 78,
      readinessScore: 78, muscleSoreness: 2, fatigue: 2, sleepQuality: 78, readinessSubjective: 75,
      source: "manual", externalId: "", confidence: "measured", notes: undefined,
      createdAt: nowStr(), updatedAt: nowStr(),
    } as any);
    store.sleepRecords.set(`s_${i}`, {
      id: `s_${i}`, userId: USER_ID, date, startedAt: iso(date, "22:00"), endedAt: iso(addDays(date, 1), "06:00"),
      timeInBedMinutes: 480, asleepMinutes: 450, efficiency: 0.94, latencyMinutes: 15,
      deepMinutes: 100, remMinutes: 110, lightMinutes: undefined, awakeMinutes: undefined, awakenings: undefined,
      source: "manual", externalId: undefined, confidence: "measured", notes: undefined,
      createdAt: nowStr(), updatedAt: nowStr(),
    } as any);
  }
  addBodyMeasurement(store, uuid(600), "2026-10-15T08:00:00.000Z", 80);
  addBodyMeasurement(store, uuid(601), "2026-10-22T08:00:00.000Z", 80);
  addBodyMeasurement(store, uuid(602), "2026-10-29T08:00:00.000Z", 80);
  addBodyMeasurement(store, uuid(603), "2026-11-05T08:00:00.000Z", 80);

  addDecisionSnapshot(store, {
    id: uuid(500),
    decidedAt: "2026-11-10",
    kind: "no_change",
    summary: "Progressing adequately; no change needed.",
    confidence: "measured",
    evidence: [
      {
        sourceEngine: "training_state",
        code: "bench_press_plateau",
        title: "Bench press stalled at 60kg",
        metric: "bench_press_load",
        observed: "60kg x 8 reps for 3 weeks",
        expected: "progression",
        confidence: "measured",
        provenanceClass: "measured",
        basis: "Bench press has been 60kg x 8 reps for 3 weeks — no progression.",
      },
    ],
  });

  return store;
}

function addDecisionSnapshot(
  store: TestStore,
  input: {
    id: string;
    decidedAt: CalendarDate;
    kind: string;
    summary: string;
    confidence: "measured" | "label_declared" | "estimated" | "unknown";
    interventions?: Array<{ kind: string; rationale: string; expectedEffect: string }>;
    evidence?: Array<{
      sourceEngine: string;
      code: string;
      title: string;
      metric: string;
      observed: string;
      expected?: string;
      confidence: "measured" | "label_declared" | "estimated" | "unknown";
      provenanceClass: "measured" | "estimated" | "inferred";
      basis: string;
    }>;
    outcomes?: Array<{ verdict: string; triggersReevaluation: boolean }>;
  },
): void {
  const snapshot = {
    id: input.id,
    userId: USER_ID,
    decidedAt: input.decidedAt,
    kind: input.kind,
    status: "current",
    unifiedStateId: "us_1",
    diagnosesAddressed: [],
    interventions: input.interventions ?? [],
    assumptions: [],
    evidence: input.evidence ?? [],
    monitoringPlan: [],
    configVersion: "v1",
    summary: input.summary,
    confidence: input.confidence,
    supersedesId: undefined,
    warnings: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.decisionSnapshots.set(input.id, snapshot);
  if (input.evidence) {
    for (const ev of input.evidence) {
      store.decisionEvidence.set(ev.code, {
        ...ev,
        id: `ev_${ev.code}`,
        decisionSnapshotId: input.id,
        createdAt: new Date().toISOString(),
      });
    }
  }
  store.decisionInterventions.set(input.id, input.interventions ?? []);
  store.decisionAssumptions.set(input.id, []);
  store.decisionOutcomes.set(input.id, input.outcomes ?? []);
}

function addFood(store: TestStore, id: string, name: string): void {
  const now = new Date().toISOString();
  const food: FoodRecord = {
    id,
    sourceId: "food_source_1",
    name,
    brand: undefined,
    densityBasis: "per_100g",
    nutrientsPer100g: { caloriesKcal: 200, proteinGrams: 20, carbohydrateGrams: 10, fatGrams: 10 },
    servings: [{ id: `serv_${id}`, foodId: id, label: "100g", grams: 100, milliliters: undefined, unitQuantity: undefined, unitName: undefined }],
    defaultServingId: `serv_${id}`,
    barcode: undefined,
    externalId: undefined,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  store.foods.set(id, food);
}

// ---------------------------------------------------------------------------
// Repositories stub over the test store
// ---------------------------------------------------------------------------

function createCoachingRepositories(store: TestStore): Repositories {
  return {
    users: {
      findById: async (id: string) => (id === USER_ID ? store.user : null),
      findByEmail: async () => null,
      create: async () => ({} as any),
      update: async () => ({} as any),
      delete: async () => {},
      localToday: async () => TODAY,
    } as any,
    profiles: {
      get: async (_userId: string) => store.profile,
      upsert: async () => ({} as any),
      revisions: async () => [],
    } as any,
    goals: {
      active: async (_userId: string) => store.goal,
      findById: async () => null,
      create: async () => null as any,
      updateStatus: async () => null as any,
      list: async () => store.goal ? [store.goal] : [],
      getStateSnapshot: async () => null,
    } as any,
    equipment: { listCatalog: async () => [], getUserInventory: async () => [] } as any,
    exercises: {
      findById: async () => null,
      findExerciseById: async (id: string) => {
        const names: Record<string, string> = {
          ex_barbell_bench_press: "Barbell Bench Press",
          ex_barbell_row: "Barbell Row",
        };
        return names[id] ? { id, name: names[id] } as any : null;
      },
      search: async () => ({ foods: [], total: 0 }),
    } as any,
    knowledge: {
      muscleCatalog: async () => [],
      muscleById: async () => null,
      movementFunctions: async () => [],
      searchExercises: async () => ({ exercises: [], total: 0 }),
      exerciseDetail: async () => null,
    } as any,
    exercisePreferences: {
      list: async () => [],
      create: async () => null as any,
      update: async () => null as any,
      delete: async () => {},
    } as any,
    trainingPlans: {
      create: async () => null as any,
      addVersion: async () => null as any,
      findById: async () => null,
      findActive: async (_userId: string) => store.plan,
      getVersions: async () => [],
      getSessions: async () => store.plan?.versions[0]?.sessions ?? [],
      getExerciseSlots: async () => [],
      listForUser: async () => store.plan ? [store.plan] : [],
      listTemporary: async () => [],
      setStatus: async () => null as any,
    } as any,
    trainingEnvironments: {
      create: async () => null as any,
      listForUser: async () => [],
      resolveForDate: async () => null,
    } as any,
    progressionLedger: {
      recordEvaluation: async () => null as any,
      findEvaluation: async () => null,
      listEvaluations: async () => store.progressionEvaluations,
      recordDecisionEvent: async () => null as any,
      listDecisionEvents: async () => [],
    } as any,
    workouts: {
      create: async (input: any) => {
        const id = input.id || uuid(9000);
        const now = new Date().toISOString();
        const workout: WorkoutRecord = {
          id,
          userId: input.userId,
          planId: input.planId ?? null,
          planVersionId: input.planVersionId ?? null,
          planSessionId: input.planSessionId ?? null,
          title: input.title ?? "Workout",
          status: input.status ?? "planned",
          startedAt: input.startedAt ?? iso(TODAY, "09:00"),
          endedAt: input.endedAt ?? iso(TODAY, "10:00"),
          notes: input.notes,
          clientRequestId: input.clientRequestId,
          environmentKind: input.environmentKind,
          sessionClassification: input.sessionClassification,
          createdAt: now,
          updatedAt: now,
        };
        store.workouts.set(id, workout);
        return workout;
      },
      addExercise: async () => null as any,
      addSet: async () => null as any,
      complete: async () => null as any,
      findById: async (id: string) => store.workouts.get(id) ?? null,
      history: async (_userId: string, options?: { limit?: number; to?: CalendarDate }) => {
        const list = [...store.workouts.values()].sort(
          (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
        );
        const filtered = options?.to
          ? list.filter((w) => new Date(w.startedAt).getTime() <= new Date(`${options.to}T00:00:00.000Z`).getTime())
          : list;
        return (options?.limit ? filtered.slice(0, options.limit) : filtered).map((w) => ({
          workout: w,
          exercises: [...store.workoutExercises.values()].filter((e) => e.workoutId === w.id),
        }));
      },
    } as any,
    bodyMeasurements: {
      record: async () => null as any,
      history: async () => [],
      getStateSnapshot: async () => {
        const measurements = [...store.bodyMeasurements.values()].sort(
          (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
        );
        if (measurements.length === 0) return null;
        const latest = measurements[0]!;
        return {
          latestWeightKg: latest.bodyWeightKg,
          latestBodyFatPercent: latest.bodyFatPercent,
          weightTrend7d: -0.375,
          weightTrend28d: -0.375,
          measurementsCount: measurements.length,
          windowDays: 28,
        };
      },
    } as any,
    physiqueGoals: {
      create: async () => null as any,
      getActive: async () => null,
      history: async () => [],
      update: async () => null as any,
      delete: async () => {},
    } as any,
    activity: {
      recordSteps: async () => null as any,
      record: async () => null as any,
      history: async () => [],
      getStateSnapshot: async () => ({
        averageDailySteps: 8000,
        stepsTrend7d: 0,
        stepsTrend28d: 0,
        sessionsPerWeek: 3,
        totalActiveMinutesWeekly: 150,
        windowDays: 28,
      }),
    } as any,
    sleep: {
      record: async () => null as any,
      history: async () => [],
      getStateSnapshot: async (_userId: string, asOf: CalendarDate, windowDays: number) => {
        const endDate = new Date(`${asOf}T00:00:00.000Z`);
        const startDate = new Date(endDate.getTime() - windowDays * 86400000);
        const records = [...store.sleepRecords.values()].filter(
          (s) => s.userId === USER_ID && new Date(s.date) >= startDate && new Date(s.date) <= endDate,
        );
        if (records.length === 0) return null;
        return {
          averageSleepMinutes: records.reduce((sum, s) => sum + (s.asleepMinutes ?? 0), 0) / records.length,
          averageEfficiency: 0.9,
          averageLatencyMinutes: 15,
          sleepDebtMinutes: 0,
          consistencyScore: 80,
          windowDays,
        };
      },
    } as any,
    recovery: {
      record: async () => null as any,
      history: async () => [],
      getStateSnapshot: async (_userId: string, asOf: CalendarDate, windowDays: number) => {
        const endDate = new Date(`${asOf}T00:00:00.000Z`);
        const startDate = new Date(endDate.getTime() - windowDays * 86400000);
        const records = [...store.recoveryRecords.values()].filter(
          (r) => r.userId === USER_ID && new Date(r.date) >= startDate && new Date(r.date) <= endDate,
        );
        if (records.length === 0) return null;
        const readiness = records.reduce((sum, r) => sum + (r.readinessScore ?? 0), 0) / records.length;
        const fatigue = records.reduce((sum, r) => sum + (r.fatigue ?? 0), 0) / records.length;
        return {
          averageReadinessScore: readiness,
          confidence: 0.5,
          sleepQualityTrend: "stable",
          sleepAdequacy: "adequate",
          hrvTrend: "stable",
          fatigueAccumulation: fatigue > 7 ? "high" : fatigue > 4 ? "moderate" : "low",
          limitingFactors: [],
          trainingRecommendation: "maintain",
          nutritionRecommendations: [],
          activityRecommendations: [],
          basisNote: "computed from test records",
          windowDays,
        };
      },
    } as any,
    foods: {
      createSource: async () => null as any,
      findSource: async () => null,
      findOrCreateUserSource: async () => null as any,
      createFood: async () => null as any,
      findById: async (id: string) => store.foods.get(id) ?? null,
      findByBarcode: async () => null,
      searchFoods: async () => ({ foods: [], total: 0 }),
      updateNutrients: async () => null as any,
      deactivate: async () => {},
      listUserFoods: async () => [],
    } as any,
    meals: {
      create: async (input: any) => {
        const id = input.id || `meal_${uuid(9000)}`;
        const now = new Date().toISOString();
        const meal: MealRecord = {
          id,
          userId: input.userId,
          localDate: input.localDate,
          slot: input.slot,
          consumedAt: input.consumedAt,
          notes: input.notes,
          clientRequestId: input.clientRequestId,
          items: input.items.map((item: any, index: number) => ({
            id: `mi_${id}_${index}`,
            mealId: id,
            foodId: item.foodId,
            recipeId: undefined,
            quantityGrams: item.quantityGrams,
            computedNutrients: item.computedNutrients ?? { caloriesKcal: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0 },
            confidence: item.confidence ?? "estimated",
            notes: item.notes,
            createdAt: now,
            updatedAt: now,
          })),
          totals: input.totals,
          createdAt: now,
          updatedAt: now,
        };
        store.meals.set(id, meal);
        return meal;
      },
      addItem: async () => null as any,
      findById: async (id: string) => store.meals.get(id) ?? null,
      listByDate: async () => [],
    } as any,
    recipes: {
      create: async () => null as any,
      findById: async () => null,
      listByOwner: async () => [],
      computeNutrition: async () => null as any,
      delete: async () => {},
    } as any,
    nutrition: {
      upsertDaily: async () => null as any,
      getDaily: async () => null,
      getStateSnapshot: async (_userId: string, asOf: CalendarDate, windowDays: number) => {
        const endDate = new Date(`${asOf}T00:00:00.000Z`);
        const startDate = new Date(endDate.getTime() - windowDays * 86400000);
        const records = [...store.dailyNutrition.values()].filter(
          (d) => d.userId === USER_ID && new Date(d.localDate) >= startDate && new Date(d.localDate) <= endDate,
        );
        if (records.length === 0) return null;
        const avgCalories = records.reduce((sum, r) => sum + r.totals.caloriesKcal, 0) / records.length;
        const avgProtein = records.reduce((sum, r) => sum + r.totals.proteinGrams, 0) / records.length;
        return {
          recentDailyTotals: records,
          averageCalories: avgCalories,
          averageProteinGrams: avgProtein,
          averageCarbsGrams: 240,
          averageFatGrams: 65,
          adherencePercent: 100,
          daysWithData: records.length,
          windowDays,
        };
      },
    } as any,
    diagnoses: {
      create: async () => null as any,
      attachEvidence: async () => null as any,
      updateStatus: async () => null as any,
      findById: async () => null,
      list: async () => [],
    } as any,
    recommendations: {
      create: async () => null as any,
      updateStatus: async () => null as any,
      findById: async () => null,
      list: async () => [],
    } as any,
    interventions: {
      create: async () => null as any,
      updateStatus: async () => null as any,
      supersede: async () => null as any,
      recordOutcome: async () => null as any,
      findById: async () => null,
      list: async () => [],
      listActive: async () => [],
      outcomes: async () => [],
    } as any,
    decisionSnapshots: {
      create: async () => null as any,
      updateStatus: async () => null as any,
      findById: async (id: string) => (store.decisionSnapshots.get(id) as any) ?? null,
      findByIdWithRelations: async (id: string) => {
        const snapshot = store.decisionSnapshots.get(id) as any;
        if (!snapshot) return null;
        return {
          ...snapshot,
          interventions: store.decisionInterventions.get(id) ?? [],
          evidence: (store.decisionEvidence as Map<string, any>).values
            ? [...store.decisionEvidence.values()].filter((e: any) => e.decisionSnapshotId === id)
            : [],
          assumptions: store.decisionAssumptions.get(id) ?? [],
          outcomes: store.decisionOutcomes.get(id) ?? [],
        };
      },
      list: async (_userId: string, options?: { status?: string; limit?: number }) => {
        let snapshots = [...store.decisionSnapshots.values()] as any[];
        if (options?.status) snapshots = snapshots.filter((s) => s.status === options.status);
        snapshots.sort((a, b) => new Date(b.decidedAt).getTime() - new Date(a.decidedAt).getTime());
        if (options?.limit) snapshots = snapshots.slice(0, options.limit);
        return snapshots;
      },
    } as any,
    decisionInterventions: {
      create: async () => null as any,
      listByDecisionSnapshot: async () => [],
    } as any,
    decisionEvidence: {
      create: async () => null as any,
      listByDecisionSnapshot: async () => [],
    } as any,
    decisionAssumptions: {
      create: async () => null as any,
      listByDecisionSnapshot: async () => [],
    } as any,
    decisionOutcomes: {
      create: async () => null as any,
      list: async () => [],
    } as any,
    conversations: {
      create: async (input: any) => {
        const id = input.id || uuid(8000);
        const now = new Date().toISOString();
        const record = {
          id,
          userId: input.userId,
          title: input.title ?? null,
          status: input.status ?? "active",
          createdAt: now,
          updatedAt: now,
        };
        store.conversations.set(id, record);
        return record;
      },
      findById: async (id: string) => (store.conversations.get(id) as any) ?? null,
      list: async (_userId: string, options?: { limit?: number; cursor?: string }) => {
        let list = [...store.conversations.values()] as any[];
        list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        if (options?.limit) list = list.slice(0, options.limit);
        return list;
      },
      updateStatus: async () => null as any,
    } as any,
    conversationMessages: {
      create: async (input: any) => {
        const id = input.id || uuid(7000 + store.conversationMessages.size + 1);
        const now = new Date().toISOString();
        const record = {
          id,
          conversationId: input.conversationId,
          role: input.role,
          content: input.content,
          contextSnapshot: input.contextSnapshot,
          evidenceRefs: input.evidenceRefs,
          proposedActions: input.proposedActions,
          isMock: input.isMock ?? false,
          provider: input.provider ?? null,
          model: input.model ?? null,
          createdAt: now,
        };
        store.conversationMessages.set(id, record);
        return record;
      },
      findById: async (id: string) => (store.conversationMessages.get(id) as any) ?? null,
      list: async (_conversationId: string, options?: { limit?: number; cursor?: string }) => {
        let list = [...store.conversationMessages.values()] as any[];
        list = list.filter((m) => m.conversationId === _conversationId);
        list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        if (options?.limit) list = list.slice(0, options.limit);
        return list;
      },
      listByUser: async (_userId: string, options?: { limit?: number; cursor?: string }) => {
        let conversations = [...store.conversations.values()] as any[];
        conversations.sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        if (options?.limit) conversations = conversations.slice(0, options.limit);
        return conversations.map((c) => {
          const messages = ([...store.conversationMessages.values()] as any[]).filter(
            (m: any) => m.conversationId === c.id,
          );
          messages.sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
          return { conversationId: c.id, messages };
        });
      },
    } as any,
  } as unknown as Repositories;
}

// ---------------------------------------------------------------------------
// Server harness
// ---------------------------------------------------------------------------

async function withCoachingServer(
  store: TestStore,
  run: (baseUrl: string, repos: Repositories) => Promise<void>,
): Promise<void> {
  const repos = createCoachingRepositories(store);
  const services = createServices(repos);
  const server = createServer({ services });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  try {
    const { port } = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${port}`, repos);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function postMessage(
  baseUrl: string,
  userId: string,
  conversationId: string,
  body: Record<string, unknown>,
): Promise<CoachingResponse> {
  const response = await fetch(`${baseUrl}/v0/users/${userId}/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(response.status, 200, `POST message failed: ${response.status} ${text}`);
  return JSON.parse(text) as CoachingResponse;
}

async function createConversation(baseUrl: string, userId: string, title?: string) {
  const response = await fetch(`${baseUrl}/v0/users/${userId}/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...(title ? { title } : {}) }),
  });
  assert.ok([200, 201].includes(response.status), `create conversation: ${response.status}`);
  return response.json() as Promise<{ conversation: { id: string } }>;
}

async function listMessages(baseUrl: string, userId: string, conversationId: string) {
  const response = await fetch(`${baseUrl}/v0/users/${userId}/conversations/${conversationId}/messages`);
  assert.equal(response.status, 200);
  return response.json() as Promise<{ messages: unknown[] }>;
}

async function getMessage(baseUrl: string, userId: string, messageId: MessageId) {
  const response = await fetch(`${baseUrl}/v0/users/${userId}/messages/${messageId}`);
  return response;
}

async function previewAction(
  baseUrl: string,
  userId: string,
  conversationId: string,
  messageId: MessageId,
  actionId: ActionId,
) {
  const response = await fetch(
    `${baseUrl}/v0/users/${userId}/conversations/${conversationId}/messages/${messageId}/actions/${actionId}/preview`,
    { method: "POST" },
  );
  return response;
}

async function confirmAction(
  baseUrl: string,
  userId: string,
  conversationId: string,
  messageId: MessageId,
  actionId: ActionId,
) {
  const response = await fetch(
    `${baseUrl}/v0/users/${userId}/conversations/${conversationId}/messages/${messageId}/actions/${actionId}/confirm`,
    { method: "POST" },
  );
  return response;
}

async function rejectAction(
  baseUrl: string,
  userId: string,
  conversationId: string,
  messageId: MessageId,
  actionId: ActionId,
) {
  const response = await fetch(
    `${baseUrl}/v0/users/${userId}/conversations/${conversationId}/messages/${messageId}/actions/${actionId}/reject`,
    { method: "POST" },
  );
  return response;
}

// ---------------------------------------------------------------------------
// Scenario fixtures
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Scenario A: stalled progress question (multi-domain)", () => {
  test("responds with actual training data and current no_change decision", async () => {
    const store = stalledProgressStore();
    await withCoachingServer(store, async (baseUrl) => {
      const { conversation } = await createConversation(baseUrl, USER_ID, "Bench stall");
      const body = await postMessage(baseUrl, USER_ID, conversation.id, {
        message: "Why am I not progressing on bench press?",
        asOf: TODAY,
        intent: { intent: "stalled_progress", confidence: 0.9, entities: {} },
      });

      assert.equal(body.isMock, true, "mock provider must be labeled");
      assert.equal(body.intent.intent, "stalled_progress");
      assert.equal(body.decisionContext.decisionSnapshot?.kind, "no_change");
      assert.ok(body.decisionContext.decisionSnapshot?.summary.includes("Progressing"), "decision summary should reference progressing");
      assert.equal(body.quality.sufficientForAdvice, true, "multi-domain context should be sufficient");
      assert.ok(!body.quality.missingDataWarnings.some((w) => w.toLowerCase().includes("no data")), "missing data warnings must not claim no data exists");

      const answer = body.answer;
      assert.ok(/bench/i.test(answer), "answer should reference the bench press");
      assert.ok(/60kg/i.test(answer), "answer should reference the actual 60kg load");

      const trainingRefs = body.evidenceReferences.filter((r) => r.source === "training_state");
      assert.ok(trainingRefs.length > 0, "evidence references should include training_state");
      assert.ok(
        trainingRefs.some((r) => /bench/i.test(r.code) || /bench/i.test(r.title)),
        "evidence references should include a bench-press-related code",
      );

      // Persistence check: user + assistant messages stored
      const messages = await listMessages(baseUrl, USER_ID, conversation.id);
      if (messages.messages.length < 2) console.log("SCENARIO A messages:", messages.messages.length, JSON.stringify(messages.messages.map((m: any) => ({ role: m.role, len: m.content.length }))));
      assert.ok(messages.messages.length >= 2, "both turns should be persisted");
    });
  });
});

describe("Scenario B: today's workout question (plan + recovery)", () => {
  test("references today's planned session and recovery state without prescribing load", async () => {
    const store = makeStore();
    addWorkout(store, uuid(400), "2026-10-30T09:00:00.000Z", "completed");
    addWorkout(store, uuid(401), "2026-11-01T09:00:00.000Z", "completed");

    // Recovery: readiness 65 (moderate), sleep moderate debt.
    // Patch the store's recovery/sleep records directly (the stubs compute from them):
    for (let i = 0; i < 14; i++) {
      const date = new Date(new Date(`${TODAY}T00:00:00.000Z`).getTime() - (13 - i) * 86400000).toISOString().split("T")[0] as CalendarDate;
      store.recoveryRecords.set(`r_${i}`, {
        id: `r_${i}`, userId: USER_ID, date, hrvMs: 45, restingHeartRateBpm: 58, sleepScore: 70,
        readinessScore: 65, muscleSoreness: 3, fatigue: 5, sleepQuality: 70, readinessSubjective: 60,
        source: "manual", externalId: "", confidence: "measured", notes: undefined,
        createdAt: nowStr(), updatedAt: nowStr(),
      } as any);
    }
    for (let i = 0; i < 14; i++) {
      const date = new Date(new Date(`${TODAY}T00:00:00.000Z`).getTime() - (13 - i) * 86400000).toISOString().split("T")[0] as CalendarDate;
      store.sleepRecords.set(`s_${i}`, {
        id: `s_${i}`, userId: USER_ID, date, startedAt: iso(date, "22:00"), endedAt: iso(addDays(date, 1), "06:00"),
        timeInBedMinutes: 480, asleepMinutes: 390, efficiency: 0.81, latencyMinutes: 15,
        deepMinutes: 70, remMinutes: 90, lightMinutes: undefined, awakeMinutes: undefined, awakenings: undefined,
        source: "manual", externalId: undefined, confidence: "measured", notes: undefined,
        createdAt: nowStr(), updatedAt: nowStr(),
      } as any);
    }

    addDecisionSnapshot(store, {
      id: uuid(501),
      decidedAt: "2026-11-10",
      kind: "no_change",
      summary: "Plan stands; no recovery block.",
      confidence: "measured",
      evidence: [
        { sourceEngine: "training_state", code: "todays_session", title: "Today's session planned", metric: "session_plan", observed: "Upper A", expected: "follow plan", confidence: "measured", provenanceClass: "measured", basis: "Today's planned session is Upper A." },
        { sourceEngine: "recovery_state", code: "readiness_score", title: "Readiness score", metric: "readiness", observed: "65/100", expected: ">=70", confidence: "measured", provenanceClass: "measured", basis: "Readiness is 65/100 — moderate fatigue." },
      ],
    });

    await withCoachingServer(store, async (baseUrl) => {
      const { conversation } = await createConversation(baseUrl, USER_ID, "Today's workout");
      const body = await postMessage(baseUrl, USER_ID, conversation.id, {
        message: "Should I train today?",
        asOf: TODAY,
        intent: { intent: "todays_workout", confidence: 0.9, entities: {} },
      });

      assert.equal(body.isMock, true);
      const answer = body.answer;
      assert.ok(/Upper A/i.test(answer), "answer should reference today's planned session");
      assert.ok(/65/i.test(answer), "answer should reference readiness 65");
      assert.ok(/moderate/i.test(answer), "answer should reference moderate fatigue/debt");
      // AI must not prescribe specific sets/reps/load as an instruction.
      assert.ok(!/you should do \d+ sets|prescribe \d+|do \d+ reps/i.test(answer), "answer must not prescribe sets/reps/load");
      const sources = new Set(body.evidenceReferences.map((r) => r.source));
      assert.ok(sources.has("recovery_state"), "evidence should include recovery_state");
      assert.ok(sources.has("training_state"), "evidence should include training_state");
      assert.equal(body.decisionContext.decisionSnapshot?.kind, "no_change");
    });
  });
});

function nowStr(): string {
  return new Date().toISOString();
}

// Add `days` days to a calendar date.
function addDays(date: CalendarDate, days: number): CalendarDate {
  return (new Date(new Date(`${date}T00:00:00.000Z`).getTime() + days * 86400000).toISOString().split("T")[0] as CalendarDate);
}

describe("Scenario C: nutrition question (meals + targets + intervention)", () => {
  test("references actual intake vs target and the active intervention", async () => {
    const store = makeStore();
    // 7 days of nutrition: 2100kcal / 140g protein vs 2400 / 180 targets.
    for (let d = 6; d >= 0; d--) {
      const date = new Date(new Date(`${TODAY}T00:00:00.000Z`).getTime() - d * 86400000).toISOString().split("T")[0] as CalendarDate;
      addDailyNutrition(store, date, 2100, 140);
    }

    for (let d = 6; d >= 0; d--) {
      const date = new Date(new Date(`${TODAY}T00:00:00.000Z`).getTime() - d * 86400000).toISOString().split("T")[0] as CalendarDate;
      addDailyNutrition(store, date, 2100, 140);
    }
    addBodyMeasurement(store, uuid(620), "2026-11-05T08:00:00.000Z", 80);

    addDecisionSnapshot(store, {
      id: uuid(502),
      decidedAt: "2026-11-10",
      kind: "intervention_selected",
      summary: "Increase protein toward target.",
      confidence: "measured",
      interventions: [
        { kind: "nutrition_target_adjustment", rationale: "Protein below target", expectedEffect: "Higher protein intake" },
      ],
      evidence: [
        {
          sourceEngine: "nutrition_state",
          code: "protein_intake_below_target",
          title: "Protein intake below target",
          metric: "protein_daily_avg_g",
          observed: "140g vs 180g target (77.8%)",
          expected: "180g",
          confidence: "measured",
          provenanceClass: "measured",
          basis: "Average protein is 140g against a 180g target (77.8%).",
        },
      ],
    });

    await withCoachingServer(store, async (baseUrl) => {
      const { conversation } = await createConversation(baseUrl, USER_ID, "Nutrition");
      const body = await postMessage(baseUrl, USER_ID, conversation.id, {
        message: "Am I eating enough protein?",
        asOf: TODAY,
        intent: { intent: "nutrition_question", confidence: 0.8, entities: {} },
      });

      assert.equal(body.isMock, true);
      const answer = body.answer;
      assert.ok(/140g/i.test(answer) || /140/i.test(answer), "answer should reference actual 140g protein");
      assert.ok(/nutrition_target_adjustment/i.test(answer), "answer should reference the active intervention");

      const nutritionRefs = body.evidenceReferences.filter((r) => r.source === "nutrition_state");
      assert.ok(nutritionRefs.length > 0, "evidence references should include nutrition_state");
      assert.ok(
        nutritionRefs.some((r) => /protein/i.test(r.code)),
        "evidence should include a protein-related code",
      );
      assert.ok(
        nutritionRefs.some((r) => /180/.test(r.value) && /77\.8/.test(r.value)),
        "evidence observed value should reference the 180g target and 77.8% adherence",
      );
      // No invented calorie target: any calorie figure in the answer must be
      // either the logged intake (2100kcal) or the target (2400kcal).
      const kcalFigures = answer.match(/\d{3,}kcal/g) ?? [];
      for (const figure of kcalFigures) {
        const n = Number(figure.replace("kcal", ""));
        assert.ok(n === 2100 || n === 2400, `unexpected calorie figure ${figure} in answer`);
      }
    });
  });
});

describe("Scenario D: weight/physique question (longitudinal + projection + uncertainty)", () => {
  test("references measurements, projection and goal with uncertainty", async () => {
    const store = makeStore();
    store.goal = {
      ...store.goal!,
      physiqueTarget: { ...store.goal!.physiqueTarget, bodyWeightKg: 77 },
    } as Goal;
    // 4 measurements over ~6 weeks: 82 -> 80 -> 79.5 -> 79 kg.
    addBodyMeasurement(store, uuid(600), "2026-09-30T08:00:00.000Z", 82);
    addBodyMeasurement(store, uuid(601), "2026-10-14T08:00:00.000Z", 80);
    addBodyMeasurement(store, uuid(602), "2026-10-28T08:00:00.000Z", 79.5);
    addBodyMeasurement(store, uuid(603), "2026-11-05T08:00:00.000Z", 79);

    addDecisionSnapshot(store, {
      id: uuid(503),
      decidedAt: "2026-11-10",
      kind: "no_change",
      summary: "Trend is on track; no change needed.",
      confidence: "estimated",
      evidence: [
        {
          sourceEngine: "body_state",
          code: "weight_trend",
          title: "Weight trend",
          metric: "weight_trend_28d",
          observed: "79kg, -0.375kg/week",
          expected: "steady loss",
          confidence: "estimated",
          provenanceClass: "estimated",
          basis: "Weight has moved 82kg -> 79kg over ~6 weeks (-0.375kg/week).",
        },
        {
          sourceEngine: "projection_state",
          code: "weight_projection_3mo",
          title: "Projected weight at 3 months",
          metric: "projection_body_weight_kg",
          observed: "77kg",
          expected: "goal 77kg",
          confidence: "estimated",
          provenanceClass: "estimated",
          basis: "Projection estimates 77kg at 3 months if the current trend continues.",
        },
      ],
    });

    await withCoachingServer(store, async (baseUrl) => {
      const { conversation } = await createConversation(baseUrl, USER_ID, "Weight");
      const body = await postMessage(baseUrl, USER_ID, conversation.id, {
        message: "Why is my weight not dropping faster?",
        asOf: TODAY,
        intent: { intent: "weight_physique", confidence: 0.8, entities: {} },
      });

      assert.equal(body.isMock, true);
      const answer = body.answer;
      if (!/79kg/i.test(answer)) console.log("SCENARIO D ANSWER:\n" + answer);
      assert.ok(/79kg/i.test(answer), "answer should reference current 79kg");
      assert.ok(/3 months/i.test(answer), "answer should reference the projection timeframe");
      assert.ok(/-0\.38kg/i.test(answer), "answer should reference the -0.38kg/week trend (rounded)");
      assert.ok(/77kg/i.test(answer), "answer should reference the 77kg projection");
      assert.ok(/estimated/i.test(answer), "answer should communicate estimated uncertainty");
      assert.ok(/3 months/i.test(answer), "answer should reference the projection timeframe");

      const sources = new Set(body.evidenceReferences.map((r) => r.source));
      assert.ok(sources.has("body_state"), "evidence references should include body_state");
      assert.ok(sources.has("projection_state"), "evidence references should include projection_state");
      // No invented weight target/timeline: only goal-provided figures appear.
      assert.ok(!/lose \d+kg in \d+ weeks/i.test(answer), "answer must not invent a weight-loss timeline");
    });
  });
});

function addBodyMeasurement(store: TestStore, id: string, recordedAt: string, weightKg: number): void {
  store.bodyMeasurements.set(id, {
    id,
    userId: USER_ID,
    recordedAt,
    condition: "morning_fasted",
    bodyWeightKg: weightKg,
    bodyFatPercent: undefined,
    circumferencesCm: { waist: 84 },
    enteredVia: "manual",
    confidence: "measured",
    sourceName: "smart scale",
    externalId: undefined,
    photoRefs: [],
    notes: undefined,
    createdAt: nowStr(),
    updatedAt: nowStr(),
  } as BodyMeasurementRecord);
}

describe("Scenario E: follow-up preserves prior context", () => {
  test("second turn references the first turn's evidence", async () => {
    const store = stalledProgressStore();
    await withCoachingServer(store, async (baseUrl) => {
      const { conversation } = await createConversation(baseUrl, USER_ID, "Follow-up");

      const firstBody = await postMessage(baseUrl, USER_ID, conversation.id, {
        message: "Why am I not progressing on bench press?",
        asOf: TODAY,
        intent: { intent: "stalled_progress", confidence: 0.9, entities: {} },
      });
      if (!/60kg/i.test(firstBody.answer)) console.log("SCENARIO E FIRST ANSWER:\n" + firstBody.answer);
      assert.ok(/60kg/i.test(firstBody.answer));

      const secondBody = await postMessage(baseUrl, USER_ID, conversation.id, {
        message: "What should I change?",
        asOf: TODAY,
        intent: { intent: "follow_up", confidence: 0.7, entities: {} },
      });
      assert.equal(secondBody.conversationId, conversation.id);
      assert.equal(
        secondBody.decisionContext.decisionSnapshot?.id,
        firstBody.decisionContext.decisionSnapshot?.id,
        "decision id should match across turns",
      );
      const secondAnswer = secondBody.answer;
      assert.ok(
        /previous turn|earlier turn|still stands|60kg/i.test(secondAnswer),
        "follow-up should reference the previous turn's evidence",
      );
      const firstCodes = new Set(firstBody.evidenceReferences.map((r) => `${r.source}:${r.code}`));
      const secondCodes = new Set(secondBody.evidenceReferences.map((r) => `${r.source}:${r.code}`));
      for (const code of firstCodes) {
        assert.ok(secondCodes.has(code), `evidence reference ${code} should carry over to the follow-up`);
      }
    });
  });
});

describe("Scenario F: missing/stale data produces honest uncertainty", () => {
  test("refuses to invent targets when nothing is logged", async () => {
    const store = makeStore();
    // Minimal user: profile without height/experience, no goal, no logs, no decision.
    store.profile = {
      ...store.profile,
      heightCm: undefined,
      trainingExperience: undefined,
      trainingDaysPerWeek: undefined,
    } as any;
    store.goal = null;

    await withCoachingServer(store, async (baseUrl) => {
      const { conversation } = await createConversation(baseUrl, USER_ID, "Empty");
      const body = await postMessage(baseUrl, USER_ID, conversation.id, {
        message: "What should I eat today?",
        asOf: TODAY,
        intent: { intent: "nutrition_question", confidence: 0.6, entities: {} },
      });

      assert.equal(body.isMock, true);
      assert.equal(body.quality.sufficientForAdvice, false);
      assert.ok(body.quality.missingDataWarnings.length > 0, "missing data warnings expected");
      assert.ok(body.quality.staleDataWarnings.length > 0, "stale data warnings expected");

      const answer = body.answer;
      assert.ok(
        /don.t have enough|not enough/i.test(answer),
        "answer should express uncertainty about missing data",
      );
      // No invented calorie targets, meal plans or specific foods.
      assert.ok(!/\d{3,}kcal/i.test(answer), "answer must not invent calorie targets");
    });
  });
});

describe("Scenario G: challenging the current recommendation", () => {
  test("explains the Decision Brain reasoning without overriding it", async () => {
    const store = makeStore();
    // User completes all planned sessions; recovery good. Body data exists so
    // the full-context sufficiency gate passes.
    addWorkout(store, uuid(400), "2026-11-04T09:00:00.000Z", "completed");
    addWorkout(store, uuid(401), "2026-11-06T09:00:00.000Z", "completed");
    addWorkout(store, uuid(402), "2026-11-08T09:00:00.000Z", "completed");
    addBodyMeasurement(store, uuid(610), "2026-11-05T08:00:00.000Z", 80);
    addRecoveryAndSleep(store, 80);
    for (let d = 6; d >= 0; d--) {
      const date = new Date(new Date(`${TODAY}T00:00:00.000Z`).getTime() - d * 86400000).toISOString().split("T")[0] as CalendarDate;
      addDailyNutrition(store, date, 2200, 150);
    }
    for (const id of store.workouts.keys()) {
      const workout = store.workouts.get(id)!;
      addBenchSets(store, workout.id, "ex_barbell_bench_press", 10, 60, 1);
    }
    for (let i = 0; i < 14; i++) {
      const date = new Date(new Date(`${TODAY}T00:00:00.000Z`).getTime() - (13 - i) * 86400000).toISOString().split("T")[0] as CalendarDate;
      store.recoveryRecords.set(`r_${i}`, {
        id: `r_${i}`, userId: USER_ID, date, hrvMs: 55, restingHeartRateBpm: 55, sleepScore: 80,
        readinessScore: 80, muscleSoreness: 2, fatigue: 3, sleepQuality: 80, readinessSubjective: 75,
        source: "manual", externalId: "", confidence: "measured", notes: undefined,
        createdAt: nowStr(), updatedAt: nowStr(),
      } as any);
    }

    addDecisionSnapshot(store, {
      id: uuid(504),
      decidedAt: "2026-11-08",
      kind: "training_volume_adjustment",
      summary: "Increase chest volume by 10% to address volume deficit.",
      confidence: "measured",
      interventions: [
        { kind: "training_volume_adjustment", rationale: "Chest volume below target", expectedEffect: "More chest stimulus" },
      ],
      evidence: [
        {
          sourceEngine: "training_state",
          code: "chest_volume_deficit",
          title: "Chest volume below target",
          metric: "weekly_volume_chest",
          observed: "12 sets",
          expected: "16 sets",
          confidence: "measured",
          provenanceClass: "measured",
          basis: "Weekly chest volume is 12 sets against a 16-set target.",
        },
      ],
    });

    await withCoachingServer(store, async (baseUrl) => {
      const { conversation } = await createConversation(baseUrl, USER_ID, "Challenge");
      const body = await postMessage(baseUrl, USER_ID, conversation.id, {
        message: "I don't think I need more volume. I'm recovering fine.",
        asOf: TODAY,
        intent: { intent: "general_coaching", confidence: 0.6, entities: {} },
      });

      assert.equal(body.isMock, true);
      const answer = body.answer;
      if (!/volume deficit|12 sets|16 sets/i.test(answer)) console.log("SCENARIO G ANSWER:\n" + answer);
      assert.ok(/volume deficit|12 sets|16 sets/i.test(answer), "answer should explain the decision reasoning with actual evidence");
      assert.ok(/80/i.test(answer), "answer should acknowledge the user's readiness data");
      assert.ok(!/reverse|override|ignore the decision/i.test(answer), "answer must not reverse the decision");
      assert.equal(body.decisionContext.decisionSnapshot?.kind, "training_volume_adjustment");
      assert.equal(body.decisionContext.decisionSnapshot?.id, uuid(504));
      const trainingRefs = body.evidenceReferences.filter((r) => r.source === "training_state");
      assert.ok(trainingRefs.some((r) => /volume/i.test(r.code) || /volume/i.test(r.title)), "evidence should reference the volume deficit");
    });
  });
});

describe("Scenario H: new logs refresh context without rewriting prior snapshots", () => {
  test("R1 vs R2 reflect the newly logged workout", async () => {
    const store = makeStore();
    // No workouts initially, but recovery data exists so advice is possible.
    addRecoveryAndSleep(store);
    addDecisionSnapshot(store, {
      id: uuid(505),
      decidedAt: "2026-11-10",
      kind: "no_change",
      summary: "Plan stands.",
      confidence: "measured",
    });

    await withCoachingServer(store, async (baseUrl, repos) => {
      const { conversation } = await createConversation(baseUrl, USER_ID, "Refresh");

      const r1Body = await postMessage(baseUrl, USER_ID, conversation.id, {
        message: "Should I train today?",
        asOf: TODAY,
        intent: { intent: "todays_workout", confidence: 0.9, entities: {} },
      });
      const r1GeneratedAt = r1Body.contextSnapshot.generatedAt;
      assert.ok(/0%|no completed|adherence/i.test(r1Body.answer), "R1 should reflect no completed workouts");

      // Log a workout between turns (new log, prior snapshot untouched).
      await (repos.workouts.create as any)({
        id: uuid(410),
        userId: USER_ID,
        planId: store.plan!.id,
        planVersionId: store.plan!.versions[0]!.id,
        planSessionId: store.plan!.versions[0]!.sessions[0]!.id,
        title: "Upper A",
        status: "completed",
        startedAt: iso(TODAY, "09:00"),
        endedAt: iso(TODAY, "10:00"),
      });
      addBenchSets(store, uuid(410), "ex_barbell_bench_press", 8, 60, 2);

      // Simulate a refreshed decision picking up the new log as evidence.
      store.decisionEvidence.set("ev_workout_logged", {
        id: "ev_workout_logged",
        decisionSnapshotId: uuid(505),
        sourceEngine: "training_state",
        code: "workout_logged",
        title: "Workout logged",
        metric: "last_workout",
        observed: "Upper A completed 2026-11-12",
        expected: "follow plan",
        confidence: "measured",
        provenanceClass: "measured",
        basis: "You completed Upper A today.",
        createdAt: new Date().toISOString(),
      });

      const r2Body = await postMessage(baseUrl, USER_ID, conversation.id, {
        message: "Should I train today?",
        asOf: TODAY,
        intent: { intent: "todays_workout", confidence: 0.9, entities: {} },
      });

      if (r1Body.answer === r2Body.answer) {
        console.log("SCENARIO H R1:\n" + r1Body.answer);
        console.log("SCENARIO H R2:\n" + r2Body.answer);
      }
      assert.notEqual(r1Body.answer, r2Body.answer, "R2 should differ from R1 after the new log");
      assert.ok(
        new Date(r2Body.contextSnapshot.generatedAt).getTime() >= new Date(r1GeneratedAt).getTime(),
        "context snapshot should be regenerated",
      );
      assert.ok(/100%|completed/i.test(r2Body.answer), "R2 should acknowledge the logged workout");
      const r2Codes = new Set(r2Body.evidenceReferences.map((r) => `${r.source}:${r.code}`));
      assert.ok(r2Codes.has("training_state:workout_logged"), "R2 evidence should include the newly logged workout");
      // Prior message untouched: re-fetch the first assistant message.
      const messages = await listMessages(baseUrl, USER_ID, conversation.id);
      const firstAssistant = messages.messages.find((m: any) => m.role === "assistant");
      assert.ok(firstAssistant, "first assistant message must still exist");
    });
  });
});

// ---------------------------------------------------------------------------
// Additional pipeline tests
// ---------------------------------------------------------------------------

describe("Response validation: invalid or unsupported claims are rejected", () => {
  test("orchestrator rejects a proposed action outside the allowlist", async () => {
    const store = makeStore();
    const repos = createCoachingRepositories(store);
    const contextBuilder = new PersonalContextBuilder(repos);
    const actionRegistry = new TypedActionRegistry(repos);
    const validator = new ResponseValidator(actionRegistry);

    // A rogue provider that tries to make the AI execute arbitrary code.
    const rogueProvider = {
      metadata: { name: "mock", isMock: true, model: "rogue" },
      generate: async () => ({
        answer: "Just run `DROP TABLE users` and everything will be fine.",
        reasoningTrace: [],
        proposedActions: [
          {
            id: uuid(9999),
            kind: "run_arbitrary_code" as any,
            title: "Run code",
            description: "execute arbitrary SQL",
            domainService: "arbitrary.query",
            parameters: { sql: "DROP TABLE users" },
            requiresConfirmation: false,
            validated: false,
            evidenceRefs: [],
            status: "pending",
          },
        ],
        isMock: true,
      }),
    };

    const orchestrator = new ConversationOrchestrator({
      repos,
      provider: rogueProvider as any,
      contextBuilder,
      actionRegistry,
      validator,
    });

    await assert.rejects(
      orchestrator.handleCoachingRequest({
        userId: USER_ID,
        message: "Do something dangerous",
        contextSources: {
          profile: true, goal: true, training: true, nutrition: true, activity: true,
          recovery: true, body: true, projection: true, decision: true, conversation: true,
        },
      }),
      (err: CoachingError) => {
        assert.equal(err.status, 400);
        assert.equal(err.code, "validation_failed");
        return true;
      },
    );
  });

  test("validator rejects malformed evidence references", async () => {
    const store = makeStore();
    const repos = createCoachingRepositories(store);
    const actionRegistry = new TypedActionRegistry(repos);
    const validator = new ResponseValidator(actionRegistry);

    const result = validator.validate({
      response: {
        answer: "Some claim",
        proposedActions: [
          {
            id: uuid(9998),
            kind: "log_food",
            title: "Log food",
            description: "log a meal",
            domainService: "nutrition.createMeal",
            parameters: { localDate: TODAY, items: [] },
            requiresConfirmation: true,
            validated: true,
            evidenceRefs: [{ source: "unknown_source", code: "made_up", title: "X", value: "1", confidence: "estimated", provenance: "inferred", generatedAt: new Date().toISOString(), relatedEntityIds: [], basis: "made up" }],
            status: "pending",
          },
        ],
        isMock: true,
      } as any,
      coachingRequest: { userId: USER_ID, message: "x", contextSources: { profile: true, goal: true, training: true, nutrition: true, activity: true, recovery: true, body: true, projection: true, decision: true, conversation: true } },
      contextSnapshot: {
        userId: USER_ID,
        asOf: TODAY,
        generatedAt: new Date().toISOString(),
        sources: [],
        quality: { overallScore: 0, sources: [], missingDataWarnings: [], staleDataWarnings: [], recommendedFollowUpQuestions: [], sufficientForAdvice: false },
      },
      decisionContext: {
        decisionSnapshot: null,
        diagnoses: [],
        activeInterventions: [],
        outcomes: [],
        shouldReevaluate: null,
        evidenceRefs: [],
        assumptions: [],
      },
      providerIsMock: true,
    });

    // The action cites evidence not present in the decision evidence -> warning.
    assert.ok(result.warnings.some((w) => w.includes("not in the current decision evidence")), "unsupported action evidence should be warned");
    // Valid otherwise (log_food with empty items fails domain validation -> invalid).
    assert.equal(result.valid, false, "action with invalid parameters should be rejected");
  });
});


describe("Action lifecycle: preview, reject, confirm, duplicate submission", () => {
  test("full action lifecycle through HTTP routes", async () => {
    const store = makeStore();
    // Full context so advice is possible; nutrition adherence present so the
    // mock proposes a log_food action.
    addRecoveryAndSleep(store);
    addBodyMeasurement(store, uuid(611), "2026-11-05T08:00:00.000Z", 80);
    for (let d = 6; d >= 0; d--) {
      const date = new Date(new Date(`${TODAY}T00:00:00.000Z`).getTime() - d * 86400000).toISOString().split("T")[0] as CalendarDate;
      addDailyNutrition(store, date, 2100, 140);
    }
    addFood(store, uuid(900), "Mock Food");

    await withCoachingServer(store, async (baseUrl) => {
      const { conversation } = await createConversation(baseUrl, USER_ID, "Actions");
      const body = await postMessage(baseUrl, USER_ID, conversation.id, {
        message: "Am I eating enough protein?",
        asOf: TODAY,
        intent: { intent: "nutrition_question", confidence: 0.8, entities: {} },
      });
      const logFoodAction = body.proposedActions.find((a) => a.kind === "log_food");
      if (!logFoodAction) console.log("SCENARIO ACTION proposedActions:", JSON.stringify(body.proposedActions));
      assert.ok(logFoodAction, "mock should propose a log_food action");
      const actionId = logFoodAction!.id;

      // Preview.
      const preview = await previewAction(baseUrl, USER_ID, conversation.id, body.messageId, actionId);
      assert.equal(preview.status, 200, "preview should succeed");
      const previewBody = (await preview.json()) as {
  preview: { validation: { valid: boolean }; requiresConfirmation: boolean };
};
      assert.ok(previewBody.preview.validation.valid, "preview validation should be valid");
      assert.equal(previewBody.preview.requiresConfirmation, true);

      // Confirm -> executes via the domain repository (meal created).
      const confirm1 = await confirmAction(baseUrl, USER_ID, conversation.id, body.messageId, actionId);
      assert.equal(confirm1.status, 200);
      assert.equal((await confirm1.json() as { status: string }).status, "executed");
      assert.ok([...store.meals.values()].length >= 1, "confirming log_food should persist a meal");

      // Duplicate submission is idempotent: no second meal.
      const mealCountBefore = [...store.meals.values()].length;
      const confirm2 = await confirmAction(baseUrl, USER_ID, conversation.id, body.messageId, actionId);
      assert.equal(confirm2.status, 200);
      assert.equal((await confirm2.json() as { status: string }).status, "executed");
      assert.equal([...store.meals.values()].length, mealCountBefore, "duplicate confirmation must not duplicate the meal");

      // Cross-user confirmation is rejected.
      const cross = await confirmAction(baseUrl, OTHER_USER_ID, conversation.id, body.messageId, actionId);
      assert.equal(cross.status, 403, "confirming another user's action must be forbidden");
    });
  });
});

  test("rejection and cross-user access are enforced", async () => {
    const store = makeStore();
    addRecoveryAndSleep(store);
    addBodyMeasurement(store, uuid(612), "2026-11-05T08:00:00.000Z", 80);
    for (let d = 6; d >= 0; d--) {
      const date = new Date(new Date(`${TODAY}T00:00:00.000Z`).getTime() - d * 86400000).toISOString().split("T")[0] as CalendarDate;
      addDailyNutrition(store, date, 2100, 140);
    }

    await withCoachingServer(store, async (baseUrl) => {
      const { conversation } = await createConversation(baseUrl, USER_ID, "Reject");
      const body = await postMessage(baseUrl, USER_ID, conversation.id, {
        message: "Am I eating enough protein?",
        asOf: TODAY,
        intent: { intent: "nutrition_question", confidence: 0.8, entities: {} },
      });
      const actionId = (body.proposedActions.find((a) => a.kind === "log_food") as ProposedAction).id;

      // Reject -> no mutation.
      const reject = await rejectAction(baseUrl, USER_ID, conversation.id, body.messageId, actionId);
      assert.equal(reject.status, 200);
      assert.equal((await reject.json() as { status: string }).status, "rejected");
      assert.equal([...store.meals.values()].length, 0, "rejection must not persist a meal");

      // Confirming a rejected action is a conflict.
      const afterReject = await confirmAction(baseUrl, USER_ID, conversation.id, body.messageId, actionId);
      assert.equal(afterReject.status, 409);

      // Cross-user message submission is rejected.
      const crossMessage = await fetch(
        `${baseUrl}/v0/users/${OTHER_USER_ID}/conversations/${conversation.id}/messages`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "hi" }) },
      );
      assert.equal(crossMessage.status, 403, "cross-user message submission must be forbidden");

      // Cross-user message retrieval is rejected.
      const crossGet = await getMessage(baseUrl, OTHER_USER_ID, body.messageId as MessageId);
      assert.equal(crossGet.status, 403, "cross-user message retrieval must be forbidden");
    });
  });
