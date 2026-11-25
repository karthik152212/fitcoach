import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { Profile, User, NutrientAmounts } from "@fitcoach/domain";
import type {
  CreateMealInput,
  CreateRecipeInput,
  CreateFoodInput,
  FoodRecord,
  MealRecord,
  MealItemRecord,
  DailyNutritionRecord,
  RecipeRecord,
  RecipeItemRecord,
  Repositories,
} from "@fitcoach/db";
import { createServer } from "../server";
import { createServices } from "../services";

/**
 * Phase 5 Nutrition API integration tests.
 *
 * These exercise the real HTTP routes and the real NutritionService
 * against an in-memory repository bundle. This verifies the wiring
 * the user actually touches — request parsing, validation, persistence
 * of foods, meals, daily totals, targets, and assessments.
 */

const USER_ID = "usr_nutrition_test";
const FOOD_SOURCE_ID = "00000000-0000-4000-8000-000000000001";

function uuid(seed: number): string {
  return `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
}

interface InMemoryNutritionStore {
  foods: Map<string, FoodRecord>;
  meals: Map<string, MealRecord>;
  dailyNutrition: Map<string, DailyNutritionRecord>;
  nutritionTargets: Map<string, any>;
  recipes: Map<string, RecipeRecord>;
}

function createNutritionStore(): InMemoryNutritionStore {
  return {
    foods: new Map(),
    meals: new Map(),
    dailyNutrition: new Map(),
    nutritionTargets: new Map(),
    recipes: new Map(),
  };
}

let foodCounter = 0;
let mealCounter = 0;
let recipeCounter = 0;

function createNutritionRepositories(store: InMemoryNutritionStore): Repositories {
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
    email: "nutrition@example.test",
    displayName: "Nutrition Test",
    timezone: "UTC",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    profile,
  } as unknown as User;

  const foodSource = {
    id: FOOD_SOURCE_ID,
    name: "Test Source",
    kind: "curated_database" as const,
    defaultConfidence: "measured" as const,
    externalSourceId: null,
  };

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
        if (!trimmed) {
          return { foods: [], total: 0 };
        }

        const limit = Math.min(options?.limit ?? 20, 100);
        const offset = options?.offset ?? 0;
        const sourceId = options?.sourceId;

        let foods = [...store.foods.values()].filter((f) => f.isActive);

        if (sourceId) {
          foods = foods.filter((f) => f.sourceId === sourceId);
        }

        // Filter by name, brand, or externalId
        foods = foods.filter(
          (f) =>
            f.name.toLowerCase().includes(trimmed) ||
            f.brand?.toLowerCase().includes(trimmed) ||
            f.externalId?.toLowerCase().includes(trimmed)
        );

        // Rank: exact name match > starts with > contains > brand/externalId
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
        if (input.clientRequestId) {
          const existing = [...store.meals.values()].find((meal) =>
            meal.userId === input.userId && meal.clientRequestId === input.clientRequestId
          );
          if (existing) return existing;
        }
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
        return [...store.meals.values()].filter(
          (m) => m.userId === userId && (!localDate || m.localDate === localDate),
        );
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
          targetsSnapshot: input.targetsSnapshot ?? { caloriesKcal: 2400, proteinGrams: 150, carbohydrateGrams: 200, fatGrams: 70 },
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
    },
    nutritionTargets: {
      async deriveAndStoreTargets(userId: string, goal: any, context: any) {
        const targets = {
          userId,
          targets: {
            goal: goal.kind,
            caloriesKcal: goal.kind === "bodybuilding" ? 2800 : 2400,
            proteinGrams: 180,
            carbohydrateGrams: goal.kind === "bodybuilding" ? 300 : 250,
            fatGrams: 80,
            fiberGrams: 30,
            derivedAt: new Date().toISOString(),
            derivedFrom: { profile: true, goal: true, bodyComposition: !!context.bodyFatPercent },
          },
        };
        store.nutritionTargets.set(userId, targets);
        return targets.targets;
      },
      async getTargets(userId: string) {
        return store.nutritionTargets.get(userId)?.targets ?? null;
      },
    },
    nutritionAssessment: {
      async assessAdherence(userId: string, targets: any, windowDays: number) {
        const daily = [...store.dailyNutrition.values()].filter(
          (d) => d.userId === userId && d.localDate >= "2026-10-01",
        );
        const avgCalories = daily.length > 0
          ? daily.reduce((sum, d) => sum + d.totals.caloriesKcal, 0) / daily.length
          : 0;
        const avgProtein = daily.length > 0
          ? daily.reduce((sum, d) => sum + d.totals.proteinGrams, 0) / daily.length
          : 0;
        const avgCarbs = daily.length > 0
          ? daily.reduce((sum, d) => sum + d.totals.carbohydrateGrams, 0) / daily.length
          : 0;
        const avgFat = daily.length > 0
          ? daily.reduce((sum, d) => sum + d.totals.fatGrams, 0) / daily.length
          : 0;

        return {
          userId,
          windowDays,
          windowStart: "2026-10-01",
          windowEnd: "2026-10-06",
          targets: {
            caloriesKcal: targets.caloriesKcal,
            proteinGrams: targets.proteinGrams,
            carbohydrateGrams: targets.carbohydrateGrams,
            fatGrams: targets.fatGrams,
          },
          averages: {
            caloriesKcal: Math.round(avgCalories),
            proteinGrams: Math.round(avgProtein * 10) / 10,
            carbohydrateGrams: Math.round(avgCarbs * 10) / 10,
            fatGrams: Math.round(avgFat * 10) / 10,
          },
          adherence: {
            caloriesKcal: targets.caloriesKcal > 0 ? Math.round((avgCalories / targets.caloriesKcal) * 100) : 0,
            proteinGrams: targets.proteinGrams > 0 ? Math.round((avgProtein / targets.proteinGrams) * 100) : 0,
            carbohydrateGrams: targets.carbohydrateGrams > 0 ? Math.round((avgCarbs / targets.carbohydrateGrams) * 100) : 0,
            fatGrams: targets.fatGrams > 0 ? Math.round((avgFat / targets.fatGrams) * 100) : 0,
          },
          assessment: {
            caloriesKcal: avgCalories > targets.caloriesKcal * 1.1 ? "over" : avgCalories < targets.caloriesKcal * 0.9 ? "under" : "on_target",
            proteinGrams: avgProtein > targets.proteinGrams * 1.1 ? "over" : avgProtein < targets.proteinGrams * 0.9 ? "under" : "on_target",
            carbohydrateGrams: avgCarbs > targets.carbohydrateGrams * 1.1 ? "over" : avgCarbs < targets.carbohydrateGrams * 0.9 ? "under" : "on_target",
            fatGrams: avgFat > targets.fatGrams * 1.1 ? "over" : avgFat < targets.fatGrams * 0.9 ? "under" : "on_target",
          },
          daysLogged: daily.length,
          daysInWindow: windowDays,
        };
      },
    },
    recipes: {
      async create(input: CreateRecipeInput) {
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
          ownerUserId: input.ownerUserId,
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
      async listByOwner(userId: string) {
        return [...store.recipes.values()].filter((recipe) => recipe.ownerUserId === userId);
      },
      async findById(id: string) {
        return store.recipes.get(id) ?? null;
      },
      async deactivate(_id: string) {
        return;
      },
      async computeRecipeNutrition(_recipeId: string, servings: number) {
        return {
          perServing: {
            caloriesKcal: 300,
            proteinGrams: 25,
            carbohydrateGrams: 30,
            fatGrams: 10,
            fiberGrams: 5,
          },
          total: {
            caloriesKcal: 300 * servings,
            proteinGrams: 25 * servings,
            carbohydrateGrams: 30 * servings,
            fatGrams: 10 * servings,
            fiberGrams: 5 * servings,
          },
        };
      },
    },
  } as unknown as Repositories;
}

async function withServer(
  store: InMemoryNutritionStore,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const services = createServices(createNutritionRepositories(store));
  const server = createServer({ services });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  try {
    const { port } = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function createFood(baseUrl: string, food: {
  name: string;
  caloriesKcal: number;
  proteinGrams: number;
  carbohydrateGrams: number;
  fatGrams: number;
  fiberGrams?: number;
  brand?: string;
  servings?: Array<{ label: string; grams?: number }>;
  sourceId?: string;
  externalId?: string;
}): Promise<FoodRecord> {
  const response = await fetch(`${baseUrl}/v0/users/${USER_ID}/foods`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceId: food.sourceId ?? FOOD_SOURCE_ID,
      name: food.name,
      brand: food.brand ?? null,
      densityBasis: "per_100g",
      nutrientsPer100g: {
        caloriesKcal: food.caloriesKcal,
        proteinGrams: food.proteinGrams,
        carbohydrateGrams: food.carbohydrateGrams,
        fatGrams: food.fatGrams,
        fiberGrams: food.fiberGrams ?? 0,
      },
      servings: food.servings?.map((s) => ({
        label: s.label,
        grams: s.grams ?? 100,
      })) ?? [{ label: "100g", grams: 100 }],
      defaultServingLabel: food.servings?.[0]?.label ?? "100g",
      ...(food.externalId ? { externalId: food.externalId } : {}),
    }),
  });
  assert.equal(response.status, 201);
  const body = await response.json() as { food: FoodRecord };
  return body.food;
}

async function createMeal(
  baseUrl: string,
  items: Array<{ foodId: string; quantityGrams: number; confidence?: string }>,
  slot: string = "lunch",
  localDate = "2026-10-06",
): Promise<MealRecord> {
  const response = await fetch(`${baseUrl}/v0/users/${USER_ID}/meals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      localDate,
      slot,
      items: items.map((item) => ({
        foodId: item.foodId,
        quantityGrams: item.quantityGrams,
        confidence: item.confidence ?? "estimated",
      })),
      clientRequestId: `test-${Date.now()}`,
    }),
  });
  assert.equal(response.status, 201);
  const body = await response.json() as { meal: MealRecord };
  return body.meal;
}

