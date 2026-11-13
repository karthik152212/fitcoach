import type { NutritionTargets } from "@fitcoach/domain";
import type { BodyAssessment, BodyContextForIntegration } from "./types";

/**
 * Cross-engine integration hooks.
 * Body engine provides context to nutrition, training planner, recovery, and adaptation engines.
 * No circular dependencies — body engine is a pure consumer of other engines' outputs,
 * and provides derived context via explicit interfaces.
 */

// -----------------------------------------------------------------------------
// Body context for nutrition targets
// -----------------------------------------------------------------------------

export interface BodyContextForNutrition {
  /** Weight trend direction for TDEE adjustment. */
  weightTrendDirection: "increasing" | "decreasing" | "stable" | "insufficient_data";
  /** Weight change rate (kg/week). */
  weightSlopeKgPerWeek: number | null;
  /** Body composition confidence (0-1). */
  compositionConfidence: number;
  /** Estimated body fat percentage (if available). */
  bodyFatPercent?: number;
  /** Whether user is in a gaining/losing/maintenance phase per physique goals. */
  physiqueDirection?: "gain" | "lose" | "maintain" | "recomp";
  /** Primary physique priority. */
  primaryPhysiquePriority?: string;
  /** Muscle development gaps (lagging priority muscles). */
  muscleDevelopmentGaps: readonly string[];
  /** Measurement data quality score (0-1). */
  dataQualityScore: number;
}

/**
 * Extract body context for nutrition target derivation.
 * Called by nutrition engine when computing targets.
 */
export function getBodyContextForNutrition(
  assessment: BodyAssessment,
  physiqueGoal: { priorities: readonly string[]; direction?: string } | null,
): BodyContextForNutrition {
  const primaryPriority = physiqueGoal?.priorities[0];

  return {
    weightTrendDirection: assessment.weightTrend.direction,
    weightSlopeKgPerWeek: assessment.weightTrend.slopeKgPerWeek,
    compositionConfidence: assessment.composition?.confidence ?? 0,
    bodyFatPercent: assessment.composition?.bodyFatPercent,
    physiqueDirection: physiqueGoal?.direction as BodyContextForNutrition["physiqueDirection"],
    primaryPhysiquePriority: primaryPriority,
    muscleDevelopmentGaps: assessment.muscleDevelopment
      .filter((d) => d.developmentStatus === "regressing" || (d.developmentStatus === "maintaining" && d.trainingExposureScore < 40))
      .map((d) => d.muscle),
    dataQualityScore: assessment.completeness.dataQualityScore,
  };
}

/**
 * Adjust nutrition targets based on body context.
 * Returns adjustment factors for calories and protein.
 */
export function adjustNutritionTargetsFromBodyContext(
  baseTargets: NutritionTargets,
  bodyContext: BodyContextForNutrition,
): { caloriesKcal: number; proteinGrams: number; adjustments: readonly string[] } {
  let caloriesKcal = baseTargets.caloriesKcal;
  let proteinGrams = baseTargets.proteinGrams;
  const adjustments: string[] = [];

  // Weight trend vs goal direction adjustments
  if (bodyContext.physiqueDirection === "gain" && bodyContext.weightTrendDirection !== "increasing") {
    const surplus = Math.min(300, 200 * (1 - (bodyContext.weightSlopeKgPerWeek ?? 0) / 0.25));
    caloriesKcal = Math.round(caloriesKcal + surplus);
    adjustments.push(`+${Math.round(surplus)} kcal: weight not increasing despite gain goal`);
  }

  if (bodyContext.physiqueDirection === "lose" && bodyContext.weightTrendDirection !== "decreasing") {
    const deficit = Math.min(250, 150 * (1 + (bodyContext.weightSlopeKgPerWeek ?? 0) / 0.25));
    caloriesKcal = Math.max(1200, Math.round(caloriesKcal - deficit));
    adjustments.push(`-${Math.round(deficit)} kcal: weight not decreasing despite loss goal`);
  }

  if (bodyContext.physiqueDirection === "recomp") {
    // Recomp: small adjustments based on trend
    if (bodyContext.weightTrendDirection === "increasing" && (bodyContext.weightSlopeKgPerWeek ?? 0) > 0.15) {
      caloriesKcal = Math.round(caloriesKcal * 0.97);
      adjustments.push("-3% kcal: weight increasing faster than recomp target");
    } else if (bodyContext.weightTrendDirection === "decreasing" && (bodyContext.weightSlopeKgPerWeek ?? 0) < -0.15) {
      caloriesKcal = Math.round(caloriesKcal * 1.03);
      adjustments.push("+3% kcal: weight decreasing faster than recomp target");
    }
  }

  // Protein adjustment based on body composition confidence and muscle gaps
  if (bodyContext.compositionConfidence > 0.5 && bodyContext.bodyFatPercent !== undefined) {
    if (bodyContext.bodyFatPercent > 25 && bodyContext.muscleDevelopmentGaps.length > 0) {
      // Higher protein for muscle retention during fat loss
      proteinGrams = Math.round(proteinGrams * 1.1);
      adjustments.push("+10% protein: elevated body fat with muscle development gaps");
    }
  }

  // Muscle development gaps → slight protein increase
  if (bodyContext.muscleDevelopmentGaps.length > 0) {
    proteinGrams = Math.round(proteinGrams * 1.05);
    adjustments.push(`+5% protein: ${bodyContext.muscleDevelopmentGaps.length} priority muscle(s) lagging`);
  }

  // Data quality warning
  if (bodyContext.dataQualityScore < 0.5) {
    adjustments.push("⚠ Low measurement data quality — adjustments are conservative");
  }

  return { caloriesKcal, proteinGrams, adjustments };
}

