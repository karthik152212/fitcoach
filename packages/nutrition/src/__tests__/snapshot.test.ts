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

// --- V2 nutrient coverage (fat detail, micronutrients, absence semantics) ---

const CURRY: NutrientAmounts = {
  caloriesKcal: 145,
  proteinGrams: 18,
  carbohydrateGrams: 6.2,
  fatGrams: 6.1,
  fiberGrams: 1.4,
  saturatedFatGrams: 2.1,
  monounsaturatedFatGrams: 2.6,
  polyunsaturatedFatGrams: 1.1,
  sodiumMilligrams: 410,
  additionalNutrients: { iron_mg: 1.6, vitamin_d_mcg: 0.4 },
};

test("scaleNutrientDensity scales V2 fat detail and micronutrients", () => {
  const scaled = scaleNutrientDensity(CURRY, 240);
  closeTo(scaled.saturatedFatGrams, 2.1 * 2.4, "saturated fat");
  closeTo(scaled.monounsaturatedFatGrams, 2.6 * 2.4, "monounsaturated fat");
  closeTo(scaled.polyunsaturatedFatGrams, 1.1 * 2.4, "polyunsaturated fat");
  closeTo(scaled.sodiumMilligrams, 410 * 2.4, "sodium");
  closeTo(scaled.additionalNutrients?.["iron_mg"] ?? 0, 1.6 * 2.4, "iron");
  closeTo(scaled.additionalNutrients?.["vitamin_d_mcg"] ?? 0, 0.4 * 2.4, "vitamin D");
});

test("sparse nutrient data stays absent instead of becoming zero", () => {
  // A source that publishes no trans fat and no omegas must not have zeros
  // invented for it (PRODUCT_SPEC V2 §Scientific honesty).
  const sparse: NutrientAmounts = {
    caloriesKcal: 120,
    proteinGrams: 22,
    carbohydrateGrams: 1,
    fatGrams: 3,
  };
  const scaled = scaleNutrientDensity(sparse, 100);
  assert.equal(scaled.transFatGrams, undefined);
  assert.equal(scaled.omega3Grams, undefined);
  assert.equal(scaled.omega6Grams, undefined);
  assert.equal(scaled.cholesterolMilligrams, undefined);
  assert.equal(scaled.additionalNutrients, undefined);
  // CURRY declares trans-fat-free data nowhere: scaling it must not invent it.
  assert.equal(scaleNutrientDensity(CURRY, 100).transFatGrams, undefined);
});

test("sumNutrientAmounts keeps absent nutrients absent and merges micronutrients", () => {
  const totals = sumNutrientAmounts([
    scaleNutrientDensity(CURRY, 100),
    { caloriesKcal: 165, proteinGrams: 31, carbohydrateGrams: 0, fatGrams: 3.6 },
  ]);
  closeTo(totals.saturatedFatGrams, 2.1, "saturated fat only from items that declare it");
  closeTo(totals.monounsaturatedFatGrams, 2.6, "monounsaturated fat from the declaring item");
  closeTo(totals.polyunsaturatedFatGrams, 1.1, "polyunsaturated fat from the declaring item");
  assert.equal(totals.transFatGrams, undefined);
  assert.equal(totals.cholesterolMilligrams, undefined);
  closeTo(totals.additionalNutrients?.["iron_mg"] ?? 0, 1.6, "iron from the single declaring item");

  const twoSources = sumNutrientAmounts([
    { ...CURRY, additionalNutrients: { iron_mg: 1 } },
    { ...CURRY, additionalNutrients: { iron_mg: 2, zinc_mg: 3 } },
  ]);
  closeTo(twoSources.additionalNutrients?.["iron_mg"] ?? 0, 3, "iron summed across items");
  closeTo(twoSources.additionalNutrients?.["zinc_mg"] ?? 0, 3, "zinc from one item only");
});

test("divideNutrientAmounts splits V2 nutrients into per-gram/per-serving values", () => {
  const batch = scaleNutrientDensity(CURRY, 500);
  // 500 g batch = 725 kcal; per gram that is 1.45 kcal (145 kcal per 100 g).
  const perGram = divideNutrientAmounts(batch, 500);
  closeTo(perGram.caloriesKcal, 1.45, "per-gram calories");
  closeTo(perGram.polyunsaturatedFatGrams, 0.011, "per-gram polyunsaturated fat");
  closeTo(perGram.additionalNutrients?.["iron_mg"] ?? 0, 0.016, "per-gram iron");
  closeTo(perGram.additionalNutrients?.["vitamin_d_mcg"] ?? 0, 0.004, "per-gram vitamin D");
  // Micronutrients nobody declared stay absent rather than becoming 0.
  assert.equal(perGram.additionalNutrients?.["zinc_mg"], undefined);
});
