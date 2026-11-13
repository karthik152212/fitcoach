import type { CalendarDate, MuscleGroup } from "@fitcoach/domain";
import type {
  BodyAssessment,
  DisproportionateDevelopment,
  MuscleDevelopment,
  BodyRecommendation,
  PhysiquePriorityTag,
} from "./types";
import { DEFAULT_RECOMMENDATIONS_CONFIG, type RecommendationsConfig } from "./configuration";

/**
 * Body recommendations — proportionate interventions.
 * Categories: maintain, collect_more_data, adjust_nutrition, review_training, reassess_technique, no_change
 */

export interface RecommendationInput {
  /** Complete body assessment. */
  assessment: BodyAssessment;
  /** User's physique goal. */
  physiqueGoal: { priorities: readonly PhysiquePriorityTag[]; direction?: string } | null;
  /** Current date. */
  asOf: CalendarDate;
}

/**
 * Generate proportionate body recommendations from assessment.
 */
export function generateBodyRecommendations(
  input: RecommendationInput,
  config: RecommendationsConfig = DEFAULT_RECOMMENDATIONS_CONFIG,
): readonly BodyRecommendation[] {
  const recommendations: BodyRecommendation[] = [];

  // 1. Recommendations from disproportionate development flags
  for (const flag of input.assessment.disproportionateDevelopment) {
    const rec = recommendationFromFlag(flag, input, config);
    if (rec) recommendations.push(rec);
  }

  // 2. Recommendations from muscle development gaps
  const priorityGaps = getPriorityMuscleGaps(input.assessment.muscleDevelopment, input.physiqueGoal?.priorities ?? []);
  for (const gap of priorityGaps) {
    const rec = recommendationFromMuscleGap(gap, input, config);
    if (rec) recommendations.push(rec);
  }

  // 3. Data completeness recommendations
  const dataRecs = recommendationsFromDataCompleteness(input.assessment, config);
  recommendations.push(...dataRecs);

  // 4. Weight trend recommendations
  const weightRecs = recommendationsFromWeightTrend(input.assessment.weightTrend, input.physiqueGoal, config);
  recommendations.push(...weightRecs);

  // 5. Maintain recommendations for positive progress (when on track with no issues)
  const maintainRecs = recommendationsForPositiveProgress(input.assessment, input.physiqueGoal, config);
  recommendations.push(...maintainRecs);

  // Deduplicate by category + related rules
  const unique = deduplicateRecommendations(recommendations);

  // Sort by category priority, then by confidence (desc)
  unique.sort((a, b) => {
    const aPriority = config.categoryPriority.indexOf(a.category);
    const bPriority = config.categoryPriority.indexOf(b.category);
    if (aPriority !== bPriority) return aPriority - bPriority;
    return b.confidence - a.confidence;
  });

  // Limit concurrent recommendations
  return unique.slice(0, config.maxConcurrentRecommendations);
}

function recommendationFromFlag(
  flag: DisproportionateDevelopment,
  _input: RecommendationInput,
  config: RecommendationsConfig,
): BodyRecommendation | null {
  if (flag.confidence < config.minConfidenceToRecommend) return null;

  let recommendation: string;
  let rationale: string;

  switch (flag.recommendedIntervention) {
    case "adjust_nutrition":
      recommendation = `Adjust nutrition to support ${flag.priorityTag.replace("_", " ")} goal`;
      rationale = `Evidence suggests ${flag.observation.toLowerCase()}. ${flag.basisNote}`;
      break;
    case "review_training":
      recommendation = `Review training volume for ${flag.involvedMuscles.join(", ")}`;
      rationale = `Training exposure for priority "${flag.priorityTag.replace("_", " ")}" appears insufficient: ${flag.observation}. ${flag.basisNote}`;
      break;
    case "reassess_technique":
      recommendation = `Reassess exercise technique for ${flag.involvedMuscles.join(" vs ")} symmetry`;
      rationale = `Asymmetry detected: ${flag.observation}. This may reflect technique bias or structural factors. ${flag.basisNote}`;
      break;
    case "collect_more_data":
      recommendation = `Continue tracking measurements for ${flag.priorityTag.replace("_", " ")}`;
      rationale = `Current data suggests a pattern but observation window is limited: ${flag.observation}. ${flag.basisNote}`;
      break;
    case "maintain":
      recommendation = `Maintain current approach for ${flag.priorityTag.replace("_", " ")}`;
      rationale = `Development appears on track: ${flag.observation}. ${flag.basisNote}`;
      break;
    case "no_change":
      return null; // No recommendation needed
    default:
      return null;
  }

  return {
    category: flag.recommendedIntervention,
    priority: config.categoryPriority.indexOf(flag.recommendedIntervention) + 1,
    relatedRules: [flag.ruleId],
    recommendation,
    rationale,
    confidence: Math.round(flag.confidence * 1000) / 1000,
    reassessInWeeks: config.reassessWindows[flag.recommendedIntervention] ?? 4,
  } satisfies BodyRecommendation;
}

