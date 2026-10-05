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
import { NotImplementedError } from "../errors";
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
  return { id: "usr_test", createdAt: NOW, updatedAt: NOW, timezone: "UTC", profile: {} };
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

test("every nutrition module is an explicit stub", async (t) => {
  const food = minimalFood();

  await t.test("nutrition.normalizeRawFood throws", () => {
    assert.throws(
      () =>
        normalizeRawFood({
          name: "Oats",
          sourceKind: "curated_database",
          confidence: "measured",
          basis: "per_100g",
          nutrients: { caloriesKcal: 379 },
        }),
      NotImplementedError,
    );
  });

  await t.test("nutrition.resolveQuantityInGrams throws", () => {
    assert.throws(
      () => resolveQuantityInGrams(food, { servingId: "srv_40g", numberOfServings: 2 }),
      NotImplementedError,
    );
  });

  await t.test("nutrition.computeMealTotals throws", () => {
    assert.throws(() => computeMealTotals([minimalMealItem("label_declared")]), NotImplementedError);
  });

  await t.test("nutrition.computeDailyTotals throws", () => {
    assert.throws(() => computeDailyTotals([minimalMeal([minimalMealItem("estimated")])]), NotImplementedError);
  });

  await t.test("nutrition.deriveNutritionTargets throws", () => {
    assert.throws(
      () => deriveNutritionTargets({ user: minimalUser(), goal: minimalGoal() }),
      NotImplementedError,
    );
  });

  await t.test("nutrition.analyzeNutritionTrend throws", () => {
    assert.throws(() => analyzeNutritionTrend([], 14), NotImplementedError);
  });
});
