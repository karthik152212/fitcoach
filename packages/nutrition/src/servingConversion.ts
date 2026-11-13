import type { Food, EntityId, ServingDefinition } from "@fitcoach/domain";

export interface ServingRequest {
  servingId?: EntityId;
  numberOfServings?: number;
  grams?: number;
  milliliters?: number;
}

/**
 * Convert any serving request into the canonical gram quantity used for all
 * math. Must fail loudly on impossible conversions (e.g. missing serving
 * weight) rather than guessing.
 */
export function resolveQuantityInGrams(food: Food, request: ServingRequest): number {
  // Direct gram quantity — highest priority, no conversion needed
  if (request.grams !== undefined) {
    if (!Number.isFinite(request.grams) || request.grams <= 0) {
      throw new RangeError("grams must be a finite positive number");
    }
    return request.grams;
  }

  // Direct milliliter quantity — only valid for per_100ml density basis
  if (request.milliliters !== undefined) {
    if (!Number.isFinite(request.milliliters) || request.milliliters <= 0) {
      throw new RangeError("milliliters must be a finite positive number");
    }
    if (food.densityBasis !== "per_100ml") {
      throw new RangeError(
        `Cannot use milliliters for food with density basis "${food.densityBasis}"`
      );
    }
    // For per_100ml foods, 1 ml ≈ 1 g by convention (density already accounts for this)
    return request.milliliters;
  }

  // Serving-based request
  if (request.servingId !== undefined) {
    const serving = food.servings.find((s) => s.id === request.servingId);
    if (!serving) {
      throw new RangeError(`Serving ${request.servingId} not found for food ${food.id}`);
    }
    return resolveServingToGrams(serving, request.numberOfServings ?? 1);
  }

  // Default serving
  if (food.defaultServingId !== undefined) {
    const serving = food.servings.find((s) => s.id === food.defaultServingId);
    if (serving) {
      return resolveServingToGrams(serving, request.numberOfServings ?? 1);
    }
  }

  // No valid conversion possible
  throw new RangeError(
    `Cannot resolve quantity: no grams, milliliters, or valid serving specified for food ${food.id}`
  );
}

function resolveServingToGrams(serving: ServingDefinition, numberOfServings: number): number {
  if (!Number.isFinite(numberOfServings) || numberOfServings <= 0) {
    throw new RangeError("numberOfServings must be a finite positive number");
  }

  // Weight-based serving
  if (serving.grams !== undefined) {
    if (!Number.isFinite(serving.grams) || serving.grams <= 0) {
      throw new RangeError(`Serving ${serving.id} has invalid grams value`);
    }
    return serving.grams * numberOfServings;
  }

  // Volume-based serving (only valid for per_100ml foods)
  if (serving.milliliters !== undefined) {
    if (!Number.isFinite(serving.milliliters) || serving.milliliters <= 0) {
      throw new RangeError(`Serving ${serving.id} has invalid milliliters value`);
    }
    return serving.milliliters * numberOfServings;
  }

  // Count-based serving (e.g., "1 large egg")
  if (serving.unitQuantity !== undefined && serving.unitName !== undefined) {
    if (!Number.isFinite(serving.unitQuantity) || serving.unitQuantity <= 0) {
      throw new RangeError(`Serving ${serving.id} has invalid unitQuantity`);
    }
    // Count-based servings cannot be resolved to grams without a reference weight
    // This is an impossible conversion — fail loudly per spec
    throw new RangeError(
      `Cannot convert count-based serving "${serving.unitName}" to grams without a reference weight`
    );
  }

  throw new RangeError(`Serving ${serving.id} has no valid size basis (grams, milliliters, or unitQuantity+unitName)`);
}