function recommendationFromMuscleGap(
  gap: { muscle: MuscleGroup; developmentStatus: string; trainingExposureScore: number; volumeAppropriateness: string },
  _input: RecommendationInput,
  config: RecommendationsConfig,
): BodyRecommendation | null {
  // Only recommend for regressing or maintaining priority muscles with low exposure
  if (gap.developmentStatus !== "regressing" && gap.developmentStatus !== "maintaining") return null;
  if (gap.trainingExposureScore >= 40) return null;

  const category = gap.volumeAppropriateness === "insufficient" ? "review_training" : "adjust_nutrition";

  if (category === "review_training") {
    return {
      category: "review_training",
      priority: config.categoryPriority.indexOf("review_training") + 1,
      relatedRules: [`muscle_gap_${gap.muscle}`],
      recommendation: `Increase training volume for ${gap.muscle.replace("_", " ")}`,
      rationale: `Priority muscle "${gap.muscle.replace("_", " ")}" shows ${gap.developmentStatus} status with low training exposure (${gap.trainingExposureScore}/100) and ${gap.volumeAppropriateness} volume.`,
      confidence: 0.65,
      reassessInWeeks: config.reassessWindows["review_training"] ?? 4,
    } satisfies BodyRecommendation;
  } else {
    return {
      category: "adjust_nutrition",
      priority: config.categoryPriority.indexOf("adjust_nutrition") + 1,
      relatedRules: [`muscle_gap_${gap.muscle}`],
      recommendation: `Adjust nutrition to support ${gap.muscle.replace("_", " ")} development`,
      rationale: `Priority muscle "${gap.muscle.replace("_", " ")}" is ${gap.developmentStatus} despite adequate training volume. Nutrition may be limiting.`,
      confidence: 0.55,
      reassessInWeeks: config.reassessWindows["adjust_nutrition"] ?? 4,
    } satisfies BodyRecommendation;
  }
}

function recommendationsFromDataCompleteness(
  assessment: BodyAssessment,
  config: RecommendationsConfig,
): BodyRecommendation[] {
  const recs: BodyRecommendation[] = [];

  if (!assessment.completeness.canEstimateComposition) {
    recs.push({
      category: "collect_more_data",
      priority: config.categoryPriority.indexOf("collect_more_data") + 1,
      relatedRules: ["data_completeness"],
      recommendation: `Log ${assessment.completeness.missingForComposition.slice(0, 2).join(" and ")} for body composition estimates`,
      rationale: `Body composition estimation requires at least ${2} circumference sites. Currently missing: ${assessment.completeness.missingForComposition.join(", ")}.`,
      confidence: 0.8,
      reassessInWeeks: config.reassessWindows["collect_more_data"] ?? 4,
    });
  }

  if (assessment.completeness.weightReadings < 7) {
    recs.push({
      category: "collect_more_data",
      priority: config.categoryPriority.indexOf("collect_more_data") + 1,
      relatedRules: ["data_completeness"],
      recommendation: "Log weight daily for reliable trend detection",
      rationale: `Only ${assessment.completeness.weightReadings} weight readings in the last 28 days. Minimum 7 needed for trend analysis.`,
      confidence: 0.7,
      reassessInWeeks: config.reassessWindows["collect_more_data"] ?? 4,
    });
  }

  return recs;
}

