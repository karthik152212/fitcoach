import type {
  SleepObservation,
  RecoveryIndicator,
  RecoveryState,
  CalendarDate,
  DailyActivitySummary,
} from "@fitcoach/domain";
import type { TrainingState } from "@fitcoach/domain";

/**
 * Configuration for recovery model.
 * All values are modeling assumptions, not universal laws.
 */
export interface RecoveryConfiguration {
  version: string;
  /** Sleep need hours per night */
  sleepNeedHours: number;
  /** Minimum adequate sleep hours */
  minAdequateSleepHours: number;
  /** HRV baseline window days */
  hrvBaselineWindowDays: number;
  /** HRV decline threshold % from baseline */
  hrvDeclineThresholdPercent: number;
  /** Training load window days for acute:chronic ratio */
  trainingLoadWindowDays: number;
  /** Acute:chronic workload ratio thresholds */
  acwrThresholds: { low: number; moderate: number; high: number; veryHigh: number };
  /** Sleep debt accumulation rate (hours debt per hour short) */
  sleepDebtRate: number;
  /** Maximum sleep debt hours before severe */
  maxSleepDebtHours: number;
  /** Weights for readiness score components */
  readinessWeights: {
    sleep: number;
    hrv: number;
    subjective: number;
    trainingLoad: number;
    nutrition: number;
  };
}

export const DEFAULT_RECOVERY_CONFIGURATION: RecoveryConfiguration = {
  version: "fitcoach.recovery.v1",
  sleepNeedHours: 7.5,
  minAdequateSleepHours: 6.5,
  hrvBaselineWindowDays: 14,
  hrvDeclineThresholdPercent: 10,
  trainingLoadWindowDays: 28,
  acwrThresholds: { low: 0.8, moderate: 1.0, high: 1.3, veryHigh: 1.5 },
  sleepDebtRate: 1.0,
  maxSleepDebtHours: 10,
  readinessWeights: {
    sleep: 0.3,
    hrv: 0.25,
    subjective: 0.2,
    trainingLoad: 0.15,
    nutrition: 0.1,
  },
};

/**
 * Compute recovery state from sleep observations, recovery indicators,
 * training load, and nutrition adherence.
 */
