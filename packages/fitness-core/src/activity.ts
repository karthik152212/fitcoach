import type {
  ActivityRecord,
  ActivityTargets,
  DailyActivitySummary,
  CalendarDate,
  NutritionTargets,
} from "@fitcoach/domain";
import type { TrainingState } from "@fitcoach/domain";

/**
 * Configuration for activity target derivation.
 * All values are modeling assumptions, not universal laws.
 */
export interface ActivityTargetConfiguration {
  version: string;
  /** Baseline daily steps for sedentary desk worker */
  baselineSteps: number;
  /** Steps per training day (additional) */
  stepsPerTrainingDay: number;
  /** Steps per 30 min cardio (additional) */
  stepsPerCardio30Min: number;
  /** Minimum daily steps floor */
  minDailySteps: number;
  /** Maximum daily steps ceiling */
  maxDailySteps: number;
  /** Weekly cardio minutes per training day */
  cardioMinPerTrainingDay: number;
  /** Weekly cardio minutes baseline (non-training days) */
  baselineWeeklyCardioMin: number;
  /** Goal-specific multipliers */
  goalMultipliers: Readonly<Record<string, { steps: number; cardio: number }>>;
  /** Recovery adjustment: reduce targets when recovery is poor */
  recoveryReduction: { moderate: number; severe: number };
}

export const DEFAULT_ACTIVITY_TARGET_CONFIGURATION: ActivityTargetConfiguration = {
  version: "fitcoach.activity.v1",
  baselineSteps: 6000,
  stepsPerTrainingDay: 1500,
  stepsPerCardio30Min: 1000,
  minDailySteps: 4000,
  maxDailySteps: 15000,
  cardioMinPerTrainingDay: 20,
  baselineWeeklyCardioMin: 75,
  goalMultipliers: {
    bodybuilding: { steps: 1.0, cardio: 0.7 },
    aesthetics_v_taper: { steps: 1.1, cardio: 0.8 },
    lean_recomposition: { steps: 1.3, cardio: 1.2 },
    athletic_performance: { steps: 1.0, cardio: 1.5 },
    max_strength: { steps: 0.9, cardio: 0.5 },
    general_fitness: { steps: 1.1, cardio: 1.0 },
    custom: { steps: 1.0, cardio: 1.0 },
  },
  recoveryReduction: { moderate: 0.85, severe: 0.7 },
};

/**
 * Aggregate daily activity from steps records + discrete sessions.
 */
export function aggregateDailyActivity(
  activityRecords: readonly ActivityRecord[],
  trainingMinutesByDate: Readonly<Record<CalendarDate, number>> = {},
): readonly DailyActivitySummary[] {
  // Group by date
  const byDate = new Map<CalendarDate, ActivityRecord[]>();
  for (const record of activityRecords) {
    const arr = byDate.get(record.date) ?? [];
    arr.push(record);
    byDate.set(record.date, arr);
  }

  const summaries: DailyActivitySummary[] = [];
  for (const [date, records] of byDate.entries()) {
    const stepsRecord = records.find((r) => r.kind === "steps");
    const sessions = records.filter((r) => r.kind !== "steps");

    let activeMinutes = 0;
    let cardioMinutes = 0;
    let estimatedEeKcal = 0;

    for (const session of sessions) {
      const duration = session.durationMinutes ?? 0;
      const effort = session.effort ?? "moderate";
      const calories = session.estimatedCaloriesBurned ?? estimateCaloriesFromSession(session);

      if (isCardioModality(session.kind)) {
        cardioMinutes += duration;
        if (effort === "moderate" || effort === "high") activeMinutes += duration;
      } else {
        // Non-cardio activity (sport, other) - count moderate+ as active
        if (effort === "moderate" || effort === "high") activeMinutes += duration;
      }
      estimatedEeKcal += calories;
    }

    // Add training minutes to active minutes
    const trainingMin = trainingMinutesByDate[date] ?? 0;
    activeMinutes += trainingMin;
    estimatedEeKcal += estimateTrainingCalories(trainingMin);

    summaries.push({
      date,
      steps: stepsRecord?.steps ?? 0,
      activeMinutes,
      cardioMinutes,
      trainingMinutes: trainingMin,
      estimatedEeKcal: Math.round(estimatedEeKcal),
      sessions,
    });
  }

  // Sort by date descending (create new array to avoid mutation)
  return [...summaries].sort((a, b) => (a.date > b.date ? -1 : 1));
}

function isCardioModality(kind: string): boolean {
  return ["walk", "run", "cycle", "row", "swim", "elliptical", "stairs", "sport"].includes(kind);
}

function estimateCaloriesFromSession(session: ActivityRecord): number {
  // Rough MET-based estimation when calories not provided
  const durationHours = (session.durationMinutes ?? 0) / 60;
  if (durationHours <= 0) return 0;

  const metByKind: Record<string, number> = {
    walk: 3.5,
    run: 7.0,
    cycle: 5.5,
    row: 6.0,
    swim: 6.0,
    elliptical: 5.0,
    stairs: 8.0,
    sport: 6.0,
    other: 4.0,
  };
  const met = metByKind[session.kind] ?? 4.0;
  const effortMultiplier = session.effort === "low" ? 0.8 : session.effort === "high" ? 1.2 : 1.0;
  // Assume 75kg reference; service should adjust by body weight
  return met * 75 * durationHours * effortMultiplier;
}

function estimateTrainingCalories(minutes: number): number {
  // ~7 kcal/min for resistance training (75kg reference)
  return minutes * 7;
}

/**
 * Derive personalized activity targets from context.
 * Activity targets are contextual (body, calories, training, recovery, goal):
 * a raw step count carries no inherent goodness.
 */
