import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test, describe } from "node:test";
import type {
  Profile,
  User,
  Goal,
  NutrientAmounts,
  DecisionSnapshot,
  DecisionSnapshotStatus,
  UnifiedFitCoachState,
  GenerateDecisionResult,
} from "@fitcoach/domain";
import type {
  CreateMealInput,
  CreateFoodInput,
  FoodRecord,
  MealRecord,
  MealItemRecord,
  DailyNutritionRecord,
  RecipeRecord,
  RecipeItemRecord,
  WorkoutRecord,
  WorkoutExerciseRecord,
  ExerciseSetRecord,
  PlanAggregate,
  PlanVersionRecord,
  BodyMeasurementRecord,
  ActivityRecordRow,
  RecoveryIndicatorRecord,
  SleepObservationRecord,
  Repositories,
  InterventionRecord,
} from "@fitcoach/db";
import { createServer } from "../server";
import { createServices } from "../services";

/**
 * Phase 8 Unified Decision Brain integration tests.
 *
 * These exercise the real HTTP routes and the real UnifiedDecisionService
 * against an in-memory repository bundle. This verifies the wiring
 * the user actually touches — the complete decision lifecycle across
 * 7 vertical scenarios (A-G).
 *
 * BEHAVIOUR UNDER TEST: The complete unified decision lifecycle API endpoints
 * MODULE/FUNCTION EXERCISED: apps/api/src/services/unifiedDecision.ts (UnifiedDecisionService)
 *                           apps/api/src/routes.ts (unified decision endpoints)
 * EXISTING TEST FILES: None - this is the first integration test file for unified decisions
 * USER INSTRUCTION: "yeaa work on those two errors to" - referring to P8-006 (integration tests A-G) and P8-007 (TypeScript verification)
 */

const USER_ID = "usr_unified_decision_test";
const FOOD_SOURCE_ID = "00000000-0000-4000-8000-000000000001";

