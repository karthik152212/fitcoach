import type {
  Repositories,
  DecisionSnapshotRecord,
  DecisionInterventionRecord,
  DecisionEvidenceRecord,
  DecisionAssumptionRecord,
  DecisionOutcomeRecord,
} from "@fitcoach/db";
import type {
  CalendarDate,
  ConfidenceLevel,
  DecisionKind,
  DecisionSnapshotStatus,
  DecisionOutcomeVerdict,
  UnifiedFitCoachState,
  DecisionSnapshot,
  GenerateDecisionRequest,
  GenerateDecisionResult,
  DecisionOutcomeEvaluationInput,
  DecisionOutcomeEvaluationResult,
  UnifiedStateSourceKind,
  DecisionAssumptionCategory,
  InterventionId,
  ProvenanceClass,
  DecisionEvidenceId,
  RecoveryState,
  DailyNutrition,
  NutritionTargets,
  PhysiqueTarget,
} from "@fitcoach/domain";
import {
  buildUnifiedState,
  makeUnifiedDecision,
  shouldReevaluate,
  evaluateDecisionOutcome,
  DEFAULT_UNIFIED_DECISION_CONFIGURATION,
  type UnifiedDecisionConfiguration,
  computeRecoveryState,
  DEFAULT_RECOVERY_CONFIGURATION,
  analyzeBodyMeasurements,
  DEFAULT_MEASUREMENT_ANALYSIS_CONFIG,
  DEFAULT_BODY_COMPOSITION_CONFIG,
  aggregateDailyActivity,
  deriveActivityTargets,
  computeActivityContext,
  DEFAULT_ACTIVITY_TARGET_CONFIGURATION,
  evaluateProgressionFromHistory,
  sortObservations,
  toPerformanceObservation,
  type PerformanceSetInput,
  DEFAULT_PROGRESSION_LEDGER_CONFIGURATION,
} from "@fitcoach/fitness-core";
import {
  analyzeNutritionTrend,
} from "@fitcoach/nutrition";
import { NotFoundError } from "@fitcoach/db";
import { newUuidv7 } from "@fitcoach/db";

/**
 * Specialist state types for Unified Decision slices.
 * These are the payload types for each specialist slice in UnifiedFitCoachState.
 */

export interface NutritionState {
  dailyNutrition: readonly DailyNutrition[];
  targets?: NutritionTargets;
  adherence: { proteinPercent: number; caloriesPercent: number };
  trends: { proteinTrend: "improving" | "stable" | "declining"; caloriesTrend: "improving" | "stable" | "declining" };
}

export interface BodyState {
  latestMeasurement?: {
    recordedAt: string;
    bodyWeightKg: number;
    bodyFatPercent?: number;
    circumferencesCm?: Record<string, number>;
  };
  weightTrend?: { slopeKgPerWeek: number; direction: "gaining" | "losing" | "stable"; confidence: number };
  bodyFatTrend?: { slopePercentPerWeek: number; direction: "increasing" | "decreasing" | "stable"; confidence: number };
  disproportionateDevelopment?: readonly string[];
  measurementTrends?: Record<string, { slopeCmPerWeek: number; direction: "increasing" | "decreasing" | "stable"; confidence: number }>;
}

export interface ActivityState {
  recentSteps: readonly { date: string; steps: number }[];
  averageSteps: number;
  totalDaysTracked: number;
  adherence: { stepsPercent: number; cardioPercent: number };
  dailyStepsTarget: number;
  weeklyCardioTarget: number;
}

export interface ProjectionState {
  planId: string;
  assumptions: readonly { code: string; value: string }[];
  divergences: readonly { significant: boolean; description: string }[];
}

export interface GoalState {
  id: string;
  kind: string;
  priorities: readonly string[];
  physiqueTarget?: PhysiqueTarget;
  effectiveFrom: string;
  alignment: { score: number; gaps: readonly string[] };
}

// Local mutable version of TrainingState for building payload
interface MutableTrainingState {
  activePlan?: { id: string; name: string; status: string } | null;
  recentWorkouts: readonly { id: string; startedAt: string; status: string; exercises: number }[];
  workoutCount: number;
  adherence: number;
  plateauSignals: { kind: string; observation: string; affectedEntity?: string; severity?: number; observedWeeks?: number }[];
  progressionStatus: Record<string, { exerciseName: string; status: string; lastEvaluated: CalendarDate; bestReps?: number; bestLoadKg?: number; trend?: string; recommendation: string; confidence: number }>;
  plannedWeeklyVolumePerMuscle: Record<string, number>;
  completedWeeklyVolumePerMuscle: Record<string, number>;
}

/**
 * Unified Decision Service — the unified decision brain's API layer.
 *
 * Wraps the core engine (fitness-core) with persistence (repositories).
 * Follows the pattern: domain → service → repository → Prisma → PostgreSQL.
 */

export interface GenerateDecisionCommand {
  userId: string;
  asOf?: CalendarDate;
  forceReevaluate?: boolean;
  assumptionOverrides?: Record<string, string>;
}

export interface RecordDecisionOutcomeCommand {
  evaluatedAt?: string;
  evaluationWindow: string;
  verdict: DecisionOutcomeVerdict;
  interventionVerdicts: Array<{
    interventionIndex: number;
    verdict: DecisionOutcomeVerdict;
    observations: string[];
  }>;
  observations: string[];
  explanation: string;
  followUpDiagnosisIds?: string[];
  triggersReevaluation: boolean;
}

export interface ListDecisionsOptions {
  status?: DecisionSnapshotStatus;
  limit?: number;
  cursor?: string;
}