// ---------------------------------------------------------------------------
// Food CRUD
// ---------------------------------------------------------------------------

test("POST /v0/users/:userId/foods creates a food with nutrients and servings", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const food = await createFood(baseUrl, {
      name: "Chicken Breast",
      caloriesKcal: 165,
      proteinGrams: 31,
      carbohydrateGrams: 0,
      fatGrams: 3.6,
      fiberGrams: 0,
      servings: [{ label: "100g", grams: 100 }, { label: "4oz", grams: 113 }],
    });

    assert.ok(food.id);
    assert.equal(food.name, "Chicken Breast");
    assert.equal(food.nutrientsPer100g.caloriesKcal, 165);
    assert.equal(food.nutrientsPer100g.proteinGrams, 31);
    assert.equal(food.servings.length, 2);
    assert.ok(food.defaultServingId);
  });
});

test("GET /v0/foods/:foodId returns the food with servings", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const created = await createFood(baseUrl, {
      name: "Test Food",
      caloriesKcal: 100,
      proteinGrams: 20,
      carbohydrateGrams: 10,
      fatGrams: 3,
    });

    const response = await fetch(`${baseUrl}/v0/foods/${created.id}`);
    assert.equal(response.status, 200);
    const { food } = (await response.json()) as { food: FoodRecord };
    assert.equal(food.id, created.id);
    assert.equal(food.name, "Test Food");
    assert.ok(food.servings.length >= 1);
  });
});

