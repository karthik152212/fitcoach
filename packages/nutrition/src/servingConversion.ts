import type { Food } from "@fitcoach/domain";
import { NotImplementedError } from "./errors";

export interface ServingRequest {
  servingId?: string;
  numberOfServings?: number;
  grams?: number;
  milliliters?: number;
}

/**
 * Convert any serving request into the canonical gram quantity used for all
 * math. Must fail loudly on impossible conversions (e.g. missing serving
 * weight) rather than guessing.
 */
export function resolveQuantityInGrams(_food: Food, _request: ServingRequest): number {
  throw new NotImplementedError("nutrition.resolveQuantityInGrams");
}
