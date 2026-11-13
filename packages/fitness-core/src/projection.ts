/**
 * Phase 7 — Projection & Trajectory Engine
 *
 * Deterministic projection engine that generates immutable, range-based
 * projections from derived facts. Recalculation produces new snapshots
 * (supersession chain) rather than mutating old ones.
 */

import type {
  ProjectionAssumption,
  ProjectionInputs,
  ProjectionMetric,
  ProjectionRequest,
  ProjectionResult,
  ProjectionSnapshot,
  ProjectionTarget,
  ProjectionHorizon,
  ProjectionMethod,
  AssumptionCategory,
  CalendarDate,
  Timestamp,
  UserId,
  Estimated,
  ConfidenceLevel,
  ProvenanceClass,
  UncertaintyRange,
} from "@fitcoach/domain";

// import { addCalendarDays } from "@fitcoach.domain/time";

// Re-export domain types for consumers
export type {
  ProjectionRequest,
  ProjectionResult,
  ProjectionSnapshot,
  ProjectionAssumption,
  ProjectionMetric,
  ProjectionInputs,
  ProjectionTarget,
  ProjectionHorizon,
  ProjectionMethod,
  AssumptionCategory,
} from "@fitcoach/domain";

function addMonths(date: CalendarDate, months: number): CalendarDate {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split("T")[0] as CalendarDate;
}

// ============================================================================
// Configuration
// ============================================================================

export const PROJECTION_CONFIG_VERSION = "fitcoach.projection.v1";

export interface ProjectionConfiguration {
  /** Minimum data points required for trend-based projection. */
  minTrendPoints: number;
  /** Default adherence assumption (fraction of planned sessions). */
  defaultAdherence: number;
  /** Default progression rate per week (fraction of 1RM). */
  defaultProgressionRatePerWeek: number;
  /** Maximum horizon in months for standard projections. */
  maxStandardHorizonMonths: number;
  /** Weight trend smoothing alpha for exponential smoothing. */
  weightTrendAlpha: number;
  /** Measurement trend smoothing alpha. */
  measurementTrendAlpha: number;
  /** Strength progression model: linear vs diminishing returns. */
  strengthModel: "linear" | "diminishing";
  /** Confidence decay per month of horizon. */
  confidenceDecayPerMonth: number;
  /** Minimum confidence floor. */
  minConfidence: ConfidenceLevel;
}

export const DEFAULT_PROJECTION_CONFIGURATION: ProjectionConfiguration = {
  minTrendPoints: 7,
  defaultAdherence: 0.85,
  defaultProgressionRatePerWeek: 0.015, // ~1.5% per week for novice/intermediate
  maxStandardHorizonMonths: 12,
  weightTrendAlpha: 0.3,
  measurementTrendAlpha: 0.25,
  strengthModel: "diminishing",
  confidenceDecayPerMonth: 0.15,
  minConfidence: "unknown",
};

// ============================================================================
// Types for internal computation (exported for testing)
// ============================================================================

export interface TrendData {
  slopePerDay: number;
  confidence: number;
  pointsUsed: number;
  direction: "increasing" | "decreasing" | "stable" | "insufficient_data";
}

export interface DerivedFacts {
  weightTrend?: TrendData;
  bodyFatTrend?: TrendData;
  muscleMassTrend?: TrendData;
  measurementTrends?: Map<string, TrendData>;
  strengthTrends?: Map<string, TrendData>;
  volumeTrend?: TrendData;
  proteinTrend?: TrendData;
  caloriesTrend?: TrendData;
  currentWeightKg?: number;
  currentBodyFatPercent?: number;
  currentMuscleMassKg?: number;
  currentMeasurements?: Map<string, number>;
  currentStrength?: Map<string, number>;
  currentWeeklyVolume?: number;
  currentDailyProteinG?: number;
  currentDailyCaloriesKcal?: number;
  trainingAdherence?: number;
  nutritionAdherence?: number;
  sleepAdequacy?: "adequate" | "moderate_debt" | "severe_debt";
  recoveryReadiness?: number;
}

// ============================================================================
// Main entry point
// ============================================================================

/**
 * Generate a deterministic projection from derived facts.
 * This is the core pure function — I/O and persistence are handled by the application layer.
 */
export function generateProjection(
  request: ProjectionRequest,
  derivedFacts: DerivedFacts,
  configuration: ProjectionConfiguration = DEFAULT_PROJECTION_CONFIGURATION
): ProjectionResult {
  const asOf = request.asOf ?? getCalendarDateToday();
  const horizons = request.horizons ?? getStandardHorizons(configuration.maxStandardHorizonMonths);
  const targets = request.targets ?? getAvailableTargets(derivedFacts);

  // Build inputs digest for reproducibility
  const inputs = buildInputsDigest(request.userId, asOf, derivedFacts, configuration);

  // Build assumptions
  const assumptions = buildAssumptions(derivedFacts, request.assumptionOverrides, configuration);

  // Generate metrics for each target × horizon
  const metrics: ProjectionMetric[] = [];
  for (const target of targets) {
    for (const horizon of horizons) {
      const metric = projectMetric(target, horizon, asOf, derivedFacts, assumptions, configuration);
      if (metric) metrics.push(metric);
    }
  }

  // Build snapshot
  const now = new Date().toISOString() as Timestamp;
  const snapshot: ProjectionSnapshot = {
    id: generateId(),
    userId: request.userId,
    generatedAt: asOf,
    status: "current",
    inputs,
    assumptions,
    metrics,
    supersedesId: undefined, // Set by application layer when superseding
    configVersion: PROJECTION_CONFIG_VERSION,
    summary: buildSummary(metrics, assumptions),
    warnings: buildWarnings(derivedFacts, assumptions, configuration),
    createdAt: now,
    updatedAt: now,
  };

  return {
    snapshot,
    isNew: true,
    previousSnapshot: undefined, // Set by application layer
  };
}