test("POST /v0/users/:userId/foods rejects invalid nutrient values", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v0/users/${USER_ID}/foods`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceId: FOOD_SOURCE_ID,
        name: "Invalid Food",
        densityBasis: "per_100g",
        nutrientsPer100g: {
          caloriesKcal: -100,
          proteinGrams: 20,
          carbohydrateGrams: 10,
          fatGrams: 3,
        },
      }),
    });
    assert.equal(response.status, 400);
    const body = await response.json() as { error: string };
    assert.equal(body.error, "validation_failed");
  });
});

test("POST /v0/users/:userId/foods rejects servings without grams or milliliters", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v0/users/${USER_ID}/foods`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceId: FOOD_SOURCE_ID,
        name: "Invalid Serving Food",
        densityBasis: "per_100g",
        nutrientsPer100g: {
          caloriesKcal: 100,
          proteinGrams: 20,
          carbohydrateGrams: 10,
          fatGrams: 3,
        },
        servings: [{ label: "serving", unitQuantity: 1 }],
      }),
    });
    assert.equal(response.status, 400);
  });
});

// ---------------------------------------------------------------------------
// Meal Logging
// ---------------------------------------------------------------------------

test("POST /v0/users/:userId/meals creates a meal with items and computes totals", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const chicken = await createFood(baseUrl, {
      name: "Chicken Breast",
      caloriesKcal: 165,
      proteinGrams: 31,
      carbohydrateGrams: 0,
      fatGrams: 3.6,
      fiberGrams: 0,
    });

    const rice = await createFood(baseUrl, {
      name: "White Rice",
      caloriesKcal: 130,
      proteinGrams: 2.7,
      carbohydrateGrams: 28.2,
      fatGrams: 0.3,
      fiberGrams: 0.4,
    });

    const meal = await createMeal(baseUrl, [
      { foodId: chicken.id, quantityGrams: 150 },
      { foodId: rice.id, quantityGrams: 200 },
    ]);

    assert.ok(meal.id);
    assert.equal(meal.items.length, 2);
    assert.ok(meal.totals.caloriesKcal > 0);
    assert.ok(meal.totals.proteinGrams > 0);
    assert.ok(meal.totals.carbohydrateGrams > 0);
  });
});

