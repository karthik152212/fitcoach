import type {
  ActivityRepository,
  SleepRepository,
  RecoveryRepository,
  WorkoutRepository,
  NutritionRepository,
  GoalRecord,
} from "@fitcoach/db";
import type {
  CalendarDate,
  DailyActivitySummary,
  ActivityTargets,
  RecoveryState,
  TrainingState,
  NutritionTargets,
  Profile,
  ActivityRecord,
  SleepObservation,
  RecoveryIndicator,
  ObservationOrigin,
  ConfidenceLevel,
} from "@fitcoach/domain";
import {
  aggregateDailyActivity,
  deriveActivityTargets,
  computeActivityContext,
  DEFAULT_ACTIVITY_TARGET_CONFIGURATION,
} from "@fitcoach/fitness-core/activity";
import {
  computeRecoveryState,
  detectRecoveryPlateauSignals,
  DEFAULT_RECOVERY_CONFIGURATION,
} from "@fitcoach/fitness-core/recovery";
import type { ActivityRecordRow, SleepObservationRecord, RecoveryIndicatorRecord } from "@fitcoach/db";

function toObservationOrigin(source: string): ObservationOrigin {
  const validOrigins: ObservationOrigin[] = [
    "manual",
    "health_connect",
    "apple_health",
    "wearable",
    "phone_sensor",
    "imported_dataset",
    "ai_parsed",
    "photo_derived",
    "system_computed",
  ];
  return validOrigins.includes(source as ObservationOrigin) ? (source as ObservationOrigin) : "manual";
}

function toConfidenceLevel(confidence: string): ConfidenceLevel {
  const validConfidence: ConfidenceLevel[] = ["measured", "label_declared", "estimated", "unknown"];
  return validConfidence.includes(confidence as ConfidenceLevel) ? (confidence as ConfidenceLevel) : "unknown";
}