// ============================================================================
// Metric projection functions
// ============================================================================

function projectMetric(
  target: ProjectionTarget,
  horizon: ProjectionHorizon,
  asOf: CalendarDate,
  facts: DerivedFacts,
  assumptions: readonly ProjectionAssumption[],
  config: ProjectionConfiguration
): ProjectionMetric | null {
  const horizonDays = horizonToDays(horizon, asOf);
  // Allow current horizon (0 days) - it returns current value with high confidence

  switch (target) {
    case "body_weight_kg":
      return projectWeight(horizonDays, horizon, asOf, facts, assumptions, config);
    case "body_fat_percent":
      return projectBodyFat(horizonDays, horizon, asOf, facts, assumptions, config);
    case "muscle_mass_kg":
      return projectMuscleMass(horizonDays, horizon, asOf, facts, assumptions, config);
    case "measurement_cm":
      return projectMeasurement(horizonDays, horizon, asOf, facts, assumptions, config);
    case "strength_1rm_kg":
      return projectStrength(horizonDays, horizon, asOf, facts, assumptions, config);
    case "volume_weekly_sets":
      return projectVolume(horizonDays, horizon, asOf, facts, assumptions, config);
    case "protein_daily_g":
      return projectProtein(horizonDays, horizon, asOf, facts, assumptions, config);
    case "calories_daily_kcal":
      return projectCalories(horizonDays, horizon, asOf, facts, assumptions, config);
    default:
      return null;
  }
}

function projectWeight(
  horizonDays: number,
  horizon: ProjectionHorizon,
  _asOf: CalendarDate,
  facts: DerivedFacts,
  _assumptions: readonly ProjectionAssumption[],
  config: ProjectionConfiguration
): ProjectionMetric | null {
  const trend = facts.weightTrend;
  const currentWeight = facts.currentWeightKg;
  if (!trend || trend.direction === "insufficient_data" || currentWeight === undefined) {
    return null;
  }

  // Current horizon: return current value with high confidence
  if (horizonDays === 0) {
    return {
      target: "body_weight_kg",
      horizon: "current",
      central: wrapEstimated(currentWeight, "estimated", "measured", {
        low: currentWeight,
        high: currentWeight,
        note: "Current measured weight",
      }),
      low: wrapEstimated(currentWeight, "inferred", "measured", undefined),
      high: wrapEstimated(currentWeight, "inferred", "measured", undefined),
      method: "linear_trend_extrapolation",
      confidence: "measured",
      basis: `Current weight measurement (${trend.pointsUsed} readings).`,
    };
  }

  const method: ProjectionMethod = "linear_trend_extrapolation";
  const dailySlope = trend.slopePerDay;
  const projectedChange = dailySlope * horizonDays;
  const centralValue = currentWeight + projectedChange;

  // Build uncertainty range based on trend confidence and horizon
  const baseUncertainty = Math.max(0.5, Math.abs(projectedChange) * 0.2);
  const horizonUncertainty = baseUncertainty * (1 + horizonDays / 30 * 0.5);
  const lowValue = centralValue - horizonUncertainty;
  const highValue = centralValue + horizonUncertainty;

  const confidence = decayConfidence(trend.confidence, horizonDays, config);

  return {
    target: "body_weight_kg",
    horizon: horizon,
    central: wrapEstimated(centralValue, "estimated", confidence, {
      low: lowValue,
      high: highValue,
      note: `Weight trend ${trend.direction} at ${(dailySlope * 7).toFixed(2)} kg/week`,
    }),
    low: wrapEstimated(lowValue, "inferred", confidence, undefined),
    high: wrapEstimated(highValue, "inferred", confidence, undefined),
    method,
    confidence,
    basis: `Linear extrapolation of weight trend (${trend.pointsUsed} readings, confidence ${(trend.confidence * 100).toFixed(0)}%) over ${Math.round(horizonDays / 7)} weeks.`,
  };
}