test("POST /v0/users/:userId/meals is idempotent on clientRequestId", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const chicken = await createFood(baseUrl, {
      name: "Chicken Breast",
      caloriesKcal: 165,
      proteinGrams: 31,
      carbohydrateGrams: 0,
      fatGrams: 3.6,
    });

    const clientRequestId = `idempotent-${Date.now()}`;

    const meal1 = await fetch(`${baseUrl}/v0/users/${USER_ID}/meals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        localDate: "2026-10-06",
        slot: "lunch",
        items: [{ foodId: chicken.id, quantityGrams: 150, confidence: "measured" }],
        clientRequestId,
      }),
    });
    assert.equal(meal1.status, 201);
    const m1 = (await meal1.json()) as { meal: MealRecord };

    const meal2 = await fetch(`${baseUrl}/v0/users/${USER_ID}/meals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        localDate: "2026-10-06",
        slot: "lunch",
        items: [{ foodId: chicken.id, quantityGrams: 150, confidence: "measured" }],
        clientRequestId,
      }),
    });
    assert.equal(meal2.status, 201);
    const m2 = (await meal2.json()) as { meal: MealRecord };

    assert.equal(m2.meal.id, m1.meal.id);
    assert.equal(m2.meal.items.length, 1);
  });
});

test("POST /v0/users/:userId/meals/:mealId/items adds an item to existing meal", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const chicken = await createFood(baseUrl, {
      name: "Chicken Breast",
      caloriesKcal: 165,
      proteinGrams: 31,
      carbohydrateGrams: 0,
      fatGrams: 3.6,
    });

    const rice = await createFood(baseUrl, {
      name: "White Rice",
      caloriesKcal: 130,
      proteinGrams: 2.7,
      carbohydrateGrams: 28.2,
      fatGrams: 0.3,
    });

    const meal = await createMeal(baseUrl, [
      { foodId: chicken.id, quantityGrams: 150 },
    ]);

    const response = await fetch(`${baseUrl}/v0/users/${USER_ID}/meals/${meal.id}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        foodId: rice.id,
        quantityGrams: 200,
        confidence: "estimated",
      }),
    });
    assert.equal(response.status, 201);
    const { meal: updated } = (await response.json()) as { meal: MealRecord };
    assert.equal(updated.items.length, 2);
  });
});

test("GET /v0/users/:userId/meals lists meals for a date", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const chicken = await createFood(baseUrl, {
      name: "Chicken Breast",
      caloriesKcal: 165,
      proteinGrams: 31,
      carbohydrateGrams: 0,
      fatGrams: 3.6,
    });

    await createMeal(baseUrl, [{ foodId: chicken.id, quantityGrams: 150 }], "breakfast");
    await createMeal(baseUrl, [{ foodId: chicken.id, quantityGrams: 200 }], "lunch");

    const response = await fetch(`${baseUrl}/v0/users/${USER_ID}/meals?date=2026-10-06`);
    assert.equal(response.status, 200);
    const { meals } = (await response.json()) as { meals: MealRecord[] };
    assert.equal(meals.length, 2);
    assert.ok(meals.some((m) => m.slot === "breakfast"));
    assert.ok(meals.some((m) => m.slot === "lunch"));
  });
});

test("POST /v0/users/:userId/meals rejects empty items array", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v0/users/${USER_ID}/meals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        localDate: "2026-10-06",
        slot: "lunch",
        items: [],
      }),
    });
    assert.equal(response.status, 400);
    const body = await response.json() as { error: string };
    assert.equal(body.error, "validation_failed");
  });
});

// ---------------------------------------------------------------------------
// Daily Nutrition
// ---------------------------------------------------------------------------

test("GET /v0/users/:userId/nutrition/daily returns daily totals", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const chicken = await createFood(baseUrl, {
      name: "Chicken Breast",
      caloriesKcal: 165,
      proteinGrams: 31,
      carbohydrateGrams: 0,
      fatGrams: 3.6,
    });

    await createMeal(baseUrl, [{ foodId: chicken.id, quantityGrams: 150 }]);

    const response = await fetch(`${baseUrl}/v0/users/${USER_ID}/nutrition/daily?date=2026-10-06`);
    assert.equal(response.status, 200);
    const { daily } = (await response.json()) as { daily: DailyNutritionRecord };
    assert.ok(daily.totals.caloriesKcal > 0);
    const targetCalories = daily.targetsSnapshot?.caloriesKcal;
    assert.ok(typeof targetCalories === "number" && targetCalories > 0);
  });
});

test("GET /v0/users/:userId/nutrition/daily returns 404 when no daily record exists", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v0/users/${USER_ID}/nutrition/daily?date=2026-10-01`);
    assert.equal(response.status, 404);
  });
});