export function computeRecoveryState(
  input: {
    /** Sleep observations (last 14+ days) */
    sleepObservations: readonly SleepObservation[];
    /** Recovery indicators (last 14+ days) */
    recoveryIndicators: readonly RecoveryIndicator[];
    /** Daily activity summaries for training load */
    dailyActivity: readonly DailyActivitySummary[];
    /** Training state for volume/frequency context */
    trainingState?: TrainingState;
    /** Nutrition targets + actuals for adherence */
    nutritionAdherence?: { caloriesPercent: number; proteinPercent: number };
    /** Current date for window anchoring */
    asOf: CalendarDate;
  },
  config: RecoveryConfiguration = DEFAULT_RECOVERY_CONFIGURATION,
): RecoveryState {
  const { sleepObservations, recoveryIndicators, dailyActivity, trainingState, nutritionAdherence, asOf } = input;

  // --- Sleep analysis ---
  const recentSleep = sleepObservations
    .filter((s) => s.date <= asOf)
    .slice(0, 14);
  const sleepMetrics = analyzeSleep(recentSleep, config);

  // --- HRV analysis ---
  const recentIndicators = recoveryIndicators
    .filter((i) => i.date <= asOf)
    .slice(0, 14);
  const hrvMetrics = analyzeHrv(recentIndicators, config);

  // --- Subjective analysis ---
  const subjectiveMetrics = analyzeSubjective(recentIndicators);

  // --- Training load analysis ---
  const trainingLoadMetrics = analyzeTrainingLoad(dailyActivity, trainingState, asOf, config);

  // --- Nutrition adherence ---
  const nutritionScore = nutritionAdherence
    ? (nutritionAdherence.caloriesPercent / 100) * 0.6 + (nutritionAdherence.proteinPercent / 100) * 0.4
    : 0.75; // neutral if no data

  // --- Compute readiness score (0-100) ---
  const weights = config.readinessWeights;
  const readinessScore = Math.round(
    sleepMetrics.score * weights.sleep +
    hrvMetrics.score * weights.hrv +
    subjectiveMetrics.score * weights.subjective +
    trainingLoadMetrics.score * weights.trainingLoad +
    nutritionScore * 100 * weights.nutrition,
  );

  // Confidence based on data completeness
  const dataCompleteness =
    (recentSleep.length / 14) * 0.3 +
    (recentIndicators.filter((i) => i.hrvMs !== undefined).length / 14) * 0.3 +
    (recentIndicators.filter((i) => i.readinessSubjective !== undefined).length / 14) * 0.2 +
    (dailyActivity.length > 0 ? 0.2 : 0);
  const confidence = Math.min(1, dataCompleteness);

  // --- Determine limiting factors ---
  const limitingFactors: string[] = [];
  if (sleepMetrics.adequacy === "severe_debt") limitingFactors.push("severe_sleep_debt");
  else if (sleepMetrics.adequacy === "moderate_debt") limitingFactors.push("moderate_sleep_debt");
  if (hrvMetrics.trend === "declining") limitingFactors.push("hrv_declining");
  if (trainingLoadMetrics.fatigueLevel === "high") limitingFactors.push("high_training_fatigue");
  else if (trainingLoadMetrics.fatigueLevel === "very_high") limitingFactors.push("very_high_training_fatigue");
  if (subjectiveMetrics.avgSoreness >= 7) limitingFactors.push("high_muscle_soreness");
  if (subjectiveMetrics.avgFatigue >= 7) limitingFactors.push("high_fatigue");
  if (nutritionScore < 0.7) limitingFactors.push("poor_nutrition_adherence");

  // --- Training recommendation ---
  let trainingRecommendation: RecoveryState["trainingRecommendation"] = "maintain";
  if (limitingFactors.includes("very_high_training_fatigue") || limitingFactors.includes("severe_sleep_debt")) {
    trainingRecommendation = "delay";
  } else if (
    limitingFactors.includes("high_training_fatigue") ||
    limitingFactors.includes("hrv_declining") ||
    limitingFactors.includes("moderate_sleep_debt")
  ) {
    trainingRecommendation = "reduce_volume";
  } else if (limitingFactors.includes("high_muscle_soreness") || limitingFactors.includes("high_fatigue")) {
    trainingRecommendation = "active_recovery";
  }

  // --- Nutrition recommendations ---
  const nutritionRecommendations: string[] = [];
  if (nutritionAdherence) {
    if (nutritionAdherence.proteinPercent < 80) nutritionRecommendations.push("increase_protein_intake");
    if (nutritionAdherence.caloriesPercent < 90) nutritionRecommendations.push("ensure_adequate_calories");
    if (nutritionAdherence.caloriesPercent > 115) nutritionRecommendations.push("moderate_calorie_surplus");
  }

  // --- Activity recommendations ---
  const activityRecommendations: string[] = [];
  if (trainingRecommendation === "delay" || trainingRecommendation === "reduce_volume") {
    activityRecommendations.push("reduce_daily_steps_target_15_to_20_percent");
    activityRecommendations.push("prioritize_low_intensity_movement");
  } else if (trainingRecommendation === "active_recovery") {
    activityRecommendations.push("maintain_steps_focus_on_walking");
  }

  // --- Basis note ---
  const basisParts: string[] = [
    `Sleep: ${sleepMetrics.avgHours.toFixed(1)}h avg (${sleepMetrics.adequacy})`,
    `HRV: ${hrvMetrics.trend} (${hrvMetrics.baselineHrv ? Math.round(hrvMetrics.baselineHrv) : "no baseline"}ms baseline)`,
    `Subjective: soreness ${subjectiveMetrics.avgSoreness.toFixed(1)}/10, fatigue ${subjectiveMetrics.avgFatigue.toFixed(1)}/10`,
    `Training load: ${trainingLoadMetrics.acwr.toFixed(2)} ACWR (${trainingLoadMetrics.fatigueLevel})`,
    `Nutrition: ${Math.round(nutritionScore * 100)}% adherence`,
  ];

  return {
    readinessScore: Math.max(0, Math.min(100, readinessScore)),
    confidence: Math.round(confidence * 100) / 100,
    sleepQualityTrend: sleepMetrics.trend,
    sleepAdequacy: sleepMetrics.adequacy,
    hrvTrend: hrvMetrics.trend,
    fatigueAccumulation: trainingLoadMetrics.fatigueLevel,
    limitingFactors,
    trainingRecommendation,
    nutritionRecommendations,
    activityRecommendations,
    basisNote: basisParts.join("; "),
  };
}

interface SleepMetrics {
  avgHours: number;
  adequacy: "adequate" | "moderate_debt" | "severe_debt";
  trend: "improving" | "stable" | "declining" | "unknown";
  score: number; // 0-100
}