export function deriveActivityTargets(
  input: {
    /** User's goal kind */
    goalKind: string;
    /** Average daily steps over last 14 days */
    averageStepsLast14Days: number;
    /** Weekly cardio minutes over last 7 days */
    weeklyCardioMinutes: number;
    /** Training days per week from profile */
    trainingDaysPerWeek: number;
    /** Training state for volume/frequency context */
    trainingState?: TrainingState;
    /** Nutrition targets for calorie context */
    nutritionTargets?: NutritionTargets;
    /** Recovery state for adjustment */
    recoveryState?: { fatigueAccumulation: string; sleepAdequacy: string };
    /** Current body weight kg */
    bodyWeightKg?: number;
  },
  config: ActivityTargetConfiguration = DEFAULT_ACTIVITY_TARGET_CONFIGURATION,
): ActivityTargets {
  const {
    goalKind,
    averageStepsLast14Days,
    weeklyCardioMinutes,
    trainingDaysPerWeek,
    trainingState,
    recoveryState,
    bodyWeightKg: _bodyWeightKg = 75,
  } = input;

  const goalMult = (config.goalMultipliers[goalKind] ?? config.goalMultipliers.custom) as { steps: number; cardio: number };

  // Base daily steps: baseline + training contribution + cardio contribution
  let dailyStepsTarget = config.baselineSteps;
  dailyStepsTarget += config.stepsPerTrainingDay * trainingDaysPerWeek;
  dailyStepsTarget += config.stepsPerCardio30Min * (weeklyCardioMinutes / 30);
  dailyStepsTarget = Math.round(dailyStepsTarget * goalMult.steps);

  // Adjust for current activity level (progressive overload principle)
  const stepGap = dailyStepsTarget - averageStepsLast14Days;
  if (stepGap > 2000) {
    // Don't jump more than 2000 steps at once
    dailyStepsTarget = averageStepsLast14Days + 2000;
  } else if (stepGap < -1000) {
    // If already exceeding, maintain slightly above current
    dailyStepsTarget = averageStepsLast14Days + 500;
  }

  // Apply floors/ceilings
  dailyStepsTarget = Math.max(config.minDailySteps, Math.min(config.maxDailySteps, dailyStepsTarget));

  // Weekly cardio target
  let weeklyCardioTarget = config.baselineWeeklyCardioMin + config.cardioMinPerTrainingDay * trainingDaysPerWeek;
  weeklyCardioTarget = Math.round(weeklyCardioTarget * goalMult.cardio);

  // Recovery adjustments
  if (recoveryState) {
    if (recoveryState.fatigueAccumulation === "high" || recoveryState.fatigueAccumulation === "very_high") {
      dailyStepsTarget = Math.round(dailyStepsTarget * config.recoveryReduction.severe);
      weeklyCardioTarget = Math.round(weeklyCardioTarget * config.recoveryReduction.severe);
    } else if (recoveryState.fatigueAccumulation === "moderate") {
      dailyStepsTarget = Math.round(dailyStepsTarget * config.recoveryReduction.moderate);
      weeklyCardioTarget = Math.round(weeklyCardioTarget * config.recoveryReduction.moderate);
    }
    if (recoveryState.sleepAdequacy === "severe_debt") {
      dailyStepsTarget = Math.round(dailyStepsTarget * 0.8);
      weeklyCardioTarget = Math.round(weeklyCardioTarget * 0.8);
    }
  }

  // Weekly active minutes = cardio + training (training ~45 min/session)
  const weeklyTrainingMinutes = (trainingState?.weeklySessionFrequency ?? trainingDaysPerWeek) * 45;
  const weeklyActiveMinTarget = weeklyCardioTarget + weeklyTrainingMinutes;

  // Build basis note for explainability
  const basisParts: string[] = [
    `Baseline ${config.baselineSteps} steps`,
    `+${config.stepsPerTrainingDay} × ${trainingDaysPerWeek} training days`,
    `+${config.stepsPerCardio30Min} × ${Math.round(weeklyCardioMinutes / 30)} cardio blocks`,
    `Goal ${goalKind} (×${goalMult.steps} steps, ×${goalMult.cardio} cardio)`,
  ];
  if (recoveryState) {
    basisParts.push(`Recovery: fatigue ${recoveryState.fatigueAccumulation}, sleep ${recoveryState.sleepAdequacy}`);
  }
  if (stepGap > 2000) basisParts.push(`Capped: gap ${stepGap} > 2000`);
  else if (stepGap < -1000) basisParts.push(`Maintenance: already exceeding by ${-stepGap}`);

  return {
    dailyStepsTarget,
    weeklyCardioMinTarget: weeklyCardioTarget,
    weeklyActiveMinTarget,
    basisNote: basisParts.join("; "),
  };
}

/**
 * Compute rolling averages for activity context.
 */
export function computeActivityContext(
  dailySummaries: readonly DailyActivitySummary[],
  windowDays = 14,
): { averageSteps: number; weeklyCardioMinutes: number; averageActiveMinutes: number } {
  const recent = dailySummaries.slice(0, windowDays);
  if (recent.length === 0) return { averageSteps: 0, weeklyCardioMinutes: 0, averageActiveMinutes: 0 };

  const totalSteps = recent.reduce((sum, d) => sum + d.steps, 0);
  const totalCardio = recent.reduce((sum, d) => sum + d.cardioMinutes, 0);
  const totalActive = recent.reduce((sum, d) => sum + d.activeMinutes, 0);

  return {
    averageSteps: Math.round(totalSteps / recent.length),
    weeklyCardioMinutes: Math.round((totalCardio / recent.length) * 7),
    averageActiveMinutes: Math.round(totalActive / recent.length),
  };
}