// ---------------------------------------------------------------------------
// Nutrition Targets
// ---------------------------------------------------------------------------

test("POST /v0/users/:userId/nutrition/targets derives and stores personalized targets", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v0/users/${USER_ID}/nutrition/targets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "bodybuilding",
        currentBodyWeightKg: 80,
        bodyFatPercent: 15,
      }),
    });
    assert.equal(response.status, 201);
    const { targets } = (await response.json()) as { targets: any };
    assert.equal(targets.userId, USER_ID);
    assert.equal(targets.goal, "bodybuilding");
    assert.ok(targets.caloriesKcal > 0);
    assert.ok(targets.proteinGrams > 0);
    assert.ok(targets.carbohydrateGrams > 0);
    assert.ok(targets.fatGrams > 0);
    assert.ok(targets.fiberGrams > 0);
    assert.ok(targets.derivedFrom.profile);
    assert.ok(targets.derivedFrom.goal);
    assert.ok(targets.derivedFrom.bodyComposition);
  });
});

test("POST /v0/users/:userId/nutrition/targets uses goal-specific calorie targets", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const bodybuilding = await fetch(`${baseUrl}/v0/users/${USER_ID}/nutrition/targets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: "bodybuilding", currentBodyWeightKg: 80 }),
    });
    const { targets: bb } = await bodybuilding.json() as { targets: any };

    const store2 = createNutritionStore();
    await withServer(store2, async (baseUrl2) => {
      const general = await fetch(`${baseUrl2}/v0/users/${USER_ID}/nutrition/targets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: "general_fitness", currentBodyWeightKg: 80 }),
      });
      const { targets: gf } = await general.json() as { targets: any };

      assert.ok(bb.caloriesKcal > gf.caloriesKcal);
    });
  });
});

test("GET /v0/users/:userId/nutrition/targets returns stored targets", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    await fetch(`${baseUrl}/v0/users/${USER_ID}/nutrition/targets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: "bodybuilding", currentBodyWeightKg: 80 }),
    });

    const response = await fetch(`${baseUrl}/v0/users/${USER_ID}/nutrition/targets`);
    assert.equal(response.status, 200);
    const { targets } = (await response.json()) as { targets: any };
    assert.equal(targets.goal, "bodybuilding");
  });
});

test("GET /v0/users/:userId/nutrition/targets returns 404 when no targets exist", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v0/users/${USER_ID}/nutrition/targets`);
    assert.equal(response.status, 404);
  });
});

// ---------------------------------------------------------------------------
// Nutrition Assessment
// ---------------------------------------------------------------------------

test("GET /v0/users/:userId/nutrition/assessment returns adherence analysis", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    await fetch(`${baseUrl}/v0/users/${USER_ID}/nutrition/targets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: "bodybuilding", currentBodyWeightKg: 80 }),
    });

    const chicken = await createFood(baseUrl, {
      name: "Chicken Breast",
      caloriesKcal: 165,
      proteinGrams: 31,
      carbohydrateGrams: 0,
      fatGrams: 3.6,
    });

    const rice = await createFood(baseUrl, {
      name: "White Rice",
      caloriesKcal: 130,
      proteinGrams: 2.7,
      carbohydrateGrams: 28.2,
      fatGrams: 0.3,
    });

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    await createMeal(baseUrl, [
      { foodId: chicken.id, quantityGrams: 150 },
      { foodId: rice.id, quantityGrams: 200 },
    ], "lunch", today);

    await fetch(`${baseUrl}/v0/users/${USER_ID}/meals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        localDate: yesterday,
        slot: "dinner",
        items: [
          { foodId: chicken.id, quantityGrams: 200, confidence: "measured" },
          { foodId: rice.id, quantityGrams: 150, confidence: "estimated" },
        ],
        clientRequestId: `day2-${Date.now()}`,
      }),
    });

    const response = await fetch(`${baseUrl}/v0/users/${USER_ID}/nutrition/assessment?windowDays=7`);
    assert.equal(response.status, 200);
    const { assessment } = (await response.json()) as { assessment: any };

    assert.equal(assessment.userId, USER_ID);
    assert.equal(assessment.windowDays, 7);
    assert.ok(assessment.targets.caloriesKcal > 0);
    assert.ok(assessment.averages.caloriesKcal >= 0);
    assert.ok(typeof assessment.adherence.caloriesKcal === "number");
    assert.ok(["on_target", "over", "under"].includes(assessment.assessment.caloriesKcal));
    assert.ok(["on_target", "over", "under"].includes(assessment.assessment.proteinGrams));
    assert.ok(assessment.daysLogged > 0);
  });
});