function projectBodyFat(
  horizonDays: number,
  horizon: ProjectionHorizon,
  _asOf: CalendarDate,
  facts: DerivedFacts,
  _assumptions: readonly ProjectionAssumption[],
  config: ProjectionConfiguration
): ProjectionMetric | null {
  const trend = facts.bodyFatTrend;
  const currentBodyFat = facts.currentBodyFatPercent;
  if (!trend || trend.direction === "insufficient_data" || currentBodyFat === undefined) {
    return null;
  }

  // Current horizon: return current value with high confidence
  if (horizonDays === 0) {
    return {
      target: "body_fat_percent",
      horizon: "current",
      central: wrapEstimated(currentBodyFat, "estimated", "measured", {
        low: currentBodyFat,
        high: currentBodyFat,
        note: "Current measured body fat",
      }),
      low: wrapEstimated(currentBodyFat, "inferred", "measured", undefined),
      high: wrapEstimated(currentBodyFat, "inferred", "measured", undefined),
      method: "linear_trend_extrapolation",
      confidence: "measured",
      basis: `Current body fat measurement (${trend.pointsUsed} readings).`,
    };
  }

  const method: ProjectionMethod = "linear_trend_extrapolation";
  const dailySlope = trend.slopePerDay;
  const projectedChange = dailySlope * horizonDays;
  const centralValue = Math.max(3, Math.min(50, currentBodyFat + projectedChange)); // Clamp to physiological range

  const baseUncertainty = Math.max(0.5, Math.abs(projectedChange) * 0.3);
  const horizonUncertainty = baseUncertainty * (1 + horizonDays / 30 * 0.6);
  const lowValue = Math.max(3, centralValue - horizonUncertainty);
  const highValue = Math.min(50, centralValue + horizonUncertainty);

  const confidence = decayConfidence(trend.confidence, horizonDays, config);

  return {
    target: "body_fat_percent",
    horizon: horizon,
    central: wrapEstimated(centralValue, "estimated", confidence, {
      low: lowValue,
      high: highValue,
      note: `Body fat trend ${trend.direction} at ${(dailySlope * 7).toFixed(2)}%/week`,
    }),
    low: wrapEstimated(lowValue, "inferred", confidence, undefined),
    high: wrapEstimated(highValue, "inferred", confidence, undefined),
    method,
    confidence,
    basis: `Linear extrapolation of body fat trend (${trend.pointsUsed} readings, confidence ${(trend.confidence * 100).toFixed(0)}%) over ${Math.round(horizonDays / 7)} weeks.`,
  };
}

function projectMuscleMass(
  horizonDays: number,
  horizon: ProjectionHorizon,
  _asOf: CalendarDate,
  facts: DerivedFacts,
  _assumptions: readonly ProjectionAssumption[],
  config: ProjectionConfiguration
): ProjectionMetric | null {
  const trend = facts.muscleMassTrend;
  const currentMuscleMass = facts.currentMuscleMassKg;
  if (!trend || trend.direction === "insufficient_data" || currentMuscleMass === undefined) {
    return null;
  }

  // Current horizon: return current value with high confidence
  if (horizonDays === 0) {
    return {
      target: "muscle_mass_kg",
      horizon: "current",
      central: wrapEstimated(currentMuscleMass, "estimated", "measured", {
        low: currentMuscleMass,
        high: currentMuscleMass,
        note: "Current measured muscle mass",
      }),
      low: wrapEstimated(currentMuscleMass, "inferred", "measured", undefined),
      high: wrapEstimated(currentMuscleMass, "inferred", "measured", undefined),
      method: "linear_trend_extrapolation",
      confidence: "measured",
      basis: `Current muscle mass measurement (${trend.pointsUsed} readings).`,
    };
  }

  const method: ProjectionMethod = "linear_trend_extrapolation";
  const dailySlope = trend.slopePerDay;
  const projectedChange = dailySlope * horizonDays;
  const centralValue = Math.max(0, currentMuscleMass + projectedChange);

  const baseUncertainty = Math.max(0.2, Math.abs(projectedChange) * 0.4);
  const horizonUncertainty = baseUncertainty * (1 + horizonDays / 30 * 0.7);
  const lowValue = Math.max(0, centralValue - horizonUncertainty);
  const highValue = centralValue + horizonUncertainty;

  const confidence = decayConfidence(trend.confidence, horizonDays, config);

  return {
    target: "muscle_mass_kg",
    horizon: horizon,
    central: wrapEstimated(centralValue, "estimated", confidence, {
      low: lowValue,
      high: highValue,
      note: `Muscle mass trend ${trend.direction} at ${(dailySlope * 7).toFixed(3)} kg/week`,
    }),
    low: wrapEstimated(lowValue, "inferred", confidence, undefined),
    high: wrapEstimated(highValue, "inferred", confidence, undefined),
    method,
    confidence,
    basis: `Linear extrapolation of muscle mass trend (${trend.pointsUsed} readings, confidence ${(trend.confidence * 100).toFixed(0)}%) over ${Math.round(horizonDays / 7)} weeks.`,
  };
}

