import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ConfidenceLevel,
  Food,
  Goal,
  Meal,
  MealItem,
  User,
} from "@fitcoach/domain";
import { normalizeRawFood } from "../normalization";
import { resolveQuantityInGrams } from "../servingConversion";
import { computeMealTotals } from "../mealTotals";
import { computeDailyTotals } from "../dailyTotals";
import { deriveNutritionTargets } from "../targets";
import { analyzeNutritionTrend } from "../trends";

const NOW = "2026-08-25T00:00:00Z";

function minimalFood(): Food {
  return {
    id: "food_test",
    createdAt: NOW,
    updatedAt: NOW,
    name: "Oats",
    sourceId: "src_test",
    densityBasis: "per_100g",
    nutrientsPer100g: {
      caloriesKcal: 379,
      proteinGrams: 13.2,
      carbohydrateGrams: 67.7,
      fatGrams: 6.5,
      fiberGrams: 10.1,
    },
    servings: [{ id: "srv_40g", label: "40 g", grams: 40 }],
    defaultServingId: "srv_40g",
  };
}

function minimalMealItem(confidence: ConfidenceLevel): MealItem {
  return {
    id: "item_test",
    ref: { kind: "food", foodId: "food_test" },
    quantityGrams: 80,
    computedNutrients: {
      caloriesKcal: 303.2,
      proteinGrams: 10.56,
      carbohydrateGrams: 54.16,
      fatGrams: 5.2,
      fiberGrams: 8.08,
    },
    confidence,
  };
}

function minimalMeal(items: readonly MealItem[]): Meal {
  return {
    id: "meal_test",
    createdAt: NOW,
    updatedAt: NOW,
    userId: "usr_test",
    date: "2026-08-25",
    items,
    totals: items.reduce(
      (acc, item) => ({
        caloriesKcal: acc.caloriesKcal + item.computedNutrients.caloriesKcal,
        proteinGrams: acc.proteinGrams + item.computedNutrients.proteinGrams,
        carbohydrateGrams:
          acc.carbohydrateGrams + item.computedNutrients.carbohydrateGrams,
        fatGrams: acc.fatGrams + item.computedNutrients.fatGrams,
      }),
      { caloriesKcal: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0 },
    ),
  };
}

function minimalUser(): User {
  return {
    id: "usr_test",
    createdAt: NOW,
    updatedAt: NOW,
    timezone: "UTC",
    profile: {
      heightCm: 180,
      birthDate: "1990-01-01",
      sex: "male",
      trainingExperience: "intermediate",
      trainingDaysPerWeek: 4,
    },
  };
}

function minimalGoal(): Goal {
  return {
    id: "goal_test",
    createdAt: NOW,
    updatedAt: NOW,
    userId: "usr_test",
    kind: "lean_recomposition",
    priorities: ["fat_loss", "muscle_retention"],
    effectiveFrom: "2026-08-01",
  };
}

test("nutrition.normalizeRawFood validates required nutrients", () => {
  assert.throws(
    () =>
      normalizeRawFood({
        name: "Oats",
        sourceId: "src_test",
        sourceKind: "curated_database",
        confidence: "measured",
        basis: "per_100g",
        nutrients: { caloriesKcal: 379 },
      }),
    /Missing required nutrient: proteinGrams/,
  );
});

test("nutrition.normalizeRawFood creates Food from valid input", () => {
  const food = normalizeRawFood({
    name: "Oats",
    sourceId: "src_test",
    sourceKind: "curated_database",
    confidence: "measured",
    basis: "per_100g",
    servingLabel: "40 g",
    servingGrams: 40,
    nutrients: {
      caloriesKcal: 379,
      proteinGrams: 13.2,
      carbohydrateGrams: 67.7,
      fatGrams: 6.5,
    },
  });

  assert.equal(food.name, "Oats");
  assert.equal(food.densityBasis, "per_100g");
  assert.equal(food.nutrientsPer100g.caloriesKcal, 379);
  assert.equal(food.nutrientsPer100g.proteinGrams, 13.2);
  assert.equal(food.servings.length, 1);
  assert.equal(food.servings[0]?.label, "40 g");
  assert.equal(food.servings[0]?.grams, 40);
  assert.ok(food.defaultServingId);
});

test("nutrition.resolveQuantityInGrams resolves grams directly", () => {
  const food = minimalFood();
  const grams = resolveQuantityInGrams(food, { grams: 100 });
  assert.equal(grams, 100);
});

test("nutrition.resolveQuantityInGrams resolves default serving", () => {
  const food = minimalFood();
  const grams = resolveQuantityInGrams(food, { numberOfServings: 2 });
  assert.equal(grams, 80);
});

test("nutrition.resolveQuantityInGrams throws on invalid serving", () => {
  const food = minimalFood();
  assert.throws(
    () => resolveQuantityInGrams(food, { servingId: "invalid" }),
    /not found/,
  );
});

