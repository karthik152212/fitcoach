import type { CalendarDate } from "@fitcoach/domain";
import type {
  DisproportionateDevelopment,
  BodyAssessment,
  WeightTrendAnalysis,
  CircumferenceTrendAnalysis,
  MuscleDevelopment,
  BodyCompositionEstimate,
  MeasurementCompleteness,
  PhysiquePriorityTag,
} from "./types";
import {
  DEFAULT_DISPROPORTIONATE_RULES_CONFIG,
  DEFAULT_PHYSIQUE_GOAL_CONFIG,
  type DisproportionateRuleConfig,
  type PhysiqueGoalConfig,
} from "./configuration";

/**
 * Disproportionate development assessment.
 * Evidence-based rules with confidence, time windows, and rule versions.
 * No medical claims — all assessments framed as "evidence suggests", "pattern consistent with".
 */

export interface DisproportionateAssessmentInput {
  /** User's physique goal with priorities. */
  physiqueGoal: { priorities: readonly PhysiquePriorityTag[] } | null;
  /** Weight trend analysis. */
  weightTrend: WeightTrendAnalysis;
  /** Circumference trend analyses. */
  circumferenceTrends: readonly CircumferenceTrendAnalysis[];
  /** Body composition estimate (if available). */
  composition?: BodyCompositionEstimate;
  /** Muscle development assessments. */
  muscleDevelopment: readonly MuscleDevelopment[];
  /** Measurement completeness. */
  completeness: MeasurementCompleteness;
  /** Current date for window calculations. */
  asOf: CalendarDate;
}

/**
 * Assess disproportionate development based on configured rules.
 */
export function assessDisproportionateDevelopment(
  input: DisproportionateAssessmentInput,
  rulesConfig: DisproportionateRuleConfig = DEFAULT_DISPROPORTIONATE_RULES_CONFIG,
  goalConfig: PhysiqueGoalConfig = DEFAULT_PHYSIQUE_GOAL_CONFIG,
): readonly DisproportionateDevelopment[] {
  const results: DisproportionateDevelopment[] = [];

  for (const rule of rulesConfig.rules) {
    // Only evaluate rules relevant to user's priorities (or general rules)
    const isRelevant = input.physiqueGoal === null ||
      input.physiqueGoal.priorities.includes(rule.priorityTag) ||
      rule.priorityTag === "proportion" || // General proportion rules always apply
      rule.priorityTag === "symmetry"; // Symmetry rules always apply

    if (!isRelevant) continue;

    const assessment = evaluateRule(rule, input, goalConfig);
    if (assessment) {
      results.push(assessment);
    }
  }

  // Sort by severity (highest first), then by priority rank
  results.sort((a, b) => {
    if (b.severity !== a.severity) return b.severity - a.severity;
    const aRank = input.physiqueGoal ? input.physiqueGoal.priorities.indexOf(a.priorityTag) : 99;
    const bRank = input.physiqueGoal ? input.physiqueGoal.priorities.indexOf(b.priorityTag) : 99;
    return (aRank === -1 ? 99 : aRank) - (bRank === -1 ? 99 : bRank);
  });

  return results;
}

function evaluateRule(
  rule: DisproportionateRuleConfig["rules"][0],
  input: DisproportionateAssessmentInput,
  goalConfig: PhysiqueGoalConfig,
): DisproportionateDevelopment | null {
  const { condition, params } = rule;

  switch (condition) {
    case "asymmetry_ratio":
      return evaluateAsymmetryRatio(rule, input, params);
    case "training_exposure_vs_priority":
      return evaluateTrainingExposureVsPriority(rule, input, params);
    case "proportion_ratio_deviation":
      return evaluateProportionRatioDeviation(rule, input, params, goalConfig);
    case "weight_trend_stagnation":
      return evaluateWeightTrendStagnation(rule, input, params);
    case "waist_trend_stagnation":
      return evaluateWaistTrendStagnation(rule, input, params);
    default:
      return null;
  }
}