function projectMeasurement(
  horizonDays: number,
  horizon: ProjectionHorizon,
  _asOf: CalendarDate,
  facts: DerivedFacts,
  _assumptions: readonly ProjectionAssumption[],
  config: ProjectionConfiguration
): ProjectionMetric | null {
  const trends = facts.measurementTrends;
  const currentMeasurements = facts.currentMeasurements;
  if (!trends || !currentMeasurements || trends.size === 0) {
    return null;
  }

  // Project the primary measurement (waist for fat loss, chest/arms for muscle gain)
  // For now, project the measurement with the strongest trend
  let bestSite = "";
  let bestTrend: TrendData | null = null;
  let bestCurrent = 0;

  for (const [site, trend] of trends) {
    if (trend.direction !== "insufficient_data" && currentMeasurements.has(site)) {
      const current = currentMeasurements.get(site)!;
      if (!bestTrend || Math.abs(trend.slopePerDay) > Math.abs(bestTrend.slopePerDay)) {
        bestSite = site;
        bestTrend = trend;
        bestCurrent = current;
      }
    }
  }

  if (!bestTrend || bestCurrent === 0) {
    return null;
  }

  // Current horizon: return current value with high confidence
  if (horizonDays === 0) {
    return {
      target: "measurement_cm",
      horizon: "current",
      central: wrapEstimated(bestCurrent, "estimated", "measured", {
        low: bestCurrent,
        high: bestCurrent,
        note: `Current measured ${bestSite}`,
      }),
      low: wrapEstimated(bestCurrent, "inferred", "measured", undefined),
      high: wrapEstimated(bestCurrent, "inferred", "measured", undefined),
      method: "linear_trend_extrapolation",
      confidence: "measured",
      basis: `Current ${bestSite} measurement (${bestTrend.pointsUsed} readings).`,
    };
  }

  const method: ProjectionMethod = "linear_trend_extrapolation";
  const dailySlope = bestTrend.slopePerDay;
  const projectedChange = dailySlope * horizonDays;
  const centralValue = bestCurrent + projectedChange;

  const baseUncertainty = Math.max(0.2, Math.abs(projectedChange) * 0.25);
  const horizonUncertainty = baseUncertainty * (1 + horizonDays / 30 * 0.5);
  const lowValue = centralValue - horizonUncertainty;
  const highValue = centralValue + horizonUncertainty;

  const confidence = decayConfidence(bestTrend.confidence, horizonDays, config);

  return {
    target: "measurement_cm",
    horizon: horizon,
    central: wrapEstimated(centralValue, "estimated", confidence, {
      low: lowValue,
      high: highValue,
      note: `${bestSite} trend ${bestTrend.direction} at ${(dailySlope * 7).toFixed(2)} cm/week`,
    }),
    low: wrapEstimated(lowValue, "inferred", confidence, undefined),
    high: wrapEstimated(highValue, "inferred", confidence, undefined),
    method,
    confidence,
    basis: `Linear extrapolation of ${bestSite} measurement trend (${bestTrend.pointsUsed} readings) over ${Math.round(horizonDays / 7)} weeks.`,
  };
}

function projectStrength(
  horizonDays: number,
  horizon: ProjectionHorizon,
  _asOf: CalendarDate,
  facts: DerivedFacts,
  assumptions: readonly ProjectionAssumption[],
  config: ProjectionConfiguration
): ProjectionMetric | null {
  const trends = facts.strengthTrends;
  const currentStrength = facts.currentStrength;
  if (!trends || !currentStrength || trends.size === 0) {
    return null;
  }

  // Use adherence assumption
  const adherenceAssumption = assumptions.find(a => a.code === "training_adherence");
  const adherence = adherenceAssumption ? parseFloat(adherenceAssumption.value) : config.defaultAdherence;

  // Project the strongest trending exercise
  let bestExercise = "";
  let bestTrend: TrendData | null = null;
  let bestCurrent = 0;

  for (const [exercise, trend] of trends) {
    if (trend.direction !== "insufficient_data" && currentStrength.has(exercise)) {
      const current = currentStrength.get(exercise)!;
      if (!bestTrend || Math.abs(trend.slopePerDay) > Math.abs(bestTrend.slopePerDay)) {
        bestExercise = exercise;
        bestTrend = trend;
        bestCurrent = current;
      }
    }
  }

  if (!bestTrend || bestCurrent === 0) {
    return null;
  }

  // Current horizon: return current value with high confidence
  if (horizonDays === 0) {
    return {
      target: "strength_1rm_kg",
      horizon: "current",
      central: wrapEstimated(bestCurrent, "estimated", "measured", {
        low: bestCurrent,
        high: bestCurrent,
        note: `Current measured ${bestExercise} 1RM`,
      }),
      low: wrapEstimated(bestCurrent, "inferred", "measured", undefined),
      high: wrapEstimated(bestCurrent, "inferred", "measured", undefined),
      method: "linear_trend_extrapolation",
      confidence: "measured",
      basis: `Current ${bestExercise} 1RM measurement (${bestTrend.pointsUsed} sessions).`,
    };
  }

  // Apply diminishing returns model if configured
  const weeklyGain = bestTrend.slopePerDay * 7;
  const effectiveWeeklyGain = config.strengthModel === "diminishing"
    ? weeklyGain * (1 - bestCurrent / 200) * adherence // Diminishing as approaching 200kg 1RM
    : weeklyGain * adherence;

  const projectedChange = effectiveWeeklyGain * (horizonDays / 7);
  const centralValue = Math.max(0, bestCurrent + projectedChange);

  const baseUncertainty = Math.max(1, Math.abs(projectedChange) * 0.4);
  const horizonUncertainty = baseUncertainty * (1 + horizonDays / 30 * 0.8);
  const lowValue = Math.max(0, centralValue - horizonUncertainty);
  const highValue = centralValue + horizonUncertainty;

  const confidence = decayConfidence(bestTrend.confidence * adherence, horizonDays, config);

  return {
    target: "strength_1rm_kg",
    horizon: horizon,
    central: wrapEstimated(centralValue, "estimated", confidence, {
      low: lowValue,
      high: highValue,
      note: `${bestExercise} trend ${bestTrend.direction} at ${weeklyGain.toFixed(1)} kg/week (adjusted: ${effectiveWeeklyGain.toFixed(1)})`,
    }),
    low: wrapEstimated(lowValue, "inferred", confidence, undefined),
    high: wrapEstimated(highValue, "inferred", confidence, undefined),
    method: config.strengthModel === "diminishing" ? "custom" : "linear_trend_extrapolation",
    confidence,
    basis: `${config.strengthModel === "diminishing" ? "Diminishing-returns" : "Linear"} extrapolation of ${bestExercise} 1RM trend (${bestTrend.pointsUsed} sessions, adherence ${(adherence * 100).toFixed(0)}%) over ${Math.round(horizonDays / 7)} weeks.`,
  };
}