test("nutrition.resolveQuantityInGrams throws on count-based serving", () => {
  const food: Food = {
    ...minimalFood(),
    servings: [
      { id: "srv_egg", label: "1 large egg", unitQuantity: 1, unitName: "large egg" },
    ],
    defaultServingId: "srv_egg",
  };
  assert.throws(
    () => resolveQuantityInGrams(food, {}),
    /Cannot convert count-based serving/,
  );
});

test("nutrition.computeMealTotals sums item snapshots", () => {
  const items = [
    minimalMealItem("label_declared"),
    minimalMealItem("estimated"),
  ];
  const totals = computeMealTotals(items);
  assert.equal(totals.caloriesKcal, 606.4);
  assert.equal(totals.proteinGrams, 21.12);
  assert.equal(totals.carbohydrateGrams, 108.32);
  assert.equal(totals.fatGrams, 10.4);
  assert.equal(totals.fiberGrams, 16.16);
});

test("nutrition.computeMealTotals empty array returns zero", () => {
  const totals = computeMealTotals([]);
  assert.equal(totals.caloriesKcal, 0);
  assert.equal(totals.proteinGrams, 0);
  assert.equal(totals.carbohydrateGrams, 0);
  assert.equal(totals.fatGrams, 0);
});

test("nutrition.computeDailyTotals sums meal totals", () => {
  const meals = [
    minimalMeal([minimalMealItem("label_declared")]),
    minimalMeal([minimalMealItem("estimated")]),
  ];
  const totals = computeDailyTotals(meals);
  assert.equal(totals.caloriesKcal, 606.4);
  assert.equal(totals.proteinGrams, 21.12);
  assert.equal(totals.carbohydrateGrams, 108.32);
  assert.equal(totals.fatGrams, 10.4);
});

test("nutrition.computeDailyTotals empty array returns zero", () => {
  const totals = computeDailyTotals([]);
  assert.equal(totals.caloriesKcal, 0);
  assert.equal(totals.proteinGrams, 0);
  assert.equal(totals.carbohydrateGrams, 0);
  assert.equal(totals.fatGrams, 0);
});

test("nutrition.deriveNutritionTargets returns personalized targets", () => {
  const targets = deriveNutritionTargets({
    user: minimalUser(),
    goal: minimalGoal(),
    currentBodyWeightKg: 80,
    averageStepsLast14Days: 8000,
    weeklyCardioMinutes: 60,
  });

  assert.ok(targets.caloriesKcal > 0);
  assert.ok(targets.proteinGrams > 0);
  assert.ok(targets.carbohydrateGrams !== undefined);
  assert.ok(targets.fatGrams !== undefined);
  assert.ok(targets.fiberGrams !== undefined && targets.fiberGrams > 0);
  assert.ok(targets.basisNote);
  assert.ok(targets.effectiveFrom);
});

test("nutrition.deriveNutritionTargets throws on missing profile data", () => {
  const incompleteUser: User = {
    id: "usr_test",
    createdAt: NOW,
    updatedAt: NOW,
    timezone: "UTC",
    profile: {},
  };
  assert.throws(
    () => deriveNutritionTargets({ user: incompleteUser, goal: minimalGoal() }),
    /heightCm is required/,
  );
});

test("nutrition.analyzeNutritionTrend returns trends for each nutrient", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  const day1 = "2026-11-05";
  const day2 = "2026-11-06";
  const day3 = "2026-11-07";

  const daily = [
    {
      id: "dn_1",
      createdAt: NOW,
      updatedAt: NOW,
      userId: "usr_test",
      date: day1,
      mealIds: [],
      totals: { caloriesKcal: 2500, proteinGrams: 150, carbohydrateGrams: 250, fatGrams: 80, fiberGrams: 25 },
    },
    {
      id: "dn_2",
      createdAt: NOW,
      updatedAt: NOW,
      userId: "usr_test",
      date: day2,
      mealIds: [],
      totals: { caloriesKcal: 2400, proteinGrams: 160, carbohydrateGrams: 240, fatGrams: 75, fiberGrams: 28 },
    },
    {
      id: "dn_3",
      createdAt: NOW,
      updatedAt: NOW,
      userId: "usr_test",
      date: day3,
      mealIds: [],
      totals: { caloriesKcal: 2300, proteinGrams: 155, carbohydrateGrams: 230, fatGrams: 70, fiberGrams: 30 },
    },
  ];

  const report = analyzeNutritionTrend(daily, 7, { now });

  assert.ok(report.calories.direction);
  assert.ok(report.protein.direction);
  assert.ok(report.carbohydrates.direction);
  assert.ok(report.fat.direction);
  assert.ok(report.fiber);
  assert.equal(report.windowDays, 7);
});

test("nutrition.analyzeNutritionTrend handles insufficient data", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  const daily = [
    {
      id: "dn_1",
      createdAt: NOW,
      updatedAt: NOW,
      userId: "usr_test",
      date: "2026-11-07",
      mealIds: [],
      totals: { caloriesKcal: 2500, proteinGrams: 150, carbohydrateGrams: 250, fatGrams: 80 },
    },
  ];

  const report = analyzeNutritionTrend(daily, 7, { now });
  assert.equal(report.calories.direction, "insufficient_data");
  assert.equal(report.calories.pointsUsed, 1);
});