function evaluateAsymmetryRatio(
  rule: DisproportionateRuleConfig["rules"][0],
  input: DisproportionateAssessmentInput,
  params: Record<string, number | string>,
): DisproportionateDevelopment | null {
  const thresholdRatio = params.thresholdRatio as number;
  const minWeeks = params.minWeeks as number;
  const leftSite = rule.muscles[0];
  const rightSite = rule.muscles[1];
  if (!leftSite || !rightSite) return null;
  const leftTrend = input.circumferenceTrends.find((t) => t.site === leftSite);
  const rightTrend = input.circumferenceTrends.find((t) => t.site === rightSite);

  if (!leftTrend || !rightTrend) return null;
  if (leftTrend.direction === "insufficient_data" || rightTrend.direction === "insufficient_data") return null;
  if (leftTrend.latestCm === null || rightTrend.latestCm === null) return null;
  if ((leftTrend.pointsUsed ?? 0) < 3 || (rightTrend.pointsUsed ?? 0) < 3) return null;

  // Check observation window
  const observationWeeks = Math.min(leftTrend.pointsUsed ?? 0, rightTrend.pointsUsed ?? 0) / 2; // rough
  if (observationWeeks < minWeeks) return null;

  const ratio = Math.max(leftTrend.latestCm, rightTrend.latestCm) / Math.min(leftTrend.latestCm, rightTrend.latestCm);
  if (ratio < thresholdRatio) return null;

  const severity = Math.min(1, (ratio - 1) / (thresholdRatio - 1) * rule.severity);
  const larger = leftTrend.latestCm > rightTrend.latestCm ? leftSite : rightSite;
  const smaller = leftTrend.latestCm > rightTrend.latestCm ? rightSite : leftSite;

  const largerMuscle = larger.replace("left_", "").replace("right_", "");
  const smallerMuscle = smaller.replace("left_", "").replace("right_", "");
  const obsWeeks = Math.round(observationWeeks * 10) / 10;

  return {
    ruleId: rule.id,
    ruleVersion: rule.version,
    priorityTag: rule.priorityTag,
    type: rule.type,
    involvedMuscles: [largerMuscle, smallerMuscle],
    severity: Math.round(severity * 1000) / 1000,
    confidence: Math.round(rule.confidence * Math.min(1, observationWeeks / minWeeks) * 1000) / 1000,
    observationWeeks: obsWeeks,
    observation: `${larger.replace("_", " ")} (${leftTrend.latestCm.toFixed(1)}cm) vs ${smaller.replace("_", " ")} (${rightTrend.latestCm.toFixed(1)}cm) — ${((ratio - 1) * 100).toFixed(0)}% asymmetry over ~${obsWeeks} weeks.`,
    evidence: [
      `Left ${leftSite.replace("_", " ")}: ${leftTrend.latestCm?.toFixed(1)}cm (${leftTrend.direction}, ${leftTrend.pointsUsed} readings)`,
      `Right ${rightSite.replace("_", " ")}: ${rightTrend.latestCm?.toFixed(1)}cm (${rightTrend.direction}, ${rightTrend.pointsUsed} readings)`,
      `Asymmetry ratio: ${ratio.toFixed(2)} (threshold: ${thresholdRatio})`,
      `Observation window: ~${obsWeeks} weeks (min: ${minWeeks})`,
    ],
    recommendedIntervention: rule.recommendedIntervention,
    basisNote: `Rule ${rule.id} v${rule.version}: ${rule.description}. Asymmetry ratio ${ratio.toFixed(2)} exceeds threshold ${thresholdRatio}. Confidence adjusted for observation window.`,
  };
}

function evaluateTrainingExposureVsPriority(
  rule: DisproportionateRuleConfig["rules"][0],
  input: DisproportionateAssessmentInput,
  params: Record<string, number | string>,
): DisproportionateDevelopment | null {
  const exposureThreshold = params.exposureThreshold as number;
  const minWeeks = params.minWeeks as number;
  // Find muscle development entries for the rule's muscles
  const relevantDev = input.muscleDevelopment.filter((d) =>
    rule.muscles.includes(d.muscle)
  );

  if (relevantDev.length === 0) return null;

  // Average training exposure across relevant muscles
  const avgExposure = relevantDev.reduce((s, d) => s + d.trainingExposureScore, 0) / relevantDev.length;

  if (avgExposure >= exposureThreshold) return null;

  const severity = Math.min(1, (exposureThreshold - avgExposure) / exposureThreshold * rule.severity);

  return {
    ruleId: rule.id,
    ruleVersion: rule.version,
    priorityTag: rule.priorityTag,
    type: rule.type,
    involvedMuscles: relevantDev.map((d) => d.muscle),
    severity: Math.round(severity * 1000) / 1000,
    confidence: Math.round(rule.confidence * 0.7 * 1000) / 1000, // Lower confidence without direct week tracking
    observationWeeks: minWeeks,
    observation: `Priority "${rule.priorityTag}" but avg training exposure ${avgExposure.toFixed(0)}/100 (threshold: ${exposureThreshold}). Muscles: ${relevantDev.map((d) => d.muscle).join(", ")}.`,
    evidence: relevantDev.map((d) =>
      `${d.muscle}: exposure ${d.trainingExposureScore}/100, volume ${d.volumeAppropriateness}, trend ${d.measurementTrend ?? "none"}`
    ),
    recommendedIntervention: rule.recommendedIntervention,
    basisNote: `Rule ${rule.id} v${rule.version}: ${rule.description}. Avg exposure ${avgExposure.toFixed(0)} below threshold ${params.exposureThreshold}.`,
  };
}