function projectVolume(
  horizonDays: number,
  horizon: ProjectionHorizon,
  _asOf: CalendarDate,
  facts: DerivedFacts,
  assumptions: readonly ProjectionAssumption[],
  config: ProjectionConfiguration
): ProjectionMetric | null {
  const trend = facts.volumeTrend;
  const currentVolume = facts.currentWeeklyVolume;
  if (!trend || trend.direction === "insufficient_data" || currentVolume === undefined) {
    return null;
  }

  const adherenceAssumption = assumptions.find(a => a.code === "training_adherence");
  const adherence = adherenceAssumption ? parseFloat(adherenceAssumption.value) : config.defaultAdherence;

  // Current horizon: return current value with high confidence
  if (horizonDays === 0) {
    return {
      target: "volume_weekly_sets",
      horizon: "current",
      central: wrapEstimated(currentVolume, "estimated", "measured", {
        low: currentVolume,
        high: currentVolume,
        note: "Current weekly volume",
      }),
      low: wrapEstimated(currentVolume, "inferred", "measured", undefined),
      high: wrapEstimated(currentVolume, "inferred", "measured", undefined),
      method: "linear_trend_extrapolation",
      confidence: "measured",
      basis: `Current weekly volume (${trend.pointsUsed} weeks).`,
    };
  }

  const method: ProjectionMethod = "linear_trend_extrapolation";
  const weeklySlope = trend.slopePerDay * 7;
  const projectedWeeklyChange = weeklySlope * (horizonDays / 7) * adherence;
  const centralValue = Math.max(0, currentVolume + projectedWeeklyChange);

  const baseUncertainty = Math.max(2, Math.abs(projectedWeeklyChange) * 0.3);
  const horizonUncertainty = baseUncertainty * (1 + horizonDays / 30 * 0.5);
  const lowValue = Math.max(0, centralValue - horizonUncertainty);
  const highValue = centralValue + horizonUncertainty;

  const confidence = decayConfidence(trend.confidence * adherence, horizonDays, config);

  return {
    target: "volume_weekly_sets",
    horizon: horizon,
    central: wrapEstimated(centralValue, "estimated", confidence, {
      low: lowValue,
      high: highValue,
      note: `Volume trend ${trend.direction} at ${weeklySlope.toFixed(1)} sets/week (adjusted for adherence)`,
    }),
    low: wrapEstimated(lowValue, "inferred", confidence, undefined),
    high: wrapEstimated(highValue, "inferred", confidence, undefined),
    method,
    confidence,
    basis: `Linear extrapolation of weekly volume trend (${trend.pointsUsed} weeks, adherence ${(adherence * 100).toFixed(0)}%) over ${Math.round(horizonDays / 7)} weeks.`,
  };
}

function projectProtein(
  horizonDays: number,
  horizon: ProjectionHorizon,
  _asOf: CalendarDate,
  facts: DerivedFacts,
  assumptions: readonly ProjectionAssumption[],
  config: ProjectionConfiguration
): ProjectionMetric | null {
  const trend = facts.proteinTrend;
  const currentProtein = facts.currentDailyProteinG;
  if (!trend || trend.direction === "insufficient_data" || currentProtein === undefined) {
    return null;
  }

  const nutritionAdherenceAssumption = assumptions.find(a => a.code === "nutrition_adherence");
  const adherence = nutritionAdherenceAssumption ? parseFloat(nutritionAdherenceAssumption.value) : 0.9;

  // Current horizon: return current value with high confidence
  if (horizonDays === 0) {
    return {
      target: "protein_daily_g",
      horizon: "current",
      central: wrapEstimated(currentProtein, "estimated", "measured", {
        low: currentProtein,
        high: currentProtein,
        note: "Current daily protein",
      }),
      low: wrapEstimated(currentProtein, "inferred", "measured", undefined),
      high: wrapEstimated(currentProtein, "inferred", "measured", undefined),
      method: "linear_trend_extrapolation",
      confidence: "measured",
      basis: `Current daily protein intake (${trend.pointsUsed} days).`,
    };
  }

  const method: ProjectionMethod = "linear_trend_extrapolation";
  const dailySlope = trend.slopePerDay;
  const projectedChange = dailySlope * horizonDays * adherence;
  const centralValue = Math.max(0, currentProtein + projectedChange);

  const baseUncertainty = Math.max(5, Math.abs(projectedChange) * 0.2);
  const horizonUncertainty = baseUncertainty * (1 + horizonDays / 30 * 0.3);
  const lowValue = Math.max(0, centralValue - horizonUncertainty);
  const highValue = centralValue + horizonUncertainty;

  const confidence = decayConfidence(trend.confidence * adherence, horizonDays, config);

  return {
    target: "protein_daily_g",
    horizon: horizon,
    central: wrapEstimated(centralValue, "estimated", confidence, {
      low: lowValue,
      high: highValue,
      note: `Protein trend ${trend.direction} at ${(dailySlope).toFixed(1)} g/day (adjusted for adherence)`,
    }),
    low: wrapEstimated(lowValue, "inferred", confidence, undefined),
    high: wrapEstimated(highValue, "inferred", confidence, undefined),
    method,
    confidence,
    basis: `Linear extrapolation of daily protein trend (${trend.pointsUsed} days, adherence ${(adherence * 100).toFixed(0)}%) over ${Math.round(horizonDays / 7)} weeks.`,
  };
}

