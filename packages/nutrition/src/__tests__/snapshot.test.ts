import assert from "node:assert/strict";
import { test } from "node:test";
import type { NutrientAmounts } from "@fitcoach/domain";
import {
  divideNutrientAmounts,
  emptyNutrientAmounts,
  scaleNutrientDensity,
  sumNutrientAmounts,
} from "../snapshot";

const OATS: NutrientAmounts = {
  caloriesKcal: 379,
  proteinGrams: 13.2,
  carbohydrateGrams: 67.7,
  fatGrams: 6.5,
  fiberGrams: 10.1,
};

function closeTo(actual: number | undefined, expected: number, label: string): void {
  assert.ok(actual !== undefined, `${label}: expected a value`);
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${label}: expected ~${expected}, got ${actual}`,
  );
}

test("scaleNutrientDensity scales per-100g density to a consumed quantity", () => {
  const snapshot = scaleNutrientDensity(OATS, 80);
  closeTo(snapshot.caloriesKcal, 303.2, "calories 80g");
  closeTo(snapshot.proteinGrams, 10.56, "protein 80g");
  closeTo(snapshot.carbohydrateGrams, 54.16, "carbs 80g");
  closeTo(snapshot.fatGrams, 5.2, "fat 80g");
  closeTo(snapshot.fiberGrams, 8.08, "fiber 80g");

  const double = scaleNutrientDensity(OATS, 200);
  closeTo(double.caloriesKcal, 758, "calories 200g");
  closeTo(double.proteinGrams, 26.4, "protein 200g");
});

test("scaleNutrientDensity preserves absence of optional nutrients", () => {
  const plain: NutrientAmounts = {
    caloriesKcal: 100,
    proteinGrams: 10,
    carbohydrateGrams: 5,
    fatGrams: 1,
  };
  const scaled = scaleNutrientDensity(plain, 50);
  assert.equal(scaled.fiberGrams, undefined);
  assert.equal(scaled.sugarsGrams, undefined);
  assert.equal(scaled.alcoholGrams, undefined);
});

test("scaleNutrientDensity rejects invalid quantities", () => {
  assert.throws(() => scaleNutrientDensity(OATS, -1), RangeError);
  assert.throws(() => scaleNutrientDensity(OATS, Number.NaN), RangeError);
  assert.throws(() => scaleNutrientDensity(OATS, Number.POSITIVE_INFINITY), RangeError);
  const zero = scaleNutrientDensity(OATS, 0);
  assert.equal(zero.caloriesKcal, 0);
});

test("sumNutrientAmounts sums meal totals across item snapshots", () => {
  const items = [
    scaleNutrientDensity(OATS, 80),
    { caloriesKcal: 165, proteinGrams: 31, carbohydrateGrams: 0, fatGrams: 3.6 },
    { caloriesKcal: 59, proteinGrams: 10, carbohydrateGrams: 3.6, fatGrams: 0.4 },
  ];
  const totals = sumNutrientAmounts(items);
  closeTo(totals.caloriesKcal, 303.2 + 165 + 59, "total calories");
  closeTo(totals.proteinGrams, 10.56 + 31 + 10, "total protein");
  closeTo(totals.carbohydrateGrams, 54.16 + 0 + 3.6, "total carbs");
  closeTo(totals.fatGrams, 5.2 + 3.6 + 0.4, "total fat");
  closeTo(totals.fiberGrams, 8.08, "fiber only from items that declare it");
});

test("sumNutrientAmounts over nothing is the empty snapshot", () => {
  assert.deepEqual(sumNutrientAmounts([]), emptyNutrientAmounts());
});

test("divideNutrientAmounts splits a recipe batch into servings", () => {
  const batch = sumNutrientAmounts([
    { caloriesKcal: 400, proteinGrams: 20, carbohydrateGrams: 40, fatGrams: 10 },
    { caloriesKcal: 200, proteinGrams: 10, carbohydrateGrams: 20, fatGrams: 5 },
  ]);
  const perServing = divideNutrientAmounts(batch, 3);
  closeTo(perServing.caloriesKcal, 200, "per-serving calories");
  closeTo(perServing.proteinGrams, 10, "per-serving protein");
  assert.throws(() => divideNutrientAmounts(batch, 0), RangeError);
  assert.throws(() => divideNutrientAmounts(batch, -2), RangeError);
});