function analyzeSleep(
  observations: readonly SleepObservation[],
  config: RecoveryConfiguration,
): SleepMetrics {
  if (observations.length === 0) {
    return { avgHours: 0, adequacy: "adequate", trend: "unknown", score: 50 };
  }

  const withDuration = observations.filter((o) => o.asleepMinutes !== undefined && o.asleepMinutes! > 0);
  if (withDuration.length === 0) {
    return { avgHours: 0, adequacy: "adequate", trend: "unknown", score: 50 };
  }

  const avgHours = withDuration.reduce((sum, o) => sum + (o.asleepMinutes! / 60), 0) / withDuration.length;
  const totalDebt = withDuration.reduce((sum, o) => sum + Math.max(0, config.sleepNeedHours - o.asleepMinutes! / 60), 0);

  let adequacy: SleepMetrics["adequacy"] = "adequate";
  if (totalDebt >= config.maxSleepDebtHours) adequacy = "severe_debt";
  else if (totalDebt > config.maxSleepDebtHours * 0.4) adequacy = "moderate_debt";

  // Trend: compare first half vs second half
  let trend: SleepMetrics["trend"] = "stable";
  if (withDuration.length >= 6) {
    const mid = Math.floor(withDuration.length / 2);
    const firstHalfAvg = withDuration.slice(0, mid).reduce((s, o) => s + o.asleepMinutes! / 60, 0) / mid;
    const secondHalfAvg = withDuration.slice(mid).reduce((s, o) => s + o.asleepMinutes! / 60, 0) / (withDuration.length - mid);
    if (secondHalfAvg > firstHalfAvg + 0.3) trend = "improving";
    else if (secondHalfAvg < firstHalfAvg - 0.3) trend = "declining";
  }

  // Score: 100 at need, linear down to 0 at need - 3h
  const score = Math.max(0, Math.min(100, ((avgHours - (config.sleepNeedHours - 3)) / 3) * 100));

  return { avgHours, adequacy, trend, score };
}

interface HrvMetrics {
  baselineHrv: number | undefined;
  currentHrv: number | undefined;
  trend: "improving" | "stable" | "declining" | "unknown";
  score: number; // 0-100
}

function analyzeHrv(
  indicators: readonly RecoveryIndicator[],
  config: RecoveryConfiguration,
): HrvMetrics {
  const withHrv = indicators.filter((i) => i.hrvMs !== undefined && i.hrvMs! > 0);
  if (withHrv.length < 3) {
    return { baselineHrv: undefined, currentHrv: undefined, trend: "unknown", score: 50 };
  }

  const baselineWindow = withHrv.slice(0, config.hrvBaselineWindowDays);
  const baselineHrv = baselineWindow.reduce((s, i) => s + i.hrvMs!, 0) / baselineWindow.length;
  // withHrv.length >= 3 guaranteed by check above
  const currentHrv = withHrv[0]!.hrvMs ?? 0;

  let trend: HrvMetrics["trend"] = "stable";
  if (withHrv.length >= 5) {
    const recent = withHrv.slice(0, 5);
    const older = withHrv.slice(5, 10);
    if (older.length > 0) {
      const recentAvg = recent.reduce((s, i) => s + i.hrvMs!, 0) / recent.length;
      const olderAvg = older.reduce((s, i) => s + i.hrvMs!, 0) / older.length;
      const change = (recentAvg - olderAvg) / olderAvg;
      if (change > 0.05) trend = "improving";
      else if (change < -0.05) trend = "declining";
    }
  }

  // Score based on deviation from baseline
  let score = 100;
  if (baselineHrv && currentHrv > 0) {
    const decline = (baselineHrv - currentHrv) / baselineHrv;
    if (decline > config.hrvDeclineThresholdPercent / 100) {
      score = Math.max(0, 100 - (decline / (config.hrvDeclineThresholdPercent / 100)) * 50);
    }
  }

  return { baselineHrv, currentHrv, trend, score };
}

interface SubjectiveMetrics {
  avgSoreness: number;
  avgFatigue: number;
  avgSleepQuality: number;
  avgReadiness: number;
  score: number; // 0-100
}