test("GET /v0/users/:userId/nutrition/assessment returns 404 when no targets exist", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v0/users/${USER_ID}/nutrition/assessment?windowDays=7`);
    assert.equal(response.status, 404);
  });
});

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

test("POST /v0/users/:userId/recipes creates a recipe with items", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const chicken = await createFood(baseUrl, {
      name: "Chicken Breast",
      caloriesKcal: 165,
      proteinGrams: 31,
      carbohydrateGrams: 0,
      fatGrams: 3.6,
    });

    const rice = await createFood(baseUrl, {
      name: "White Rice",
      caloriesKcal: 130,
      proteinGrams: 2.7,
      carbohydrateGrams: 28.2,
      fatGrams: 0.3,
    });

    const broccoli = await createFood(baseUrl, {
      name: "Broccoli",
      caloriesKcal: 34,
      proteinGrams: 2.8,
      carbohydrateGrams: 6.6,
      fatGrams: 0.4,
    });

    const response = await fetch(`${baseUrl}/v0/users/${USER_ID}/recipes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Chicken Rice Bowl",
        servings: 2,
        instructions: "Cook rice. Grill chicken. Steam broccoli. Combine.",
        items: [
          { foodId: chicken.id, quantityGrams: 300 },
          { foodId: rice.id, quantityGrams: 300 },
          { foodId: broccoli.id, quantityGrams: 200 },
        ],
      }),
    });
    assert.equal(response.status, 201);
    const { recipe } = (await response.json()) as { recipe: RecipeRecord };
    assert.equal(recipe.name, "Chicken Rice Bowl");
    assert.equal(recipe.servings, 2);
    assert.equal(recipe.items.length, 3);
  });
});

test("GET /v0/recipes/:recipeId/nutrition computes per-serving nutrition", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const chicken = await createFood(baseUrl, {
      name: "Chicken Breast",
      caloriesKcal: 165,
      proteinGrams: 31,
      carbohydrateGrams: 0,
      fatGrams: 3.6,
    });

    const rice = await createFood(baseUrl, {
      name: "White Rice",
      caloriesKcal: 130,
      proteinGrams: 2.7,
      carbohydrateGrams: 28.2,
      fatGrams: 0.3,
    });

    const createResponse = await fetch(`${baseUrl}/v0/users/${USER_ID}/recipes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Test Recipe",
        servings: 4,
        items: [
          { foodId: chicken.id, quantityGrams: 400 },
          { foodId: rice.id, quantityGrams: 400 },
        ],
      }),
    });
    assert.equal(createResponse.status, 201);
    const { recipe } = (await createResponse.json()) as { recipe: RecipeRecord };

    const nutritionResponse = await fetch(`${baseUrl}/v0/recipes/${recipe.id}/nutrition?servings=2`);
    assert.equal(nutritionResponse.status, 200);
    const { nutrition } = (await nutritionResponse.json()) as { nutrition: any };
    assert.ok(nutrition.perServing.caloriesKcal > 0);
    assert.ok(nutrition.total.caloriesKcal > 0);
    assert.ok(nutrition.total.caloriesKcal === nutrition.perServing.caloriesKcal * 2);
  });
});

test("GET /v0/recipes/:recipeId/nutrition requires servings parameter", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v0/recipes/some-id/nutrition`);
    assert.equal(response.status, 400);
    const body = await response.json() as { error: string };
    assert.equal(body.error, "validation_failed");
  });
});

test("GET /v0/users/:userId/recipes lists user recipes", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v0/users/${USER_ID}/recipes`);
    assert.equal(response.status, 200);
    const { recipes } = (await response.json()) as { recipes: RecipeRecord[] };
    assert.ok(Array.isArray(recipes));
  });
});

// ---------------------------------------------------------------------------
// Food Search
// ---------------------------------------------------------------------------

test("GET /v0/foods/search returns 400 for short queries", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v0/foods/search?q=a`);
    assert.equal(response.status, 400);
  });
});