function projectCalories(
  horizonDays: number,
  horizon: ProjectionHorizon,
  _asOf: CalendarDate,
  facts: DerivedFacts,
  assumptions: readonly ProjectionAssumption[],
  config: ProjectionConfiguration
): ProjectionMetric | null {
  const trend = facts.caloriesTrend;
  const currentCalories = facts.currentDailyCaloriesKcal;
  if (!trend || trend.direction === "insufficient_data" || currentCalories === undefined) {
    return null;
  }

  const nutritionAdherenceAssumption = assumptions.find(a => a.code === "nutrition_adherence");
  const adherence = nutritionAdherenceAssumption ? parseFloat(nutritionAdherenceAssumption.value) : 0.9;

  // Current horizon: return current value with high confidence
  if (horizonDays === 0) {
    return {
      target: "calories_daily_kcal",
      horizon: "current",
      central: wrapEstimated(currentCalories, "estimated", "measured", {
        low: currentCalories,
        high: currentCalories,
        note: "Current daily calories",
      }),
      low: wrapEstimated(currentCalories, "inferred", "measured", undefined),
      high: wrapEstimated(currentCalories, "inferred", "measured", undefined),
      method: "linear_trend_extrapolation",
      confidence: "measured",
      basis: `Current daily calories intake (${trend.pointsUsed} days).`,
    };
  }

  const method: ProjectionMethod = "linear_trend_extrapolation";
  const dailySlope = trend.slopePerDay;
  const projectedChange = dailySlope * horizonDays * adherence;
  const centralValue = Math.max(800, currentCalories + projectedChange); // Floor at 800 kcal

  const baseUncertainty = Math.max(50, Math.abs(projectedChange) * 0.2);
  const horizonUncertainty = baseUncertainty * (1 + horizonDays / 30 * 0.3);
  const lowValue = Math.max(800, centralValue - horizonUncertainty);
  const highValue = centralValue + horizonUncertainty;

  const confidence = decayConfidence(trend.confidence * adherence, horizonDays, config);

  return {
    target: "calories_daily_kcal",
    horizon: horizon,
    central: wrapEstimated(centralValue, "estimated", confidence, {
      low: lowValue,
      high: highValue,
      note: `Calories trend ${trend.direction} at ${(dailySlope).toFixed(0)} kcal/day (adjusted for adherence)`,
    }),
    low: wrapEstimated(lowValue, "inferred", confidence, undefined),
    high: wrapEstimated(highValue, "inferred", confidence, undefined),
    method,
    confidence,
    basis: `Linear extrapolation of daily calories trend (${trend.pointsUsed} days, adherence ${(adherence * 100).toFixed(0)}%) over ${Math.round(horizonDays / 7)} weeks.`,
  };
}

// ============================================================================
// Helper functions
// ============================================================================

function decayConfidence(baseConfidence: number, horizonDays: number, config: ProjectionConfiguration): ConfidenceLevel {
  const monthsAhead = horizonDays / 30;
  const decayed = baseConfidence * Math.pow(1 - config.confidenceDecayPerMonth, monthsAhead);
  const floored = Math.max(confidenceToNumber(config.minConfidence), decayed);
  return numberToConfidence(floored);
}

function confidenceToNumber(conf: ConfidenceLevel): number {
  switch (conf) {
    case "measured": return 0.9;
    case "label_declared": return 0.75;
    case "estimated": return 0.6;
    case "unknown": return 0.3;
  }
}

function numberToConfidence(num: number): ConfidenceLevel {
  if (num >= 0.8) return "measured";
  if (num >= 0.7) return "label_declared";
  if (num >= 0.5) return "estimated";
  return "unknown";
}

function wrapEstimated(
  value: number,
  provenance: ProvenanceClass,
  confidence: ConfidenceLevel,
  uncertainty?: UncertaintyRange
): Estimated<number> {
  return {
    value,
    provenance,
    confidence,
    uncertainty,
  };
}

function horizonToDays(horizon: ProjectionHorizon, asOf: CalendarDate): number {
  switch (horizon) {
    case "current": return 0;
    case "1_month": return daysBetween(asOf, addMonths(asOf, 1));
    case "3_months": return daysBetween(asOf, addMonths(asOf, 3));
    case "6_months": return daysBetween(asOf, addMonths(asOf, 6));
    case "12_months": return daysBetween(asOf, addMonths(asOf, 12));
    case "custom": return 90; // Default 3 months for custom
    default: return 0;
  }
}