function evaluateProportionRatioDeviation(
  rule: DisproportionateRuleConfig["rules"][0],
  input: DisproportionateAssessmentInput,
  params: Record<string, number | string>,
  goalConfig: PhysiqueGoalConfig,
): DisproportionateDevelopment | null {
  const ratioName = params.ratioName as string;
  const deviationThreshold = params.deviationThreshold as number;
  const minWeeks = params.minWeeks as number;
  const ratioConfig = goalConfig.proportionRatios.find((r) => r.name === ratioName);
  if (!ratioConfig) return null;

  // Get latest circumference values for numerator and denominator sites
  const getLatestCircumference = (site: string): number | null => {
    const trend = input.circumferenceTrends.find((t) => t.site === site);
    return trend?.latestCm ?? null;
  };

  const numeratorValues = ratioConfig.numerator.map(getLatestCircumference).filter((v): v is number => v !== null);
  const denominatorValues = ratioConfig.denominator.map(getLatestCircumference).filter((v): v is number => v !== null);

  if (numeratorValues.length === 0 || denominatorValues.length === 0) return null;

  const numeratorAvg = numeratorValues.reduce((s, v) => s + v, 0) / numeratorValues.length;
  const denominatorAvg = denominatorValues.reduce((s, v) => s + v, 0) / denominatorValues.length;
  const currentRatio = numeratorAvg / denominatorAvg;

  const [targetMin, targetMax] = ratioConfig.targetRange;
  const targetMid = (targetMin + targetMax) / 2;
  const deviation = Math.abs(currentRatio - targetMid) / targetMid;

  if (deviation < deviationThreshold) return null;

  // Check observation window (simplified)
  const observationWeeks = minWeeks;

  const severity = Math.min(1, (deviation / deviationThreshold) * rule.severity);

  return {
    ruleId: rule.id,
    ruleVersion: rule.version,
    priorityTag: rule.priorityTag,
    type: rule.type,
    involvedMuscles: [...ratioConfig.numerator, ...ratioConfig.denominator].map((s) => s.replace("left_", "").replace("right_", "")),
    severity: Math.round(severity * 1000) / 1000,
    confidence: Math.round(rule.confidence * Math.min(1, observationWeeks / minWeeks) * 1000) / 1000,
    observationWeeks,
    observation: `${ratioConfig.name} ratio: ${currentRatio.toFixed(2)} (target: ${targetMin.toFixed(2)}–${targetMax.toFixed(2)}). Deviation: ${(deviation * 100).toFixed(0)}% (threshold: ${(deviationThreshold * 100).toFixed(0)}%).`,
    evidence: [
      `Numerator (${ratioConfig.numerator.join("+")}): avg ${numeratorAvg.toFixed(1)}cm`,
      `Denominator (${ratioConfig.denominator.join("+")}): avg ${denominatorAvg.toFixed(1)}cm`,
      `Current ratio: ${currentRatio.toFixed(2)}`,
      `Target range: ${targetMin.toFixed(2)}–${targetMax.toFixed(2)}`,
      `Deviation from target mid: ${(deviation * 100).toFixed(0)}%`,
    ],
    recommendedIntervention: rule.recommendedIntervention,
    basisNote: `Rule ${rule.id} v${rule.version}: ${rule.description}. ${ratioConfig.name} ratio ${currentRatio.toFixed(2)} deviates ${(deviation * 100).toFixed(0)}% from target mid ${targetMid.toFixed(2)}.`,
  };
}

