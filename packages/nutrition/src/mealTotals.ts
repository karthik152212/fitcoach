import type { MealItem, NutrientAmounts } from "@fitcoach/domain";
import { sumNutrientAmounts } from "./snapshot";

/**
 * Sum logged meal items into meal totals. Uses the snapshotted
 * computedNutrients on each item so historical meals stay stable even when
 * underlying food data changes later.
 */
export function computeMealTotals(items: readonly MealItem[]): NutrientAmounts {
  if (items.length === 0) {
    return { caloriesKcal: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0 };
  }
  return sumNutrientAmounts(items.map((item) => item.computedNutrients));
}
