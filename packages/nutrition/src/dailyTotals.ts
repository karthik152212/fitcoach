import type { Meal, NutrientAmounts } from "@fitcoach/domain";
import { sumNutrientAmounts } from "./snapshot";

/**
 * Sum a day's meals into daily totals. Input is retained meals (not the
 * stored snapshot) so totals can be recomputed and audited.
 */
export function computeDailyTotals(meals: readonly Meal[]): NutrientAmounts {
  if (meals.length === 0) {
    return { caloriesKcal: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0 };
  }
  return sumNutrientAmounts(meals.map((meal) => meal.totals));
}