function evaluateWeightTrendStagnation(
  rule: DisproportionateRuleConfig["rules"][0],
  input: DisproportionateAssessmentInput,
  params: Record<string, number | string>,
): DisproportionateDevelopment | null {
  const minWeightGainKgPerMonth = params.minWeightGainKgPerMonth as number;
  const minWeeks = params.minWeeks as number;
  if (input.weightTrend.direction === "insufficient_data") return null;
  if (input.weightTrend.slopeKgPerWeek === null) return null;

  const weightGainPerMonth = input.weightTrend.slopeKgPerWeek * 4.33; // weeks per month

  if (weightGainPerMonth >= minWeightGainKgPerMonth) return null;

  // Check observation window
  const observationWeeks = input.weightTrend.pointsUsed / 2; // rough
  if (observationWeeks < minWeeks) return null;

  const severity = Math.min(1, (minWeightGainKgPerMonth - weightGainPerMonth) / minWeightGainKgPerMonth * rule.severity);

  return {
    ruleId: rule.id,
    ruleVersion: rule.version,
    priorityTag: rule.priorityTag,
    type: rule.type,
    involvedMuscles: rule.muscles,
    severity: Math.round(severity * 1000) / 1000,
    confidence: Math.round(rule.confidence * Math.min(1, observationWeeks / minWeeks) * (input.weightTrend.confidence ?? 0.5) * 1000) / 1000,
    observationWeeks: Math.round(observationWeeks * 10) / 10,
    observation: `Weight trend: ${input.weightTrend.direction} (${(input.weightTrend.slopeKgPerWeek * 4.33).toFixed(2)} kg/month). Target for "${rule.priorityTag}": ≥${minWeightGainKgPerMonth} kg/month.`,
    evidence: [
      `Weight trend direction: ${input.weightTrend.direction}`,
      `Slope: ${input.weightTrend.slopeKgPerWeek?.toFixed(4)} kg/week (${(input.weightTrend.slopeKgPerWeek! * 4.33).toFixed(2)} kg/month)`,
      `Target minimum: ${minWeightGainKgPerMonth} kg/month`,
      `Data points: ${input.weightTrend.pointsUsed} over ~${Math.round(observationWeeks)} weeks`,
      `Confidence: ${input.weightTrend.confidence?.toFixed(2) ?? "N/A"}`,
    ],
    recommendedIntervention: rule.recommendedIntervention,
    basisNote: `Rule ${rule.id} v${rule.version}: ${rule.description}. Weight gain ${(weightGainPerMonth).toFixed(2)} kg/month below target ${params.minWeightGainKgPerMonth} kg/month over ~${Math.round(observationWeeks)} weeks.`,
  };
}

function evaluateWaistTrendStagnation(
  rule: DisproportionateRuleConfig["rules"][0],
  input: DisproportionateAssessmentInput,
  params: Record<string, number | string>,
): DisproportionateDevelopment | null {
  const maxWaistChangeCmPerMonth = params.maxWaistChangeCmPerMonth as number;
  const minWeeks = params.minWeeks as number;
  const waistTrend = input.circumferenceTrends.find((t) => t.site === "waist");
  if (!waistTrend) return null;
  if (waistTrend.direction === "insufficient_data") return null;
  if (waistTrend.slopeCmPerWeek === null) return null;

  const waistChangePerMonth = waistTrend.slopeCmPerWeek * 4.33;

  // For leanness, we want waist to DECREASE (negative slope)
  // Stagnation = not decreasing enough (slope > -threshold)
  if (waistChangePerMonth <= -maxWaistChangeCmPerMonth) return null; // Decreasing fast enough

  const observationWeeks = waistTrend.pointsUsed / 2; // rough
  if (observationWeeks < minWeeks) return null;

  const severity = Math.min(1, (waistChangePerMonth + maxWaistChangeCmPerMonth) / maxWaistChangeCmPerMonth * rule.severity);

  return {
    ruleId: rule.id,
    ruleVersion: rule.version,
    priorityTag: rule.priorityTag,
    type: rule.type,
    involvedMuscles: ["waist", "abs", "obliques"],
    severity: Math.round(severity * 1000) / 1000,
    confidence: Math.round(rule.confidence * Math.min(1, observationWeeks / minWeeks) * (waistTrend.confidence ?? 0.5) * 1000) / 1000,
    observationWeeks: Math.round(observationWeeks * 10) / 10,
    observation: `Waist trend: ${waistTrend.direction} (${waistChangePerMonth.toFixed(2)} cm/month). Target for "${rule.priorityTag}": ≤${-maxWaistChangeCmPerMonth} cm/month (decreasing).`,
    evidence: [
      `Waist trend direction: ${waistTrend.direction}`,
      `Slope: ${waistTrend.slopeCmPerWeek?.toFixed(4)} cm/week (${waistChangePerMonth.toFixed(2)} cm/month)`,
      `Target maximum change: ${-maxWaistChangeCmPerMonth} cm/month (decrease)`,
      `Data points: ${waistTrend.pointsUsed} over ~${Math.round(observationWeeks)} weeks`,
      `Confidence: ${waistTrend.confidence?.toFixed(2) ?? "N/A"}`,
    ],
    recommendedIntervention: rule.recommendedIntervention,
    basisNote: `Rule ${rule.id} v${rule.version}: ${rule.description}. Waist change ${waistChangePerMonth.toFixed(2)} cm/month not decreasing enough (target ≤${-maxWaistChangeCmPerMonth} cm/month) over ~${Math.round(observationWeeks)} weeks.`,
  };
}

