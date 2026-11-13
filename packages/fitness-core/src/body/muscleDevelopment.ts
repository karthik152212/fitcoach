import type { MuscleGroup } from "@fitcoach/domain";
import type { MuscleCoverageReport } from "../muscleCoverage";
import type { WeeklyVolumeReport } from "../volume";
import type { RecoveryState } from "@fitcoach/domain";
import type { MuscleDevelopment } from "./types";
import { DEFAULT_MUSCLE_DEVELOPMENT_CONFIG, type MuscleDevelopmentConfig } from "./configuration";

/**
 * Muscle development analysis.
 * Combines training exposure (from muscleCoverage), measurement trends,
 * recovery context, and volume appropriateness to assess development status.
 */

export interface MuscleDevelopmentInput {
  /** Muscle coverage report from planned training. */
  coverageReport: MuscleCoverageReport;
  /** Weekly volume report with target comparison. */
  volumeReport: WeeklyVolumeReport;
  /** Circumference trends for measurable muscles. */
  circumferenceTrends: readonly {
    site: string;
    direction: "increasing" | "decreasing" | "stable" | "insufficient_data";
    slopeCmPerWeek: number | null;
    confidence: number | null;
  }[];
  /** Recovery state for context. */
  recoveryState?: RecoveryState;
  /** User's physique goal for priority context. */
  physiqueGoalPriorities?: readonly string[];
  /** Experience level for volume targets. */
  experience?: "novice" | "intermediate" | "advanced";
  /** Goal profile for volume targets. */
  goalProfile?: string;
}

interface MuscleMapping {
  muscleGroup: MuscleGroup;
  circumferenceSites: string[];
  coverageMuscleIds: string[];
  volumeMuscleSlugs: string[];
}

const MUSCLE_MAPPINGS: readonly MuscleMapping[] = [
  { muscleGroup: "chest", circumferenceSites: ["chest"], coverageMuscleIds: ["chest"], volumeMuscleSlugs: ["chest"] },
  { muscleGroup: "upper_back", circumferenceSites: [], coverageMuscleIds: ["lats", "traps", "rear_delts"], volumeMuscleSlugs: ["lats", "traps", "rear_delts"] },
  { muscleGroup: "front_delts", circumferenceSites: ["shoulders"], coverageMuscleIds: ["front_delts"], volumeMuscleSlugs: ["front_delts"] },
  { muscleGroup: "side_delts", circumferenceSites: ["shoulders"], coverageMuscleIds: ["side_delts"], volumeMuscleSlugs: ["side_delts"] },
  { muscleGroup: "rear_delts", circumferenceSites: ["shoulders"], coverageMuscleIds: ["rear_delts"], volumeMuscleSlugs: ["rear_delts"] },
  { muscleGroup: "biceps", circumferenceSites: ["left_upper_arm", "right_upper_arm"], coverageMuscleIds: ["biceps"], volumeMuscleSlugs: ["biceps"] },
  { muscleGroup: "triceps", circumferenceSites: ["left_upper_arm", "right_upper_arm"], coverageMuscleIds: ["triceps"], volumeMuscleSlugs: ["triceps"] },
  { muscleGroup: "forearms", circumferenceSites: [], coverageMuscleIds: ["forearms"], volumeMuscleSlugs: ["forearms"] },
  { muscleGroup: "quadriceps", circumferenceSites: ["left_thigh", "right_thigh"], coverageMuscleIds: ["quadriceps"], volumeMuscleSlugs: ["quadriceps"] },
  { muscleGroup: "hamstrings", circumferenceSites: ["left_thigh", "right_thigh"], coverageMuscleIds: ["hamstrings"], volumeMuscleSlugs: ["hamstrings"] },
  { muscleGroup: "glutes", circumferenceSites: ["hips", "left_thigh", "right_thigh"], coverageMuscleIds: ["glutes"], volumeMuscleSlugs: ["glutes"] },
  { muscleGroup: "calves", circumferenceSites: ["left_calf", "right_calf"], coverageMuscleIds: ["calves"], volumeMuscleSlugs: ["calves"] },
  { muscleGroup: "abdominals", circumferenceSites: ["waist"], coverageMuscleIds: ["abdominals"], volumeMuscleSlugs: ["abdominals"] },
  { muscleGroup: "obliques", circumferenceSites: ["waist"], coverageMuscleIds: ["obliques"], volumeMuscleSlugs: ["obliques"] },
  { muscleGroup: "lower_back", circumferenceSites: [], coverageMuscleIds: ["lower_back"], volumeMuscleSlugs: ["lower_back"] },
  { muscleGroup: "traps", circumferenceSites: [], coverageMuscleIds: ["traps"], volumeMuscleSlugs: ["traps"] },
  { muscleGroup: "lats", circumferenceSites: [], coverageMuscleIds: ["lats"], volumeMuscleSlugs: ["lats"] },
];

