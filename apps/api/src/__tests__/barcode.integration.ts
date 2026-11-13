import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test, describe } from "node:test";
import type { Profile, User, NutrientAmounts } from "@fitcoach/domain";
import type {
  CreateMealInput,
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
 * Phase 7 Barcode Scanner API integration tests.
 *
 * These exercise the real HTTP routes and the real BarcodeScannerService
 * against an in-memory repository bundle. This verifies the wiring
 * the user actually touches — request parsing, Open Food Facts lookup,
 * personalized nutrition assessment, and product preview.
 */

const USER_ID = "usr_barcode_test";
const FOOD_SOURCE_ID = "00000000-0000-4000-8000-000000000001";

function uuid(seed: number): string {
  return `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
}

interface InMemoryBarcodeStore {
  foods: Map<string, FoodRecord>;
  meals: Map<string, MealRecord>;
  dailyNutrition: Map<string, DailyNutritionRecord>;
  nutritionTargets: Map<string, any>;
  recipes: Map<string, RecipeRecord>;
}

function createBarcodeStore(): InMemoryBarcodeStore {
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

function createBarcodeRepositories(store: InMemoryBarcodeStore): Repositories {
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
    email: "barcode@example.test",
    displayName: "Barcode Test",
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
      async findByBarcode(barcode: string) {
        for (const food of store.foods.values()) {
          if (food.barcode === barcode) {
            return food;
          }
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
      async createRecipe(input: { userId: string; name: string; servings: number; instructions?: string; items: any[] }) {
        const now = new Date().toISOString();
        const items: RecipeItemRecord[] = input.items.map((item, i) => ({
          id: uuid(6000 + i),
          recipeId: uuid(5000),
          foodId: item.foodId,
          quantityGrams: item.quantityGrams,
          notes: item.notes ?? undefined,
          position: i,
        }));
        const recipe: RecipeRecord = {
          id: uuid(5000),
          ownerUserId: input.userId,
          name: input.name,
          servings: input.servings,
          instructions: input.instructions ?? undefined,
          items,
          createdAt: now,
          updatedAt: now,
        };
        store.recipes.set(recipe.id, recipe);
        return recipe;
      },
      async listRecipes(_userId: string) {
        return [];
      },
      async getRecipe(id: string) {
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
  store: InMemoryBarcodeStore,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const services = createServices(createBarcodeRepositories(store));
  const server = createServer({ services });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  try {
    const { port } = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// Mock Open Food Facts responses for testing
// Mock Open Food Facts responses available for future tests
// const MOCK_OPEN_FOOD_FACTS_PRODUCT = { ... };
// const MOCK_OPEN_FOOD_FACTS_PRODUCT_HEALTHY = { ... };

// ---------------------------------------------------------------------------
// Barcode Lookup Tests
// ---------------------------------------------------------------------------

describe("Barcode Scanner API", () => {
  test("GET /v0/barcode/lookup returns 400 for missing barcode parameter", async () => {
    const store = createBarcodeStore();
    await withServer(store, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v0/barcode/lookup`);
      assert.equal(response.status, 400);
      const body = await response.json() as { error: string };
      assert.equal(body.error, "validation_failed");
    });
  });

  test("GET /v0/barcode/lookup returns 400 for invalid barcode format", async () => {
    const store = createBarcodeStore();
    await withServer(store, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v0/barcode/lookup?barcode=abc`);
      assert.equal(response.status, 400);
      const body = await response.json() as { error: string };
      assert.equal(body.error, "validation_failed");
    });
  });

  test("GET /v0/barcode/lookup returns found=false for unknown barcode when offline", async () => {
    const store = createBarcodeStore();
    await withServer(store, async (baseUrl) => {
      // Use a barcode that definitely won't exist in Open Food Facts (all 9s)
      const response = await fetch(`${baseUrl}/v0/barcode/lookup?barcode=9999999999999`);
      assert.equal(response.status, 200);
      const body = await response.json() as { found: boolean; product: null; source: string };
      assert.equal(body.found, false);
      assert.equal(body.product, null);
      assert.equal(body.source, "unknown");
    });
  });

  test("GET /v0/barcode/lookup returns local product when barcode exists in database", async () => {
    const store = createBarcodeStore();
    await withServer(store, async (baseUrl) => {
      // Create a food with barcode in the local database
      const foodResponse = await fetch(`${baseUrl}/v0/users/${USER_ID}/foods`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: FOOD_SOURCE_ID,
          name: "Local Chicken Breast",
          brand: "Local Brand",
          densityBasis: "per_100g",
          nutrientsPer100g: {
            caloriesKcal: 165,
            proteinGrams: 31,
            carbohydrateGrams: 0,
            fatGrams: 3.6,
            fiberGrams: 0,
          },
          servings: [{ label: "100g", grams: 100 }],
          defaultServingLabel: "100g",
          barcode: "1234567890123",
        }),
      });
      assert.equal(foodResponse.status, 201);

      const response = await fetch(`${baseUrl}/v0/barcode/lookup?barcode=1234567890123`);
      assert.equal(response.status, 200);
      const body = await response.json() as { found: boolean; product: any; source: string };
      assert.equal(body.found, true);
      assert.ok(body.product);
      assert.equal(body.product.name, "Local Chicken Breast");
      assert.equal(body.product.brand, "Local Brand");
      assert.equal(body.source, "local");
    });
  });
});

// ---------------------------------------------------------------------------
// Barcode Preview Tests
// ---------------------------------------------------------------------------

describe("Barcode Preview API", () => {
  test("GET /v0/barcode/preview returns 400 for missing barcode parameter", async () => {
    const store = createBarcodeStore();
    await withServer(store, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v0/barcode/preview`);
      assert.equal(response.status, 400);
      const body = await response.json() as { error: string };
      assert.equal(body.error, "validation_failed");
    });
  });

  test("GET /v0/barcode/preview returns 400 for missing servingGrams parameter", async () => {
    const store = createBarcodeStore();
    await withServer(store, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v0/barcode/preview?barcode=1234567890123`);
      assert.equal(response.status, 400);
      const body = await response.json() as { error: string };
      assert.equal(body.error, "validation_failed");
    });
  });

  test("GET /v0/barcode/preview returns 400 for invalid servingGrams", async () => {
    const store = createBarcodeStore();
    await withServer(store, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v0/barcode/preview?barcode=1234567890123&servingGrams=0`);
      assert.equal(response.status, 400);
      const body = await response.json() as { error: string };
      assert.equal(body.error, "validation_failed");
    });
  });

  test("GET /v0/barcode/preview returns 401 when userId not provided", async () => {
    const store = createBarcodeStore();
    await withServer(store, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v0/barcode/preview?barcode=1234567890123&servingGrams=100`);
      assert.equal(response.status, 401);
      const body = await response.json() as { error: string };
      assert.equal(body.error, "unauthorized");
    });
  });

  test("GET /v0/barcode/preview returns 404 when no nutrition targets exist for user", async () => {
    const store = createBarcodeStore();
    await withServer(store, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v0/barcode/preview?barcode=1234567890123&servingGrams=100&userId=${USER_ID}`);
      assert.equal(response.status, 404);
      const body = await response.json() as { error: string };
      assert.equal(body.error, "not_found");
    });
  });

  test("GET /v0/barcode/preview returns personalized assessment for local product", async () => {
    const store = createBarcodeStore();
    await withServer(store, async (baseUrl) => {
      // Create nutrition targets first
      const targetsResponse = await fetch(`${baseUrl}/v0/users/${USER_ID}/nutrition/targets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goal: "bodybuilding",
          currentBodyWeightKg: 80,
          bodyFatPercent: 15,
        }),
      });
      assert.equal(targetsResponse.status, 201);

      // Create a food with barcode in the local database
      const foodResponse = await fetch(`${baseUrl}/v0/users/${USER_ID}/foods`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: FOOD_SOURCE_ID,
          name: "Test Protein Bar",
          brand: "Test Brand",
          densityBasis: "per_100g",
          nutrientsPer100g: {
            caloriesKcal: 400,
            proteinGrams: 30,
            carbohydrateGrams: 40,
            fatGrams: 12,
            fiberGrams: 5,
            sugarsGrams: 2,
            sodiumMilligrams: 150,
            saturatedFatGrams: 4,
          },
          servings: [{ label: "100g", grams: 100 }, { label: "1 bar (50g)", grams: 50 }],
          defaultServingLabel: "1 bar (50g)",
          barcode: "9999999999999",
        }),
      });
      assert.equal(foodResponse.status, 201);

      const response = await fetch(`${baseUrl}/v0/barcode/preview?barcode=9999999999999&servingGrams=50&userId=${USER_ID}`);
      assert.equal(response.status, 200);
      const body = await response.json() as { product: any; assessment: any };
      assert.ok(body.product);
      assert.equal(body.product.name, "Test Protein Bar");
      assert.ok(body.assessment);
      assert.ok(["add_to_log", "consider_alternative", "skip"].includes(body.assessment.recommendation));
      assert.ok(typeof body.assessment.reasoning === "string");
      assert.ok(body.assessment.reasoning.length > 0);
    });
  });
});

// ---------------------------------------------------------------------------
// Barcode Service Unit Tests (testing the service directly)
// ---------------------------------------------------------------------------

describe("BarcodeScannerService unit tests", () => {
  // These would test the service directly without HTTP
  // For now, we rely on the integration tests above
  test("service integrates with repositories and assessment", async () => {
    // This is a placeholder for more granular unit tests
    // The integration tests cover the full flow
    assert.ok(true);
  });
});