// -----------------------------------------------------------------------------
// Body context for training planner
// -----------------------------------------------------------------------------

export interface BodyContextForTraining {
  /** Muscle development gaps (lagging priority muscles). */
  muscleDevelopmentGaps: readonly string[];
  /** Disproportionate development flags (rule IDs). */
  disproportionateFlags: readonly string[];
  /** Muscle development highlights (progressing well). */
  muscleDevelopmentHighlights: readonly string[];
  /** Volume appropriateness per muscle. */
  volumeAppropriateness: Readonly<Record<string, "insufficient" | "appropriate" | "excessive" | "unknown">>;
  /** Recovery context per muscle. */
  recoveryContext: Readonly<Record<string, "supportive" | "neutral" | "limiting">>;
  /** Overall goal-relative progress. */
  goalRelativeProgress: "on_track" | "needs_attention" | "insufficient_data";
}

/**
 * Extract body context for training planner.
 */
export function getBodyContextForTraining(
  assessment: BodyAssessment,
): BodyContextForTraining {
  const volumeAppropriateness: Record<string, "insufficient" | "appropriate" | "excessive" | "unknown"> = {};
  const recoveryContext: Record<string, "supportive" | "neutral" | "limiting"> = {};

  for (const dev of assessment.muscleDevelopment) {
    volumeAppropriateness[dev.muscle] = dev.volumeAppropriateness;
    recoveryContext[dev.muscle] = dev.recoveryContext;
  }

  return {
    muscleDevelopmentGaps: assessment.muscleDevelopment
      .filter((d) => d.developmentStatus === "regressing" || (d.developmentStatus === "maintaining" && d.trainingExposureScore < 40))
      .map((d) => d.muscle),
    disproportionateFlags: assessment.disproportionateDevelopment.map((d) => d.ruleId),
    muscleDevelopmentHighlights: assessment.muscleDevelopment
      .filter((d) => d.developmentStatus === "progressing" && d.confidence > 0.6)
      .map((d) => d.muscle),
    volumeAppropriateness,
    recoveryContext,
    goalRelativeProgress: assessment.goalRelativeProgress,
  };
}

/**
 * Generate training adjustments from body context.
 * Called by training planner when constructing/modifying a plan.
 */
