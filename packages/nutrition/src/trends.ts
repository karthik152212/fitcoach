import type { DailyNutrition } from "@fitcoach/domain";
import type { TrendAnalysis } from "@fitcoach/fitness-core";
import { NotImplementedError } from "./errors";

export interface NutritionTrendReport {
  calories: TrendAnalysis;
  protein: TrendAnalysis;
  carbohydrates: TrendAnalysis;
  fat: TrendAnalysis;
  fiber?: TrendAnalysis;
  windowDays: number;
}

/**
 * Analyze nutrition adherence as trends, not single days. One high-calorie
 * day (or one ice cream) is not a violation if the rolling trajectory stays
 * appropriate; conversely "good" daily averages can hide a drifting trend.
 */
export function analyzeNutritionTrend(
  _daily: readonly DailyNutrition[],
  _windowDays: number,
): NutritionTrendReport {
  throw new NotImplementedError("nutrition.analyzeNutritionTrend");
}