export interface ListDecisionOutcomesOptions {
  evaluationWindow?: string;
  limit?: number;
}

export class UnifiedDecisionService {
  constructor(
    private readonly repos: Repositories,
    private readonly config: UnifiedDecisionConfiguration = DEFAULT_UNIFIED_DECISION_CONFIGURATION,
  ) {}

  private async requireUser(userId: string): Promise<{ timezone: string }> {
    const user = await this.repos.users.findById(userId);
    if (!user) throw new NotFoundError(`user ${userId} not found`);
    return user;
  }

  public async buildUnifiedStateForUser(
    userId: string,
    asOf: CalendarDate,
  ): Promise<UnifiedFitCoachState> {
    // Fetch all specialist slices for the user
    const [
      latestBodyMeasurement,
      recentActivity,
      recentRecovery,
      recentSleep,
      latestDailyNutrition,
      activeGoal,
      activePlan,
      recentWorkouts,
    ] = await Promise.all([
      this.repos.bodyMeasurements.history(userId, { limit: 28 }),
      this.repos.activity.history(userId, { limit: 28 }),
      this.repos.recovery.history(userId, { limit: 28 }),
      this.repos.sleep.history(userId, { limit: 28 }),
      this.repos.nutrition.getDaily(userId, asOf),
      this.repos.goals.active(userId),
      this.repos.trainingPlans.findActive(userId),
      this.repos.workouts.history(userId, { limit: 28 }),
    ]);

    // Get active interventions (proposed/accepted status)
    const activeInterventions = await this.repos.interventions.list(userId, {
      status: "proposed",
      limit: 50,
    });

    // Get current decision for supersession chain
    const currentDecisions = await this.repos.decisionSnapshots.list(userId, { status: "current", limit: 1 });
    const previousUnifiedStateId = currentDecisions[0]?.unifiedStateId;

    // Get profile for body composition estimation
    const profile = await this.repos.profiles.get(userId);

    // Get nutrition targets from state snapshot
    const nutritionStateSnapshot = await this.repos.nutrition.getStateSnapshot(userId, asOf, 28);
    const nutritionTargets = nutritionStateSnapshot?.recentDailyTotals[0]?.targetsSnapshot as unknown as NutritionTargets | undefined;

    // Get training minutes by date for activity aggregation
    const trainingMinutesByDate: Record<string, number> = {};
    for (const w of recentWorkouts) {
      const startedAt = w.workout.startedAt;
      if (!startedAt) continue;
      const date = startedAt.split("T")[0] ?? "";
      if (!date) continue;
      trainingMinutesByDate[date] = (trainingMinutesByDate[date] ?? 0) + (w.workout.endedAt && w.workout.startedAt
        ? Math.round((new Date(w.workout.endedAt).getTime() - new Date(w.workout.startedAt).getTime()) / 60000)
        : 60);
    }

    // ========================================================================
    // Compute TRAINING STATE with progression status, adherence, plateau signals
    // ========================================================================
    let trainingStatePayload: MutableTrainingState = {
      activePlan: activePlan ? { id: activePlan.id, name: activePlan.name, status: activePlan.status } : null,
      recentWorkouts: recentWorkouts.map((w) => ({
        id: w.workout.id,
        startedAt: w.workout.startedAt,
        status: w.workout.status,
        exercises: w.exercises.length,
      })),
      workoutCount: recentWorkouts.length,
      adherence: 1.0,
      plateauSignals: [],
      progressionStatus: {},
      plannedWeeklyVolumePerMuscle: {},
      completedWeeklyVolumePerMuscle: {},
    };

    if (activePlan || recentWorkouts.length > 0) {
      // Compute training adherence
      const plannedSessions = activePlan ? 4 : 4; // default 4 sessions/week from profile
      const completedSessions = recentWorkouts.filter((w) => w.workout.status === "completed").length;
      trainingStatePayload.adherence = plannedSessions > 0 ? Math.min(1, completedSessions / (plannedSessions * 4)) : 1.0; // 4 weeks

      // Compute progression status for each exercise from workout history
      const exerciseObservations = new Map<string, PerformanceSetInput[]>();
      for (const w of recentWorkouts) {
        for (const ex of w.exercises) {
          for (const set of ex.sets) {
            if (set.kind === "working" && set.reps !== undefined && set.loadKg !== undefined) {
              const key = ex.exerciseId;
              if (!exerciseObservations.has(key)) exerciseObservations.set(key, []);
              exerciseObservations.get(key)!.push({
                id: set.id,
                exerciseId: ex.exerciseId,
                workoutId: w.workout.id,
                planVersionId: w.workout.planVersionId,
                slotId: ex.slotId,
                setKind: set.kind,
                loadKg: set.loadKg,
                reps: set.reps,
                rir: set.rir,
                createdAt: set.createdAt,
                workoutStatus: w.workout.status,
                targetRepMin: 8,
                targetRepMax: 12,
                environmentKind: w.workout.environmentKind,
                localDate: w.workout.startedAt.split("T")[0] as CalendarDate,
              });
            }
          }
        }
      }

      // Evaluate progression for each exercise
      for (const [exerciseId, observations] of exerciseObservations) {
        if (observations.length >= 3) {
          const sortedObs = sortObservations(observations.map(toPerformanceObservation));
          const evalResult = evaluateProgressionFromHistory({
            exerciseId,
            exerciseName: `ex_${exerciseId}`,
            goalProfile: "hypertrophy",
            observations: sortedObs,
            configuration: DEFAULT_PROGRESSION_LEDGER_CONFIGURATION,
          });
          trainingStatePayload.progressionStatus[exerciseId] = {
            exerciseName: `ex_${exerciseId}`,
            status: evalResult.outcome === "insufficient_data" ? "progressing" :
                    evalResult.outcome === "maintain" ? "progressing" :
                    evalResult.outcome === "increase_load" || evalResult.outcome === "increase_reps" ? "progressing" :
                    evalResult.outcome === "repeat" ? "stalled" :
                    evalResult.outcome === "reduce_load" || evalResult.outcome === "reduce_target" ? "regressing" :
                    evalResult.outcome === "change_exercise" ? "stalled" : "unknown",
            lastEvaluated: asOf,
            ...(evalResult.performance.bestReps !== undefined ? { bestReps: evalResult.performance.bestReps } : {}),
            ...(evalResult.performance.bestLoadKg !== undefined ? { bestLoadKg: evalResult.performance.bestLoadKg } : {}),
            trend: evalResult.performance.trend,
            recommendation: evalResult.recommendation.outcome,
            confidence: evalResult.recommendation.confidence,
          };
        }
      }

      // Detect plateau signals
      for (const [exerciseId, status] of Object.entries(trainingStatePayload.progressionStatus)) {
        if (status.status === "stalled" || status.status === "regressing") {
          trainingStatePayload.plateauSignals.push({
            kind: status.status === "stalled" ? "repeated_performance_stagnation" : "declining_performance",
            observation: `${status.exerciseName} progression is ${status.status}`,
            affectedEntity: exerciseId,
            severity: status.status === "regressing" ? 0.8 : 0.6,
            observedWeeks: 2,
          });
        }
      }

      // Compute planned vs completed weekly volume per muscle (simplified)
      const muscleGroups = ["chest", "back", "legs", "shoulders", "arms"];
      for (const muscle of muscleGroups) {
        trainingStatePayload.plannedWeeklyVolumePerMuscle[muscle] = 12; // default
        trainingStatePayload.completedWeeklyVolumePerMuscle[muscle] = Math.round(12 * trainingStatePayload.adherence);
      }
    }

    let trainingStateSlice: UnifiedFitCoachState["slices"][0] | undefined;
    if (activePlan || recentWorkouts.length > 0) {
      trainingStateSlice = {
        sourceKind: "training_state",
        configVersion: "fitcoach.training.v1",
        computedAt: new Date().toISOString(),
        payload: trainingStatePayload,
        confidence: activePlan ? "measured" : "estimated",
        warnings: activePlan ? [] : ["No active training plan"],
      } as const;
    }

    // ========================================================================
    // Compute NUTRITION STATE with adherence, targets, trends
    // ========================================================================
    // Helper to convert DailyNutritionRecord to domain DailyNutrition
    const convertDailyNutrition = (record: NonNullable<typeof latestDailyNutrition>): import("@fitcoach/domain").DailyNutrition => {
      let targetsSnapshot: import("@fitcoach/domain").NutritionTargets | undefined;
      if (record.targetsSnapshot && typeof record.targetsSnapshot === "object" && "caloriesKcal" in record.targetsSnapshot) {
        const ts = record.targetsSnapshot as Record<string, unknown>;
        if (typeof ts.caloriesKcal === "number" && typeof ts.proteinGrams === "number" && typeof ts.effectiveFrom === "string") {
          targetsSnapshot = {
            caloriesKcal: ts.caloriesKcal,
            proteinGrams: ts.proteinGrams,
            carbohydrateGrams: typeof ts.carbohydrateGrams === "number" ? ts.carbohydrateGrams : undefined,
            fatGrams: typeof ts.fatGrams === "number" ? ts.fatGrams : undefined,
            fiberGrams: typeof ts.fiberGrams === "number" ? ts.fiberGrams : undefined,
            basisNote: typeof ts.basisNote === "string" ? ts.basisNote : undefined,
            effectiveFrom: ts.effectiveFrom,
          };
        }
      }
      return {
        id: record.id,
        userId: record.userId,
        date: record.localDate,
        mealIds: [],
        totals: record.totals,
        targetsSnapshot,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    };

    let nutritionStatePayload: NutritionState = {
      dailyNutrition: latestDailyNutrition ? [convertDailyNutrition(latestDailyNutrition)] : [],
      targets: nutritionTargets ?? undefined,
      adherence: { proteinPercent: 100, caloriesPercent: 100 },
      trends: { proteinTrend: "stable", caloriesTrend: "stable" },
    };

    // Helper to map fitness-core TrendDirection to domain trend type
    const mapTrendDirection = (dir: "increasing" | "decreasing" | "stable" | "insufficient_data"): "improving" | "stable" | "declining" => {
      switch (dir) {
        case "increasing": return "improving";
        case "decreasing": return "declining";
        case "stable": return "stable";
        case "insufficient_data": return "stable";
      }
    };

    if (latestDailyNutrition && nutritionTargets && nutritionStateSnapshot) {
      const dailyHistory = nutritionStateSnapshot.recentDailyTotals;
      if (dailyHistory.length > 0) {
        const trendReport = analyzeNutritionTrend(dailyHistory as any, 28, { minPoints: 7 });
        nutritionStatePayload.trends = {
          proteinTrend: mapTrendDirection(trendReport.protein.direction),
          caloriesTrend: mapTrendDirection(trendReport.calories.direction),
        };
      }

      const proteinPercent = nutritionTargets.proteinGrams > 0
        ? Math.round((latestDailyNutrition.totals.proteinGrams / nutritionTargets.proteinGrams) * 100)
        : 100;
      const caloriesPercent = nutritionTargets.caloriesKcal > 0
        ? Math.round((latestDailyNutrition.totals.caloriesKcal / nutritionTargets.caloriesKcal) * 100)
        : 100;

      nutritionStatePayload.adherence = { proteinPercent, caloriesPercent };
      nutritionStatePayload.targets = nutritionTargets;
      nutritionStatePayload.dailyNutrition = [convertDailyNutrition(latestDailyNutrition)];
    }

    let nutritionStateSlice: UnifiedFitCoachState["slices"][0] | undefined;
    if (latestDailyNutrition) {
      nutritionStateSlice = {
        sourceKind: "nutrition_state",
        configVersion: "fitcoach.nutrition.v1",
        computedAt: new Date().toISOString(),
        payload: nutritionStatePayload,
        confidence: "measured",
        warnings: [],
      } as const;
    }

    // ========================================================================
    // Compute BODY STATE with weight trend, body fat trend, measurement trends
    // ========================================================================
    let bodyStatePayload: BodyState = {
      latestMeasurement: undefined,
      weightTrend: undefined,
      bodyFatTrend: undefined,
      disproportionateDevelopment: [],
      measurementTrends: {},
    };

    if (latestBodyMeasurement.length > 0) {
      const bm = latestBodyMeasurement[0]!;
      bodyStatePayload.latestMeasurement = {
        recordedAt: bm.recordedAt,
        bodyWeightKg: bm.bodyWeightKg ?? 0,
        bodyFatPercent: bm.bodyFatPercent,
        circumferencesCm: bm.circumferencesCm,
      };

      if (profile && latestBodyMeasurement.length >= 2) {
        const heightCm = profile.heightCm ?? 180;
        const sex = profile.sex === "male" ? "male" : "female";
        const analysis = analyzeBodyMeasurements(
          latestBodyMeasurement as any,
          heightCm,
          sex,
          DEFAULT_MEASUREMENT_ANALYSIS_CONFIG,
          DEFAULT_BODY_COMPOSITION_CONFIG,
        );

        // Map TrendDirection to BodyState weight trend direction
        const mapWeightTrendDirection = (dir: "increasing" | "decreasing" | "stable" | "insufficient_data"): "gaining" | "losing" | "stable" => {
          switch (dir) {
            case "increasing": return "gaining";
            case "decreasing": return "losing";
            case "stable": return "stable";
            case "insufficient_data": return "stable";
          }
        };

        bodyStatePayload.weightTrend = {
          slopeKgPerWeek: analysis.weightTrend.slopeKgPerWeek ?? 0,
          direction: mapWeightTrendDirection(analysis.weightTrend.direction),
          confidence: analysis.weightTrend.confidence ?? 0.5,
        };

        bodyStatePayload.bodyFatTrend = {
          slopePercentPerWeek: 0, // simplified - body fat trend not directly computed
          direction: "stable",
          confidence: 0.5,
        };

        // Measurement trends from circumferences
        const measurementTrends = bodyStatePayload.measurementTrends ?? {};
        for (const trend of analysis.circumferenceTrends) {
          if (trend.slopeCmPerWeek !== null) {
            measurementTrends[trend.site] = {
              slopeCmPerWeek: trend.slopeCmPerWeek,
              direction: trend.direction === "increasing" ? "increasing" : trend.direction === "decreasing" ? "decreasing" : "stable",
              confidence: trend.confidence ?? 0.5,
            };
          }
        }
        bodyStatePayload.measurementTrends = measurementTrends;
      }
    }

    let bodyStateSlice: UnifiedFitCoachState["slices"][0] | undefined;
    if (latestBodyMeasurement.length > 0) {
      bodyStateSlice = {
        sourceKind: "body_state",
        configVersion: "fitcoach.body.v1",
        computedAt: new Date().toISOString(),
        payload: bodyStatePayload,
        confidence: "measured",
        warnings: [],
      } as const;
    }

    // ========================================================================
    // Compute RECOVERY STATE with readinessScore, sleepAdequacy, fatigueAccumulation, hrvTrend
    // ========================================================================
    let recoveryStatePayload: RecoveryState = {
      readinessScore: 75,
      confidence: 0.5,
      sleepQualityTrend: "stable",
      sleepAdequacy: "adequate",
      hrvTrend: "stable",
      fatigueAccumulation: "low",
      limitingFactors: [],
      trainingRecommendation: "maintain",
      nutritionRecommendations: [],
      activityRecommendations: [],
      basisNote: "default",
    };

    if (recentRecovery.length > 0 || recentSleep.length > 0) {
      // Convert SleepObservationRecord to SleepObservation (domain type)
      const sleepObs = recentSleep.map((s) => ({
        id: s.id,
        userId: s.userId,
        date: s.date,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        timeInBedMinutes: s.timeInBedMinutes,
        asleepMinutes: s.asleepMinutes,
        efficiency: s.efficiency,
        latencyMinutes: s.latencyMinutes,
        deepMinutes: s.deepMinutes,
        remMinutes: s.remMinutes,
        lightMinutes: s.lightMinutes,
        awakeMinutes: s.awakeMinutes,
        awakenings: s.awakenings,
        source: s.source as any,
        externalId: s.externalId,
        confidence: s.confidence as any,
        notes: s.notes,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }));

      // Convert RecoveryIndicatorRecord to RecoveryIndicator (domain type)
      const recoveryIndicators = recentRecovery.map((r) => ({
        id: r.id,
        userId: r.userId,
        date: r.date,
        hrvMs: r.hrvMs,
        restingHeartRateBpm: r.restingHeartRateBpm,
        sleepScore: r.sleepScore,
        readinessScore: r.readinessScore,
        muscleSoreness: r.muscleSoreness,
        fatigue: r.fatigue,
        sleepQuality: r.sleepQuality,
        readinessSubjective: r.readinessSubjective,
        source: r.source as any,
        externalId: r.externalId,
        confidence: r.confidence as any,
        notes: r.notes,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));

      const dailyActivity = aggregateDailyActivity(recentActivity as any, trainingMinutesByDate);

      const nutritionAdherence = nutritionStatePayload.adherence
        ? { caloriesPercent: nutritionStatePayload.adherence.caloriesPercent, proteinPercent: nutritionStatePayload.adherence.proteinPercent }
        : undefined;

      // Convert MutableTrainingState to domain TrainingState for computeRecoveryState
      const trainingStateForRecovery = {
        ...trainingStatePayload,
        progressionStatus: Object.fromEntries(
          Object.entries(trainingStatePayload.progressionStatus).map(([exerciseId, status]) => [
            exerciseId,
            {
              exerciseId,
              exerciseName: status.exerciseName,
              currentLoadKg: status.bestLoadKg,
              currentRepRange: undefined,
              currentRirTarget: undefined,
              lastProgressionDate: status.lastEvaluated,
              progressionsCompleted: 0, // Not tracked in unified state yet
              status: status.status as "progressing" | "holding" | "stalled" | "regressing" | "unknown",
              nextProgressionTarget: status.recommendation,
            } as import("@fitcoach/domain").ProgressionStatus,
          ])
        ),
      } as import("@fitcoach/domain").TrainingState;

      const computedRecovery = computeRecoveryState(
        {
          sleepObservations: sleepObs,
          recoveryIndicators,
          dailyActivity,
          trainingState: trainingStateForRecovery,
          nutritionAdherence,
          asOf,
        },
        DEFAULT_RECOVERY_CONFIGURATION,
      );

      recoveryStatePayload = {
        readinessScore: computedRecovery.readinessScore,
        confidence: computedRecovery.confidence,
        sleepQualityTrend: computedRecovery.sleepQualityTrend,
        sleepAdequacy: computedRecovery.sleepAdequacy,
        hrvTrend: computedRecovery.hrvTrend,
        fatigueAccumulation: computedRecovery.fatigueAccumulation,
        limitingFactors: computedRecovery.limitingFactors,
        trainingRecommendation: computedRecovery.trainingRecommendation,
        nutritionRecommendations: computedRecovery.nutritionRecommendations,
        activityRecommendations: computedRecovery.activityRecommendations,
        basisNote: computedRecovery.basisNote,
      };
    }

    let recoveryStateSlice: UnifiedFitCoachState["slices"][0] | undefined;
    if (recentRecovery.length > 0 || recentSleep.length > 0) {
      const latestRecovery = recentRecovery[0];
      const latestSleep = recentSleep[0];
      recoveryStateSlice = {
        sourceKind: "recovery_state",
        configVersion: "fitcoach.recovery.v1",
        computedAt: new Date().toISOString(),
        payload: {
          ...recoveryStatePayload,
          latestRecovery: latestRecovery ? {
            date: latestRecovery.date,
            hrvMs: latestRecovery.hrvMs,
            restingHeartRateBpm: latestRecovery.restingHeartRateBpm,
            sleepScore: latestRecovery.sleepScore,
            readinessScore: latestRecovery.readinessScore,
            muscleSoreness: latestRecovery.muscleSoreness,
            fatigue: latestRecovery.fatigue,
          } : null,
          latestSleep: latestSleep ? {
            date: latestSleep.date,
            timeInBedMinutes: latestSleep.timeInBedMinutes,
            asleepMinutes: latestSleep.asleepMinutes,
            efficiency: latestSleep.efficiency,
            deepMinutes: latestSleep.deepMinutes,
            remMinutes: latestSleep.remMinutes,
          } : null,
        },
        confidence: "measured",
        warnings: [],
      } as const;
    }

    // ========================================================================
    // Compute ACTIVITY STATE with adherence, targets
    // ========================================================================
    let activityStatePayload: ActivityState = {
      recentSteps: recentActivity
        .filter((a) => a.kind === "steps")
        .slice(0, 7)
        .map((d) => ({ date: d.date, steps: d.steps ?? 0 })),
      averageSteps: 0,
      totalDaysTracked: 0,
      adherence: { stepsPercent: 100, cardioPercent: 100 },
      dailyStepsTarget: 8000,
      weeklyCardioTarget: 75,
    };

    if (recentActivity.length > 0) {
      const stepsDays = recentActivity.filter((a) => a.kind === "steps");
      const totalSteps = stepsDays.reduce((sum, d) => sum + (d.steps ?? 0), 0);
      const avgSteps = stepsDays.length > 0 ? Math.round(totalSteps / stepsDays.length) : 0;

      const context = computeActivityContext(
        aggregateDailyActivity(recentActivity as any, trainingMinutesByDate),
        14,
      );

      const activityTargets = deriveActivityTargets({
        goalKind: activeGoal?.kind ?? "aesthetics_v_taper",
        averageStepsLast14Days: context.averageSteps,
        weeklyCardioMinutes: context.weeklyCardioMinutes,
        trainingDaysPerWeek: profile?.trainingDaysPerWeek ?? 4,
        trainingState: trainingStatePayload as any,
        recoveryState: {
          fatigueAccumulation: recoveryStatePayload.fatigueAccumulation,
          sleepAdequacy: recoveryStatePayload.sleepAdequacy,
        },
        bodyWeightKg: profile?.heightCm ? 80 : undefined, // default weight
      }, DEFAULT_ACTIVITY_TARGET_CONFIGURATION);

      activityStatePayload = {
        recentSteps: stepsDays.slice(0, 7).map((d) => ({ date: d.date, steps: d.steps ?? 0 })),
        averageSteps: avgSteps,
        totalDaysTracked: stepsDays.length,
        adherence: {
          stepsPercent: activityTargets.dailyStepsTarget > 0 ? Math.round((avgSteps / activityTargets.dailyStepsTarget) * 100) : 100,
          cardioPercent: activityTargets.weeklyCardioMinTarget > 0 ? Math.round((context.weeklyCardioMinutes / activityTargets.weeklyCardioMinTarget) * 100) : 100,
        },
        dailyStepsTarget: activityTargets.dailyStepsTarget,
        weeklyCardioTarget: activityTargets.weeklyCardioMinTarget,
      };
    }

    let activityStateSlice: UnifiedFitCoachState["slices"][0] | undefined;
    if (recentActivity.length > 0) {
      activityStateSlice = {
        sourceKind: "activity_state",
        configVersion: "fitcoach.activity.v1",
        computedAt: new Date().toISOString(),
        payload: activityStatePayload,
        confidence: "measured",
        warnings: [],
      } as const;
    }

    // ========================================================================
    // Compute PROJECTION STATE with divergences (placeholder for now)
    // ========================================================================
    let projectionStateSlice: UnifiedFitCoachState["slices"][0] | undefined;
    if (activePlan) {
      projectionStateSlice = {
        sourceKind: "projection_state",
        configVersion: "fitcoach.projection.v1",
        computedAt: new Date().toISOString(),
        payload: {
          planId: activePlan.id,
          assumptions: [],
          divergences: [],
        },
        confidence: "estimated",
        warnings: ["Projection engine not yet integrated"],
      } as const;
    }

    // ========================================================================
    // Compute GOAL STATE with alignment
    // ========================================================================
    let goalStatePayload: GoalState = {
      id: activeGoal?.id ?? "",
      kind: activeGoal?.kind ?? "",
      priorities: activeGoal?.priorities ?? [],
      physiqueTarget: activeGoal?.physiqueTarget ?? undefined,
      effectiveFrom: activeGoal?.effectiveFrom ?? "",
      alignment: { score: 70, gaps: [] },
    };

    if (activeGoal) {
      // Simple alignment scoring based on available data
      let score = 70;
      const gaps: string[] = [];

      if (trainingStatePayload.adherence < 0.8) {
        score -= 15;
        gaps.push("training_adherence");
      }
      if (nutritionStatePayload.adherence.proteinPercent < 80) {
        score -= 10;
        gaps.push("protein_intake");
      }
      if (nutritionStatePayload.adherence.caloriesPercent < 90) {
        score -= 5;
        gaps.push("calorie_intake");
      }
      if (recoveryStatePayload.readinessScore < 60) {
        score -= 10;
        gaps.push("recovery");
      }
      if (activityStatePayload.adherence.stepsPercent < 80) {
        score -= 5;
        gaps.push("activity");
      }

      goalStatePayload.alignment = { score: Math.max(0, score), gaps };
    }

    let goalStateSlice: UnifiedFitCoachState["slices"][0] | undefined;
    if (activeGoal) {
      goalStateSlice = {
        sourceKind: "goal_state",
        configVersion: "fitcoach.goals.v1",
        computedAt: new Date().toISOString(),
        payload: goalStatePayload,
        confidence: "measured",
        warnings: [],
      } as const;
    }

    return buildUnifiedState({
      userId,
      asOf,
      slices: {
        trainingState: trainingStateSlice ? { ...trainingStateSlice, warnings: [...trainingStateSlice.warnings] } : undefined,
        nutritionState: nutritionStateSlice ? { ...nutritionStateSlice, warnings: [...nutritionStateSlice.warnings] } : undefined,
        bodyState: bodyStateSlice ? { ...bodyStateSlice, warnings: [...bodyStateSlice.warnings] } : undefined,
        recoveryState: recoveryStateSlice ? { ...recoveryStateSlice, warnings: [...recoveryStateSlice.warnings] } : undefined,
        activityState: activityStateSlice ? { ...activityStateSlice, warnings: [...activityStateSlice.warnings] } : undefined,
        projectionState: projectionStateSlice ? { ...projectionStateSlice, warnings: [...projectionStateSlice.warnings] } : undefined,
        goalState: goalStateSlice ? { ...goalStateSlice, warnings: [...goalStateSlice.warnings] } : undefined,
      },
      activeGoal: activeGoal ?? undefined,
      activeInterventions: activeInterventions.map((i) => i.id),
      previousUnifiedStateId,
    });
  }

  async generateDecision(command: GenerateDecisionCommand): Promise<GenerateDecisionResult> {
    await this.requireUser(command.userId);

    const asOf = command.asOf ?? (new Date().toISOString().split("T")[0] as CalendarDate);

    // Build unified state from specialist slices
    const unifiedState = await this.buildUnifiedStateForUser(command.userId, asOf);

    // Get current decision if any (for supersession)
    const currentDecisions = await this.repos.decisionSnapshots.list(command.userId, { status: "current", limit: 1 });
    const previousDecision = currentDecisions[0] ? this.mapToDomainSnapshot(currentDecisions[0]) : undefined;

    // Check if re-evaluation is needed
    if (!command.forceReevaluate && previousDecision) {
      const reevaluation = shouldReevaluate(previousDecision, unifiedState, this.config);
      if (!reevaluation.should) {
        return {
          snapshot: previousDecision,
          isNew: false,
          previousSnapshot: undefined,
          unifiedState,
          diagnoses: [],
          interventions: [],
        };
      }
    }

    // Run the unified decision engine
    const request: GenerateDecisionRequest = {
      userId: command.userId,
      asOf,
      forceReevaluate: command.forceReevaluate,
      assumptionOverrides: command.assumptionOverrides,
    };

    const result = makeUnifiedDecision(request, unifiedState, previousDecision, this.config);

    // Persist the decision snapshot
    await this.persistDecisionSnapshot(result.snapshot, command.userId);

    // Supersede previous decision if applicable
    if (result.previousSnapshot) {
      await this.repos.decisionSnapshots.updateStatus(result.previousSnapshot.id, "superseded");
    }

    return result;
  }

  async getDecision(userId: string, decisionId: string): Promise<DecisionSnapshot | null> {
    await this.requireUser(userId);
    const record = await this.repos.decisionSnapshots.findByIdWithRelations(decisionId);
    if (!record || record.userId !== userId) return null;
    return this.mapToDomainSnapshot(record);
  }

  async listDecisions(userId: string, options: ListDecisionsOptions = {}): Promise<DecisionSnapshot[]> {
    await this.requireUser(userId);
    const records = await this.repos.decisionSnapshots.list(userId, {
      status: options.status,
      limit: options.limit ?? 20,
      cursor: options.cursor,
    });
    return records.map((r) => this.mapToDomainSnapshot(r));
  }

  async getCurrentDecision(userId: string): Promise<DecisionSnapshot | null> {
    await this.requireUser(userId);
    const records = await this.repos.decisionSnapshots.list(userId, { status: "current", limit: 1 });
    const firstRecord = records[0];
    if (!firstRecord) return null;
    const record = await this.repos.decisionSnapshots.findByIdWithRelations(firstRecord.id);
    return record ? this.mapToDomainSnapshot(record) : null;
  }

  async recordDecisionOutcome(
    userId: string,
    decisionId: string,
    command: RecordDecisionOutcomeCommand,
  ): Promise<DecisionOutcomeEvaluationResult> {
    await this.requireUser(userId);

    const decisionRecord = await this.repos.decisionSnapshots.findByIdWithRelations(decisionId);
    if (!decisionRecord || decisionRecord.userId !== userId) {
      throw new NotFoundError(`decision ${decisionId} not found`);
    }

    const domainDecision = this.mapToDomainSnapshot(decisionRecord);

    // Build current unified state for evaluation
    const asOf = new Date().toISOString().split("T")[0] as CalendarDate;
    const currentUnifiedState = await this.buildUnifiedStateForUser(userId, asOf);

    // Evaluate outcome using core engine
    const evaluationInput: DecisionOutcomeEvaluationInput = {
      decisionSnapshot: domainDecision,
      currentUnifiedState,
      evaluationWindowDays: this.parseEvaluationWindow(command.evaluationWindow),
      recordedVerdict: command.verdict,
    };

    const evaluation = evaluateDecisionOutcome(evaluationInput);

    // Persist the outcome
    await this.persistDecisionOutcome(decisionId, userId, command);

    return evaluation;
  }

  async listDecisionOutcomes(
    userId: string,
    decisionId: string,
    options: ListDecisionOutcomesOptions = {},
  ): Promise<DecisionOutcomeEvaluationResult[]> {
    await this.requireUser(userId);

    const decisionRecord = await this.repos.decisionSnapshots.findById(decisionId);
    if (!decisionRecord || decisionRecord.userId !== userId) {
      throw new NotFoundError(`decision ${decisionId} not found`);
    }

    const records = await this.repos.decisionOutcomes.list(decisionId, {
      evaluationWindow: options.evaluationWindow,
      limit: options.limit ?? 10,
    });

    return records.map((r) => this.mapToDomainOutcome(r));
  }

  async shouldReevaluateDecision(userId: string, decisionId: string): Promise<{ should: boolean; reason: string }> {
    await this.requireUser(userId);

    const decisionRecord = await this.repos.decisionSnapshots.findById(decisionId);
    if (!decisionRecord || decisionRecord.userId !== userId) {
      throw new NotFoundError(`decision ${decisionId} not found`);
    }

    const domainDecision = this.mapToDomainSnapshot(decisionRecord);
    const asOf = new Date().toISOString().split("T")[0] as CalendarDate;
    const currentUnifiedState = await this.buildUnifiedStateForUser(userId, asOf);

    // Fetch recent outcomes for this decision to check triggersReevaluation
    const recentOutcomes = await this.repos.decisionOutcomes.list(decisionId, { limit: 10 });
    const outcomeTriggers = recentOutcomes.map((o) => ({
      verdict: o.verdict,
      triggersReevaluation: o.triggersReevaluation,
    }));
    const reevaluateResult = shouldReevaluate(domainDecision, currentUnifiedState, this.config, outcomeTriggers);
    return reevaluateResult;
  }

  private async persistDecisionSnapshot(snapshot: DecisionSnapshot, userId: string): Promise<void> {
    // Create the main snapshot record
    await this.repos.decisionSnapshots.create({
      id: snapshot.id,
      userId,
      decidedAt: snapshot.decidedAt,
      kind: snapshot.kind,
      status: snapshot.status,
      unifiedStateId: snapshot.unifiedStateId,
      diagnosesAddressed: [...snapshot.diagnosesAddressed],
      monitoringPlan: [...snapshot.monitoringPlan],
      configVersion: snapshot.configVersion,
      summary: snapshot.summary,
      confidence: snapshot.confidence,
      supersedesId: snapshot.supersedesId,
      warnings: [...snapshot.warnings],
    });

    // Create interventions
    for (const intervention of snapshot.interventions) {
      await this.repos.decisionInterventions.create({
        id: newUuidv7(),
        decisionSnapshotId: snapshot.id,
        kind: intervention.kind,
        parameters: intervention.parameters as any,
        rationale: intervention.rationale,
        expectedEffect: intervention.expectedEffect,
        addressesDiagnoses: intervention.addressesDiagnoses as string[],
        reviewOn: intervention.reviewOn,
      });
    }

    // Create evidence
    for (const evidence of snapshot.evidence) {
      await this.repos.decisionEvidence.create({
        id: newUuidv7(),
        decisionSnapshotId: snapshot.id,
        sourceEngine: evidence.engine,
        code: evidence.code,
        title: evidence.description,
        metric: (evidence.payload as any)?.metric ?? "",
        window: (evidence.payload as any)?.window ?? "",
        observed: evidence.basis,
        observedNumeric: (evidence.payload as any)?.observedNumeric,
        expected: (evidence.payload as any)?.expected,
        confidence: evidence.confidence,
        provenanceClass: evidence.provenance,
        severity: (evidence.payload as any)?.severity ?? "informational",
        sensitive: evidence.sensitive,
      });
    }

    // Create assumptions
    for (const assumption of snapshot.assumptions) {
      await this.repos.decisionAssumptions.create({
        id: newUuidv7(),
        decisionSnapshotId: snapshot.id,
        code: assumption.code,
        description: assumption.description,
        category: assumption.category,
        value: assumption.value,
        sensitive: assumption.sensitive,
        source: assumption.source,
      });
    }
  }

  private async persistDecisionOutcome(
    decisionId: string,
    userId: string,
    command: RecordDecisionOutcomeCommand,
  ): Promise<void> {
    await this.repos.decisionOutcomes.create({
      id: newUuidv7(),
      userId,
      decisionSnapshotId: decisionId,
      evaluatedAt: command.evaluatedAt ?? new Date().toISOString(),
      evaluationWindow: command.evaluationWindow,
      verdict: command.verdict,
      interventionVerdicts: command.interventionVerdicts as any,
      observations: command.observations,
      explanation: command.explanation,
      followUpDiagnosisIds: command.followUpDiagnosisIds ?? [],
      triggersReevaluation: command.triggersReevaluation,
    });
  }

  private mapToDomainSnapshot(record: DecisionSnapshotRecord & {
    interventions?: DecisionInterventionRecord[];
    evidence?: DecisionEvidenceRecord[];
    assumptions?: DecisionAssumptionRecord[];
    outcomes?: DecisionOutcomeRecord[];
  }): DecisionSnapshot {
    return {
      id: record.id,
      userId: record.userId,
      decidedAt: record.decidedAt,
      kind: record.kind as DecisionKind,
      status: record.status as DecisionSnapshotStatus,
      unifiedStateId: record.unifiedStateId,
      diagnosesAddressed: record.diagnosesAddressed,
      interventions: (record.interventions ?? []).map((i: DecisionInterventionRecord) => ({
        interventionId: i.id as InterventionId,
        kind: i.kind,
        parameters: i.parameters as Record<string, number | string | boolean | null>,
        rationale: i.rationale,
        expectedEffect: i.expectedEffect,
        addressesDiagnoses: i.addressesDiagnoses,
        reviewOn: i.reviewOn,
      })),
      assumptions: (record.assumptions ?? []).map((a: DecisionAssumptionRecord) => ({
        code: a.code,
        description: a.description,
        category: a.category as DecisionAssumptionCategory,
        value: a.value,
        sensitive: a.sensitive,
        source: a.source,
      })),
      evidence: (record.evidence ?? []).map((e: DecisionEvidenceRecord) => ({
        id: e.id as DecisionEvidenceId,
        userId: e.decisionSnapshotId,
        kind: "custom" as any,
        code: e.code,
        description: e.title,
        engine: e.sourceEngine as UnifiedStateSourceKind,
        engineConfigVersion: "",
        generatedAt: e.createdAt,
        payload: {
          metric: e.metric,
          window: e.window,
          observed: e.observed,
          observedNumeric: e.observedNumeric,
          expected: e.expected,
          severity: e.severity,
        },
        confidence: e.confidence as ConfidenceLevel,
        provenance: e.provenanceClass as ProvenanceClass,
        sensitive: e.sensitive,
        relatedEntityIds: [],
        basis: e.observed,
        createdAt: e.createdAt,
        updatedAt: e.createdAt,
      })),
      monitoringPlan: [...record.monitoringPlan],
      configVersion: record.configVersion,
      summary: record.summary,
      confidence: record.confidence as ConfidenceLevel,
      supersedesId: record.supersedesId,
      warnings: [...record.warnings],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private mapToDomainOutcome(record: DecisionOutcomeRecord): DecisionOutcomeEvaluationResult {
    const interventionVerdicts = (record.interventionVerdicts as any[]).map((v) => ({
      interventionIndex: v.interventionIndex,
      verdict: v.verdict,
      observations: v.observations,
    }));

    return {
      verdict: record.verdict as DecisionOutcomeVerdict,
      interventionVerdicts,
      observations: record.observations,
      explanation: record.explanation,
      followUpDiagnosisIds: record.followUpDiagnosisIds as any,
      triggersReevaluation: record.triggersReevaluation,
    };
  }

  private parseEvaluationWindow(window: string): number {
    const match = window.match(/(\d+)d/);
    return match ? parseInt(match[1]!, 10) : 14;
  }
}

export function createUnifiedDecisionService(
  repos: Repositories,
  config?: UnifiedDecisionConfiguration,
): UnifiedDecisionService {
  return new UnifiedDecisionService(repos, config);
}