export function getTrainingAdjustmentsFromBodyContext(
  bodyContext: BodyContextForTraining,
): {
  volumeAdjustments: readonly { muscle: string; direction: "increase" | "decrease"; reason: string }[];
  exerciseSelectionHints: readonly string[];
  frequencyHints: readonly string[];
} {
  const volumeAdjustments: { muscle: string; direction: "increase" | "decrease"; reason: string }[] = [];
  const exerciseSelectionHints: string[] = [];
  const frequencyHints: string[] = [];

  // Volume adjustments from muscle development gaps
  for (const muscle of bodyContext.muscleDevelopmentGaps) {
    const volumeStatus = bodyContext.volumeAppropriateness[muscle];
    const recovery = bodyContext.recoveryContext[muscle];

    if (volumeStatus === "insufficient" && recovery !== "limiting") {
      volumeAdjustments.push({
        muscle,
        direction: "increase",
        reason: `Priority muscle ${muscle} lagging with insufficient volume`,
      });
    } else if (volumeStatus === "excessive" || recovery === "limiting") {
      volumeAdjustments.push({
        muscle,
        direction: "decrease",
        reason: `Priority muscle ${muscle} has ${volumeStatus} volume and recovery is ${recovery}`,
      });
    }
  }

  // Disproportionate flags → exercise selection hints
  for (const flag of bodyContext.disproportionateFlags) {
    if (flag.includes("symmetry") || flag.includes("asymmetric")) {
      exerciseSelectionHints.push("Include unilateral work for symmetry flags");
      frequencyHints.push("Balance left/right volume for asymmetric muscles");
    }
    if (flag.includes("shoulder") || flag.includes("lateral")) {
      exerciseSelectionHints.push("Prioritize lateral delt exercises (cable lateral raise, upright row, face pull)");
    }
    if (flag.includes("waist")) {
      exerciseSelectionHints.push("Limit direct oblique hypertrophy work; prioritize vacuums/core stability");
    }
    if (flag.includes("chest") || flag.includes("press")) {
      exerciseSelectionHints.push("Ensure pressing variety (incline, flat, decline) for complete chest development");
    }
    if (flag.includes("back") || flag.includes("lat")) {
      exerciseSelectionHints.push("Balance vertical (pull-up) and horizontal (row) pulling for back width");
    }
  }

  // Highlights → maintain
  for (const muscle of bodyContext.muscleDevelopmentHighlights) {
    volumeAdjustments.push({
      muscle,
      direction: "increase", // maintain = slight increase to continue progress
      reason: `Muscle ${muscle} progressing well — maintain stimulus`,
    });
  }

  // Overall progress
  if (bodyContext.goalRelativeProgress === "needs_attention") {
    exerciseSelectionHints.push("Overall physique progress needs attention — review plan holistically");
  }

  return {
    volumeAdjustments,
    exerciseSelectionHints: [...new Set(exerciseSelectionHints)],
    frequencyHints: [...new Set(frequencyHints)],
  };
}

// -----------------------------------------------------------------------------
// Body context for recovery engine
// -----------------------------------------------------------------------------

export interface BodyContextForRecovery {
  /** Body assessment signals that may limit recovery. */
  limitingBodySignals: readonly string[];
  /** Weight trend impact on recovery perception. */
  weightTrendImpact: "supportive" | "neutral" | "concerning";
  /** Muscle groups with limiting recovery context. */
  musclesWithLimitingRecovery: readonly string[];
}

/**
 * Extract body context for recovery engine.
 */
export function getBodyContextForRecovery(
  assessment: BodyAssessment,
): BodyContextForRecovery {
  const limitingSignals: string[] = [];

  // Rapid weight loss → concerning
  if (assessment.weightTrend.direction === "decreasing" &&
      assessment.weightTrend.slopeKgPerWeek !== null &&
      assessment.weightTrend.slopeKgPerWeek < -0.3) {
    limitingSignals.push("Rapid weight loss (>0.3 kg/week) may impair recovery");
  }

  // Rapid weight gain → concerning
  if (assessment.weightTrend.direction === "increasing" &&
      assessment.weightTrend.slopeKgPerWeek !== null &&
      assessment.weightTrend.slopeKgPerWeek > 0.4) {
    limitingSignals.push("Rapid weight gain (>0.4 kg/week) may indicate excess fatigue");
  }

  // Disproportionate flags with recovery implications
  for (const flag of assessment.disproportionateDevelopment) {
    if (flag.recommendedIntervention === "reassess_technique") {
      limitingSignals.push(`Asymmetry in ${flag.involvedMuscles.join("/")} — technique may contribute to uneven fatigue`);
    }
  }

  // Muscles with limiting recovery
  const musclesWithLimitingRecovery = assessment.muscleDevelopment
    .filter((d) => d.recoveryContext === "limiting")
    .map((d) => d.muscle);

  let weightTrendImpact: "supportive" | "neutral" | "concerning" = "neutral";
  if (assessment.weightTrend.direction === "stable") weightTrendImpact = "supportive";
  else if (assessment.weightTrend.direction === "insufficient_data") weightTrendImpact = "neutral";
  else if (Math.abs(assessment.weightTrend.slopeKgPerWeek ?? 0) > 0.3) weightTrendImpact = "concerning";

  return {
    limitingBodySignals: limitingSignals,
    weightTrendImpact,
    musclesWithLimitingRecovery,
  };
}