/**
 * Assess muscle development for all tracked muscle groups.
 * Returns empty array when there's no training or measurement data to assess.
 */
export function assessMuscleDevelopment(
  input: MuscleDevelopmentInput,
  config: MuscleDevelopmentConfig = DEFAULT_MUSCLE_DEVELOPMENT_CONFIG,
): readonly MuscleDevelopment[] {
  // Return early if no data to assess
  const hasCoverageData = input.coverageReport?.perMuscle?.length > 0;
  const hasVolumeData = input.volumeReport?.byMuscle?.length > 0;
  const hasCircumferenceData = input.circumferenceTrends?.length > 0;
  const hasRecoveryData = input.recoveryState !== undefined;
  const hasPriorities = (input.physiqueGoalPriorities?.length ?? 0) > 0;

  if (!hasCoverageData && !hasVolumeData && !hasCircumferenceData && !hasRecoveryData && !hasPriorities) {
    return [];
  }

  const results: MuscleDevelopment[] = [];

  for (const mapping of MUSCLE_MAPPINGS) {
    const development = assessSingleMuscleDevelopment(mapping, input, config);
    results.push(development);
  }

  return results;
}

function assessSingleMuscleDevelopment(
  mapping: MuscleMapping,
  input: MuscleDevelopmentInput,
  config: MuscleDevelopmentConfig,
): MuscleDevelopment {
  // 1. Training exposure score (0-100)
  const trainingExposureScore = calculateTrainingExposureScore(mapping, input.coverageReport, config);

  // 2. Measurement trend (if applicable)
  const measurementTrend = getMeasurementTrend(mapping, input.circumferenceTrends);

  // 3. Recovery context
  const recoveryContext = assessRecoveryContext(input.recoveryState);

  // 4. Volume appropriateness
  const volumeAppropriateness = assessVolumeAppropriatenessForMuscle(mapping, input.volumeReport);

  // 5. Overall development status
  const { developmentStatus, confidence, evidence } = determineDevelopmentStatus(
    mapping.muscleGroup,
    trainingExposureScore,
    measurementTrend,
    recoveryContext,
    volumeAppropriateness,
    input.physiqueGoalPriorities ?? [],
    config,
  );

  return {
    muscle: mapping.muscleGroup,
    trainingExposureScore,
    measurementTrend: measurementTrend?.direction,
    measurementSlopePerWeek: measurementTrend?.slopeCmPerWeek ?? null,
    measurementConfidence: measurementTrend?.confidence ?? null,
    recoveryContext,
    volumeAppropriateness,
    developmentStatus,
    confidence,
    evidence,
  };
}

function calculateTrainingExposureScore(
  mapping: MuscleMapping,
  coverageReport: MuscleCoverageReport,
  config: MuscleDevelopmentConfig,
): number {
  let totalPrimary = 0;
  let totalSecondary = 0;

  for (const muscleId of mapping.coverageMuscleIds) {
    const entry = coverageReport.perMuscle.find((e) => e.muscleId === muscleId);
    if (entry) {
      totalPrimary += entry.primaryWeeklySets;
      totalSecondary += entry.secondaryWeeklySets;
    }
  }

  // Weighted: primary sets count fully, secondary at 0.5
  const effectiveSets = totalPrimary + totalSecondary * 0.5;

  // Convert to 0-100 score using thresholds
  const { low, moderate, high } = config.trainingExposureThresholds;

  if (effectiveSets >= high) return 100;
  if (effectiveSets >= moderate) return 60 + 40 * (effectiveSets - moderate) / (high - moderate);
  if (effectiveSets >= low) return 30 + 30 * (effectiveSets - low) / (moderate - low);
  return Math.max(0, 30 * effectiveSets / low);
}

