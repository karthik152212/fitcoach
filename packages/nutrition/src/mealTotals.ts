import type { MealItem, NutrientAmounts } from "@fitcoach/domain";
import { NotImplementedError } from "./errors";

/**
 * Sum logged meal items into meal totals. Uses the snapshotted
 * computedNutrients on each item so historical meals stay stable even when
 * underlying food data changes later.
 */
export function computeMealTotals(_items: readonly MealItem[]): NutrientAmounts {
  throw new NotImplementedError("nutrition.computeMealTotals");
}
