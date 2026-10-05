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
 *
 * V2: the arithmetic is keyed off the nutrient set, not a hand-written list of
 * nine fields, so fat detail (mono/poly/trans/omega) and micronutrients added
 * later flow through scale/sum/divide without rewriting this module
 * (PRODUCT_SPEC V2 §Nutrition: "micronutrients must be addable without
 * redesigning the meal/food system"). Absence is preserved end to end: an
 * undeclared nutrient stays undefined rather than becoming 0, because a missing
 * nutrient is unknown, not zero.
 */

/** Nutrients every food, meal and day is guaranteed to carry. */
const REQUIRED_KEYS = [
  "caloriesKcal",
  "proteinGrams",
  "carbohydrateGrams",
  "fatGrams",
] as const;

/** Nutrients that may or may not be known for a given food. */
const OPTIONAL_KEYS = [
  "fiberGrams",
  "sugarsGrams",
  "sodiumMilligrams",
  "alcoholGrams",
  "cholesterolMilligrams",
  "saturatedFatGrams",
  "monounsaturatedFatGrams",
  "polyunsaturatedFatGrams",
  "transFatGrams",
  "omega3Grams",
  "omega6Grams",
] as const;

type AmountKey = (typeof REQUIRED_KEYS)[number] | (typeof OPTIONAL_KEYS)[number];

type AmountView = Partial<Record<AmountKey, number>> & {
  additionalNutrients?: Readonly<Record<string, number>>;
};

function view(amounts: NutrientAmounts): AmountView {
  return amounts;
}

function requiredValue(amounts: AmountView, key: (typeof REQUIRED_KEYS)[number]): number {
  return amounts[key] ?? 0;
}

function optionalValue(amounts: AmountView, key: (typeof OPTIONAL_KEYS)[number]): number | undefined {
  return amounts[key];
}

function scaleRecord(
  values: Readonly<Record<string, number>>,
  factor: number,
): Readonly<Record<string, number>> {
  const scaled: Record<string, number> = {};
  for (const [key, value] of Object.entries(values)) {
    scaled[key] = value * factor;
  }
  return scaled;
}

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
  const density = view(densityPer100);
  const result: AmountView = {};

  for (const key of REQUIRED_KEYS) {
    result[key] = requiredValue(density, key) * factor;
  }
  for (const key of OPTIONAL_KEYS) {
    const value = optionalValue(density, key);
    if (value !== undefined) result[key] = value * factor;
  }
  if (densityPer100.additionalNutrients !== undefined) {
    result.additionalNutrients = scaleRecord(densityPer100.additionalNutrients, factor);
  }

  return result as NutrientAmounts;
}

/** Sum nutrient amounts (meal totals = Σ item snapshots). */
export function sumNutrientAmounts(items: readonly NutrientAmounts[]): NutrientAmounts {
  const total: AmountView = {
    caloriesKcal: 0,
    proteinGrams: 0,
    carbohydrateGrams: 0,
    fatGrams: 0,
  };
  const definedOptional = new Set<string>();
  const additional: Record<string, number> = {};

  for (const item of items) {
    const amounts = view(item);
    for (const key of REQUIRED_KEYS) {
      total[key] = requiredValue(total, key) + requiredValue(amounts, key);
    }
    for (const key of OPTIONAL_KEYS) {
      const value = optionalValue(amounts, key);
      if (value === undefined) continue;
      definedOptional.add(key);
      total[key] = (total[key] ?? 0) + value;
    }
    for (const [key, value] of Object.entries(item.additionalNutrients ?? {})) {
      additional[key] = (additional[key] ?? 0) + value;
      definedOptional.add(`additional:${key}`);
    }
  }

  for (const key of OPTIONAL_KEYS) {
    if (!definedOptional.has(key)) delete total[key];
  }
  if (Object.keys(additional).length > 0) {
    total.additionalNutrients = additional;
  }

  return total as NutrientAmounts;
}

/** Divide all nutrients (recipe batch → per-serving values). */
export function divideNutrientAmounts(amounts: NutrientAmounts, divisor: number): NutrientAmounts {
  if (!Number.isFinite(divisor) || divisor <= 0) {
    throw new RangeError(`divisor must be a finite positive number, got ${divisor}`);
  }
  const source = view(amounts);
  const result: AmountView = {};

  for (const key of REQUIRED_KEYS) {
    result[key] = requiredValue(source, key) / divisor;
  }
  for (const key of OPTIONAL_KEYS) {
    const value = optionalValue(source, key);
    if (value !== undefined) result[key] = value / divisor;
  }
  if (amounts.additionalNutrients !== undefined) {
    const scaled: Record<string, number> = {};
    for (const [key, value] of Object.entries(amounts.additionalNutrients)) {
      scaled[key] = value / divisor;
    }
    result.additionalNutrients = scaled;
  }

  return result as NutrientAmounts;
}