function analyzeSubjective(indicators: readonly RecoveryIndicator[]): SubjectiveMetrics {
  const withSoreness = indicators.filter((i) => i.muscleSoreness !== undefined);
  const withFatigue = indicators.filter((i) => i.fatigue !== undefined);
  const withSleepQuality = indicators.filter((i) => i.sleepQuality !== undefined);
  const withReadiness = indicators.filter((i) => i.readinessSubjective !== undefined);

  const avgSoreness = withSoreness.length > 0
    ? withSoreness.reduce((s, i) => s + i.muscleSoreness!, 0) / withSoreness.length
    : 3;
  const avgFatigue = withFatigue.length > 0
    ? withFatigue.reduce((s, i) => s + i.fatigue!, 0) / withFatigue.length
    : 3;
  const avgSleepQuality = withSleepQuality.length > 0
    ? withSleepQuality.reduce((s, i) => s + i.sleepQuality!, 0) / withSleepQuality.length
    : 7;
  const avgReadiness = withReadiness.length > 0
    ? withReadiness.reduce((s, i) => s + i.readinessSubjective!, 0) / withReadiness.length
    : 7;

  // Score: readiness is primary, inverted soreness/fatigue
  const score = Math.round(
    (avgReadiness / 10) * 50 +
    ((10 - avgSoreness) / 10) * 25 +
    ((10 - avgFatigue) / 10) * 25,
  );

  return { avgSoreness, avgFatigue, avgSleepQuality, avgReadiness, score };
}

interface TrainingLoadMetrics {
  acuteLoad: number;
  chronicLoad: number;
  acwr: number;
  fatigueLevel: "low" | "moderate" | "high" | "very_high";
  score: number; // 0-100
}

function analyzeTrainingLoad(
  dailyActivity: readonly DailyActivitySummary[],
  _trainingState: TrainingState | undefined,
  asOf: CalendarDate,
  config: RecoveryConfiguration,
): TrainingLoadMetrics {
  // Use estimatedEeKcal from activity as proxy for training load
  // (training minutes already included in activeMinutes/estimatedEeKcal)
  const recentActivity = dailyActivity
    .filter((d) => d.date <= asOf)
    .slice(0, config.trainingLoadWindowDays);

  if (recentActivity.length === 0) {
    return { acuteLoad: 0, chronicLoad: 0, acwr: 1, fatigueLevel: "low", score: 100 };
  }

  const loads = recentActivity.map((d) => d.estimatedEeKcal);
  const acuteLoad = loads.slice(0, 7).reduce((s, v) => s + v, 0) / 7; // 7-day average
  const chronicLoad = loads.reduce((s, v) => s + v, 0) / loads.length; // 28-day average
  const acwr = chronicLoad > 0 ? acuteLoad / chronicLoad : 1;

  let fatigueLevel: TrainingLoadMetrics["fatigueLevel"] = "low";
  if (acwr >= config.acwrThresholds.veryHigh) fatigueLevel = "very_high";
  else if (acwr >= config.acwrThresholds.high) fatigueLevel = "high";
  else if (acwr >= config.acwrThresholds.moderate) fatigueLevel = "moderate";

  // Score: 100 at ACWR 1.0, decreasing on both sides
  let score = 100;
  if (acwr > 1) {
    score = Math.max(0, 100 - (acwr - 1) * 100);
  } else if (acwr < 0.8) {
    score = Math.max(0, 100 - (0.8 - acwr) * 100); // undertraining also reduces readiness
  }

  return { acuteLoad, chronicLoad, acwr, fatigueLevel, score };
}

/**
 * Detect recovery-related plateau signals for the adaptation engine.
 */
export function detectRecoveryPlateauSignals(
  recoveryState: RecoveryState,
  _trainingState: TrainingState,
): readonly import("@fitcoach/domain").PlateauSignal[] {
  const signals: import("@fitcoach/domain").PlateauSignal[] = [];

  if (recoveryState.fatigueAccumulation === "high" || recoveryState.fatigueAccumulation === "very_high") {
    signals.push({
      kind: "excessive_volume_signal",
      observation: `Recovery indicates ${recoveryState.fatigueAccumulation} fatigue accumulation (ACWR-driven)`,
      affectedEntity: "systemic",
      severity: recoveryState.fatigueAccumulation === "very_high" ? 0.9 : 0.7,
      observedWeeks: 1,
    });
  }

  if (recoveryState.sleepAdequacy === "severe_debt") {
    signals.push({
      kind: "adherence_issue",
      observation: "Severe sleep debt limiting recovery capacity",
      affectedEntity: "systemic",
      severity: 0.8,
      observedWeeks: Math.ceil(recoveryState.limitingFactors.filter((f) => f.includes("sleep_debt")).length / 2),
    });
  }

  if (recoveryState.hrvTrend === "declining" && recoveryState.readinessScore < 50) {
    signals.push({
      kind: "declining_performance",
      observation: "HRV declining with low readiness — autonomic imbalance likely",
      affectedEntity: "systemic",
      severity: 0.7,
      observedWeeks: 1,
    });
  }

  return signals;
}