/**
 * Build complete body assessment from all components.
 */
export function buildBodyAssessment(
  userId: string,
  input: DisproportionateAssessmentInput,
  disproportionateDevelopment: readonly DisproportionateDevelopment[],
): BodyAssessment {
  const goalRelativeProgress = assessOverallGoalProgress(input, disproportionateDevelopment);

  const priorityActions = generatePriorityActions(disproportionateDevelopment, input);

  return {
    userId,
    asOf: input.asOf,
    weightTrend: input.weightTrend,
    circumferenceTrends: input.circumferenceTrends,
    composition: input.composition,
    completeness: input.completeness,
    muscleDevelopment: input.muscleDevelopment,
    disproportionateDevelopment,
    goalRelativeProgress,
    priorityActions,
  };
}

function assessOverallGoalProgress(
  input: DisproportionateAssessmentInput,
  disproportionate: readonly DisproportionateDevelopment[],
): "on_track" | "needs_attention" | "insufficient_data" {
  if (input.weightTrend.direction === "insufficient_data" &&
      input.circumferenceTrends.every((t) => t.direction === "insufficient_data")) {
    return "insufficient_data";
  }

  // If any severe disproportionate flags, needs attention
  const hasSevere = disproportionate.some((d) => d.severity > 0.7);
  if (hasSevere) return "needs_attention";

  // If multiple moderate flags, needs attention
  const moderateCount = disproportionate.filter((d) => d.severity > 0.4).length;
  if (moderateCount >= 2) return "needs_attention";

  // Check muscle development for priority muscles
  const priorityMuscles = input.muscleDevelopment.filter((d) =>
    input.physiqueGoal?.priorities.some((p) =>
      p.toLowerCase().includes(d.muscle.toLowerCase())
    )
  );

  const regressingPriority = priorityMuscles.some((d) => d.developmentStatus === "regressing");
  if (regressingPriority) return "needs_attention";

  return "on_track";
}

function generatePriorityActions(
  disproportionate: readonly DisproportionateDevelopment[],
  input: DisproportionateAssessmentInput,
): readonly string[] {
  const actions: string[] = [];

  // Top disproportionate flags
  for (const d of disproportionate.slice(0, 3)) {
    switch (d.recommendedIntervention) {
      case "adjust_nutrition":
        actions.push(`Adjust nutrition for ${d.priorityTag.replace("_", " ")} (${d.observation})`);
        break;
      case "review_training":
        actions.push(`Review training for ${d.involvedMuscles.join(", ")} (${d.observation})`);
        break;
      case "reassess_technique":
        actions.push(`Reassess technique for ${d.involvedMuscles.join(" vs ")} symmetry`);
        break;
      case "collect_more_data":
        actions.push(`Collect more measurements for ${d.priorityTag.replace("_", " ")}`);
        break;
    }
  }

  // Data completeness
  if (!input.completeness.canEstimateComposition) {
    actions.push(`Log ${input.completeness.missingForComposition.join(", ")} for body composition estimates`);
  }

  // Weight trend
  if (input.weightTrend.direction === "insufficient_data") {
    actions.push("Log weight more frequently (daily preferred) for trend detection");
  }

  return actions.slice(0, 5);
}