function getMeasurementTrend(
  mapping: MuscleMapping,
  circumferenceTrends: readonly {
    site: string;
    direction: "increasing" | "decreasing" | "stable" | "insufficient_data";
    slopeCmPerWeek: number | null;
    confidence: number | null;
  }[],
): { direction: "increasing" | "decreasing" | "stable" | "insufficient_data"; slopeCmPerWeek: number | null; confidence: number | null } | null {
  if (mapping.circumferenceSites.length === 0) return null;

  const relevantTrends = circumferenceTrends.filter((t) =>
    mapping.circumferenceSites.includes(t.site)
  );

  if (relevantTrends.length === 0) return null;

  // Average the trends
  const validTrends = relevantTrends.filter((t) => t.direction !== "insufficient_data");
  if (validTrends.length === 0) return null;

  const avgSlope = validTrends.reduce((s, t) => s + (t.slopeCmPerWeek ?? 0), 0) / validTrends.length;
  const avgConfidence = validTrends.reduce((s, t) => s + (t.confidence ?? 0), 0) / validTrends.length;

  // Determine consensus direction
  const increasingCount = validTrends.filter((t) => t.direction === "increasing").length;
  const decreasingCount = validTrends.filter((t) => t.direction === "decreasing").length;
  const stableCount = validTrends.filter((t) => t.direction === "stable").length;

  let direction: "increasing" | "decreasing" | "stable" | "insufficient_data" = "insufficient_data";
  if (increasingCount > decreasingCount && increasingCount > stableCount) direction = "increasing";
  else if (decreasingCount > increasingCount && decreasingCount > stableCount) direction = "decreasing";
  else if (stableCount > increasingCount && stableCount > decreasingCount) direction = "stable";
  else direction = "stable"; // tie goes to stable

  return { direction, slopeCmPerWeek: avgSlope, confidence: avgConfidence };
}

function assessRecoveryContext(recoveryState?: RecoveryState): "supportive" | "neutral" | "limiting" {
  if (!recoveryState) return "neutral";

  const { readinessScore, fatigueAccumulation, sleepAdequacy } = recoveryState;

  if (readinessScore >= 75 && fatigueAccumulation === "low" && sleepAdequacy === "adequate") {
    return "supportive";
  }
  if (readinessScore < 50 || fatigueAccumulation === "very_high" || sleepAdequacy === "severe_debt") {
    return "limiting";
  }
  return "neutral";
}

function assessVolumeAppropriatenessForMuscle(
  mapping: MuscleMapping,
  volumeReport: WeeklyVolumeReport,
): "insufficient" | "appropriate" | "excessive" | "unknown" {
  let totalEffectiveSets = 0;
  let hasTarget = false;

  for (const slug of mapping.volumeMuscleSlugs) {
    const entry = volumeReport.byMuscle.find((e) => e.muscleSlug === slug);
    if (entry) {
      totalEffectiveSets += entry.totalEffectiveSets;
      hasTarget = true;
    }
  }

  if (!hasTarget) return "unknown";

  // Check against volume report flags
  const isUnderTarget = mapping.volumeMuscleSlugs.some((s) =>
    volumeReport.underTargetMuscles.includes(s)
  );
  const isExcessive = mapping.volumeMuscleSlugs.some((s) =>
    volumeReport.potentiallyExcessiveMuscles.includes(s)
  );

  if (isUnderTarget) return "insufficient";
  if (isExcessive) return "excessive";
  return "appropriate";
}

