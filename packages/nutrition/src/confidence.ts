import type { ConfidenceLevel } from "@fitcoach/domain";

export type { ConfidenceLevel };

/**
 * A value paired with how trustworthy it is. Nutrition data ranges from
 * lab-measured to pure guesswork; downstream logic must be able to tell
 * the difference instead of treating all numbers as equal.
 */
export interface QuantifiedNutrient<T = number> {
  value: T;
  confidence: ConfidenceLevel;
  basisNote?: string;
}