function recommendationsFromWeightTrend(
  weightTrend: { direction: string; slopeKgPerWeek: number | null; confidence: number | null },
  physiqueGoal: { priorities: readonly PhysiquePriorityTag[]; direction?: string } | null,
  config: RecommendationsConfig,
): BodyRecommendation[] {
  const recs: BodyRecommendation[] = [];

  if (weightTrend.direction === "insufficient_data") return recs;
  if (!physiqueGoal) return recs;

  const primaryGoal = physiqueGoal.priorities[0];
  const goalDirection = physiqueGoal.direction ?? "recomp";

  // Weight gain goal but weight stable/decreasing
  if ((goalDirection === "gain" || (primaryGoal === "overall_mass" && goalDirection !== "lose")) &&
      weightTrend.direction !== "increasing") {
    recs.push({
      category: "adjust_nutrition",
      priority: config.categoryPriority.indexOf("adjust_nutrition") + 1,
      relatedRules: ["weight_trend_vs_goal"],
      recommendation: "Increase caloric intake to support mass gain goal",
      rationale: `Goal direction is "${goalDirection}" but weight trend is ${weightTrend.direction} (${weightTrend.slopeKgPerWeek ? (weightTrend.slopeKgPerWeek * 4.33).toFixed(2) : "?"} kg/month).`,
      confidence: weightTrend.confidence ?? 0.5,
      reassessInWeeks: config.reassessWindows["adjust_nutrition"] ?? 4,
    } satisfies BodyRecommendation);
  }

  // Weight loss/leanness goal but weight increasing
  if ((goalDirection === "lose" || primaryGoal === "leanness") &&
      weightTrend.direction === "increasing") {
    recs.push({
      category: "adjust_nutrition",
      priority: config.categoryPriority.indexOf("adjust_nutrition") + 1,
      relatedRules: ["weight_trend_vs_goal"],
      recommendation: "Reduce caloric intake to support leanness goal",
      rationale: `Goal direction is "${goalDirection}" but weight trend is increasing (${(weightTrend.slopeKgPerWeek! * 4.33).toFixed(2)} kg/month).`,
      confidence: weightTrend.confidence ?? 0.5,
      reassessInWeeks: config.reassessWindows["adjust_nutrition"] ?? 4,
    } satisfies BodyRecommendation);
  }

  return recs;
}

function getPriorityMuscleGaps(
  muscleDevelopment: readonly MuscleDevelopment[],
  priorities: readonly PhysiquePriorityTag[],
): readonly { muscle: MuscleGroup; developmentStatus: string; trainingExposureScore: number; volumeAppropriateness: string }[] {
  const gaps: { muscle: MuscleGroup; developmentStatus: string; trainingExposureScore: number; volumeAppropriateness: string }[] = [];

  for (const dev of muscleDevelopment) {
    const isPriority = priorities.some((p) =>
      p.toLowerCase().includes(dev.muscle.toLowerCase()) ||
      (dev.muscle === "biceps" || dev.muscle === "triceps") && p.includes("arm") ||
      (dev.muscle === "quadriceps" || dev.muscle === "hamstrings" || dev.muscle === "glutes") && p.includes("leg") ||
      (dev.muscle === "front_delts" || dev.muscle === "side_delts" || dev.muscle === "rear_delts") && p.includes("shoulder") ||
      (dev.muscle === "chest") && p.includes("chest") ||
      (dev.muscle === "upper_back" || dev.muscle === "lats" || dev.muscle === "traps") && p.includes("back")
    );

    if (isPriority && (dev.developmentStatus === "regressing" || dev.developmentStatus === "maintaining")) {
      gaps.push({
        muscle: dev.muscle,
        developmentStatus: dev.developmentStatus,
        trainingExposureScore: dev.trainingExposureScore,
        volumeAppropriateness: dev.volumeAppropriateness,
      });
    }
  }

  return gaps;
}

function deduplicateRecommendations(
  recommendations: BodyRecommendation[],
): BodyRecommendation[] {
  const seen = new Map<string, BodyRecommendation>();

  for (const rec of recommendations) {
    const sortedRules = [...rec.relatedRules].sort();
    const key = `${rec.category}:${sortedRules.join(",")}`;
    const existing = seen.get(key);
    if (!existing || rec.confidence > existing.confidence) {
      seen.set(key, rec);
    }
  }

  return Array.from(seen.values());
}

