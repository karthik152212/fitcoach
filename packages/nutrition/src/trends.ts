import type { DailyNutrition, NutrientAmounts } from "@fitcoach/domain";
import type { TrendAnalysis, TrendPoint, TrendOptions } from "@fitcoach/fitness-core";
import { detectTrend } from "@fitcoach/fitness-core";

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
export interface AnalyzeNutritionTrendOptions extends TrendOptions {
  /** Optional fixed "now" date for deterministic testing. Defaults to current time. */
  now?: Date;
}

/**
 * Analyze nutrition adherence as trends, not single days. One high-calorie
 * day (or one ice cream) is not a violation if the rolling trajectory stays
 * appropriate; conversely "good" daily averages can hide a drifting trend.
 */
export function analyzeNutritionTrend(
  daily: readonly DailyNutrition[],
  windowDays: number,
  options: AnalyzeNutritionTrendOptions = {},
): NutritionTrendReport {
  // Sort by date ascending (oldest first) for the trend detection
  const sorted = [...daily].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Filter to the rolling window
  const now = options.now ?? new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffStr = cutoff.toISOString().split("T")[0] ?? "";

  const windowed = sorted.filter((d) => d.date >= cutoffStr);

  // Convert to trend points for each nutrient
  const caloriesPoints = extractNutrientPoints(windowed, "caloriesKcal");
  const proteinPoints = extractNutrientPoints(windowed, "proteinGrams");
  const carbPoints = extractNutrientPoints(windowed, "carbohydrateGrams");
  const fatPoints = extractNutrientPoints(windowed, "fatGrams");
  const fiberPoints = extractNutrientPoints(windowed, "fiberGrams");

  // Detect trends
  const calories = detectTrend(caloriesPoints, options);
  const protein = detectTrend(proteinPoints, options);
  const carbohydrates = detectTrend(carbPoints, options);
  const fat = detectTrend(fatPoints, options);
  const fiber = fiberPoints.length >= (options.minPoints ?? 3)
    ? detectTrend(fiberPoints, options)
    : undefined;

  return {
    calories,
    protein,
    carbohydrates,
    fat,
    fiber,
    windowDays,
  };
}

/**
 * Extract valid TrendPoints from DailyNutrition for a specific nutrient.
 * Absence (undefined) is filtered out — missing data does not become zero.
 */
function extractNutrientPoints(
  daily: readonly DailyNutrition[],
  nutrient: keyof NutrientAmounts,
): readonly TrendPoint[] {
  return daily
    .map((d) => {
      const value = d.totals[nutrient];
      if (value === undefined || !Number.isFinite(value)) {
        return null;
      }
      return { date: d.date, value };
    })
    .filter((p): p is TrendPoint => p !== null);
}
