import type {
  CalendarDate,
  BodyMeasurement,
  BodySite,
} from "@fitcoach/domain";
import {
  detectTrend,
  type TrendPoint,
  type TrendOptions,
} from "../trendDetection";
import type {
  WeightTrendAnalysis,
  CircumferenceTrendAnalysis,
  MeasurementCompleteness,
  BodyCompositionEstimate,
} from "./types";
import {
  DEFAULT_MEASUREMENT_ANALYSIS_CONFIG,
  DEFAULT_BODY_COMPOSITION_CONFIG,
  type MeasurementAnalysisConfig,
  type BodyCompositionConfig,
} from "./configuration";

/**
 * Body measurements analysis — weight trends, circumference trends, completeness,
 * and body composition estimation.
 * All computations are deterministic and use detectTrend() for consistency.
 */

// -----------------------------------------------------------------------------
// Weight trend analysis
// -----------------------------------------------------------------------------

export function analyzeWeightTrend(
  measurements: readonly BodyMeasurement[],
  config: MeasurementAnalysisConfig = DEFAULT_MEASUREMENT_ANALYSIS_CONFIG,
): WeightTrendAnalysis {
  const weightPoints: TrendPoint[] = measurements
    .filter((m) => m.bodyWeightKg !== undefined && Number.isFinite(m.bodyWeightKg))
    .map((m) => ({
      date: m.recordedAt.split("T")[0] as CalendarDate,
      value: m.bodyWeightKg!,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const trendOptions: TrendOptions = {
    minPoints: config.minWeightReadingsForTrend,
    stabilityThresholdPerDay: config.trendStabilityThresholdPerDay,
  };

  const trend = detectTrend(weightPoints, trendOptions);

  // Compute averages
  const recentWeights = weightPoints.slice(-14).map((p) => p.value);
  const averageWeight7dKg = recentWeights.length > 0
    ? recentWeights.reduce((s, v) => s + v, 0) / recentWeights.length
    : null;
  const averageWeight14dKg = weightPoints.length > 0
    ? weightPoints.reduce((s, v) => s + v.value, 0) / weightPoints.length
    : null;

  const currentWeightKg = weightPoints.length > 0 ? weightPoints[weightPoints.length - 1]!.value : null;

  // Convert daily slope to weekly
  const slopeKgPerWeek = trend.slopePerDay !== null ? trend.slopePerDay * 7 : null;

  return {
    direction: trend.direction,
    slopeKgPerWeek,
    confidence: trend.confidence,
    pointsUsed: trend.pointsUsed,
    warnings: trend.warnings,
    currentWeightKg,
    averageWeight7dKg,
    averageWeight14dKg,
  };
}

// -----------------------------------------------------------------------------
// Circumference trend analysis
// -----------------------------------------------------------------------------

export function analyzeCircumferenceTrends(
  measurements: readonly BodyMeasurement[],
  config: MeasurementAnalysisConfig = DEFAULT_MEASUREMENT_ANALYSIS_CONFIG,
): readonly CircumferenceTrendAnalysis[] {
  const sites: BodySite[] = [
    "neck",
    "shoulders",
    "chest",
    "waist",
    "hips",
    "left_upper_arm",
    "right_upper_arm",
    "left_thigh",
    "right_thigh",
    "left_calf",
    "right_calf",
  ];

  return sites.map((site) => {
    const points: TrendPoint[] = measurements
      .filter((m) => m.circumferencesCm?.[site] !== undefined && Number.isFinite(m.circumferencesCm![site]!))
      .map((m) => ({
        date: m.recordedAt.split("T")[0] as CalendarDate,
        value: m.circumferencesCm![site]!,
      }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const trendOptions: TrendOptions = {
      minPoints: config.minCircumferenceReadingsPerSite,
      stabilityThresholdPerDay: config.trendStabilityThresholdPerDay,
    };

    const trend = detectTrend(points, trendOptions);
    const latestCm = points.length > 0 ? points[points.length - 1]!.value : null;
    const slopeCmPerWeek = trend.slopePerDay !== null ? trend.slopePerDay * 7 : null;

    return {
      site,
      direction: trend.direction,
      slopeCmPerWeek,
      confidence: trend.confidence,
      pointsUsed: trend.pointsUsed,
      warnings: trend.warnings,
      latestCm,
    };
  });
}

// -----------------------------------------------------------------------------
// Measurement completeness
// -----------------------------------------------------------------------------

export function assessMeasurementCompleteness(
  measurements: readonly BodyMeasurement[],
  config: MeasurementAnalysisConfig = DEFAULT_MEASUREMENT_ANALYSIS_CONFIG,
): MeasurementCompleteness {
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
  const cutoffStr = cutoffDate.toISOString().split("T")[0]!;

  const recentMeasurements = measurements.filter(
    (m) => m.recordedAt.split("T")[0]! >= cutoffStr
  );

  // Weight readings
  const weightReadings = recentMeasurements.filter((m) => m.bodyWeightKg !== undefined).length;

  // Circumference sites and readings
  const circumferenceSitesSet = new Set<string>();
  let circumferenceReadings = 0;

  for (const m of recentMeasurements) {
    if (m.circumferencesCm) {
      for (const [site, value] of Object.entries(m.circumferencesCm)) {
        if (value !== undefined && Number.isFinite(value)) {
          circumferenceSitesSet.add(site);
          circumferenceReadings++;
        }
      }
    }
  }

  const circumferenceSites = Array.from(circumferenceSitesSet);

  // Can estimate composition?
  const preferredSites = config.preferredCompositionSites;
  const availablePreferred = preferredSites.filter((s) => circumferenceSitesSet.has(s));
  const canEstimateComposition = availablePreferred.length >= config.minSitesForComposition;
  const missingForComposition = preferredSites.filter((s) => !circumferenceSitesSet.has(s));

  // Data quality score
  const weightScore = Math.min(1, weightReadings / config.minWeightReadingsForTrend);
  const coverageScore = Math.min(1, circumferenceSites.length / config.preferredCompositionSites.length);
  const consistencyScore = recentMeasurements.length > 0 ? 0.8 : 0; // Simplified
  const recencyScore = recentMeasurements.length > 0 ? 1 : 0;

  const dataQualityScore =
    config.qualityWeights.weightFrequency * weightScore +
    config.qualityWeights.circumferenceCoverage * coverageScore +
    config.qualityWeights.consistency * consistencyScore +
    config.qualityWeights.recency * recencyScore;

  return {
    weightReadings,
    circumferenceSites,
    circumferenceReadings,
    canEstimateComposition,
    missingForComposition,
    dataQualityScore: Math.round(dataQualityScore * 1000) / 1000,
  };
}

// -----------------------------------------------------------------------------
// Body composition estimation
// -----------------------------------------------------------------------------

interface NavyInputs {
  waistCm: number;
  neckCm: number;
  heightCm: number;
  sex: "male" | "female";
}

interface NavyHipInputs extends NavyInputs {
  hipCm: number;
}

function estimateNavyMethod(inputs: NavyInputs): number {
  if (inputs.sex === "male") {
    const bodyDensity =
      1.0324 -
      0.19077 * Math.log10(inputs.waistCm - inputs.neckCm) +
      0.15456 * Math.log10(inputs.heightCm);
    return (495 / bodyDensity) - 450;
  } else {
    // Female Navy uses waist + hip - neck - need hip measurement
    // This function requires hipCm, call estimateNavyHipMethod instead
    throw new Error("estimateNavyMethod for female requires hipCm - use estimateNavyHipMethod");
  }
}

function estimateNavyHipMethod(inputs: NavyHipInputs): number {
  if (inputs.sex === "male") {
    // Male with hip - not standard, use waist/neck
    return estimateNavyMethod(inputs);
  } else {
    const bodyDensity =
      1.29579 -
      0.35004 * Math.log10(inputs.waistCm + inputs.hipCm - inputs.neckCm) +
      0.221 * Math.log10(inputs.heightCm);
    return (495 / bodyDensity) - 450;
  }
}

/**
 * Estimate body composition from measurements.
 * Requires: latest weight, height, sex, and at least 2 circumference sites.
 * Returns estimate with method, uncertainty, and confidence.
 */
export function estimateBodyComposition(
  measurements: readonly BodyMeasurement[],
  heightCm: number,
  sex: "male" | "female",
  config: BodyCompositionConfig = DEFAULT_BODY_COMPOSITION_CONFIG,
  measurementConfig: MeasurementAnalysisConfig = DEFAULT_MEASUREMENT_ANALYSIS_CONFIG,
): BodyCompositionEstimate | null {
  const latest = measurements[measurements.length - 1];
  if (!latest || latest.bodyWeightKg === undefined) return null;

  const circumferences = latest.circumferencesCm ?? {};
  const waistCm = circumferences.waist;
  const neckCm = circumferences.neck;
  const hipCm = circumferences.hips;
  const weightKg = latest.bodyWeightKg;

  // Determine best available method
  let method: BodyCompositionEstimate["method"] = "weight_only";
  let bodyFatPercent: number | null = null;
  let uncertainty = config.methodUncertainty.weight_only;
  const circumferencesUsed: string[] = [];

  // Navy with hip (female) or waist/neck - most validated circumference method
  if (waistCm !== undefined && neckCm !== undefined) {
    if (sex === "female" && hipCm !== undefined) {
      method = "weight_waist_hip";
      bodyFatPercent = estimateNavyHipMethod({ waistCm, neckCm, hipCm, heightCm, sex });
      uncertainty = config.methodUncertainty.weight_waist_hip;
      circumferencesUsed.push("waist", "hip", "neck");
    } else {
      method = "weight_waist_neck";
      bodyFatPercent = estimateNavyMethod({ waistCm, neckCm, heightCm, sex });
      uncertainty = config.methodUncertainty.weight_waist_neck;
      circumferencesUsed.push("waist", "neck");
    }
  }
  // Weight only (least accurate)
  else {
    // Very rough estimate from BMI - not reliable
    const bmi = weightKg / Math.pow(heightCm / 100, 2);
    if (sex === "male") {
      bodyFatPercent = 1.2 * bmi + 0.23 * 30 - 16.2; // Assuming age 30
    } else {
      bodyFatPercent = 1.2 * bmi + 0.23 * 30 - 5.4;
    }
    method = "weight_only";
    uncertainty = config.methodUncertainty.weight_only;
  }

  if (bodyFatPercent === null || !Number.isFinite(bodyFatPercent)) return null;

  // Clamp to reasonable range
  bodyFatPercent = Math.max(3, Math.min(55, bodyFatPercent));

  // Confidence based on method and data completeness
  const completeness = assessMeasurementCompleteness(measurements, measurementConfig);
  let confidence = 0.5; // Base

  switch (method) {
    case "weight_waist_hip":
      confidence = 0.7;
      break;
    case "weight_waist_neck":
      confidence = 0.6;
      break;
    case "weight_only":
      confidence = 0.3;
      break;
  }

  // Adjust for data quality
  confidence *= completeness.dataQualityScore;

  if (confidence < config.minConfidenceToReturn) return null;

  const basisNote = `Body composition estimated via ${method.replace("_", " ")} method. ` +
    `Weight: ${weightKg}kg, height: ${heightCm}cm, sex: ${sex}. ` +
    `Circumferences used: ${circumferencesUsed.join(", ") || "none"}. ` +
    `Uncertainty: ±${uncertainty}%. Data quality: ${Math.round(completeness.dataQualityScore * 100)}%.`;

  return {
    bodyFatPercent: Math.round(bodyFatPercent * 10) / 10,
    uncertaintyPct: uncertainty,
    method,
    confidence: Math.round(confidence * 1000) / 1000,
    asOf: latest.recordedAt.split("T")[0] as CalendarDate,
    inputs: {
      weightKg,
      circumferencesUsed,
      measurementCount: measurements.length,
    },
    basisNote,
  };
}

// -----------------------------------------------------------------------------
// Aggregate measurement analysis
// -----------------------------------------------------------------------------

export interface FullMeasurementAnalysis {
  weightTrend: WeightTrendAnalysis;
  circumferenceTrends: readonly CircumferenceTrendAnalysis[];
  completeness: MeasurementCompleteness;
  composition?: BodyCompositionEstimate;
}

export function analyzeBodyMeasurements(
  measurements: readonly BodyMeasurement[],
  heightCm: number,
  sex: "male" | "female",
  measurementConfig: MeasurementAnalysisConfig = DEFAULT_MEASUREMENT_ANALYSIS_CONFIG,
  compositionConfig: BodyCompositionConfig = DEFAULT_BODY_COMPOSITION_CONFIG,
): FullMeasurementAnalysis {
  const weightTrend = analyzeWeightTrend(measurements, measurementConfig);
  const circumferenceTrends = analyzeCircumferenceTrends(measurements, measurementConfig);
  const completeness = assessMeasurementCompleteness(measurements, measurementConfig);
  const composition = completeness.canEstimateComposition
    ? estimateBodyComposition(measurements, heightCm, sex, compositionConfig, measurementConfig) ?? undefined
    : undefined;

  return {
    weightTrend,
    circumferenceTrends,
    completeness,
    composition,
  };
}