function toActivityRecord(row: ActivityRecordRow): ActivityRecord {
  return {
    id: row.id,
    userId: row.userId,
    date: row.date,
    kind: row.kind,
    steps: row.steps,
    durationMinutes: row.durationMinutes,
    distanceKm: row.distanceKm,
    averageHeartRateBpm: row.averageHeartRateBpm,
    estimatedCaloriesBurned: row.estimatedCaloriesBurned,
    effort: row.effort,
    recordedVia: row.recordedVia,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSleepObservation(row: SleepObservationRecord): SleepObservation {
  return {
    id: row.id,
    userId: row.userId,
    date: row.date,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    timeInBedMinutes: row.timeInBedMinutes,
    asleepMinutes: row.asleepMinutes,
    efficiency: row.efficiency,
    latencyMinutes: row.latencyMinutes,
    stages: row.deepMinutes !== undefined || row.remMinutes !== undefined || row.lightMinutes !== undefined || row.awakeMinutes !== undefined
      ? { deepMinutes: row.deepMinutes, remMinutes: row.remMinutes, lightMinutes: row.lightMinutes, awakeMinutes: row.awakeMinutes }
      : undefined,
    awakenings: row.awakenings,
    source: toObservationOrigin(row.source),
    externalId: row.externalId,
    confidence: toConfidenceLevel(row.confidence),
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRecoveryIndicator(row: RecoveryIndicatorRecord): RecoveryIndicator {
  return {
    id: row.id,
    userId: row.userId,
    date: row.date,
    hrvMs: row.hrvMs,
    restingHeartRateBpm: row.restingHeartRateBpm,
    sleepScore: row.sleepScore,
    readinessScore: row.readinessScore,
    muscleSoreness: row.muscleSoreness,
    fatigue: row.fatigue,
    sleepQuality: row.sleepQuality,
    readinessSubjective: row.readinessSubjective,
    source: toObservationOrigin(row.source),
    externalId: row.externalId,
    confidence: toConfidenceLevel(row.confidence),
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface ActivityContext {
  averageStepsLast14Days: number;
  weeklyCardioMinutes: number;
  trainingDaysPerWeek: number;
  trainingState?: TrainingState;
  nutritionTargets?: NutritionTargets;
  recoveryState?: RecoveryState;
  bodyWeightKg?: number;
}

/**
 * Service for computing derived activity state (aggregations, targets).
 * Pure computation — no persistence.
 */
export class ActivityIntelligenceService {
  constructor(
    private readonly activity: ActivityRepository,
    private readonly workouts: WorkoutRepository,
    private readonly profiles: { get: (userId: string) => Promise<Profile> },
    private readonly goals: { active: (userId: string) => Promise<GoalRecord | null> },
    private readonly nutrition: NutritionRepository,
    private readonly planner: { getTrainingState: (userId: string) => Promise<TrainingState> },
  ) {}

  /**
   * Get daily activity summaries for a date range.
   */
  async getDailySummaries(
    userId: string,
    from: CalendarDate,
    to: CalendarDate,
  ): Promise<readonly DailyActivitySummary[]> {
    const activityRecords = await this.activity.history(userId, { from, to, limit: 200 });
    const trainingMinutes = await this.getTrainingMinutesByDate(userId, from, to);
    return aggregateDailyActivity(activityRecords.map(toActivityRecord), trainingMinutes);
  }

  /**
   * Get personalized activity targets for the user.
   */
  async getActivityTargets(userId: string): Promise<ActivityTargets> {
    const profile = await this.profiles.get(userId);
    const goal = await this.goals.active(userId);

    // Get recent activity context (14 days)
    const to = new Date().toISOString().split("T")[0] as CalendarDate;
    const from = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0] as CalendarDate;
    const summaries = await this.getDailySummaries(userId, from, to);
    const context = computeActivityContext(summaries);

    // Get training state
    const trainingState = await this.planner.getTrainingState(userId);

    // Get nutrition targets (use getDaily with most recent date)
    const latestNutrition = await this.nutrition.getDaily(userId, to);
    const nutritionTargets = latestNutrition?.targetsSnapshot as NutritionTargets | undefined;

    // Get recovery state - implement if needed
    const recoveryState: RecoveryState | undefined = undefined;

    // Get current body weight
    const bodyWeight = await this.getLatestBodyWeight(userId);

    return deriveActivityTargets(
      {
        goalKind: goal?.kind ?? "general_fitness",
        averageStepsLast14Days: context.averageSteps,
        weeklyCardioMinutes: context.weeklyCardioMinutes,
        trainingDaysPerWeek: profile?.trainingDaysPerWeek ?? 3,
        trainingState,
        nutritionTargets,
        recoveryState,
        bodyWeightKg: bodyWeight,
      },
      DEFAULT_ACTIVITY_TARGET_CONFIGURATION,
    );
  }

  /**
   * Get activity context (rolling averages).
   */
  async getActivityContext(userId: string, windowDays = 14): Promise<ReturnType<typeof computeActivityContext>> {
    const to = new Date().toISOString().split("T")[0] as CalendarDate;
    const from = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString().split("T")[0] as CalendarDate;
    const summaries = await this.getDailySummaries(userId, from, to);
    return computeActivityContext(summaries, windowDays);
  }

  private async getTrainingMinutesByDate(
    userId: string,
    from: CalendarDate,
    to: CalendarDate,
  ): Promise<Record<CalendarDate, number>> {
    const workouts = await this.workouts.history(userId, { from, to, limit: 100 });
    const byDate: Record<CalendarDate, number> = {};
    for (const w of workouts) {
      if (w.workout.status === "completed" && w.workout.endedAt) {
        const date = w.workout.startedAt.split("T")[0] as CalendarDate;
        const duration = Math.round((new Date(w.workout.endedAt).getTime() - new Date(w.workout.startedAt).getTime()) / 60000);
        byDate[date] = (byDate[date] ?? 0) + duration;
      }
    }
    return byDate;
  }

  private async getLatestBodyWeight(_userId: string): Promise<number | undefined> {
    // Body weight would come from body measurements repository
    // For now return undefined
    return undefined;
  }
}

/**
 * Service for computing recovery state.
 */
export class RecoveryIntelligenceService {
  constructor(
    private readonly sleep: SleepRepository,
    private readonly recovery: RecoveryRepository,
    private readonly activity: ActivityRepository,
    private readonly workouts: WorkoutRepository,
    private readonly nutrition: NutritionRepository,
    private readonly planner: { getTrainingState: (userId: string) => Promise<TrainingState> },
  ) {}

  /**
   * Get computed recovery state for the user.
   */
  async getRecoveryState(userId: string): Promise<RecoveryState> {
    const to = new Date().toISOString().split("T")[0] as CalendarDate;
    const from = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0] as CalendarDate;

    const sleepObservations = (await this.sleep.history(userId, { from, to, limit: 20 })).map(toSleepObservation);
    const recoveryIndicators = (await this.recovery.history(userId, { from, to, limit: 20 })).map(toRecoveryIndicator);
    const activitySummaries = await this.getActivitySummaries(userId, from, to);

    const trainingState = await this.planner.getTrainingState(userId);

    const latestNutrition = await this.nutrition.getDaily(userId, to);
    const nutritionTargets = latestNutrition?.targetsSnapshot as NutritionTargets | undefined;
    const dailyNutrition = await this.getDailyNutritionHistory(userId, from, to);
    const nutritionAdherence = this.computeNutritionAdherence(nutritionTargets, dailyNutrition);

    return computeRecoveryState(
      {
        sleepObservations,
        recoveryIndicators,
        dailyActivity: activitySummaries,
        trainingState,
        nutritionAdherence,
        asOf: to,
      },
      DEFAULT_RECOVERY_CONFIGURATION,
    );
  }

  /**
   * Get recovery-related plateau signals for adaptation engine.
   */
  async getRecoveryPlateauSignals(userId: string): Promise<ReturnType<typeof detectRecoveryPlateauSignals>> {
    const recoveryState = await this.getRecoveryState(userId);
    const trainingState = await this.planner.getTrainingState(userId);
    return detectRecoveryPlateauSignals(recoveryState, trainingState);
  }

  private async getActivitySummaries(
    userId: string,
    from: CalendarDate,
    to: CalendarDate,
  ): Promise<readonly DailyActivitySummary[]> {
    const activityRecords = await this.activity.history(userId, { from, to, limit: 200 });
    const trainingMinutes = await this.getTrainingMinutesByDate(userId, from, to);
    return aggregateDailyActivity(activityRecords.map(toActivityRecord), trainingMinutes);
  }

  private async getTrainingMinutesByDate(
    userId: string,
    from: CalendarDate,
    to: CalendarDate,
  ): Promise<Record<CalendarDate, number>> {
    const workouts = await this.workouts.history(userId, { from, to, limit: 100 });
    const byDate: Record<CalendarDate, number> = {};
    for (const w of workouts) {
      if (w.workout.status === "completed" && w.workout.endedAt) {
        const date = w.workout.startedAt.split("T")[0] as CalendarDate;
        const duration = Math.round((new Date(w.workout.endedAt).getTime() - new Date(w.workout.startedAt).getTime()) / 60000);
        byDate[date] = (byDate[date] ?? 0) + duration;
      }
    }
    return byDate;
  }

  private async getDailyNutritionHistory(
    userId: string,
    from: CalendarDate,
    to: CalendarDate,
  ): Promise<Array<{ totalCaloriesKcal: number; totalProteinG: number }>> {
    const results: Array<{ totalCaloriesKcal: number; totalProteinG: number }> = [];
    const current = new Date(from);
    const end = new Date(to);
    while (current <= end) {
      const date = current.toISOString().split("T")[0] as CalendarDate;
      const daily = await this.nutrition.getDaily(userId, date);
      if (daily) {
        results.push({
          totalCaloriesKcal: daily.totals.caloriesKcal,
          totalProteinG: daily.totals.proteinGrams,
        });
      }
      current.setDate(current.getDate() + 1);
    }
    return results;
  }

  private computeNutritionAdherence(
    targets: NutritionTargets | undefined,
    daily: Array<{ totalCaloriesKcal: number; totalProteinG: number }>,
  ): { caloriesPercent: number; proteinPercent: number } | undefined {
    if (!targets || daily.length === 0) return undefined;
    const avgCalories = daily.reduce((s, d) => s + d.totalCaloriesKcal, 0) / daily.length;
    const avgProtein = daily.reduce((s, d) => s + d.totalProteinG, 0) / daily.length;
    return {
      caloriesPercent: (avgCalories / targets.caloriesKcal) * 100,
      proteinPercent: (avgProtein / targets.proteinGrams) * 100,
    };
  }
}