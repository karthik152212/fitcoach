import type { Meal, NutrientAmounts } from "@fitcoach/domain";
import { NotImplementedError } from "./errors";

/**
 * Sum a day's meals into daily totals. Input is retained meals (not the
 * stored snapshot) so totals can be recomputed and audited.
 */
export function computeDailyTotals(_meals: readonly Meal[]): NutrientAmounts {
  throw new NotImplementedError("nutrition.computeDailyTotals");
}
