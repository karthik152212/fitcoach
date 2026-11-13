import { createServer } from "./apps/api/dist/server.js";
import { createServices } from "./apps/api/dist/services/index.js";

const USER_ID = "usr_nutrition_test";
const FOOD_SOURCE_ID = "00000000-0000-4000-8000-000000000001";

function uuid(seed) {
  return `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
}

function createNutritionStore() {
  return {
    foods: new Map(),
    meals: new Map(),
    dailyNutrition: new Map(),
    nutritionTargets: new Map(),
    recipes: new Map(),
  };
}

let foodCounter = 0;

function createNutritionRepositories(store) {
  const profile = {
    userId: USER_ID,
    birthDate: "1995-04-12",
    sex: "male",
    heightCm: 180,
    trainingExperience: "intermediate",
    trainingDaysPerWeek: 4,
    sessionDurationMinutes: 60,
    limitations: [],
    unitSystem: "metric",
  };

  const user = {
    id: USER_ID,
    email: "nutrition@example.test",
    displayName: "Nutrition Test",
    timezone: "UTC",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const foodSource = {
    id: FOOD_SOURCE_ID,
    name: "Test Source",
    kind: "curated_database",
    defaultConfidence: "measured",
    externalSourceId: null,
  };

  return {
    users: {
      async findById(id) {
        console.log(`[users.findById] id=${id}`);
        return id === USER_ID ? { ...user, timezone: "UTC" } : null;
      },
      async localToday(_userId) {
        return "2026-10-06";
      },
    },
    profiles: {
      async get(userId) {
        return userId === USER_ID ? profile : null;
      },
    },
    foodSources: {
      async get(id) {
        console.log(`[foodSources.get] id=${id}`);
        return id === FOOD_SOURCE_ID ? foodSource : null;
      },
    },
    foods: {
      async findSource(id) {
        console.log(`[foods.findSource] id=${id}`);
        return id === FOOD_SOURCE_ID ? foodSource : null;
      },
      async createFood(input) {
        console.log(`[foods.createFood] input=`, JSON.stringify(input, null, 2));
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
        const food = {
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
        console.log(`[foods.createFood] created food:`, food);
        store.foods.set(id, food);
        return food;
      },
      async findById(id) {
        console.log(`[foods.findById] id=${id}, store has ${store.foods.size} foods`);
        const food = store.foods.get(id) ?? null;
        console.log(`[foods.findById] returning:`, food ? "found" : "null");
        return food;
      },
      async findOrCreateUserSource(_userId) {
        return foodSource;
      },
      async updateNutrients(id, nutrients) {
        const food = store.foods.get(id);
        if (!food) throw new Error("Food not found");
        const updated = { ...food, nutrientsPer100g: { ...food.nutrientsPer100g, ...nutrients }, updatedAt: new Date().toISOString() };
        store.foods.set(id, updated);
        return updated;
      },
      async listUserFoods(_userId) {
        return [...store.foods.values()].filter((f) => f.sourceId === FOOD_SOURCE_ID);
      },
      async deactivate(_id) {
        return;
      },
      async createSource(_input) {
        return foodSource;
      },
    },
    meals: {
      async create(input) { return {}; },
      async addItem(mealId, item) { return {}; },
      async findById(id) { return null; },
      async listByDate(userId, localDate) { return []; },
    },
    nutrition: {
      async upsertDaily(input) { return {}; },
      async getDaily(userId, localDate) { return null; },
    },
    nutritionTargets: {
      async deriveAndStoreTargets(userId, goal, context) { return {}; },
      async getTargets(userId) { return null; },
    },
    nutritionAssessment: {
      async assessAdherence(userId, targets, windowDays) { return {}; },
    },
    recipes: {
      async createRecipe(input) { return {}; },
      async listRecipes(_userId) { return []; },
      async getRecipe(id) { return null; },
      async deactivate(_id) { return; },
      async computeRecipeNutrition(_recipeId, servings) { return {}; },
    },
  };
}

async function withServer(store, run) {
  const services = createServices(createNutritionRepositories(store));
  const server = createServer({ services });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  try {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

async function createFood(baseUrl, food) {
  const response = await fetch(`${baseUrl}/v0/users/${USER_ID}/foods`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceId: FOOD_SOURCE_ID,
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
    }),
  });
  console.log(`[createFood] response status: ${response.status}`);
  const body = await response.json();
  console.log(`[createFood] response body:`, JSON.stringify(body, null, 2));
  return body.food;
}

async function testGetFood(baseUrl, foodId) {
  console.log(`\n=== GET /v0/foods/${foodId} ===`);
  const response = await fetch(`${baseUrl}/v0/foods/${foodId}`);
  console.log(`[GET /v0/foods/:foodId] response status: ${response.status}`);
  const body = await response.json();
  console.log(`[GET /v0/foods/:foodId] response body:`, JSON.stringify(body, null, 2));
  return body;
}

const store = createNutritionStore();
await withServer(store, async (baseUrl) => {
  console.log("\n=== Creating food ===");
  const created = await createFood(baseUrl, {
    name: "Test Food",
    caloriesKcal: 100,
    proteinGrams: 20,
    carbohydrateGrams: 10,
    fatGrams: 3,
  });

  await testGetFood(baseUrl, created.id);
});