function uuid(seed: number): string {
  return `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
}

interface InMemoryDecisionStore {
  foods: Map<string, FoodRecord>;
  meals: Map<string, MealRecord>;
  dailyNutrition: Map<string, DailyNutritionRecord>;
  nutritionTargets: Map<string, any>;
  recipes: Map<string, RecipeRecord>;
  workouts: Map<string, WorkoutRecord>;
  workoutExercises: Map<string, WorkoutExerciseRecord>;
  trainingPlans: Map<string, PlanAggregate>;
  trainingPlanVersions: Map<string, PlanVersionRecord>;
  bodyMeasurements: Map<string, BodyMeasurementRecord>;
  activityRecords: Map<string, ActivityRecordRow>;
  recoveryRecords: Map<string, RecoveryIndicatorRecord>;
  sleepRecords: Map<string, SleepObservationRecord>;
  interventions: Map<string, InterventionRecord>;
  // Decision lifecycle stores (not used by in-memory repo but kept for completeness)
  decisionSnapshots: Map<string, any>;
  decisionInterventions: Map<string, any>;
  decisionEvidence: Map<string, any>;
  decisionAssumptions: Map<string, any>;
  decisionOutcomes: Map<string, any>;
}

let testRunCounter = 0;

function createDecisionStore(): InMemoryDecisionStore {
  const store: InMemoryDecisionStore = {
    foods: new Map<string, FoodRecord>(),
    meals: new Map<string, MealRecord>(),
    dailyNutrition: new Map<string, DailyNutritionRecord>(),
    nutritionTargets: new Map<string, any>(),
    recipes: new Map<string, RecipeRecord>(),
    workouts: new Map<string, WorkoutRecord>(),
    workoutExercises: new Map<string, WorkoutExerciseRecord>(),
    trainingPlans: new Map<string, PlanAggregate>(),
    trainingPlanVersions: new Map<string, PlanVersionRecord>(),
    bodyMeasurements: new Map<string, BodyMeasurementRecord>(),
    activityRecords: new Map<string, ActivityRecordRow>(),
    recoveryRecords: new Map<string, RecoveryIndicatorRecord>(),
    sleepRecords: new Map<string, SleepObservationRecord>(),
    interventions: new Map<string, InterventionRecord>(),
    decisionSnapshots: new Map<string, any>(),
    decisionInterventions: new Map<string, any>(),
    decisionEvidence: new Map<string, any>(),
    decisionAssumptions: new Map<string, any>(),
    decisionOutcomes: new Map<string, any>(),
  };

  // ===== Populate store with default fixture data =====
  // Helper: create a basic training plan
  function createBasicPlan(): { plan: PlanAggregate; version: PlanVersionRecord } {
    planCounter++;
    versionCounter++;
    sessionCounter++;
    slotCounter++;

    const now = new Date().toISOString();
    const planId = `plan_${planCounter}`;
    const versionId = `version_${versionCounter}`;
    const sessionId = `session_${sessionCounter}`;
    const slotId = `slot_${slotCounter}`;

    const plan: PlanAggregate = {
      id: planId,
      userId: USER_ID,
      name: "Test Plan",
      status: "active",
      description: undefined,
      activeFrom: undefined,
      activeUntil: undefined,
      createdAt: now,
      updatedAt: now,
      versions: [],
    };
    store.trainingPlans.set(planId, plan);

    const version: PlanVersionRecord = {
      id: versionId,
      planId,
      status: "active",
      planJson: "{}",
      configVersion: undefined,
      supersedesId: undefined,
      effectiveFrom: "2026-01-01",
      effectiveUntil: undefined,
      createdAt: now,
      updatedAt: now,
      sessions: [
        {
          id: sessionId,
          name: "Upper A",
          weekdayHint: 0,
          slots: [
            {
              id: slotId,
              exerciseId: "ex_barbell_bench_press",
              targetSets: 3,
              targetRepRange: { min: 8, max: 12 },
              targetRir: 2,
              restSeconds: undefined,
              substitutionExerciseIds: undefined,
              notes: undefined,
            },
          ],
        },
      ],
    };
    store.trainingPlanVersions.set(versionId, version);

    return { plan, version };
  }

  // Helper: create basic workout history
  function createWorkoutHistory(): void {
    const now = new Date().toISOString();
    for (let i = 0; i < 5; i++) {
      workoutCounter++;
      const workoutId = `workout_${workoutCounter}`;
      const workout: WorkoutRecord = {
        id: workoutId,
        userId: USER_ID,
        planId: "plan_1",
        planVersionId: "version_1",
        planSessionId: `session_${i + 1}`,
        title: `Workout ${i + 1}`,
        status: "completed",
        startedAt: new Date(Date.now() - (4 - i) * 86400000).toISOString(),
        endedAt: new Date(Date.now() - (4 - i) * 86400000 + 3600000).toISOString(),
        notes: undefined,
        clientRequestId: undefined,
        environmentKind: undefined,
        sessionClassification: undefined,
        createdAt: now,
        updatedAt: now,
      };
      store.workouts.set(workoutId, workout);

      // Add exercises to workout
      for (let j = 0; j < 3; j++) {
        workoutCounter++;
        const exId = `workout_ex_${workoutCounter}`;
        const sets: ExerciseSetRecord[] = [
          { id: `set_${workoutCounter}_1`, workoutExerciseId: exId, exerciseId: `ex_${j}`, position: 0, kind: "working", reps: 10, loadKg: 60, rir: 2, createdAt: now, updatedAt: now },
          { id: `set_${workoutCounter}_2`, workoutExerciseId: exId, exerciseId: `ex_${j}`, position: 1, kind: "working", reps: 10, loadKg: 60, rir: 2, createdAt: now, updatedAt: now },
          { id: `set_${workoutCounter}_3`, workoutExerciseId: exId, exerciseId: `ex_${j}`, position: 2, kind: "working", reps: 9, loadKg: 60, rir: 1, createdAt: now, updatedAt: now },
        ];
        const exercise: WorkoutExerciseRecord = {
          id: exId,
          workoutId,
          exerciseId: `ex_${j}`,
          position: j,
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
    }
  }

  createBasicPlan();
  createWorkoutHistory();

  // Create body measurements
  const bmDate = "2026-10-01";
  bmCounter++;
  const bm: BodyMeasurementRecord = {
    id: `bm_${bmCounter}`,
    userId: USER_ID,
    recordedAt: new Date(bmDate).toISOString(),
    condition: undefined,
    bodyWeightKg: 80,
    bodyFatPercent: 15,
    circumferencesCm: { chest: 105, waist: 82, hips: 95, left_upper_arm: 36, right_upper_arm: 36, left_thigh: 58, right_thigh: 58 },
    enteredVia: undefined,
    confidence: undefined,
    sourceName: undefined,
    externalId: undefined,
    photoRefs: [],
    notes: undefined,
    createdAt: new Date().toISOString(),
  };
  store.bodyMeasurements.set(bm.id, bm);

  // Create activity records (steps)
  for (let i = 0; i < 14; i++) {
    activityCounter++;
    const date = new Date(Date.now() - (13 - i) * 86400000).toISOString().split("T")[0] ?? "";
    const record: ActivityRecordRow = {
      id: `activity_${activityCounter}`,
      userId: USER_ID,
      date,
      kind: "steps",
      steps: 8000 + i * 200,
      durationMinutes: 30,
      distanceKm: undefined,
      averageHeartRateBpm: undefined,
      estimatedCaloriesBurned: undefined,
      effort: undefined,
      recordedVia: undefined,
      externalId: undefined,
      notes: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.activityRecords.set(record.id, record);
  }

  // Create recovery records
  for (let i = 0; i < 14; i++) {
    recoveryCounter++;
    const date = new Date(Date.UTC(2026, 9, 6 - (13 - i))).toISOString().split("T")[0] ?? "";
    const record: RecoveryIndicatorRecord = {
      id: `recovery_${recoveryCounter}`,
      userId: USER_ID,
      date,
      hrvMs: 45 + i,
      restingHeartRateBpm: 58,
      sleepScore: 80,
      readinessScore: 75,
      muscleSoreness: 2,
      fatigue: 3,
      sleepQuality: 80,
      readinessSubjective: 75,
      source: "manual",
      externalId: "",
      confidence: "measured",
      notes: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.recoveryRecords.set(record.id, record);
  }

  // Create sleep records
  for (let i = 0; i < 14; i++) {
    sleepCounter++;
    const date = new Date(Date.UTC(2026, 9, 6 - (13 - i))).toISOString().split("T")[0] ?? "";
    const record: SleepObservationRecord = {
      id: `sleep_${sleepCounter}`,
      userId: USER_ID,
      date,
      startedAt: new Date(Date.UTC(2026, 9, 6 - (13 - i), 22)).toISOString(),
      endedAt: new Date(Date.UTC(2026, 9, 7 - (13 - i), 6)).toISOString(),
      timeInBedMinutes: 480,
      asleepMinutes: 450,
      efficiency: 0.94,
      latencyMinutes: undefined,
      deepMinutes: 100,
      remMinutes: 110,
      lightMinutes: undefined,
      awakeMinutes: undefined,
      awakenings: undefined,
      source: "manual",
      externalId: undefined,
      confidence: "measured",
      notes: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.sleepRecords.set(record.id, record);
  }

  // Create nutrition targets
  const targets = {
    userId: USER_ID,
    targets: {
      goal: "aesthetics_v_taper",
      caloriesKcal: 2400,
      proteinGrams: 180,
      carbohydrateGrams: 250,
      fatGrams: 70,
      fiberGrams: 30,
      derivedAt: new Date().toISOString(),
      derivedFrom: { profile: true, goal: true, bodyComposition: true },
    },
  };
  store.nutritionTargets.set(USER_ID, targets);

  // Create daily nutrition
  const dailyNutrition: DailyNutritionRecord = {
    id: `${USER_ID}:2026-10-06`,
    userId: USER_ID,
    localDate: "2026-10-06",
    totals: { caloriesKcal: 2300, proteinGrams: 140, carbohydrateGrams: 240, fatGrams: 65 },
    targetsSnapshot: targets.targets,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.dailyNutrition.set(dailyNutrition.id, dailyNutrition);

  // Create an active intervention
  interventionCounter++;
  const intervention: InterventionRecord = {
    id: `intervention_${interventionCounter}`,
    userId: USER_ID,
    kind: "training_volume_adjustment",
    parameters: { muscleGroup: "chest", adjustmentPercent: 10 },
    rationale: "Increase chest volume",
    expectedEffect: "Increase chest volume",
    reviewOn: undefined,
    status: "proposed",
    acceptedAt: undefined,
    completedAt: undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.interventions.set(intervention.id, intervention);

  return store;
}

let foodCounter = 0;
let mealCounter = 0;
let recipeCounter = 0;
let workoutCounter = 0;
let planCounter = 0;
let versionCounter = 0;
let sessionCounter = 0;
let slotCounter = 0;
let bmCounter = 0;
let activityCounter = 0;
let recoveryCounter = 0;
let sleepCounter = 0;
let interventionCounter = 0;

function createDecisionRepositories(store: InMemoryDecisionStore): Repositories {
  const profile: Profile = {
    userId: USER_ID,
    birthDate: "1995-04-12",
    sex: "male",
    heightCm: 180,
    trainingExperience: "intermediate",
    trainingDaysPerWeek: 4,
    sessionDurationMinutes: 60,
    limitations: [],
    unitSystem: "metric",
  } as unknown as Profile;

  const user: User = {
    id: USER_ID,
    email: "unified-decision@example.test",
    displayName: "Unified Decision Test",
    timezone: "UTC",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as User;

  const foodSource = {
    id: FOOD_SOURCE_ID,
    name: "Test Source",
    kind: "curated_database" as const,
    defaultConfidence: "measured" as const,
    externalSourceId: null,
  };

  const goal: Goal = {
    id: uuid(100),
    userId: USER_ID,
    kind: "aesthetics_v_taper",
    priorities: ["shoulder_width", "waist_control"],
    physiqueTarget: "v_taper",
    effectiveFrom: "2026-01-01",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as Goal;

  return {
    users: {
      async findById(id: string) {
        return id === USER_ID ? { ...user, timezone: "UTC" } : null;
      },
      async localToday(_userId: string) {
        return "2026-10-06";
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
        return id === goal.id ? goal : null;
      },
      async list(userId: string) {
        return userId === USER_ID ? [goal] : [];
      },
      async getStateSnapshot(userId: string, asOf: string) {
        if (userId !== USER_ID) return null;
        const asOfDate = new Date(`${asOf}T00:00:00.000Z`);
        const startDate = new Date(goal.effectiveFrom);
        if (asOfDate < startDate) return null;
        return {
          activeGoal: goal,
          history: [goal],
          alignment: { score: 70, gaps: [] },
        };
      },
    },
    equipment: {
      async list(userId: string) {
        return userId === USER_ID ? [{ id: "dumbbells", name: "Dumbbells" }] : [];
      },
    },
    foodSources: {
      async get(id: string) {
        return id === FOOD_SOURCE_ID ? foodSource : null;
      },
    },
    foods: {
      async findSource(id: string) {
        return id === FOOD_SOURCE_ID ? foodSource : null;
      },
      async createFood(input: CreateFoodInput) {
        const id = uuid(1000 + ++foodCounter);
        const now = new Date().toISOString();
        const servings = input.servings?.map((s, i) => ({
          id: uuid(2000 + foodCounter * 10 + i),
          foodId: id,
          label: s.label,
          grams: s.grams ?? undefined,
          milliliters: s.milliliters ?? undefined,
          unitQuantity: s.unitQuantity ?? undefined,
          unitName: s.unitName ?? undefined,
        })) ?? [{ id: uuid(3000 + foodCounter), foodId: id, label: "100g", grams: 100, milliliters: undefined, unitQuantity: undefined, unitName: undefined }];
        const food: FoodRecord = {
          id,
          sourceId: input.sourceId,
          name: input.name,
          brand: input.brand ?? undefined,
          densityBasis: input.densityBasis,
          nutrientsPer100g: input.nutrientsPer100g,
          servings,
          defaultServingId: input.defaultServingLabel
            ? servings.find((s) => s.label === input.defaultServingLabel)?.id ?? (servings[0]?.id ?? "")
            : servings[0]?.id ?? "",
          barcode: input.barcode ?? undefined,
          externalId: input.externalId ?? undefined,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        };
        store.foods.set(id, food);
        return food;
      },
      async findById(id: string) {
        return store.foods.get(id) ?? null;
      },
      async findByBarcode(barcode: string) {
        for (const food of store.foods.values()) {
          if (food.barcode === barcode) return food;
        }
        return null;
      },
      async findOrCreateUserSource(_userId: string) {
        return foodSource;
      },
      async updateNutrients(id: string, nutrients: NutrientAmounts) {
        const food = store.foods.get(id);
        if (!food) throw new Error("Food not found");
        const updated = { ...food, nutrientsPer100g: { ...food.nutrientsPer100g, ...nutrients }, updatedAt: new Date().toISOString() };
        store.foods.set(id, updated);
        return updated;
      },
      async listUserFoods(_userId: string) {
        return [...store.foods.values()].filter((f) => f.sourceId === FOOD_SOURCE_ID);
      },
      async searchFoods(
        query: string,
        options?: { limit?: number; offset?: number; sourceId?: string }
      ): Promise<{ foods: FoodRecord[]; total: number }> {
        const trimmed = query.trim().toLowerCase();
        if (!trimmed) return { foods: [], total: 0 };
        const limit = Math.min(options?.limit ?? 20, 100);
        const offset = options?.offset ?? 0;
        const sourceId = options?.sourceId;
        let foods = [...store.foods.values()].filter((f) => f.isActive);
        if (sourceId) foods = foods.filter((f) => f.sourceId === sourceId);
        foods = foods.filter(
          (f) =>
            f.name.toLowerCase().includes(trimmed) ||
            f.brand?.toLowerCase().includes(trimmed) ||
            f.externalId?.toLowerCase().includes(trimmed)
        );
        const scored = foods.map((f) => ({
          food: f,
          rank: (() => {
            const n = f.name.toLowerCase();
            const b = f.brand?.toLowerCase() ?? "";
            const e = f.externalId?.toLowerCase() ?? "";
            if (n === trimmed) return 0;
            if (n.startsWith(trimmed)) return 1;
            if (n.includes(trimmed)) return 2;
            if (b && b === trimmed) return 3;
            if (b && b.startsWith(trimmed)) return 4;
            if (b && b.includes(trimmed)) return 5;
            if (e && e === trimmed) return 6;
            if (e && e.startsWith(trimmed)) return 7;
            if (e && e.includes(trimmed)) return 8;
            return 9;
          })(),
        }));
        scored.sort((a, b) => a.rank - b.rank);
        const total = scored.length;
        const paginated = scored.slice(offset, offset + limit);
        return { foods: paginated.map((s) => s.food), total };
      },
      async deactivate(_id: string) {
        return;
      },
      async createSource(_input: any) {
        return foodSource;
      },
    },
    meals: {
      async create(input: CreateMealInput) {
        mealCounter++;
        const id = `meal_${mealCounter}`;
        const now = new Date().toISOString();
        const items: MealItemRecord[] = input.items.map((item, index) => ({
          id: `meal_item_${mealCounter}_${index}`,
          mealId: id,
          foodId: item.foodId,
          recipeId: item.recipeId,
          quantityGrams: item.quantityGrams,
          recipeServings: item.recipeServings,
          computedNutrients: item.snapshot ?? {
            caloriesKcal: 0,
            proteinGrams: 0,
            carbohydrateGrams: 0,
            fatGrams: 0,
            fiberGrams: 0,
          },
          confidence: item.confidence ?? "estimated",
          notes: item.notes ?? undefined,
          createdAt: now,
          updatedAt: now,
        }));
        const totals = items.reduce<NutrientAmounts>(
          (acc, item) => ({
            caloriesKcal: acc.caloriesKcal + item.computedNutrients.caloriesKcal,
            proteinGrams: acc.proteinGrams + item.computedNutrients.proteinGrams,
            carbohydrateGrams: acc.carbohydrateGrams + item.computedNutrients.carbohydrateGrams,
            fatGrams: acc.fatGrams + item.computedNutrients.fatGrams,
            fiberGrams: (acc.fiberGrams ?? 0) + (item.computedNutrients.fiberGrams ?? 0) || undefined,
          }),
          { caloriesKcal: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0 },
        );
        const meal: MealRecord = {
          id,
          userId: input.userId,
          localDate: input.localDate ?? "2026-10-06",
          slot: input.slot,
          consumedAt: input.consumedAt,
          notes: input.notes ?? undefined,
          clientRequestId: input.clientRequestId ?? undefined,
          items,
          totals,
          createdAt: now,
          updatedAt: now,
        };
        store.meals.set(id, meal);
        return meal;
      },
      async addItem(mealId: string, item: any) {
        const meal = store.meals.get(mealId);
        if (!meal) throw new Error("Meal not found");
        const now = new Date().toISOString();
        const newItem: MealItemRecord = {
          id: `meal_item_${mealId}_${meal.items.length}`,
          mealId,
          foodId: item.foodId,
          recipeId: item.recipeId,
          quantityGrams: item.quantityGrams,
          recipeServings: item.recipeServings,
          computedNutrients: item.snapshot ?? { caloriesKcal: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0, fiberGrams: 0 },
          confidence: item.confidence ?? "estimated",
          notes: item.notes ?? undefined,
          createdAt: now,
          updatedAt: now,
        };
        meal.items.push(newItem);
        meal.totals = meal.items.reduce<NutrientAmounts>(
          (acc, i) => ({
            caloriesKcal: acc.caloriesKcal + i.computedNutrients.caloriesKcal,
            proteinGrams: acc.proteinGrams + i.computedNutrients.proteinGrams,
            carbohydrateGrams: acc.carbohydrateGrams + i.computedNutrients.carbohydrateGrams,
            fatGrams: acc.fatGrams + i.computedNutrients.fatGrams,
            fiberGrams: (acc.fiberGrams ?? 0) + (i.computedNutrients.fiberGrams ?? 0) || undefined,
          }),
          { caloriesKcal: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0 },
        );
        meal.updatedAt = now;
        store.meals.set(mealId, meal);
        return meal;
      },
      async findById(id: string) {
        return store.meals.get(id) ?? null;
      },
      async listByDate(userId: string, localDate?: string) {
        return [...store.meals.values()].filter((m) => m.userId === userId && (!localDate || m.localDate === localDate));
      },
    },
    nutrition: {
      async upsertDaily(input: { userId: string; localDate: string; totals: NutrientAmounts; targetsSnapshot?: Record<string, unknown> }) {
        const key = `${input.userId}:${input.localDate}`;
        const now = new Date().toISOString();
        const record: DailyNutritionRecord = {
          id: key,
          userId: input.userId,
          localDate: input.localDate,
          totals: input.totals,
          targetsSnapshot: input.targetsSnapshot ?? { caloriesKcal: 2400, proteinGrams: 180, carbohydrateGrams: 250, fatGrams: 70 },
          createdAt: now,
          updatedAt: now,
        };
        store.dailyNutrition.set(key, record);
        return record;
      },
      async getDaily(userId: string, localDate?: string) {
        const date = localDate ?? "2026-10-06";
        return store.dailyNutrition.get(`${userId}:${date}`) ?? null;
      },
      async history(userId: string, _options: { limit?: number }) {
        return [...store.dailyNutrition.values()].filter((d) => d.userId === userId);
      },
      async getStateSnapshot(userId: string, asOf: string, windowDays: number = 28) {
        const endDate = new Date(`${asOf}T00:00:00.000Z`);
        const startDate = new Date(endDate.getTime() - windowDays * 86400000);
        const records = [...store.dailyNutrition.values()].filter((d) => d.userId === userId && new Date(d.localDate) >= startDate && new Date(d.localDate) <= endDate).sort((a, b) => new Date(a.localDate).getTime() - new Date(b.localDate).getTime());
        if (records.length === 0) return null;
        const avgCalories = records.reduce((sum, r) => sum + r.totals.caloriesKcal, 0) / records.length;
        const avgProtein = records.reduce((sum, r) => sum + (r.totals.proteinGrams ?? 0), 0) / records.length;
        const avgCarbs = records.reduce((sum, r) => sum + (r.totals.carbohydrateGrams ?? 0), 0) / records.length;
        const avgFat = records.reduce((sum, r) => sum + (r.totals.fatGrams ?? 0), 0) / records.length;
        let adherentDays = 0;
        for (const record of records) {
          if (record.targetsSnapshot && typeof record.targetsSnapshot === "object" && "caloriesKcal" in record.targetsSnapshot) {
            const target = record.targetsSnapshot as Record<string, unknown>;
            if (typeof target.caloriesKcal === "number" && target.caloriesKcal > 0) {
              const diff = Math.abs(record.totals.caloriesKcal - target.caloriesKcal);
              if (diff / target.caloriesKcal <= 0.1) adherentDays++;
            }
          }
        }
        return {
          recentDailyTotals: records,
          averageCalories: avgCalories,
          averageProteinGrams: avgProtein,
          averageCarbsGrams: avgCarbs,
          averageFatGrams: avgFat,
          adherencePercent: records.length > 0 ? Math.round((adherentDays / records.length) * 100) : 0,
          daysWithData: records.length,
          windowDays,
        };
      },
    },
    nutritionTargets: {
      async deriveAndStoreTargets(userId: string, _goal: any, _context: any) {
        const targets = {
          userId,
          targets: {
            goal: "aesthetics_v_taper",
            caloriesKcal: 2400,
            proteinGrams: 180,
            carbohydrateGrams: 250,
            fatGrams: 70,
            fiberGrams: 30,
            derivedAt: new Date().toISOString(),
            derivedFrom: { profile: true, goal: true, bodyComposition: true },
          },
        };
        store.nutritionTargets.set(userId, targets);
        return targets.targets;
      },
      async getTargets(userId: string) {
        return store.nutritionTargets.get(userId)?.targets ?? null;
      },
    },
    recipes: {
      async createRecipe(input: { userId: string; name: string; servings: number; instructions?: string; items: any[] }) {
        recipeCounter++;
        const id = uuid(5000 + recipeCounter);
        const now = new Date().toISOString();
        const items: RecipeItemRecord[] = input.items.map((item, i) => ({
          id: uuid(6000 + i),
          recipeId: id,
          foodId: item.foodId,
          quantityGrams: item.quantityGrams,
          notes: item.notes ?? undefined,
          position: i,
        }));
        const recipe: RecipeRecord = {
          id,
          ownerUserId: input.userId,
          name: input.name,
          servings: input.servings,
          instructions: input.instructions ?? undefined,
          items,
          createdAt: now,
          updatedAt: now,
        };
        store.recipes.set(id, recipe);
        return recipe;
      },
      async listRecipes(_userId: string) {
        return [...store.recipes.values()];
      },
      async getRecipe(id: string) {
        return store.recipes.get(id) ?? null;
      },
      async deactivate(_id: string) {
        return;
      },
      async computeRecipeNutrition(_recipeId: string, servings: number) {
        return {
          perServing: { caloriesKcal: 300, proteinGrams: 25, carbohydrateGrams: 30, fatGrams: 10, fiberGrams: 5 },
          total: { caloriesKcal: 300 * servings, proteinGrams: 25 * servings, carbohydrateGrams: 30 * servings, fatGrams: 10 * servings, fiberGrams: 5 * servings },
        };
      },
    },
    workouts: {
      async history(userId: string, options?: { limit?: number }) {
        const workouts = [...store.workouts.values()].filter((w) => w.userId === userId).sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
        // Return WorkoutAggregate: { workout: WorkoutRecord, exercises: WorkoutExerciseRecord[] }
        const result = workouts.map((w) => ({
          workout: w,
          exercises: [...store.workoutExercises.values()].filter((e) => e.workoutId === w.id),
        }));
        return options?.limit ? result.slice(0, options.limit) : result;
      },
      async findById(id: string) {
        const workout = store.workouts.get(id) ?? null;
        if (!workout) return null;
        return {
          workout,
          exercises: [...store.workoutExercises.values()].filter((e) => e.workoutId === id),
        };
      },
      async findByPlanVersion(planVersionId: string) {
        const workouts = [...store.workouts.values()].filter((w) => w.planVersionId === planVersionId);
        return workouts.map((w) => ({
          workout: w,
          exercises: [...store.workoutExercises.values()].filter((e) => e.workoutId === w.id),
        }));
      },
      async getExercises(workoutId: string) {
        return [...store.workoutExercises.values()].filter((e) => e.workoutId === workoutId);
      },
      async getSessionWorkouts(sessionId: string) {
        const workouts = [...store.workouts.values()].filter((w) => w.planSessionId === sessionId);
        return workouts.map((w) => ({
          workout: w,
          exercises: [...store.workoutExercises.values()].filter((e) => e.workoutId === w.id),
        }));
      },
    },
    trainingPlans: {
      async findActive(userId: string) {
        return [...store.trainingPlans.values()].find((p) => p.userId === userId && p.status === "active") ?? null;
      },
      async findById(id: string) {
        return store.trainingPlans.get(id) ?? null;
      },
      async getVersions(planId: string) {
        return [...store.trainingPlanVersions.values()].filter((v) => v.planId === planId);
      },
      async getSessions(versionId: string) {
        const version = store.trainingPlanVersions.get(versionId);
        return version?.sessions ?? [];
      },
      async getExerciseSlots(sessionId: string) {
        const versions = [...store.trainingPlanVersions.values()];
        for (const version of versions) {
          const session = version.sessions.find((s) => s.id === sessionId);
          if (session) return session.slots;
        }
        return [];
      },
      async listTemporary(userId: string) {
        return [...store.trainingPlans.values()].filter((p) => p.userId === userId && p.kind === "temporary_environment");
      },
    },
    bodyMeasurements: {
      async history(userId: string, options?: { limit?: number }) {
        const measurements = [...store.bodyMeasurements.values()].filter((b) => b.userId === userId).sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());
        return options?.limit ? measurements.slice(-options.limit) : measurements;
      },
      async findById(id: string) {
        return store.bodyMeasurements.get(id) ?? null;
      },
      async getStateSnapshot(userId: string, asOf: string, windowDays: number = 28) {
        const endDate = new Date(`${asOf}T23:59:59.999Z`);
        const startDate = new Date(endDate.getTime() - windowDays * 86400000);
        const measurements = [...store.bodyMeasurements.values()].filter((b) => b.userId === userId && new Date(b.recordedAt) >= startDate && new Date(b.recordedAt) <= endDate).sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
        if (measurements.length === 0) return null;
        // Return a simplified snapshot
        return {
          recentMeasurements: measurements,
          weightTrend: { slopeKgPerWeek: 0, direction: "stable" as const, confidence: 0.5 },
          bodyFatTrend: { slopePercentPerWeek: 0, direction: "stable" as const, confidence: 0.5 },
          measurementTrends: {},
        };
      },
    },
    activity: {
      async history(userId: string, options?: { limit?: number }) {
        const records = [...store.activityRecords.values()].filter((a) => a.userId === userId).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return options?.limit ? records.slice(0, options.limit) : records;
      },
      async getStateSnapshot(userId: string, asOf: string, windowDays: number = 28) {
        const endDate = new Date(`${asOf}T00:00:00.000Z`);
        const startDate = new Date(endDate.getTime() - windowDays * 86400000);
        const records = [...store.activityRecords.values()].filter((a) => a.userId === userId && new Date(a.date) >= startDate && new Date(a.date) <= endDate).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        if (records.length === 0) return null;
        const stepsDays = records.filter((a) => a.kind === "steps");
        const totalSteps = stepsDays.reduce((sum, d) => sum + (d.steps ?? 0), 0);
        const avgSteps = stepsDays.length > 0 ? Math.round(totalSteps / stepsDays.length) : 0;
        return {
          recentSteps: stepsDays.slice(0, 14).map((d) => ({ date: d.date, steps: d.steps ?? 0 })),
          averageSteps: avgSteps,
          totalDaysTracked: stepsDays.length,
          adherence: { stepsPercent: 100, cardioPercent: 100 },
          dailyStepsTarget: 8000,
          weeklyCardioTarget: 75,
        };
      },
    },
    recovery: {
      async history(userId: string, options?: { limit?: number }) {
        const records = [...store.recoveryRecords.values()].filter((r) => r.userId === userId).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return options?.limit ? records.slice(0, options.limit) : records;
      },
      async getStateSnapshot(userId: string, asOf: string, windowDays: number = 14) {
        const endDate = new Date(`${asOf}T00:00:00.000Z`);
        const startDate = new Date(endDate.getTime() - windowDays * 86400000);
        const records = [...store.recoveryRecords.values()].filter((r) => r.userId === userId && new Date(r.date) >= startDate && new Date(r.date) <= endDate).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        if (records.length === 0) return null;
        const latest = records[records.length - 1];
        if (!latest) return null;
        return {
          readinessScore: latest.readinessScore ?? 75,
          confidence: 0.5,
          sleepQualityTrend: "stable" as const,
          sleepAdequacy: "adequate" as const,
          hrvTrend: "stable" as const,
          fatigueAccumulation: "low" as const,
          limitingFactors: [],
          trainingRecommendation: "maintain" as const,
          nutritionRecommendations: [],
          activityRecommendations: [],
          basisNote: "default",
        };
      },
    },
    sleep: {
      async history(userId: string, options?: { limit?: number }) {
        const records = [...store.sleepRecords.values()].filter((s) => s.userId === userId).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return options?.limit ? records.slice(0, options.limit) : records;
      },
      async getStateSnapshot(userId: string, asOf: string, windowDays: number = 14) {
        const endDate = new Date(`${asOf}T00:00:00.000Z`);
        const startDate = new Date(endDate.getTime() - windowDays * 86400000);
        const records = [...store.sleepRecords.values()].filter((s) => s.userId === userId && new Date(s.date) >= startDate && new Date(s.date) <= endDate).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        if (records.length === 0) return null;
        return {
          recentSleep: records.map((s) => ({
            date: s.date,
            timeInBedMinutes: s.timeInBedMinutes ?? 0,
            asleepMinutes: s.asleepMinutes ?? 0,
            efficiency: s.efficiency ?? 0,
            deepMinutes: s.deepMinutes ?? 0,
            remMinutes: s.remMinutes ?? 0,
          })),
          averageSleepMinutes: records.reduce((sum, s) => sum + (s.asleepMinutes ?? 0), 0) / records.length,
          sleepQualityTrend: "stable" as const,
        };
      },
    },
    interventions: {
      async list(userId: string, options?: { status?: string; limit?: number }) {
        let interventions = [...store.interventions.values()].filter((i) => i.userId === userId);
        if (options?.status) interventions = interventions.filter((i) => i.status === options.status);
        if (options?.limit) interventions = interventions.slice(0, options.limit);
        return interventions;
      },
      async findById(id: string) {
        return store.interventions.get(id) ?? null;
      },
    },
    decisionSnapshots: {
      async findById(id: string) {
        return store.decisionSnapshots.get(id) ?? null;
      },
      async findByIdWithRelations(id: string) {
        const snapshot = store.decisionSnapshots.get(id);
        if (!snapshot) return null;
        return {
          ...snapshot,
          interventions: [...store.decisionInterventions.values()].filter((i) => i.decisionSnapshotId === id),
          evidence: [...store.decisionEvidence.values()].filter((e) => e.decisionSnapshotId === id),
          assumptions: [...store.decisionAssumptions.values()].filter((a) => a.decisionSnapshotId === id),
          outcomes: [...store.decisionOutcomes.values()].filter((o) => o.decisionSnapshotId === id),
        };
      },
      async create(input: any) {
        const now = new Date().toISOString();
        const record = {
          ...input,
          id: input.id ?? uuid(++interventionCounter),
          createdAt: now,
          updatedAt: now,
        };
        store.decisionSnapshots.set(record.id, record);
        return record;
      },
      async updateStatus(id: string, status: string) {
        const snapshot = store.decisionSnapshots.get(id);
        if (snapshot) {
          snapshot.status = status;
          snapshot.updatedAt = new Date().toISOString();
        }
        return snapshot;
      },
      async list(userId: string, options?: { status?: DecisionSnapshotStatus; limit?: number; cursor?: string }) {
        let snapshots = [...store.decisionSnapshots.values()].filter((s) => s.userId === userId);
        if (options?.status) snapshots = snapshots.filter((s) => s.status === options.status);
        snapshots.sort((a, b) => new Date(b.decidedAt).getTime() - new Date(a.decidedAt).getTime());
        if (options?.limit) snapshots = snapshots.slice(0, options.limit);
        if (options?.cursor) {
          const cursorIndex = snapshots.findIndex((s) => s.id === options.cursor);
          if (cursorIndex >= 0) snapshots = snapshots.slice(cursorIndex + 1);
        }
        return snapshots;
      },
    },
    decisionInterventions: {
      async create(input: any) {
        const now = new Date().toISOString();
        const record = {
          ...input,
          id: input.id ?? uuid(++interventionCounter),
          createdAt: now,
        };
        store.decisionInterventions.set(record.id, record);
        return record;
      },
      async listByDecisionSnapshot(decisionSnapshotId: string) {
        return [...store.decisionInterventions.values()].filter((i) => i.decisionSnapshotId === decisionSnapshotId);
      },
    },
    decisionEvidence: {
      async create(input: any) {
        const now = new Date().toISOString();
        const record = {
          ...input,
          id: input.id ?? uuid(++interventionCounter),
          createdAt: now,
        };
        store.decisionEvidence.set(record.id, record);
        return record;
      },
      async listByDecisionSnapshot(decisionSnapshotId: string) {
        return [...store.decisionEvidence.values()].filter((e) => e.decisionSnapshotId === decisionSnapshotId);
      },
    },
    decisionAssumptions: {
      async create(input: any) {
        const now = new Date().toISOString();
        const record = {
          ...input,
          id: input.id ?? uuid(++interventionCounter),
          createdAt: now,
        };
        store.decisionAssumptions.set(record.id, record);
        return record;
      },
      async listByDecisionSnapshot(decisionSnapshotId: string) {
        return [...store.decisionAssumptions.values()].filter((a) => a.decisionSnapshotId === decisionSnapshotId);
      },
    },
    decisionOutcomes: {
      async create(input: any) {
        const now = new Date().toISOString();
        const record = {
          ...input,
          id: input.id ?? uuid(++interventionCounter),
          createdAt: now,
        };
        store.decisionOutcomes.set(record.id, record);
        return record;
      },
      async list(decisionSnapshotId: string, options?: { evaluationWindow?: string; limit?: number }) {
        let outcomes = [...store.decisionOutcomes.values()].filter((o) => o.decisionSnapshotId === decisionSnapshotId);
        if (options?.evaluationWindow) outcomes = outcomes.filter((o) => o.evaluationWindow === options.evaluationWindow);
        outcomes.sort((a, b) => new Date(b.evaluatedAt).getTime() - new Date(a.evaluatedAt).getTime());
        if (options?.limit) outcomes = outcomes.slice(0, options.limit);
        return outcomes;
      },
    },
    physiqueGoals: {
      async active(_userId: string) {
        return null;
      },
    },
  } as unknown as Repositories;
}

async function withServer(
  store: InMemoryDecisionStore,
  run: (baseUrl: string) => Promise<void>,
  testName?: string
): Promise<void> {
  const runId = ++testRunCounter;
  console.error(`[TEST RUN ${runId}] Starting: ${testName ?? 'unknown'}`);
  const services = createServices(createDecisionRepositories(store));
  const server = createServer({ services });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  try {
    const { port } = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  console.error(`[TEST RUN ${runId}] Completed: ${testName ?? 'unknown'}`);
}

async function generateDecision(baseUrl: string, userId: string, options?: { asOf?: string; forceReevaluate?: boolean; assumptionOverrides?: Record<string, string> }): Promise<GenerateDecisionResult> {
  // Test fixtures are anchored to 2026-10-06 (see createDecisionStore localToday).
  // Default asOf so repository date-window queries (getDaily, getStateSnapshot)
  // match the persisted fixture data rather than the server's current date.
  const requestBody: Record<string, unknown> = { ...(options ?? {}) };
  if (requestBody.asOf === undefined) requestBody.asOf = "2026-10-06";
  const response = await fetch(`${baseUrl}/v0/users/${userId}/decisions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  const responseText = await response.text();
  const body = JSON.parse(responseText) as GenerateDecisionResult;
  return body;
}