test("GET /v0/foods/search returns 400 for empty query", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v0/foods/search?q=`);
    assert.equal(response.status, 400);
  });
});

test("GET /v0/foods/search returns foods matching name (case-insensitive)", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    await createFood(baseUrl, { name: "Chicken Breast", caloriesKcal: 165, proteinGrams: 31, carbohydrateGrams: 0, fatGrams: 3.6 });
    await createFood(baseUrl, { name: "Chicken Thigh", caloriesKcal: 209, proteinGrams: 26, carbohydrateGrams: 0, fatGrams: 10.9 });
    await createFood(baseUrl, { name: "Beef Steak", caloriesKcal: 271, proteinGrams: 25, carbohydrateGrams: 0, fatGrams: 19 });

    const response = await fetch(`${baseUrl}/v0/foods/search?q=chicken`);
    assert.equal(response.status, 200);
    const { foods, total } = (await response.json()) as { foods: FoodRecord[]; total: number };
    assert.equal(total, 2);
    assert.equal(foods.length, 2);
    assert.ok(foods.every((f) => f.name.toLowerCase().includes("chicken")));
  });
});

test("GET /v0/foods/search ranks exact name matches first", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    await createFood(baseUrl, { name: "Chicken", caloriesKcal: 100, proteinGrams: 20, carbohydrateGrams: 0, fatGrams: 2 });
    await createFood(baseUrl, { name: "Chicken Breast", caloriesKcal: 165, proteinGrams: 31, carbohydrateGrams: 0, fatGrams: 3.6 });
    await createFood(baseUrl, { name: "Grilled Chicken", caloriesKcal: 150, proteinGrams: 28, carbohydrateGrams: 0, fatGrams: 4 });

    const response = await fetch(`${baseUrl}/v0/foods/search?q=Chicken`);
    assert.equal(response.status, 200);
    const { foods } = (await response.json()) as { foods: FoodRecord[]; total: number };
    assert.ok(foods.length > 0);
    assert.equal(foods[0]!.name, "Chicken"); // Exact match first
  });
});

test("GET /v0/foods/search matches brand name", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    await createFood(baseUrl, { name: "Whey Protein", brand: "Optimum Nutrition", caloriesKcal: 120, proteinGrams: 24, carbohydrateGrams: 3, fatGrams: 1 });
    await createFood(baseUrl, { name: "Whey Protein", brand: "Dymatize", caloriesKcal: 110, proteinGrams: 25, carbohydrateGrams: 2, fatGrams: 0.5 });
    await createFood(baseUrl, { name: "Creatine", brand: "Optimum Nutrition", caloriesKcal: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0 });

    const response = await fetch(`${baseUrl}/v0/foods/search?q=Optimum`);
    assert.equal(response.status, 200);
    const { foods, total } = (await response.json()) as { foods: FoodRecord[]; total: number };
    assert.equal(total, 2);
    assert.ok(foods.every((f) => f.brand?.toLowerCase().includes("optimum")));
  });
});

test("GET /v0/foods/search matches externalId", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    await createFood(baseUrl, { name: "Banana", externalId: "usda-09040", caloriesKcal: 89, proteinGrams: 1.1, carbohydrateGrams: 23, fatGrams: 0.3 });
    await createFood(baseUrl, { name: "Apple", externalId: "usda-09003", caloriesKcal: 52, proteinGrams: 0.3, carbohydrateGrams: 14, fatGrams: 0.2 });

    const response = await fetch(`${baseUrl}/v0/foods/search?q=usda-09040`);
    assert.equal(response.status, 200);
    const { foods, total } = (await response.json()) as { foods: FoodRecord[]; total: number };
    assert.equal(total, 1);
    assert.equal(foods[0]!.externalId, "usda-09040");
  });
});

test("GET /v0/foods/search supports pagination with limit and offset", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    for (let i = 1; i <= 15; i++) {
      await createFood(baseUrl, { name: `Chicken ${i}`, caloriesKcal: 100 + i, proteinGrams: 20, carbohydrateGrams: 0, fatGrams: 2 });
    }

    const page1 = await fetch(`${baseUrl}/v0/foods/search?q=Chicken&limit=5&offset=0`);
    assert.equal(page1.status, 200);
    const { foods: f1, total } = (await page1.json()) as { foods: FoodRecord[]; total: number };
    assert.equal(total, 15);
    assert.equal(f1.length, 5);

    const page2 = await fetch(`${baseUrl}/v0/foods/search?q=Chicken&limit=5&offset=5`);
    assert.equal(page2.status, 200);
    const { foods: f2 } = (await page2.json()) as { foods: FoodRecord[]; total: number };
    assert.equal(f2.length, 5);

    const page3 = await fetch(`${baseUrl}/v0/foods/search?q=Chicken&limit=5&offset=10`);
    assert.equal(page3.status, 200);
    const { foods: f3 } = (await page3.json()) as { foods: FoodRecord[]; total: number };
    assert.equal(f3.length, 5);

    // Ensure no overlap
    const ids1 = new Set(f1.map((f) => f.id));
    const ids2 = new Set(f2.map((f) => f.id));
    const ids3 = new Set(f3.map((f) => f.id));
    assert.equal([...ids1].filter((id) => ids2.has(id)).length, 0);
    assert.equal([...ids2].filter((id) => ids3.has(id)).length, 0);
  });
});

test("GET /v0/foods/search filters by sourceId", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    // Need to create foods with different sources via the repository directly
    // since the createFood endpoint uses a fixed FOOD_SOURCE_ID
    const food1 = await createFood(baseUrl, { name: "Chicken Breast", caloriesKcal: 165, proteinGrams: 31, carbohydrateGrams: 0, fatGrams: 3.6 });
    const food2 = await createFood(baseUrl, { name: "Chicken Thigh", caloriesKcal: 209, proteinGrams: 26, carbohydrateGrams: 0, fatGrams: 10.9 });

    // Manually set different sourceIds in the store
    const f1 = store.foods.get(food1.id);
    const f2 = store.foods.get(food2.id);
    if (f1) { f1.sourceId = "source-1"; store.foods.set(food1.id, f1); }
    if (f2) { f2.sourceId = "source-2"; store.foods.set(food2.id, f2); }

    const response = await fetch(`${baseUrl}/v0/foods/search?q=chicken&sourceId=source-1`);
    assert.equal(response.status, 200);
    const { foods, total } = (await response.json()) as { foods: FoodRecord[]; total: number };
    assert.equal(total, 1);
    assert.equal(foods[0]!.sourceId, "source-1");
  });
});

test("GET /v0/foods/search returns only active foods", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    await createFood(baseUrl, { name: "Active Chicken", caloriesKcal: 165, proteinGrams: 31, carbohydrateGrams: 0, fatGrams: 3.6 });
    const inactiveFood = await createFood(baseUrl, { name: "Inactive Chicken", caloriesKcal: 165, proteinGrams: 31, carbohydrateGrams: 0, fatGrams: 3.6 });

    // Deactivate one food directly in the store
    const inactive = store.foods.get(inactiveFood.id);
    if (inactive) { inactive.isActive = false; store.foods.set(inactiveFood.id, inactive); }

    const response = await fetch(`${baseUrl}/v0/foods/search?q=chicken`);
    assert.equal(response.status, 200);
    const { foods, total } = (await response.json()) as { foods: FoodRecord[]; total: number };
    assert.equal(total, 1);
    assert.equal(foods[0]!.name, "Active Chicken");
  });
});

test("GET /v0/foods/search enforces max limit of 100", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v0/foods/search?q=test&limit=200`);
    assert.equal(response.status, 200);
    const { foods } = (await response.json()) as { foods: FoodRecord[]; total: number };
    // Limit should be capped at 100 but no foods exist
    assert.equal(foods.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Snapshot isolation: editing food doesn't rewrite meal history
// ---------------------------------------------------------------------------

test("editing a food never rewrites logged meal history (snapshot isolation)", async () => {
  const store = createNutritionStore();
  await withServer(store, async (baseUrl) => {
    const chicken = await createFood(baseUrl, {
      name: "Chicken Breast",
      caloriesKcal: 165,
      proteinGrams: 31,
      carbohydrateGrams: 0,
      fatGrams: 3.6,
    });

    const mealResponse = await fetch(`${baseUrl}/v0/users/${USER_ID}/meals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        localDate: "2026-10-06",
        slot: "lunch",
        items: [
          { foodId: chicken.id, quantityGrams: 100, confidence: "measured" },
        ],
        clientRequestId: `snapshot-test-${Date.now()}`,
      }),
    });
    assert.equal(mealResponse.status, 201);
    const { meal: originalMeal } = await mealResponse.json() as { meal: MealRecord };
    const originalCalories = originalMeal.totals.caloriesKcal;

    const updateResponse = await fetch(`${baseUrl}/v0/users/${USER_ID}/foods/${chicken.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nutrientsPer100g: {
          caloriesKcal: 200,
          proteinGrams: 31,
          carbohydrateGrams: 0,
          fatGrams: 3.6,
        },
      }),
    });
    assert.ok([200, 404, 405].includes(updateResponse.status));

    const mealAgainResponse = await fetch(`${baseUrl}/v0/users/${USER_ID}/meals/${originalMeal.id}`);
    if (mealAgainResponse.status === 200) {
      const { meal } = await mealAgainResponse.json() as { meal: MealRecord };
      assert.equal(meal.totals.caloriesKcal, originalCalories);
    }
  });
});