/**
 * Generate maintain recommendations when progress is positive and no issues detected.
 */
function recommendationsForPositiveProgress(
  assessment: BodyAssessment,
  physiqueGoal: { priorities: readonly PhysiquePriorityTag[]; direction?: string } | null,
  config: RecommendationsConfig,
): BodyRecommendation[] {
  const recs: BodyRecommendation[] = [];

  // Only generate maintain recommendations if:
  // - Goal relative progress is on_track
  // - No high-severity disproportionate flags
  // - At least one priority muscle is progressing
  if (assessment.goalRelativeProgress !== "on_track") return recs;
  if (!physiqueGoal) return recs;

  const hasHighSeverityFlag = assessment.disproportionateDevelopment.some(
    (f) => f.severity >= 0.7 && f.recommendedIntervention !== "maintain"
  );
  if (hasHighSeverityFlag) return recs;

  // Check if any priority muscles are progressing
  const priorityMusclesProgressing = assessment.muscleDevelopment.some((dev) => {
    const isPriority = physiqueGoal.priorities.some((p) =>
      p.toLowerCase().includes(dev.muscle.toLowerCase()) ||
      (dev.muscle === "biceps" || dev.muscle === "triceps") && p.includes("arm") ||
      (dev.muscle === "quadriceps" || dev.muscle === "hamstrings" || dev.muscle === "glutes") && p.includes("leg") ||
      (dev.muscle === "front_delts" || dev.muscle === "side_delts" || dev.muscle === "rear_delts") && p.includes("shoulder") ||
      (dev.muscle === "chest") && p.includes("chest") ||
      (dev.muscle === "upper_back" || dev.muscle === "lats" || dev.muscle === "traps") && p.includes("back")
    );
    return isPriority && dev.developmentStatus === "progressing";
  });

  if (!priorityMusclesProgressing) return recs;

  // Generate maintain recommendations for each progressing priority muscle
  for (const dev of assessment.muscleDevelopment) {
    const isPriority = physiqueGoal.priorities.some((p) =>
      p.toLowerCase().includes(dev.muscle.toLowerCase()) ||
      (dev.muscle === "biceps" || dev.muscle === "triceps") && p.includes("arm") ||
      (dev.muscle === "quadriceps" || dev.muscle === "hamstrings" || dev.muscle === "glutes") && p.includes("leg") ||
      (dev.muscle === "front_delts" || dev.muscle === "side_delts" || dev.muscle === "rear_delts") && p.includes("shoulder") ||
      (dev.muscle === "chest") && p.includes("chest") ||
      (dev.muscle === "upper_back" || dev.muscle === "lats" || dev.muscle === "traps") && p.includes("back")
    );

    if (isPriority && dev.developmentStatus === "progressing" && dev.confidence > 0.6) {
      recs.push({
        category: "maintain",
        priority: config.categoryPriority.indexOf("maintain") + 1,
        relatedRules: [`positive_progress_${dev.muscle}`],
        recommendation: `Maintain current approach for ${dev.muscle.replace("_", " ")}`,
        rationale: `Muscle "${dev.muscle.replace("_", " ")}" is progressing well with ${dev.measurementTrend} measurement trend and appropriate training volume.`,
        confidence: Math.min(dev.confidence, 0.85),
        reassessInWeeks: config.reassessWindows["maintain"] ?? 6,
      } satisfies BodyRecommendation);
    }
  }

  return recs;
}

/**
 * Get a human-readable summary of all recommendations.
 */
export function summarizeRecommendations(
  recommendations: readonly BodyRecommendation[],
): string {
  if (recommendations.length === 0) {
    return "No specific recommendations at this time. Continue current approach.";
  }

  const byCategory = new Map<string, BodyRecommendation[]>();
  for (const rec of recommendations) {
    const list = byCategory.get(rec.category) ?? [];
    list.push(rec);
    byCategory.set(rec.category, list);
  }

  const lines: string[] = [];
  for (const [category, recs] of byCategory) {
    lines.push(`${category.replace("_", " ").toUpperCase()}:`);
    for (const rec of recs) {
      lines.push(`  • ${rec.recommendation} (reassess in ${rec.reassessInWeeks}w)`);
    }
  }

  return lines.join("\n");
}