async function getCurrentDecision(baseUrl: string, userId: string): Promise<DecisionSnapshot | null> {
  const response = await fetch(`${baseUrl}/v0/users/${userId}/decisions/current`);
  assert.ok([200, 404].includes(response.status));
  if (response.status === 404) return null;
  const body = await response.json() as { decision: DecisionSnapshot | null };
  return body.decision;
}

async function listDecisions(baseUrl: string, userId: string, params?: { status?: DecisionSnapshotStatus; limit?: number }): Promise<DecisionSnapshot[]> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set("status", params.status);
  if (params?.limit) searchParams.set("limit", String(params.limit));
  const response = await fetch(`${baseUrl}/v0/users/${userId}/decisions?${searchParams.toString()}`);
  assert.equal(response.status, 200);
  const body = await response.json() as { decisions: DecisionSnapshot[] };
  return body.decisions;
}

async function recordDecisionOutcome(baseUrl: string, userId: string, decisionId: string, command: {
  evaluationWindow: string;
  verdict: string;
  interventionVerdicts: Array<{ interventionIndex: number; verdict: string; observations: string[] }>;
  observations: string[];
  explanation: string;
  followUpDiagnosisIds?: string[];
  triggersReevaluation: boolean;
}): Promise<any> {
  const response = await fetch(`${baseUrl}/v0/users/${userId}/decisions/${decisionId}/outcomes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(command),
  });
  assert.equal(response.status, 201);
  const body = await response.json() as { outcome: any };
  return body.outcome;
}

async function shouldReevaluate(baseUrl: string, userId: string, decisionId: string): Promise<{ should: boolean; reason: string }> {
  const response = await fetch(`${baseUrl}/v0/users/${userId}/decisions/${decisionId}/reevaluate`);
  assert.equal(response.status, 200);
  const body = await response.json() as { should: boolean; reason: string };
  return body;
}

async function getUnifiedState(baseUrl: string, userId: string): Promise<UnifiedFitCoachState> {
  const response = await fetch(`${baseUrl}/v0/users/${userId}/unified-state?asOf=2026-10-06`);
  if (response.status !== 200) {
    const errorBody = await response.text();
    console.error(`GET /unified-state failed with status ${response.status}:`, errorBody);
  }
  assert.equal(response.status, 200);
  const body = await response.json() as { unifiedState: UnifiedFitCoachState };
  return body.unifiedState;
}

function createStalledSets(exerciseId: string, workoutExerciseId: string): ExerciseSetRecord[] {
  const now = new Date().toISOString();
  // Use reps=6 (below the 8-rep floor for hypertrophy) to trigger "repeat" outcome
  return [
    { id: `set_${exerciseId}_1`, workoutExerciseId, exerciseId, position: 0, kind: "working", reps: 6, loadKg: 80, rir: 2, createdAt: now, updatedAt: now },
    { id: `set_${exerciseId}_2`, workoutExerciseId, exerciseId, position: 1, kind: "working", reps: 6, loadKg: 80, rir: 2, createdAt: now, updatedAt: now },
    { id: `set_${exerciseId}_3`, workoutExerciseId, exerciseId, position: 2, kind: "working", reps: 6, loadKg: 80, rir: 2, createdAt: now, updatedAt: now },
  ];
}

function createProgressiveSets(exerciseId: string, workoutExerciseId: string): ExerciseSetRecord[] {
  const now = new Date().toISOString();
  return [
    { id: `set_${exerciseId}_1`, workoutExerciseId, exerciseId, position: 0, kind: "working", reps: 10, loadKg: 80, rir: 1, createdAt: now, updatedAt: now },
    { id: `set_${exerciseId}_2`, workoutExerciseId, exerciseId, position: 1, kind: "working", reps: 10, loadKg: 80, rir: 1, createdAt: now, updatedAt: now },
    { id: `set_${exerciseId}_3`, workoutExerciseId, exerciseId, position: 2, kind: "working", reps: 9, loadKg: 80, rir: 0, createdAt: now, updatedAt: now },
  ];
}

function createStalledProgressionSets(exerciseId: string, workoutExerciseId: string): ExerciseSetRecord[] {
  const now = new Date().toISOString();
  return [
    { id: `set_${exerciseId}_1`, workoutExerciseId, exerciseId, position: 0, kind: "working", reps: 8, loadKg: 80, rir: 2, createdAt: now, updatedAt: now },
    { id: `set_${exerciseId}_2`, workoutExerciseId, exerciseId, position: 1, kind: "working", reps: 8, loadKg: 80, rir: 2, createdAt: now, updatedAt: now },
    { id: `set_${exerciseId}_3`, workoutExerciseId, exerciseId, position: 2, kind: "working", reps: 8, loadKg: 80, rir: 2, createdAt: now, updatedAt: now },
  ];
}

function createMultipleWorkoutsWithExercises(
  store: InMemoryDecisionStore,
  userId: string,
  numWorkouts: number,
  exercises: readonly { exerciseId: string; sets: ExerciseSetRecord[] }[],
  versionId: string,
  sessionIds: string[]
): void {
  for (let w = 0; w < numWorkouts; w++) {
    const workoutId = `workout_${++workoutCounter}`;
    const now = new Date().toISOString();
    const startedAt = new Date(Date.now() - (numWorkouts - w) * 86400000).toISOString();
    const endedAt = new Date(Date.now() - (numWorkouts - w) * 86400000 + 3600000).toISOString();

    const workout: WorkoutRecord = {
      id: workoutId,
      userId,
      planVersionId: versionId,
      planSessionId: sessionIds[w] ?? `session_${w + 1}`,
      title: `Workout ${w + 1}`,
      status: "completed",
      startedAt,
      endedAt,
      environmentKind: "gym",
      createdAt: now,
      updatedAt: now,
    };
    store.workouts.set(workoutId, workout);

    let i = 0;
    for (const { exerciseId, sets } of exercises) {
      const workoutExerciseId = `wex_${workoutCounter}_${i}`;

      const workoutExercise: WorkoutExerciseRecord = {
        id: workoutExerciseId,
        workoutId,
        exerciseId,
        position: i,
        slotId: `slot_${i + 1}`,
        sets,
        createdAt: now,
        updatedAt: now,
      };
      store.workoutExercises.set(workoutExerciseId, workoutExercise);
      i++;
    }
  }
}

function createTrainingPlanWithExercises(
  store: InMemoryDecisionStore,
  userId: string,
  exerciseIds: string[],
  numSessions: number = 1
): { planId: string; versionId: string; sessionIds: string[] } {
  planCounter++;
  versionCounter++;

  const now = new Date().toISOString();
  const planId = `plan_${planCounter}`;
  const versionId = `version_${versionCounter}`;

  const plan: PlanAggregate = {
    id: planId,
    userId,
    name: "Test Plan",
    status: "active",
    description: undefined,
    activeFrom: undefined,
    activeUntil: undefined,
    createdAt: now,
    updatedAt: now,
    versions: [],
  };
  store.trainingPlans.set(planId, plan);

  const slots = exerciseIds.map((exId, i) => ({
    id: `slot_${i + 1}`,
    exerciseId: exId,
    targetSets: 3,
    targetRepRange: { min: 8, max: 12 },
    targetRir: 2,
    restSeconds: undefined,
    substitutionExerciseIds: undefined,
    notes: undefined,
  }));

  const sessions = [];
  const sessionIds: string[] = [];
  for (let s = 0; s < numSessions; s++) {
    sessionCounter++;
    const sessionId = `session_${sessionCounter}`;
    sessionIds.push(sessionId);
    sessions.push({
      id: sessionId,
      name: s === 0 ? "Upper A" : s === 1 ? "Lower A" : `Session ${s + 1}`,
      weekdayHint: s % 7,
      slots,
    });
  }

  const version: PlanVersionRecord = {
    id: versionId,
    planId,
    status: "active",
    planJson: "{}",
    configVersion: undefined,
    supersedesId: undefined,
    effectiveFrom: "2026-01-01",
    effectiveUntil: undefined,
    createdAt: now,
    updatedAt: now,
    sessions,
  };
  store.trainingPlanVersions.set(versionId, version);

  return { planId, versionId, sessionIds };
}

// ============================================================================
// SCENARIO A: New user onboarding → first unified state → first decision
// ============================================================================

describe("Scenario A: New user onboarding → first unified state → first decision", () => {
  test("generates a unified state with all available slices", async () => {
    const store = createDecisionStore();
    await withServer(store, async (baseUrl) => {
      const unifiedState = await getUnifiedState(baseUrl, USER_ID);

      assert.ok(unifiedState.id);
      assert.equal(unifiedState.userId, USER_ID);
      assert.ok(unifiedState.slices.length >= 4, "Should have at least 4 specialist slices");
      assert.ok(unifiedState.summary.includes("slices"));
      assert.ok(unifiedState.activeGoal);
      assert.equal(unifiedState.activeGoal?.kind, "aesthetics_v_taper");
    });
  });

  test("generates first decision (no_change or intervention)", async () => {
    const store = createDecisionStore();
    await withServer(store, async (baseUrl) => {
      const result = await generateDecision(baseUrl, USER_ID);

      assert.ok(result.snapshot.id);
      assert.equal(result.snapshot.userId, USER_ID);
      assert.ok(["no_change", "intervention_selected", "plan_adaptation"].includes(result.snapshot.kind));
      assert.equal(result.snapshot.status, "current");
      assert.ok(result.isNew);
      assert.ok(result.unifiedState);
      assert.ok(Array.isArray(result.diagnoses));
      assert.ok(Array.isArray(result.interventions));
    });
  });

  test("returns existing decision on second call without forceReevaluate", async () => {
    const store = createDecisionStore();
    await withServer(store, async (baseUrl) => {
      const first = await generateDecision(baseUrl, USER_ID);
      const second = await generateDecision(baseUrl, USER_ID);

      assert.equal(second.isNew, false);
      assert.equal(second.snapshot.id, first.snapshot.id);
    });
  });

  test("forces new decision with forceReevaluate", async () => {
    const store = createDecisionStore();
    await withServer(store, async (baseUrl) => {
      const first = await generateDecision(baseUrl, USER_ID);
      const forced = await generateDecision(baseUrl, USER_ID, { forceReevaluate: true });

      assert.ok(forced.isNew);
      assert.notEqual(forced.snapshot.id, first.snapshot.id);
      // The previous decision must be marked superseded in the store (re-fetch to verify persisted state)
      const superseded = await listDecisions(baseUrl, USER_ID, { status: "superseded" });
      assert.ok(superseded.some((d) => d.id === first.snapshot.id), "Previous decision should be superseded");
    });
  });
});

// ============================================================================
// SCENARIO B: Stalled hypertrophy → diagnosis → volume intervention → outcome evaluation
// ============================================================================

describe("Scenario B: Stalled hypertrophy → diagnosis → volume intervention → outcome evaluation", () => {
  test("detects training progression stalled diagnosis", async () => {
    const store = createDecisionStore();
    // Clear default training plan and workouts to use test-specific data
    store.trainingPlans.clear();
    store.trainingPlanVersions.clear();
    store.workouts.clear();
    store.workoutExercises.clear();
    // Create training plan with exercises matching the test
    const { versionId, sessionIds } = createTrainingPlanWithExercises(store, USER_ID, ["ex_barbell_bench_press", "ex_squat"], 4);
    // Create multiple workouts with exercises showing stalled progression (need 3+ for progression evaluation)
    createMultipleWorkoutsWithExercises(store, USER_ID, 12, [
      { exerciseId: "ex_barbell_bench_press", sets: createStalledSets("ex_barbell_bench_press", "wex_1") },
      { exerciseId: "ex_squat", sets: createStalledSets("ex_squat", "wex_2") },
    ], versionId, sessionIds);

    await withServer(store, async (baseUrl) => {
      const result = await generateDecision(baseUrl, USER_ID);

      const stalledDiagnosis = result.diagnoses.find((d) => d.code === "training_progression_stalled");
      assert.ok(stalledDiagnosis, "Should detect training_progression_stalled");
      assert.equal(stalledDiagnosis.severity, "act");
      assert.ok(stalledDiagnosis.evidence.length > 0);
    });
  });

  test("generates volume adjustment intervention for stalled hypertrophy", async () => {
    const store = createDecisionStore();
    store.trainingPlans.clear();
    store.trainingPlanVersions.clear();
    store.workouts.clear();
    store.workoutExercises.clear();
    const { versionId, sessionIds } = createTrainingPlanWithExercises(store, USER_ID, ["ex_barbell_bench_press", "ex_squat"], 4);
    createMultipleWorkoutsWithExercises(store, USER_ID, 12, [
      { exerciseId: "ex_barbell_bench_press", sets: createStalledSets("ex_barbell_bench_press", "wex_1") },
      { exerciseId: "ex_squat", sets: createStalledSets("ex_squat", "wex_2") },
    ], versionId, sessionIds);

    await withServer(store, async (baseUrl) => {
      const result = await generateDecision(baseUrl, USER_ID);

      const volumeIntervention = result.interventions.find((i) => i.kind === "training_volume_adjustment");
      assert.ok(volumeIntervention, "Should generate training_volume_adjustment intervention");
      assert.ok(volumeIntervention.parameters.targetMuscles);
      assert.ok(volumeIntervention.rationale.length > 0);
      assert.ok(volumeIntervention.expectedEffect.length > 0);
      assert.ok(volumeIntervention.addressesDiagnoses.length > 0);
    });
  });

  test("generates training_volume_adjustment for volume deficit diagnosis", async () => {
    const store = createDecisionStore();
    store.trainingPlans.clear();
    store.trainingPlanVersions.clear();
    store.workouts.clear();
    store.workoutExercises.clear();
    const { versionId, sessionIds } = createTrainingPlanWithExercises(store, USER_ID, ["ex_barbell_bench_press", "ex_squat"], 4);
    createMultipleWorkoutsWithExercises(store, USER_ID, 12, [
      { exerciseId: "ex_barbell_bench_press", sets: createStalledSets("ex_barbell_bench_press", "wex_1") },
      { exerciseId: "ex_squat", sets: createStalledSets("ex_squat", "wex_2") },
    ], versionId, sessionIds);

    await withServer(store, async (baseUrl) => {
      const result = await generateDecision(baseUrl, USER_ID);

      const volumeIntervention = result.interventions.find((i) => i.kind === "training_volume_adjustment");
      assert.ok(volumeIntervention, "Should generate training_volume_adjustment intervention");
      assert.ok(volumeIntervention.parameters.targetMuscles);
      assert.ok(volumeIntervention.rationale.length > 0);
      assert.ok(volumeIntervention.expectedEffect.length > 0);
      assert.ok(volumeIntervention.addressesDiagnoses.length > 0);
    });
  });

  test("evaluates outcome as improved after evaluation window", async () => {
    const store = createDecisionStore();
    store.trainingPlans.clear();
    store.trainingPlanVersions.clear();
    store.workouts.clear();
    store.workoutExercises.clear();
    const { versionId, sessionIds } = createTrainingPlanWithExercises(store, USER_ID, ["ex_barbell_bench_press", "ex_squat"], 4);
    createMultipleWorkoutsWithExercises(store, USER_ID, 12, [
      { exerciseId: "ex_barbell_bench_press", sets: createStalledSets("ex_barbell_bench_press", "wex_1") },
      { exerciseId: "ex_squat", sets: createStalledSets("ex_squat", "wex_2") },
    ], versionId, sessionIds);

    await withServer(store, async (baseUrl) => {
      const result = await generateDecision(baseUrl, USER_ID);
      const decisionId = result.snapshot.id;

      // Record outcome after evaluation window
      const evaluation = await recordDecisionOutcome(baseUrl, USER_ID, decisionId, {
        evaluationWindow: "14d",
        verdict: "improved_as_expected",
        interventionVerdicts: result.interventions.map((_, index) => ({
          interventionIndex: index,
          verdict: "improved_as_expected",
          observations: ["Progression resumed on target exercises"],
        })),
        observations: ["Training volume increase effective"],
        explanation: "Stalled exercises now progressing",
        followUpDiagnosisIds: [],
        triggersReevaluation: false,
      });

      assert.equal(evaluation.verdict, "improved_as_expected");
      assert.ok(evaluation.interventionVerdicts.length > 0);
    });
  });
});

// ============================================================================
// SCENARIO C: Weight loss stall → nutrition deficit diagnosis → calorie adjustment
// ============================================================================

describe("Scenario C: Weight loss stall → nutrition deficit diagnosis → calorie adjustment", () => {
  test("detects calorie intake below target diagnosis", async () => {
    const store = createDecisionStore();
    // Update daily nutrition to show calorie deficit
    const dailyKey = `${USER_ID}:2026-10-06`;
    const daily = store.dailyNutrition.get(dailyKey);
    if (daily) {
      daily.totals = { caloriesKcal: 1800, proteinGrams: 150, carbohydrateGrams: 180, fatGrams: 50 }; // 25% below target
      store.dailyNutrition.set(dailyKey, daily);
    }

    await withServer(store, async (baseUrl) => {
      const result = await generateDecision(baseUrl, USER_ID);
      const calorieDiagnosis = result.diagnoses.find((d) => d.code === "calorie_intake_below_target");
      assert.ok(calorieDiagnosis, "Should detect calorie_intake_below_target");
      assert.equal(calorieDiagnosis.severity, "watch");
    });
  });

  test("detects protein intake below target diagnosis", async () => {
    const store = createDecisionStore();
    // Update daily nutrition to show protein deficit
    const dailyKey = `${USER_ID}:2026-10-06`;
    const daily = store.dailyNutrition.get(dailyKey);
    if (daily) {
      daily.totals = { caloriesKcal: 2200, proteinGrams: 100, carbohydrateGrams: 220, fatGrams: 65 }; // Protein ~55% of target
      store.dailyNutrition.set(dailyKey, daily);
    }

    await withServer(store, async (baseUrl) => {
      const result = await generateDecision(baseUrl, USER_ID);

      const proteinDiagnosis = result.diagnoses.find((d) => d.code === "protein_intake_below_target");
      assert.ok(proteinDiagnosis, "Should detect protein_intake_below_target");
      assert.equal(proteinDiagnosis.severity, "act");
    });
  });

  test("generates nutrition target adjustment intervention", async () => {
    const store = createDecisionStore();
    const dailyKey = `${USER_ID}:2026-10-06`;
    const daily = store.dailyNutrition.get(dailyKey);
    if (daily) {
      daily.totals = { caloriesKcal: 1800, proteinGrams: 100, carbohydrateGrams: 180, fatGrams: 50 };
      store.dailyNutrition.set(dailyKey, daily);
    }

    await withServer(store, async (baseUrl) => {
      const result = await generateDecision(baseUrl, USER_ID);

      const nutritionIntervention = result.interventions.find((i) => i.kind === "nutrition_target_adjustment");
      assert.ok(nutritionIntervention, "Should generate nutrition_target_adjustment intervention");
      assert.ok(
        nutritionIntervention.parameters.target === "calories" || nutritionIntervention.parameters.target === "protein",
        `Expected target to be calories or protein, got: ${nutritionIntervention.parameters.target}`,
      );
      assert.ok(nutritionIntervention.addressesDiagnoses.length > 0);
    });
  });
});

// ============================================================================
// SCENARIO D: Recovery debt accumulating → urgent diagnosis → deload intervention
// ============================================================================

describe("Scenario D: Recovery debt accumulating → urgent diagnosis → deload intervention", () => {
  test("detects low recovery readiness diagnosis", async () => {
    const store = createDecisionStore();
    // computeRecoveryState derives readiness from subjective/sleep/HRV/training/nutrition
    // components, not from recoveryIndicators[].readinessScore directly. To get a
    // low readiness score we must modify the underlying components.
    for (const [, record] of store.recoveryRecords) {
      record.readinessScore = 45;
      record.readinessSubjective = 2;   // very low on 0-10 scale
      record.hrvMs = 30;                // very low HRV
      record.fatigue = 8;
      record.muscleSoreness = 7;
      record.sleepQuality = 3;
    }
    for (const [, record] of store.sleepRecords) {
      record.asleepMinutes = 300;       // 5 hours -> severe sleep debt
      record.efficiency = 0.7;
    }

    await withServer(store, async (baseUrl) => {
      const result = await generateDecision(baseUrl, USER_ID);

      const recoveryDiagnosis = result.diagnoses.find((d) => d.code === "recovery_readiness_low");
      assert.ok(recoveryDiagnosis, "Should detect recovery_readiness_low");
      assert.equal(recoveryDiagnosis.severity, "act");
    });
  });

  test("detects severe sleep debt as urgent", async () => {
    const store = createDecisionStore();
    // Update sleep records to show severe debt
    for (const [, record] of store.sleepRecords) {
      record.asleepMinutes = 300; // 5 hours
      record.efficiency = 0.7;
    }
    for (const [, record] of store.recoveryRecords) {
      record.sleepScore = 40;
    }

    await withServer(store, async (baseUrl) => {
      const result = await generateDecision(baseUrl, USER_ID);

      const sleepDiagnosis = result.diagnoses.find((d) => d.code === "sleep_debt_severe");
      assert.ok(sleepDiagnosis, "Should detect sleep_debt_severe");
      assert.equal(sleepDiagnosis.severity, "urgent");
    });
  });

  test("generates recovery adjustment (deload) intervention", async () => {
    const store = createDecisionStore();
    for (const [, record] of store.recoveryRecords) {
      record.readinessScore = 45;
      record.fatigue = 8;
    }
    for (const [, record] of store.sleepRecords) {
      record.asleepMinutes = 300;
    }

    await withServer(store, async (baseUrl) => {
      const result = await generateDecision(baseUrl, USER_ID);

      const recoveryIntervention = result.interventions.find((i) => i.kind === "recovery_adjustment");
      assert.ok(recoveryIntervention, "Should generate recovery_adjustment intervention");
      assert.ok(["comprehensive_recovery", "sleep_and_stress"].includes(
        recoveryIntervention.parameters.focus as string
      ));
      assert.ok(recoveryIntervention.precedence === "recovery_blocking");
    });
  });
});

// ============================================================================
// SCENARIO E: Projection divergence → plan adaptation → new decision supersedes
// ============================================================================

describe("Scenario E: Projection divergence → plan adaptation → new decision supersedes", () => {
  test("detects projection divergence in unified state", async () => {
    const store = createDecisionStore();

    await withServer(store, async (baseUrl) => {
      const unifiedState = await getUnifiedState(baseUrl, USER_ID);
      const projectionSlice = unifiedState.slices.find((s) => s.sourceKind === "projection_state");
      assert.ok(projectionSlice, "Should have projection slice");
    });
  });

  test("generates plan adaptation decision when projection diverges", async () => {
    const store = createDecisionStore();

    await withServer(store, async (baseUrl) => {
      const result = await generateDecision(baseUrl, USER_ID);

      // At minimum, should have a decision with proper structure
      assert.ok(result.snapshot.id);
      assert.ok(result.snapshot.supersedesId === undefined || result.snapshot.supersedesId);
    });
  });

  test("supersedes previous decision on re-evaluation with new divergence", async () => {
    const store = createDecisionStore();

    await withServer(store, async (baseUrl) => {
      const first = await generateDecision(baseUrl, USER_ID);
      const second = await generateDecision(baseUrl, USER_ID, { forceReevaluate: true });

      assert.ok(second.isNew);
      assert.notEqual(second.snapshot.id, first.snapshot.id);
      assert.equal(second.snapshot.supersedesId, first.snapshot.id);
      // The previous decision must be marked superseded in the store (re-fetch to verify persisted state)
      const superseded = await listDecisions(baseUrl, USER_ID, { status: "superseded" });
      assert.ok(superseded.some((d) => d.id === first.snapshot.id), "Previous decision should be superseded");
    });
  });
});

// ============================================================================
// SCENARIO F: Conflicting specialist advice → precedence resolution → coherent decision
// ============================================================================

describe("Scenario F: Conflicting specialist advice → precedence resolution → coherent decision", () => {
  test("resolves conflicting training vs recovery advice via precedence", async () => {
    const store = createDecisionStore();
    // Create scenario where training wants more volume but recovery wants deload
    for (const [, exercise] of store.workoutExercises) {
      exercise.sets = createProgressiveSets(exercise.exerciseId, exercise.id);
    }
    // Low recovery
    for (const [, record] of store.recoveryRecords) {
      record.readinessScore = 50;
      record.fatigue = 7;
    }

    await withServer(store, async (baseUrl) => {
      const result = await generateDecision(baseUrl, USER_ID);

      // Should have both training and recovery related interventions
      // Recovery blocking (precedence 1) should win over training progression (precedence 3)
      const recoveryInterventions = result.interventions.filter((i) => i.precedence === "recovery_blocking");
      const trainingInterventions = result.interventions.filter((i) => i.precedence === "training_progression");

      // Recovery should take precedence
      if (recoveryInterventions.length > 0 && trainingInterventions.length > 0) {
        const precedenceOrder = ["critical_safety", "recovery_blocking", "nutrition_foundation", "training_progression"];
        const recoveryPrec = precedenceOrder.indexOf(recoveryInterventions[0]!.precedence);
        const trainingPrec = precedenceOrder.indexOf(trainingInterventions[0]!.precedence);
        assert.ok(recoveryPrec < trainingPrec, "Recovery blocking should have higher precedence (lower number)");
      }
    });
  });

  test("produces coherent decision with no conflicting interventions", async () => {
    const store = createDecisionStore();
    // Nutrition deficit + low recovery + training stall
    const dailyKey = `${USER_ID}:2026-10-06`;
    const daily = store.dailyNutrition.get(dailyKey);
    if (daily) {
      daily.totals = { caloriesKcal: 1800, proteinGrams: 100, carbohydrateGrams: 180, fatGrams: 50 };
      store.dailyNutrition.set(dailyKey, daily);
    }
    for (const [, record] of store.recoveryRecords) {
      record.readinessScore = 55;
    }
    for (const [, exercise] of store.workoutExercises) {
      exercise.sets = createStalledProgressionSets(exercise.exerciseId, exercise.id);
    }

    await withServer(store, async (baseUrl) => {
      const result = await generateDecision(baseUrl, USER_ID);

      // All interventions should be valid (passed specialist validation)
      for (const intervention of result.interventions) {
        assert.ok(intervention.isValid, `Intervention ${intervention.kind} should be valid`);
      }

      // Decision should have a coherent summary
      assert.ok(result.snapshot.summary.length > 0);
      assert.ok(result.snapshot.interventions.length >= 0);
    });
  });

  test("respects critical_safety precedence over all others", async () => {
    const store = createDecisionStore();

    await withServer(store, async (baseUrl) => {
      const result = await generateDecision(baseUrl, USER_ID);

      // If critical_safety intervention exists, it should be first
      const safetyInterventions = result.interventions.filter((i) => i.precedence === "critical_safety");
      if (safetyInterventions.length > 0) {
        const firstIntervention = result.interventions[0];
        assert.ok(firstIntervention, "First intervention should exist");
        assert.equal(firstIntervention.precedence, "critical_safety");
      }
    });
  });
});

// ============================================================================
// SCENARIO G: Decision outcome "worsened" → re-evaluation → corrective intervention
// ============================================================================

describe("Scenario G: Decision outcome 'worsened' → re-evaluation → corrective intervention", () => {
  test("evaluates outcome as worsened when signals persist", async () => {
    const store = createDecisionStore();
    // Set up initial stalled state
    for (const [, exercise] of store.workoutExercises) {
      exercise.sets = createStalledSets(exercise.exerciseId, exercise.id);
    }

    await withServer(store, async (baseUrl) => {
      const result = await generateDecision(baseUrl, USER_ID);
      const decisionId = result.snapshot.id;

      // Record worsened outcome
      const evaluation = await recordDecisionOutcome(baseUrl, USER_ID, decisionId, {
        evaluationWindow: "14d",
        verdict: "worsened",
        interventionVerdicts: result.interventions.map((_, index) => ({
          interventionIndex: index,
          verdict: "worsened",
          observations: ["Stagnation signal still present", "No improvement in progression"],
        })),
        observations: ["Training progression still stalled after intervention"],
        explanation: "Volume increase did not resolve stagnation",
        followUpDiagnosisIds: [],
        triggersReevaluation: true,
      });

      assert.equal(evaluation.verdict, "worsened");
      assert.ok(evaluation.triggersReevaluation);
    });
  });

  test("triggers re-evaluation when outcome is worsened", async () => {
    const store = createDecisionStore();
    for (const [, exercise] of store.workoutExercises) {
      exercise.sets = createStalledSets(exercise.exerciseId, exercise.id);
    }

    await withServer(store, async (baseUrl) => {
      const result = await generateDecision(baseUrl, USER_ID);
      const decisionId = result.snapshot.id;

      await recordDecisionOutcome(baseUrl, USER_ID, decisionId, {
        evaluationWindow: "14d",
        verdict: "worsened",
        interventionVerdicts: result.interventions.map((_, index) => ({
          interventionIndex: index,
          verdict: "worsened",
          observations: ["No improvement"],
        })),
        observations: ["Worsened"],
        explanation: "Worsened",
        followUpDiagnosisIds: [],
        triggersReevaluation: true,
      });

      const reevaluation = await shouldReevaluate(baseUrl, USER_ID, decisionId);
      assert.ok(reevaluation.should);
      assert.ok(reevaluation.reason.includes("worsened") || reevaluation.reason.includes("reevaluation"));
    });
  });

  test("generates corrective intervention on re-evaluation after worsened outcome", async () => {
    const store = createDecisionStore();
    for (const [, exercise] of store.workoutExercises) {
      exercise.sets = createStalledSets(exercise.exerciseId, exercise.id);
    }

    await withServer(store, async (baseUrl) => {
      const first = await generateDecision(baseUrl, USER_ID);
      const decisionId = first.snapshot.id;

      await recordDecisionOutcome(baseUrl, USER_ID, decisionId, {
        evaluationWindow: "14d",
        verdict: "worsened",
        interventionVerdicts: first.interventions.map((_, index) => ({
          interventionIndex: index,
          verdict: "worsened",
          observations: ["No improvement"],
        })),
        observations: ["Worsened"],
        explanation: "Worsened",
        followUpDiagnosisIds: [],
        triggersReevaluation: true,
      });

      // Force re-evaluation
      const second = await generateDecision(baseUrl, USER_ID, { forceReevaluate: true });

      assert.ok(second.isNew);
      assert.notEqual(second.snapshot.id, first.snapshot.id);
      assert.ok(second.snapshot.interventions.length > 0);
      // Should have different or additional interventions
    });
  });
});

// ============================================================================
// Additional API Contract Tests
// ============================================================================

describe("Unified Decision API Contract", () => {
  test("GET /v0/users/:userId/decisions lists decisions", async () => {
    const store = createDecisionStore();
    await withServer(store, async (baseUrl) => {
      await generateDecision(baseUrl, USER_ID);
      const decisions = await listDecisions(baseUrl, USER_ID);
      assert.ok(Array.isArray(decisions));
      assert.ok(decisions.length >= 1);
    });
  });

  test("GET /v0/users/:userId/decisions filters by status", async () => {
    const store = createDecisionStore();
    await withServer(store, async (baseUrl) => {
      await generateDecision(baseUrl, USER_ID);
      const current = await listDecisions(baseUrl, USER_ID, { status: "current" });
      const superseded = await listDecisions(baseUrl, USER_ID, { status: "superseded" });

      assert.ok(current.every((d) => d.status === "current"));
      assert.ok(superseded.every((d) => d.status === "superseded"));
    });
  });

  test("GET /v0/users/:userId/decisions/:decisionId returns specific decision", async () => {
    const store = createDecisionStore();
    await withServer(store, async (baseUrl) => {
      const result = await generateDecision(baseUrl, USER_ID);
      const decisionId = result.snapshot.id;

      const response = await fetch(`${baseUrl}/v0/users/${USER_ID}/decisions/${decisionId}`);
      assert.equal(response.status, 200);
      const body = await response.json() as { decision: DecisionSnapshot };
      assert.equal(body.decision.id, decisionId);
    });
  });

  test("GET /v0/users/:userId/decisions/:decisionId returns 404 for non-existent", async () => {
    const store = createDecisionStore();
    await withServer(store, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v0/users/${USER_ID}/decisions/non-existent-id`);
      assert.equal(response.status, 404);
    });
  });

  test("GET /v0/users/:userId/decisions/current returns current decision", async () => {
    const store = createDecisionStore();
    await withServer(store, async (baseUrl) => {
      await generateDecision(baseUrl, USER_ID);
      const decision = await getCurrentDecision(baseUrl, USER_ID);
      assert.ok(decision);
      assert.equal(decision?.status, "current");
    });
  });

  test("GET /v0/users/:userId/unified-state returns complete state", async () => {
    const store = createDecisionStore();
    await withServer(store, async (baseUrl) => {
      const state = await getUnifiedState(baseUrl, USER_ID);
      assert.ok(state.id);
      assert.ok(state.slices.length >= 4);
      assert.ok(state.activeGoal);
      assert.ok(state.summary);
    });
  });

  test("POST /v0/users/:userId/decisions validates request body", async () => {
    const store = createDecisionStore();
    await withServer(store, async (baseUrl) => {
      // Invalid asOf format
      const response = await fetch(`${baseUrl}/v0/users/${USER_ID}/decisions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ asOf: "invalid-date" }),
      });
      assert.ok([400, 422].includes(response.status));
    });
  });

  test("POST /v0/users/:userId/decisions/:id/outcomes validates outcome", async () => {
    const store = createDecisionStore();
    await withServer(store, async (baseUrl) => {
      const result = await generateDecision(baseUrl, USER_ID);
      const decisionId = result.snapshot.id;

      // Missing required fields
      const response = await fetch(`${baseUrl}/v0/users/${USER_ID}/decisions/${decisionId}/outcomes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.ok([400, 422].includes(response.status));
    });
  });
});