// -----------------------------------------------------------------------------
// Body context for adaptation engine
// -----------------------------------------------------------------------------

export interface BodyContextForAdaptation {
  /** Body-specific plateau signals. */
  bodyPlateauSignals: {
    type: "weight_stagnation" | "measurement_stagnation" | "composition_stagnation" | "muscle_development_stagnation";
    observation: string;
    severity: number;
    affectedMuscles?: readonly string[];
  }[];
  /** Goal-relative progress for adaptation context. */
  goalRelativeProgress: "on_track" | "needs_attention" | "insufficient_data";
}

/**
 * Extract body plateau signals for adaptation engine.
 */
export function getBodyContextForAdaptation(
  assessment: BodyAssessment,
): BodyContextForAdaptation {
  const signals: BodyContextForAdaptation["bodyPlateauSignals"] = [] as BodyContextForAdaptation["bodyPlateauSignals"];

  // Weight stagnation
  if (assessment.weightTrend.direction === "stable" && assessment.weightTrend.pointsUsed >= 14) {
    signals.push({
      type: "weight_stagnation",
      observation: `Weight stable for ${assessment.weightTrend.pointsUsed} readings (${(assessment.weightTrend.pointsUsed / 2).toFixed(0)} weeks)`,
      severity: 0.4,
    });
  }

  // Measurement stagnation for priority sites
  for (const trend of assessment.circumferenceTrends) {
    if (trend.direction === "stable" && trend.pointsUsed >= 6 && trend.confidence !== null && trend.confidence > 0.5) {
      signals.push({
        type: "measurement_stagnation",
        observation: `${trend.site} stable for ${trend.pointsUsed} readings`,
        severity: 0.3,
        affectedMuscles: [trend.site.replace("left_", "").replace("right_", "")],
      });
    }
  }

  // Muscle development stagnation
  for (const dev of assessment.muscleDevelopment) {
    if (dev.developmentStatus === "maintaining" && dev.trainingExposureScore >= 60 && dev.measurementTrend === "stable") {
      signals.push({
        type: "muscle_development_stagnation",
        observation: `${dev.muscle} maintaining despite high training exposure (${dev.trainingExposureScore}/100)`,
        severity: 0.5,
        affectedMuscles: [dev.muscle],
      });
    }
    if (dev.developmentStatus === "regressing" && dev.trainingExposureScore >= 40) {
      signals.push({
        type: "muscle_development_stagnation",
        observation: `${dev.muscle} regressing with training exposure ${dev.trainingExposureScore}/100`,
        severity: 0.7,
        affectedMuscles: [dev.muscle],
      });
    }
  }

  return {
    bodyPlateauSignals: signals,
    goalRelativeProgress: assessment.goalRelativeProgress,
  };
}

// -----------------------------------------------------------------------------
// Unified integration interface
// -----------------------------------------------------------------------------

export interface BodyEngineIntegrationOutput {
  forNutrition: BodyContextForNutrition;
  forTraining: BodyContextForTraining;
  forRecovery: BodyContextForRecovery;
  forAdaptation: BodyContextForAdaptation;
}

/**
 * Generate all integration contexts from a single body assessment.
 * Single entry point for cross-engine consumption.
 */
export function generateIntegrationContexts(
  assessment: BodyAssessment,
  physiqueGoal: { priorities: readonly string[]; direction?: string } | null,
): BodyEngineIntegrationOutput {
  return {
    forNutrition: getBodyContextForNutrition(assessment, physiqueGoal),
    forTraining: getBodyContextForTraining(assessment),
    forRecovery: getBodyContextForRecovery(assessment),
    forAdaptation: getBodyContextForAdaptation(assessment),
  };
}

/**
 * Build body context for cross-engine integration (simplified interface).
 */
export function buildBodyContextForIntegration(
  assessment: BodyAssessment,
): BodyContextForIntegration {
  return {
    weightTrendDirection: assessment.weightTrend.direction,
    weightSlopeKgPerWeek: assessment.weightTrend.slopeKgPerWeek,
    compositionConfidence: assessment.composition?.confidence ?? 0,
    muscleDevelopmentGaps: assessment.muscleDevelopment
      .filter((d) => d.developmentStatus === "regressing" || (d.developmentStatus === "maintaining" && d.trainingExposureScore < 40))
      .map((d) => d.muscle),
    disproportionateFlags: assessment.disproportionateDevelopment.map((d) => d.ruleId),
    goalRelativeProgress: assessment.goalRelativeProgress,
  };
}