function determineDevelopmentStatus(
  muscleGroup: MuscleGroup,
  trainingExposureScore: number,
  measurementTrend: { direction: string; slopeCmPerWeek: number | null; confidence: number | null } | null,
  recoveryContext: "supportive" | "neutral" | "limiting",
  volumeAppropriateness: "insufficient" | "appropriate" | "excessive" | "unknown",
  physiqueGoalPriorities: readonly string[],
  config: MuscleDevelopmentConfig,
): { developmentStatus: MuscleDevelopment["developmentStatus"]; confidence: number; evidence: readonly string[] } {
  const evidence: string[] = [];

  // Training exposure evidence
  if (trainingExposureScore >= config.trainingExposureThresholds.high) {
    evidence.push(`High training exposure (${trainingExposureScore}/100)`);
  } else if (trainingExposureScore >= config.trainingExposureThresholds.moderate) {
    evidence.push(`Moderate training exposure (${trainingExposureScore}/100)`);
  } else {
    evidence.push(`Low training exposure (${trainingExposureScore}/100)`);
  }

  // Volume evidence
  if (volumeAppropriateness === "insufficient") {
    evidence.push("Volume below target range");
  } else if (volumeAppropriateness === "excessive") {
    evidence.push("Volume above caution range");
  } else if (volumeAppropriateness === "appropriate") {
    evidence.push("Volume within target range");
  }

  // Recovery evidence
  if (recoveryContext === "supportive") {
    evidence.push("Recovery supportive");
  } else if (recoveryContext === "limiting") {
    evidence.push("Recovery limiting");
  } else {
    evidence.push("Recovery neutral");
  }

  // Measurement evidence
  let measurementSupportsProgress = false;

  if (measurementTrend) {
    if (measurementTrend.direction === "increasing" && (measurementTrend.slopeCmPerWeek ?? 0) > 0.05) {
      evidence.push(`Measurement trend: increasing (${measurementTrend.slopeCmPerWeek?.toFixed(2)} cm/week)`);
      measurementSupportsProgress = true;
    } else if (measurementTrend.direction === "decreasing" && (measurementTrend.slopeCmPerWeek ?? 0) < -0.05) {
      evidence.push(`Measurement trend: decreasing (${measurementTrend.slopeCmPerWeek?.toFixed(2)} cm/week)`);
      measurementSupportsProgress = false;
    } else {
      evidence.push("Measurement trend: stable");
      measurementSupportsProgress = true; // maintaining is progress for maintenance
    }
  } else {
    evidence.push("No measurement trend data");
  }

  // Priority boost
  const isPriority = physiqueGoalPriorities.some((p) =>
    p.toLowerCase().includes(muscleGroup.toLowerCase()) ||
    (muscleGroup === "biceps" || muscleGroup === "triceps") && p.includes("arm") ||
    (muscleGroup === "quadriceps" || muscleGroup === "hamstrings" || muscleGroup === "glutes") && p.includes("leg") ||
    (muscleGroup === "front_delts" || muscleGroup === "side_delts" || muscleGroup === "rear_delts") && p.includes("shoulder") ||
    (muscleGroup === "chest") && p.includes("chest") ||
    (muscleGroup === "upper_back" || muscleGroup === "lats" || muscleGroup === "traps") && p.includes("back")
  );

  if (isPriority) {
    evidence.push("Priority muscle for user's physique goals");
  }

  // Determine status
  const weights = {
    training: config.trainingExposureWeight,
    measurement: config.measurementTrendWeight,
    recovery: config.recoveryContextWeight,
    volume: config.volumeAppropriatenessWeight,
  };

  const recoveryScore = config.recoveryContextScores[recoveryContext];
  const trainingScore = trainingExposureScore / 100;
  const measurementScore = measurementTrend
    ? measurementTrend.direction === "increasing" ? 1.0
      : measurementTrend.direction === "stable" ? 0.7
      : 0.3
    : 0.5;
  const volumeScore = volumeAppropriateness === "appropriate" ? 1.0
    : volumeAppropriateness === "insufficient" ? 0.4
    : volumeAppropriateness === "excessive" ? 0.6
    : 0.5;

  const compositeScore =
    weights.training * trainingScore +
    weights.measurement * measurementScore +
    weights.recovery * recoveryScore +
    weights.volume * volumeScore;

  let developmentStatus: MuscleDevelopment["developmentStatus"];
  let confidence = compositeScore;

  // Adjust confidence based on data availability
  if (!measurementTrend) confidence *= 0.7;
  if (volumeAppropriateness === "unknown") confidence *= 0.8;

  // Apply minimum confidence threshold
  if (confidence < config.minConfidenceForAssessment) {
    developmentStatus = "insufficient_data";
    confidence = Math.max(confidence, 0.3);
  } else if (compositeScore >= 0.7 && measurementSupportsProgress) {
    developmentStatus = "progressing";
  } else if (compositeScore >= 0.5) {
    developmentStatus = "maintaining";
  } else {
    developmentStatus = "regressing";
  }

  return { developmentStatus, confidence: Math.round(confidence * 1000) / 1000, evidence: evidence as readonly string[] };
}

/**
 * Get muscle development gaps — muscles that are priorities but underdeveloped.
 */
export function getMuscleDevelopmentGaps(
  muscleDevelopment: readonly MuscleDevelopment[],
  physiqueGoalPriorities: readonly string[],
): readonly string[] {
  const gaps: string[] = [];

  for (const dev of muscleDevelopment) {
    const isPriority = physiqueGoalPriorities.some((p) =>
      p.toLowerCase().includes(dev.muscle.toLowerCase()) ||
      (dev.muscle === "biceps" || dev.muscle === "triceps") && p.includes("arm") ||
      (dev.muscle === "quadriceps" || dev.muscle === "hamstrings" || dev.muscle === "glutes") && p.includes("leg") ||
      (dev.muscle === "front_delts" || dev.muscle === "side_delts" || dev.muscle === "rear_delts") && p.includes("shoulder") ||
      (dev.muscle === "chest") && p.includes("chest") ||
      (dev.muscle === "upper_back" || dev.muscle === "lats" || dev.muscle === "traps") && p.includes("back")
    );

    if (isPriority && (dev.developmentStatus === "regressing" || dev.developmentStatus === "maintaining" || dev.trainingExposureScore < 40)) {
      gaps.push(dev.muscle);
    }
  }

  return gaps;
}

/**
 * Get muscle development highlights — muscles progressing well.
 */
export function getMuscleDevelopmentHighlights(
  muscleDevelopment: readonly MuscleDevelopment[],
): readonly string[] {
  return muscleDevelopment
    .filter((d) => d.developmentStatus === "progressing" && d.confidence > 0.6)
    .map((d) => d.muscle);
}