import type {
  ConfidenceLevel,
  Food,
  FoodSourceId,
  FoodSourceKind,
  NutrientAmounts,
  EntityId,
  ServingDefinition,
} from "@fitcoach/domain";
import { newUuidv7 } from "@fitcoach/db";

/** Raw provider-shaped food data before normalization. */
export interface RawFoodInput {
  name: string;
  brand?: string;
  sourceId: FoodSourceId;
  sourceKind: FoodSourceKind;
  confidence: ConfidenceLevel;
  /** The basis the provided nutrients are expressed in. */
  basis: "per_100g" | "per_100ml" | "per_serving";
  servingLabel?: string;
  servingGrams?: number;
  nutrients: Partial<NutrientAmounts>;
  /** Optional external identifier from the source dataset. */
  externalId?: string;
  /** Optional barcode. */
  barcode?: string;
  /** Optional preparation state. */
  preparationState?: Food["preparationState"];
  /** Optional preparation method. */
  preparationMethod?: string;
}

/**
 * Normalize arbitrary provider data into the canonical Food representation:
 * nutrient density per 100 g/ml plus explicit serving definitions.
 * Deterministic only — natural-language food parsing happens elsewhere.
 */
export function normalizeRawFood(input: RawFoodInput): Food {
  // Validate required nutrients
  const required: (keyof NutrientAmounts)[] = ["caloriesKcal", "proteinGrams", "carbohydrateGrams", "fatGrams"];
  for (const key of required) {
    const value = input.nutrients[key];
    if (value === undefined) {
      throw new RangeError(`Missing required nutrient: ${key}`);
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new RangeError(`Invalid value for ${key}: must be a finite non-negative number`);
    }
  }

  // Determine density basis
  let densityBasis: "per_100g" | "per_100ml" = "per_100g";
  let nutrientsPer100: NutrientAmounts;

  if (input.basis === "per_100g") {
    densityBasis = "per_100g";
    nutrientsPer100 = input.nutrients as NutrientAmounts;
  } else if (input.basis === "per_100ml") {
    densityBasis = "per_100ml";
    nutrientsPer100 = input.nutrients as NutrientAmounts;
  } else {
    // per_serving — need to convert to per_100g using servingGrams
    if (!input.servingGrams || input.servingGrams <= 0) {
      throw new RangeError('per_serving basis requires servingGrams > 0');
    }
    const factor = 100 / input.servingGrams;
    nutrientsPer100 = scaleRawNutrients(input.nutrients, factor);
    densityBasis = "per_100g"; // canonical basis is always per_100g or per_100ml
  }

  // Build servings
  const servings: ServingDefinition[] = [];
  let defaultServingId: EntityId | undefined;

  if (input.servingLabel && input.servingGrams !== undefined && input.servingGrams > 0) {
    const servingId = newUuidv7();
    servings.push({
      id: servingId,
      label: input.servingLabel,
      grams: input.servingGrams,
    });
    defaultServingId = servingId;
  }

  return {
    id: newUuidv7(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: input.name,
    brand: input.brand,
    preparationState: input.preparationState,
    preparationMethod: input.preparationMethod,
    sourceId: input.sourceId,
    densityBasis,
    nutrientsPer100g: nutrientsPer100,
    servings,
    defaultServingId,
    provenance: undefined, // Set by caller if needed
  };
}

function scaleRawNutrients(
  nutrients: Partial<NutrientAmounts>,
  factor: number,
): NutrientAmounts {
  const result: NutrientAmounts = {
    caloriesKcal: (nutrients.caloriesKcal ?? 0) * factor,
    proteinGrams: (nutrients.proteinGrams ?? 0) * factor,
    carbohydrateGrams: (nutrients.carbohydrateGrams ?? 0) * factor,
    fatGrams: (nutrients.fatGrams ?? 0) * factor,
  };

  // Scale optional nutrients if present
  if (nutrients.fiberGrams !== undefined) result.fiberGrams = nutrients.fiberGrams * factor;
  if (nutrients.sugarsGrams !== undefined) result.sugarsGrams = nutrients.sugarsGrams * factor;
  if (nutrients.sodiumMilligrams !== undefined) result.sodiumMilligrams = nutrients.sodiumMilligrams * factor;
  if (nutrients.alcoholGrams !== undefined) result.alcoholGrams = nutrients.alcoholGrams * factor;
  if (nutrients.cholesterolMilligrams !== undefined)
    result.cholesterolMilligrams = nutrients.cholesterolMilligrams * factor;
  if (nutrients.saturatedFatGrams !== undefined) result.saturatedFatGrams = nutrients.saturatedFatGrams * factor;
  if (nutrients.monounsaturatedFatGrams !== undefined)
    result.monounsaturatedFatGrams = nutrients.monounsaturatedFatGrams * factor;
  if (nutrients.polyunsaturatedFatGrams !== undefined)
    result.polyunsaturatedFatGrams = nutrients.polyunsaturatedFatGrams * factor;
  if (nutrients.transFatGrams !== undefined) result.transFatGrams = nutrients.transFatGrams * factor;
  if (nutrients.omega3Grams !== undefined) result.omega3Grams = nutrients.omega3Grams * factor;
  if (nutrients.omega6Grams !== undefined) result.omega6Grams = nutrients.omega6Grams * factor;

  // Scale additional nutrients
  if (nutrients.additionalNutrients !== undefined) {
    const scaled: Record<string, number> = {};
    for (const [key, value] of Object.entries(nutrients.additionalNutrients)) {
      scaled[key] = value * factor;
    }
    result.additionalNutrients = scaled;
  }

  return result;
}
