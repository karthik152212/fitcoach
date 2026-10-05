import type { NutrientAmounts, CalendarDate, Timestamp } from "@fitcoach/domain";

/**
 * Row <-> domain translation helpers shared by every repository.
 *
 * Rules (docs/DATABASE_DESIGN.md §2):
 *   * timestamps are stored UTC and surfaced as ISO-8601 strings;
 *   * `date` columns are user-local calendar days (YYYY-MM-DD);
 *   * exact numeric columns become JS numbers at deterministic precision —
 *     rounding happens in the application, never silently in SQL.
 */

export function toTimestamp(value: Date): Timestamp {
  return value.toISOString();
}

export function toCalendarDate(value: Date): CalendarDate {
  const year = String(value.getUTCFullYear()).padStart(4, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Prisma Decimal (or anything stringifiable) → number, or undefined. */
export function decimalToNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

/** Prisma Decimal → number with 0 fallback (for NOT NULL snapshot columns). */
export function decimalToNumberOr0(value: unknown): number {
  return decimalToNumber(value) ?? 0;
}

const CALORIE_FACTOR = 100; // 2 decimals
const GRAM_FACTOR = 1000; // 3 decimals

function roundTo(value: number, factor: number): number {
  return Math.round(value * factor) / factor;
}

function roundOptional(value: number | undefined, factor: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) {
    throw new RangeError(`non-finite nutrient value: ${value}`);
  }
  return roundTo(value, factor);
}

/**
 * Deterministic rounding aligned with column precision: kcal → 2 decimals,
 * grams/mg → 3 decimals. Non-finite inputs are rejected loudly; nutrient
 * values are never allowed to drift into NaN.
 */
export interface RoundedNutrients {
  caloriesKcal: number;
  proteinGrams: number;
  carbohydrateGrams: number;
  fatGrams: number;
  fiberGrams?: number;
  sugarsGrams?: number;
  saturatedFatGrams?: number;
  sodiumMilligrams?: number;
  alcoholGrams?: number;
}

// V2 divergence D12 (docs/DATABASE_IMPLEMENTATION.md §9): NutrientAmounts
// gained V2 fields (cholesterol, mono/poly/trans fat, omega-3/6 and the
// `additionalNutrients` micronutrient bag) plus food preparation state, recipe
// yield and food-provenance tiers in the domain. Persistence for those is
// deliberately deferred to Phase 4 (nutrient_definitions + food_nutrient_values
// registry), so this mapping layer persists exactly the nutrients the Phase 1
// schema stores. Nothing can silently lose data today because no Phase 1
// writer accepts the new fields; the mapping functions gain the new columns in
// the same migration that adds the registry.

export function roundNutrients(amounts: NutrientAmounts): RoundedNutrients {
  if (!Number.isFinite(amounts.caloriesKcal)) {
    throw new RangeError(`non-finite calories: ${amounts.caloriesKcal}`);
  }
  return {
    caloriesKcal: roundTo(amounts.caloriesKcal, CALORIE_FACTOR),
    proteinGrams: roundTo(amounts.proteinGrams, GRAM_FACTOR),
    carbohydrateGrams: roundTo(amounts.carbohydrateGrams, GRAM_FACTOR),
    fatGrams: roundTo(amounts.fatGrams, GRAM_FACTOR),
    fiberGrams: roundOptional(amounts.fiberGrams, GRAM_FACTOR),
    sugarsGrams: roundOptional(amounts.sugarsGrams, GRAM_FACTOR),
    saturatedFatGrams: roundOptional(amounts.saturatedFatGrams, GRAM_FACTOR),
    sodiumMilligrams: roundOptional(amounts.sodiumMilligrams, GRAM_FACTOR),
    alcoholGrams: roundOptional(amounts.alcoholGrams, GRAM_FACTOR),
  };
}

export function emptyNutrients(): NutrientAmounts {
  return {
    caloriesKcal: 0,
    proteinGrams: 0,
    carbohydrateGrams: 0,
    fatGrams: 0,
  };
}

/** foods-table density columns (input side). */
export interface FoodNutrientColumns {
  caloriesKcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
  fiberG: number | null;
  sugarsG: number | null;
  saturatedFatG: number | null;
  alcoholG: number | null;
  sodiumMg: number | null;
}

export function foodNutrientsToColumns(nutrients: NutrientAmounts): FoodNutrientColumns {
  const r = roundNutrients(nutrients);
  return {
    caloriesKcal: r.caloriesKcal,
    proteinG: r.proteinGrams,
    carbohydrateG: r.carbohydrateGrams,
    fatG: r.fatGrams,
    fiberG: r.fiberGrams ?? null,
    sugarsG: r.sugarsGrams ?? null,
    saturatedFatG: r.saturatedFatGrams ?? null,
    alcoholG: r.alcoholGrams ?? null,
    sodiumMg: r.sodiumMilligrams ?? null,
  };
}

/** foods-table density columns (row side) → domain NutrientAmounts. */
export function foodNutrientsFromRow(row: {
  caloriesKcal: unknown;
  proteinG: unknown;
  carbohydrateG: unknown;
  fatG: unknown;
  fiberG: unknown;
  sugarsG: unknown;
  saturatedFatG: unknown;
  alcoholG: unknown;
  sodiumMg: unknown;
}): NutrientAmounts {
  return {
    caloriesKcal: decimalToNumberOr0(row.caloriesKcal),
    proteinGrams: decimalToNumberOr0(row.proteinG),
    carbohydrateGrams: decimalToNumberOr0(row.carbohydrateG),
    fatGrams: decimalToNumberOr0(row.fatG),
    fiberGrams: decimalToNumber(row.fiberG),
    sugarsGrams: decimalToNumber(row.sugarsG),
    saturatedFatGrams: decimalToNumber(row.saturatedFatG),
    alcoholGrams: decimalToNumber(row.alcoholG),
    sodiumMilligrams: decimalToNumber(row.sodiumMg),
  };
}

/** meal_items snapshot columns (input side). */
export interface ItemSnapshotColumns {
  caloriesKcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
  fiberG: number | null;
}

/** meals / daily_nutrition totals snapshot columns (input side). */
export interface TotalsSnapshotColumns {
  totalCaloriesKcal: number;
  totalProteinG: number;
  totalCarbohydrateG: number;
  totalFatG: number;
  totalFiberG: number | null;
}

export function itemSnapshotColumns(amounts: NutrientAmounts): ItemSnapshotColumns {
  const r = roundNutrients(amounts);
  return {
    caloriesKcal: r.caloriesKcal,
    proteinG: r.proteinGrams,
    carbohydrateG: r.carbohydrateGrams,
    fatG: r.fatGrams,
    fiberG: r.fiberGrams ?? null,
  };
}

export function totalsSnapshotColumns(amounts: NutrientAmounts): TotalsSnapshotColumns {
  const r = roundNutrients(amounts);
  return {
    totalCaloriesKcal: r.caloriesKcal,
    totalProteinG: r.proteinGrams,
    totalCarbohydrateG: r.carbohydrateGrams,
    totalFatG: r.fatGrams,
    totalFiberG: r.fiberGrams ?? null,
  };
}

/** meal_items snapshot columns (row side) → NutrientAmounts. */
export function itemSnapshotFromRow(row: {
  caloriesKcal: unknown;
  proteinG: unknown;
  carbohydrateG: unknown;
  fatG: unknown;
  fiberG: unknown;
}): NutrientAmounts {
  return {
    caloriesKcal: decimalToNumberOr0(row.caloriesKcal),
    proteinGrams: decimalToNumberOr0(row.proteinG),
    carbohydrateGrams: decimalToNumberOr0(row.carbohydrateG),
    fatGrams: decimalToNumberOr0(row.fatG),
    fiberGrams: decimalToNumber(row.fiberG),
  };
}

/** meals / daily_nutrition totals columns (row side) → NutrientAmounts. */
export function totalsSnapshotFromRow(row: {
  totalCaloriesKcal: unknown;
  totalProteinG: unknown;
  totalCarbohydrateG: unknown;
  totalFatG: unknown;
  totalFiberG: unknown;
}): NutrientAmounts {
  return {
    caloriesKcal: decimalToNumberOr0(row.totalCaloriesKcal),
    proteinGrams: decimalToNumberOr0(row.totalProteinG),
    carbohydrateGrams: decimalToNumberOr0(row.totalCarbohydrateG),
    fatGrams: decimalToNumberOr0(row.totalFatG),
    fiberGrams: decimalToNumber(row.totalFiberG),
  };
}