function daysBetween(start: CalendarDate, end: CalendarDate): number {
  const d1 = new Date(start);
  const d2 = new Date(end);
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

function getStandardHorizons(maxMonths: number): ProjectionHorizon[] {
  const horizons: ProjectionHorizon[] = ["current", "1_month", "3_months"];
  if (maxMonths >= 6) horizons.push("6_months");
  if (maxMonths >= 12) horizons.push("12_months");
  return horizons;
}

function getAvailableTargets(facts: DerivedFacts): ProjectionTarget[] {
  const targets: ProjectionTarget[] = [];
  if (facts.weightTrend && facts.weightTrend.direction !== "insufficient_data" && facts.currentWeightKg) targets.push("body_weight_kg");
  if (facts.bodyFatTrend && facts.bodyFatTrend.direction !== "insufficient_data" && facts.currentBodyFatPercent) targets.push("body_fat_percent");
  if (facts.muscleMassTrend && facts.muscleMassTrend.direction !== "insufficient_data" && facts.currentMuscleMassKg) targets.push("muscle_mass_kg");
  if (facts.measurementTrends && facts.measurementTrends.size > 0 && facts.currentMeasurements) targets.push("measurement_cm");
  if (facts.strengthTrends && facts.strengthTrends.size > 0 && facts.currentStrength) targets.push("strength_1rm_kg");
  if (facts.volumeTrend && facts.volumeTrend.direction !== "insufficient_data" && facts.currentWeeklyVolume) targets.push("volume_weekly_sets");
  if (facts.proteinTrend && facts.proteinTrend.direction !== "insufficient_data" && facts.currentDailyProteinG) targets.push("protein_daily_g");
  if (facts.caloriesTrend && facts.caloriesTrend.direction !== "insufficient_data" && facts.currentDailyCaloriesKcal) targets.push("calories_daily_kcal");
  return targets;
}

function buildInputsDigest(
  userId: UserId,
  asOf: CalendarDate,
  facts: DerivedFacts,
  _config: ProjectionConfiguration
): ProjectionInputs {
  return {
    userId,
    asOf,
    trainingWindowDays: 84, // 12 weeks
    nutritionWindowDays: 28, // 4 weeks
    bodyWindowDays: 84, // 12 weeks
    activityWindowDays: 28, // 4 weeks
    derivedFacts: serializeDerivedFacts(facts),
    activeGoals: {}, // Filled by application layer
    activeInterventions: {}, // Filled by application layer
  };
}

function serializeDerivedFacts(facts: DerivedFacts): Record<string, string> {
  const out: Record<string, string> = {};
  if (facts.weightTrend) out.weightTrend = JSON.stringify(facts.weightTrend);
  if (facts.bodyFatTrend) out.bodyFatTrend = JSON.stringify(facts.bodyFatTrend);
  if (facts.muscleMassTrend) out.muscleMassTrend = JSON.stringify(facts.muscleMassTrend);
  if (facts.measurementTrends) out.measurementTrends = JSON.stringify(Object.fromEntries(facts.measurementTrends));
  if (facts.strengthTrends) out.strengthTrends = JSON.stringify(Object.fromEntries(facts.strengthTrends));
  if (facts.volumeTrend) out.volumeTrend = JSON.stringify(facts.volumeTrend);
  if (facts.proteinTrend) out.proteinTrend = JSON.stringify(facts.proteinTrend);
  if (facts.caloriesTrend) out.caloriesTrend = JSON.stringify(facts.caloriesTrend);
  if (facts.currentWeightKg) out.currentWeightKg = String(facts.currentWeightKg);
  if (facts.currentBodyFatPercent) out.currentBodyFatPercent = String(facts.currentBodyFatPercent);
  if (facts.currentMuscleMassKg) out.currentMuscleMassKg = String(facts.currentMuscleMassKg);
  if (facts.currentWeeklyVolume) out.currentWeeklyVolume = String(facts.currentWeeklyVolume);
  if (facts.currentDailyProteinG) out.currentDailyProteinG = String(facts.currentDailyProteinG);
  if (facts.currentDailyCaloriesKcal) out.currentDailyCaloriesKcal = String(facts.currentDailyCaloriesKcal);
  if (facts.trainingAdherence) out.trainingAdherence = String(facts.trainingAdherence);
  if (facts.nutritionAdherence) out.nutritionAdherence = String(facts.nutritionAdherence);
  if (facts.sleepAdequacy) out.sleepAdequacy = facts.sleepAdequacy;
  if (facts.recoveryReadiness) out.recoveryReadiness = String(facts.recoveryReadiness);
  return out;
}

function buildAssumptions(
  facts: DerivedFacts,
  overrides: Partial<Record<AssumptionCategory, string>> | undefined,
  config: ProjectionConfiguration
): ProjectionAssumption[] {
  const assumptions: ProjectionAssumption[] = [];

  // Adherence assumptions
  assumptions.push({
    code: "training_adherence",
    description: "Fraction of planned training sessions completed",
    category: "adherence",
    value: String(overrides?.adherence ?? facts.trainingAdherence ?? config.defaultAdherence),
    sensitive: true,
  });

  assumptions.push({
    code: "nutrition_adherence",
    description: "Fraction of nutrition targets met",
    category: "adherence",
    value: String(overrides?.nutrition ?? facts.nutritionAdherence ?? 0.9),
    sensitive: true,
  });

  // Progression rate
  assumptions.push({
    code: "strength_progression_rate",
    description: "Weekly 1RM progression rate as fraction",
    category: "progression_rate",
    value: String(config.defaultProgressionRatePerWeek),
    sensitive: true,
  });

  // Recovery
  assumptions.push({
    code: "sleep_adequacy",
    description: "Sleep debt status",
    category: "recovery",
    value: facts.sleepAdequacy ?? "adequate",
    sensitive: true,
  });

  // Body composition method
  assumptions.push({
    code: "body_composition_method",
    description: "Method used for body composition estimation",
    category: "body_composition",
    value: "multi_site_estimation",
    sensitive: false,
  });

  // Measurement consistency
  assumptions.push({
    code: "measurement_consistency",
    description: "Assumed consistency of measurement protocol",
    category: "measurement_consistency",
    value: "standard_protocol",
    sensitive: false,
  });

  return assumptions;
}

function buildSummary(metrics: readonly ProjectionMetric[], assumptions: readonly ProjectionAssumption[]): string {
  const targetCounts = new Map<ProjectionTarget, number>();
  for (const m of metrics) {
    targetCounts.set(m.target, (targetCounts.get(m.target) || 0) + 1);
  }
  const targetList = Array.from(targetCounts.entries()).map(([t, c]) => `${t} (${c} horizons)`).join(", ");
  const adherenceAssumption = assumptions.find(a => a.code === "training_adherence");
  const adherence = adherenceAssumption ? `adherence ${(parseFloat(adherenceAssumption.value) * 100).toFixed(0)}%` : "adherence unknown";
  return `Projection covering ${targetList || "no targets"}. ${adherence}. ${metrics.length} metrics generated.`;
}

function buildWarnings(
  facts: DerivedFacts,
  assumptions: readonly ProjectionAssumption[],
  config: ProjectionConfiguration
): readonly string[] {
  const warnings: string[] = [];

  if (facts.weightTrend && facts.weightTrend.pointsUsed < config.minTrendPoints) {
    warnings.push(`Weight trend based on only ${facts.weightTrend.pointsUsed} readings (minimum ${config.minTrendPoints})`);
  }
  if (facts.bodyFatTrend && facts.bodyFatTrend.pointsUsed < config.minTrendPoints) {
    warnings.push(`Body fat trend based on only ${facts.bodyFatTrend.pointsUsed} readings`);
  }
  if (facts.measurementTrends) {
    for (const [site, trend] of facts.measurementTrends) {
      if (trend.pointsUsed < config.minTrendPoints) {
        warnings.push(`${site} trend based on only ${trend.pointsUsed} readings`);
      }
    }
  }
  if (facts.strengthTrends) {
    for (const [exercise, trend] of facts.strengthTrends) {
      if (trend.pointsUsed < config.minTrendPoints) {
        warnings.push(`${exercise} strength trend based on only ${trend.pointsUsed} sessions`);
      }
    }
  }

  const adherenceAssumption = assumptions.find(a => a.code === "training_adherence");
  if (adherenceAssumption && parseFloat(adherenceAssumption.value) < 0.7) {
    warnings.push(`Low training adherence assumed (${(parseFloat(adherenceAssumption.value) * 100).toFixed(0)}%) — projections may be optimistic`);
  }

  const sleepAssumption = assumptions.find(a => a.code === "sleep_adequacy");
  if (sleepAssumption && sleepAssumption.value !== "adequate") {
    warnings.push(`Sleep adequacy: ${sleepAssumption.value} — recovery capacity may be reduced`);
  }

  return warnings;
}

function getCalendarDateToday(): CalendarDate {
  return new Date().toISOString().split("T")[0] as CalendarDate;
}

function generateId(): string {
  // UUIDv7-like: timestamp + random
  const timestamp = Date.now().toString(16).padStart(12, "0");
  const random = Math.random().toString(16).substring(2, 14).padStart(12, "0");
  return `${timestamp}-${random}`.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
}

// ============================================================================
// Projection divergence detection
// ============================================================================

export interface DivergenceDetectionInput {
  projectionSnapshot: ProjectionSnapshot;
  actualValues: Map<ProjectionTarget, Map<ProjectionHorizon, number>>;
  significanceThresholdPercent: number;
}

export interface DivergenceDetectionResult {
  divergences: Array<{
    target: ProjectionTarget;
    horizon: ProjectionHorizon;
    projectedCentral: number;
    actualValue: number;
    absoluteDifference: number;
    relativeDifferencePercent: number;
    significant: boolean;
  }>;
}

/**
 * Detect divergences between a projection snapshot and actual observed values.
 * Used by Phase 8 diagnosis engine.
 */
export function detectProjectionDivergences(
  input: DivergenceDetectionInput
): DivergenceDetectionResult {
  const { projectionSnapshot, actualValues, significanceThresholdPercent } = input;
  const divergences: DivergenceDetectionResult["divergences"] = [];

  for (const metric of projectionSnapshot.metrics) {
    const actualForTarget = actualValues.get(metric.target);
    if (!actualForTarget) continue;

    const actualValue = actualForTarget.get(metric.horizon);
    if (actualValue === undefined) continue;

    const absoluteDifference = Math.abs(actualValue - metric.central.value);
    const relativeDifferencePercent = metric.central.value !== 0
      ? (absoluteDifference / Math.abs(metric.central.value)) * 100
      : 100;

    const significant = relativeDifferencePercent >= significanceThresholdPercent;

    divergences.push({
      target: metric.target,
      horizon: metric.horizon,
      projectedCentral: metric.central.value,
      actualValue,
      absoluteDifference,
      relativeDifferencePercent,
      significant,
    });
  }

  return { divergences };
}

// ============================================================================
// Snapshot supersession
// ============================================================================

export interface SupersessionResult {
  newSnapshot: ProjectionSnapshot;
  previousSnapshot: ProjectionSnapshot;
}

/**
 * Create a new projection snapshot that supersedes the previous one.
 * Called when re-projecting with new data.
 */
export function supersedeProjection(
  previousSnapshot: ProjectionSnapshot,
  newSnapshot: ProjectionSnapshot
): SupersessionResult {
  const supersededSnapshot: ProjectionSnapshot = {
    ...previousSnapshot,
    status: "superseded",
  };

  const newCurrentSnapshot: ProjectionSnapshot = {
    ...newSnapshot,
    supersedesId: previousSnapshot.id,
    status: "current",
  };

  return {
    newSnapshot: newCurrentSnapshot,
    previousSnapshot: supersededSnapshot,
  };
}