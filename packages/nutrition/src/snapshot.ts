import type { NutrientAmounts } from "@fitcoach/domain";

/**
 * Deterministic nutrient arithmetic for write-time snapshots.
 *
 * When a meal is logged, the nutrients actually used at that moment are
 * computed here and frozen into the stored rows (docs/DATABASE_DESIGN.md §8).
 * Later edits to the food database can never change a logged meal — the old
 * meal re-reads its own snapshot, not the food.
 *
 * Pure functions only: no clock, no I/O, no rounding policy of their own
 * (column-precision rounding happens where the values are persisted).
 */

export function emptyNutrientAmounts(): NutrientAmounts {
  return {
    caloriesKcal: 0,
    proteinGrams: 0,
    carbohydrateGrams: 0,
    fatGrams: 0,
  };
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative number, got ${value}`);
  }
}

/**
 * Scale a per-100 g/ml nutrient density to a consumed quantity.
 * Example: oats at 379 kcal/100 g × 80 g → 303.2 kcal.
 */
export function scaleNutrientDensity(
  densityPer100: NutrientAmounts,
  quantityGramsOrMl: number,
): NutrientAmounts {
  assertFiniteNonNegative(quantityGramsOrMl, "quantity");
  const factor = quantityGramsOrMl / 100;
  return {
    caloriesKcal: densityPer100.caloriesKcal * factor,
    proteinGrams: densityPer100.proteinGrams * factor,
    carbohydrateGrams: densityPer100.carbohydrateGrams * factor,
    fatGrams: densityPer100.fatGrams * factor,
    fiberGrams: densityPer100.fiberGrams === undefined ? undefined : densityPer100.fiberGrams * factor,
    sugarsGrams: densityPer100.sugarsGrams === undefined ? undefined : densityPer100.sugarsGrams * factor,
    saturatedFatGrams:
      densityPer100.saturatedFatGrams === undefined
        ? undefined
        : densityPer100.saturatedFatGrams * factor,
    sodiumMilligrams:
      densityPer100.sodiumMilligrams === undefined
        ? undefined
        : densityPer100.sodiumMilligrams * factor,
    alcoholGrams: densityPer100.alcoholGrams === undefined ? undefined : densityPer100.alcoholGrams * factor,
  };
}

/** Sum nutrient amounts (meal totals = Σ item snapshots). */
export function sumNutrientAmounts(items: readonly NutrientAmounts[]): NutrientAmounts {
  const total = emptyNutrientAmounts();
  let hasFiber = false;
  let fiber = 0;
  for (const item of items) {
    total.caloriesKcal += item.caloriesKcal;
    total.proteinGrams += item.proteinGrams;
    total.carbohydrateGrams += item.carbohydrateGrams;
    total.fatGrams += item.fatGrams;
    if (item.fiberGrams !== undefined) {
      hasFiber = true;
      fiber += item.fiberGrams;
    }
  }
  if (hasFiber) total.fiberGrams = fiber;
  return total;
}

/** Divide all nutrients (recipe batch → per-serving values). */
export function divideNutrientAmounts(amounts: NutrientAmounts, divisor: number): NutrientAmounts {
  if (!Number.isFinite(divisor) || divisor <= 0) {
    throw new RangeError(`divisor must be a finite positive number, got ${divisor}`);
  }
  const scale = (value: number | undefined): number | undefined =>
    value === undefined ? undefined : value / divisor;
  return {
    caloriesKcal: amounts.caloriesKcal / divisor,
    proteinGrams: amounts.proteinGrams / divisor,
    carbohydrateGrams: amounts.carbohydrateGrams / divisor,
    fatGrams: amounts.fatGrams / divisor,
    fiberGrams: scale(amounts.fiberGrams),
    sugarsGrams: scale(amounts.sugarsGrams),
    saturatedFatGrams: scale(amounts.saturatedFatGrams),
    sodiumMilligrams: scale(amounts.sodiumMilligrams),
    alcoholGrams: scale(amounts.alcoholGrams),
  };
}
