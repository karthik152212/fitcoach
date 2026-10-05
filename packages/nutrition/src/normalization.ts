import type { ConfidenceLevel, Food, FoodSourceKind, NutrientAmounts } from "@fitcoach/domain";
import { NotImplementedError } from "./errors";

/** Raw provider-shaped food data before normalization. */
export interface RawFoodInput {
  name: string;
  brand?: string;
  sourceKind: FoodSourceKind;
  confidence: ConfidenceLevel;
  /** The basis the provided nutrients are expressed in. */
  basis: "per_100g" | "per_100ml" | "per_serving";
  servingLabel?: string;
  servingGrams?: number;
  nutrients: Partial<NutrientAmounts>;
}

/**
 * Normalize arbitrary provider data into the canonical Food representation:
 * nutrient density per 100 g/ml plus explicit serving definitions.
 * Deterministic only — natural-language food parsing happens elsewhere.
 */
export function normalizeRawFood(_input: RawFoodInput): Food {
  throw new NotImplementedError("nutrition.normalizeRawFood");
}
