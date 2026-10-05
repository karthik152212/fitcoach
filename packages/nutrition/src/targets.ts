import type { Goal, NutritionTargets, User } from "@fitcoach/domain";
import { NotImplementedError } from "./errors";

export interface TargetDerivationInput {
  user: User;
  goal: Goal;
  /** Rolling activity context; activity targets are contextual, never universal. */
  averageStepsLast14Days?: number;
  weeklyCardioMinutes?: number;
  currentBodyWeightKg?: number;
}

/**
 * Derive calorie/protein/macro targets from the person, their goal and their
 * actual activity. Every target must carry a basis note explaining how it
 * was derived (explainability requirement).
 */
export function deriveNutritionTargets(_input: TargetDerivationInput): NutritionTargets {
  throw new NotImplementedError("nutrition.deriveNutritionTargets");
}
