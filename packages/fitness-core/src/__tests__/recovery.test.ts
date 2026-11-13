/**
 * Phase 5 — Recovery Intelligence unit tests.
 *
 * Uses native Node.js test runner (node:test) for compatibility with npm test.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  computeRecoveryState,
  detectRecoveryPlateauSignals,
  DEFAULT_RECOVERY_CONFIGURATION,
} from "../recovery";
import type { SleepObservation, RecoveryIndicator, DailyActivitySummary, TrainingState } from "@fitcoach/domain";
import type { ConfidenceLevel } from "@fitcoach/domain";

const highConfidence: ConfidenceLevel = "measured";

const baseSleep: SleepObservation[] = [
  { id: "s1", userId: "u1", date: "2024-01-15", startedAt: "2024-01-15T22:00:00Z", endedAt: "2024-01-16T06:00:00Z", asleepMinutes: 480, efficiency: 90, source: "wearable", confidence: highConfidence, createdAt: "2024-01-16T00:00:00Z", updatedAt: "2024-01-16T00:00:00Z" },
  { id: "s2", userId: "u1", date: "2024-01-14", startedAt: "2024-01-14T22:30:00Z", endedAt: "2024-01-15T06:30:00Z", asleepMinutes: 420, efficiency: 85, source: "wearable", confidence: highConfidence, createdAt: "2024-01-15T00:00:00Z", updatedAt: "2024-01-15T00:00:00Z" },
  { id: "s3", userId: "u1", date: "2024-01-13", startedAt: "2024-01-13T23:00:00Z", endedAt: "2024-01-14T07:00:00Z", asleepMinutes: 500, efficiency: 92, source: "wearable", confidence: highConfidence, createdAt: "2024-01-14T00:00:00Z", updatedAt: "2024-01-14T00:00:00Z" },
];

const baseIndicators: RecoveryIndicator[] = [
  { id: "i1", userId: "u1", date: "2024-01-15", hrvMs: 55, restingHeartRateBpm: 55, muscleSoreness: 2, fatigue: 3, sleepQuality: 8, readinessSubjective: 8, source: "wearable", confidence: highConfidence, createdAt: "2024-01-15T00:00:00Z", updatedAt: "2024-01-15T00:00:00Z" },
  { id: "i2", userId: "u1", date: "2024-01-14", hrvMs: 58, restingHeartRateBpm: 54, muscleSoreness: 3, fatigue: 2, sleepQuality: 7, readinessSubjective: 7, source: "wearable", confidence: highConfidence, createdAt: "2024-01-14T00:00:00Z", updatedAt: "2024-01-14T00:00:00Z" },
  { id: "i3", userId: "u1", date: "2024-01-13", hrvMs: 52, restingHeartRateBpm: 56, muscleSoreness: 2, fatigue: 3, sleepQuality: 8, readinessSubjective: 8, source: "wearable", confidence: highConfidence, createdAt: "2024-01-13T00:00:00Z", updatedAt: "2024-01-13T00:00:00Z" },
];

const baseActivity: DailyActivitySummary[] = [
  { date: "2024-01-15", steps: 8000, activeMinutes: 45, cardioMinutes: 30, trainingMinutes: 60, estimatedEeKcal: 500, sessions: [] },
  { date: "2024-01-14", steps: 7500, activeMinutes: 40, cardioMinutes: 20, trainingMinutes: 0, estimatedEeKcal: 300, sessions: [] },
  { date: "2024-01-13", steps: 9000, activeMinutes: 60, cardioMinutes: 45, trainingMinutes: 60, estimatedEeKcal: 550, sessions: [] },
];

const baseTrainingState: TrainingState = {
  currentPlanVersionId: "p1",
  currentPlanStatus: "active",
  trainingGoalKind: "general_fitness",
  weeklySessionFrequency: 3,
  sessionFrequencyPerWeek: 3,
  progressionStatus: {},
  plateauSignals: [],
  confidence: 0.8,
};

describe("computeRecoveryState", () => {
  test("returns readiness score 0-100", () => {
    const state = computeRecoveryState(
      {
        sleepObservations: baseSleep,
        recoveryIndicators: baseIndicators,
        dailyActivity: baseActivity,
        trainingState: baseTrainingState,
        asOf: "2024-01-15",
      },
      DEFAULT_RECOVERY_CONFIGURATION,
    );
    assert.ok(state.readinessScore >= 0);
    assert.ok(state.readinessScore <= 100);
  });

  test("returns confidence 0-1", () => {
    const state = computeRecoveryState(
      {
        sleepObservations: baseSleep,
        recoveryIndicators: baseIndicators,
        dailyActivity: baseActivity,
        trainingState: baseTrainingState,
        asOf: "2024-01-15",
      },
      DEFAULT_RECOVERY_CONFIGURATION,
    );
    assert.ok(state.confidence >= 0);
    assert.ok(state.confidence <= 1);
  });

  test("detects severe sleep debt", () => {
    const shortSleep: SleepObservation[] = baseSleep.map((s) => ({ ...s, asleepMinutes: 240 })); // 4h
    const state = computeRecoveryState(
      {
        sleepObservations: shortSleep,
        recoveryIndicators: baseIndicators,
        dailyActivity: baseActivity,
        trainingState: baseTrainingState,
        asOf: "2024-01-15",
      },
      DEFAULT_RECOVERY_CONFIGURATION,
    );
    assert.strictEqual(state.sleepAdequacy, "severe_debt");
    assert.ok(state.limitingFactors.includes("severe_sleep_debt"));
    assert.strictEqual(state.trainingRecommendation, "delay");
  });

  test("detects moderate sleep debt", () => {
    const shortSleep: SleepObservation[] = baseSleep.map((s) => ({ ...s, asleepMinutes: 330 })); // 5.5h
    const state = computeRecoveryState(
      {
        sleepObservations: shortSleep,
        recoveryIndicators: baseIndicators,
        dailyActivity: baseActivity,
        trainingState: baseTrainingState,
        asOf: "2024-01-15",
      },
      DEFAULT_RECOVERY_CONFIGURATION,
    );
    assert.strictEqual(state.sleepAdequacy, "moderate_debt");
    assert.ok(state.limitingFactors.includes("moderate_sleep_debt"));
  });

  test("detects HRV declining trend", () => {
    const decliningHrv: RecoveryIndicator[] = [
      { id: "i1", userId: "u1", date: "2024-01-15", hrvMs: 40, source: "wearable", confidence: highConfidence, createdAt: "2024-01-15T00:00:00Z", updatedAt: "2024-01-15T00:00:00Z" },
      { id: "i2", userId: "u1", date: "2024-01-14", hrvMs: 42, source: "wearable", confidence: highConfidence, createdAt: "2024-01-14T00:00:00Z", updatedAt: "2024-01-14T00:00:00Z" },
      { id: "i3", userId: "u1", date: "2024-01-13", hrvMs: 45, source: "wearable", confidence: highConfidence, createdAt: "2024-01-13T00:00:00Z", updatedAt: "2024-01-13T00:00:00Z" },
      { id: "i4", userId: "u1", date: "2024-01-12", hrvMs: 50, source: "wearable", confidence: highConfidence, createdAt: "2024-01-12T00:00:00Z", updatedAt: "2024-01-12T00:00:00Z" },
      { id: "i5", userId: "u1", date: "2024-01-11", hrvMs: 52, source: "wearable", confidence: highConfidence, createdAt: "2024-01-11T00:00:00Z", updatedAt: "2024-01-11T00:00:00Z" },
      { id: "i6", userId: "u1", date: "2024-01-10", hrvMs: 55, source: "wearable", confidence: highConfidence, createdAt: "2024-01-10T00:00:00Z", updatedAt: "2024-01-10T00:00:00Z" },
      { id: "i7", userId: "u1", date: "2024-01-09", hrvMs: 58, source: "wearable", confidence: highConfidence, createdAt: "2024-01-09T00:00:00Z", updatedAt: "2024-01-09T00:00:00Z" },
      { id: "i8", userId: "u1", date: "2024-01-08", hrvMs: 60, source: "wearable", confidence: highConfidence, createdAt: "2024-01-08T00:00:00Z", updatedAt: "2024-01-08T00:00:00Z" },
      { id: "i9", userId: "u1", date: "2024-01-07", hrvMs: 62, source: "wearable", confidence: highConfidence, createdAt: "2024-01-07T00:00:00Z", updatedAt: "2024-01-07T00:00:00Z" },
      { id: "i10", userId: "u1", date: "2024-01-06", hrvMs: 65, source: "wearable", confidence: highConfidence, createdAt: "2024-01-06T00:00:00Z", updatedAt: "2024-01-06T00:00:00Z" },
    ];
    const state = computeRecoveryState(
      {
        sleepObservations: baseSleep,
        recoveryIndicators: decliningHrv,
        dailyActivity: baseActivity,
        trainingState: baseTrainingState,
        asOf: "2024-01-15",
      },
      DEFAULT_RECOVERY_CONFIGURATION,
    );
    assert.strictEqual(state.hrvTrend, "declining");
    assert.ok(state.limitingFactors.includes("hrv_declining"));
  });

  test("detects high training fatigue from ACWR", () => {
    // High acute load, low chronic load -> high ACWR
    const highAcuteActivity: DailyActivitySummary[] = [
      { date: "2024-01-15", steps: 8000, activeMinutes: 120, cardioMinutes: 60, trainingMinutes: 120, estimatedEeKcal: 1200, sessions: [] },
      { date: "2024-01-14", steps: 8000, activeMinutes: 120, cardioMinutes: 60, trainingMinutes: 120, estimatedEeKcal: 1200, sessions: [] },
      { date: "2024-01-13", steps: 8000, activeMinutes: 120, cardioMinutes: 60, trainingMinutes: 120, estimatedEeKcal: 1200, sessions: [] },
      { date: "2024-01-12", steps: 8000, activeMinutes: 120, cardioMinutes: 60, trainingMinutes: 120, estimatedEeKcal: 1200, sessions: [] },
      { date: "2024-01-11", steps: 8000, activeMinutes: 120, cardioMinutes: 60, trainingMinutes: 120, estimatedEeKcal: 1200, sessions: [] },
      { date: "2024-01-10", steps: 8000, activeMinutes: 120, cardioMinutes: 60, trainingMinutes: 120, estimatedEeKcal: 1200, sessions: [] },
      { date: "2024-01-09", steps: 8000, activeMinutes: 120, cardioMinutes: 60, trainingMinutes: 120, estimatedEeKcal: 1200, sessions: [] },
      // Chronic: low load for 21 days prior
      ...Array.from({ length: 21 }, (_, i) => ({
        date: `2024-01-${String(8 - i).padStart(2, "0")}`,
        steps: 5000,
        activeMinutes: 30,
        cardioMinutes: 15,
        trainingMinutes: 0,
        estimatedEeKcal: 200,
        sessions: [],
      })),
    ];
    const state = computeRecoveryState(
      {
        sleepObservations: baseSleep,
        recoveryIndicators: baseIndicators,
        dailyActivity: highAcuteActivity,
        trainingState: baseTrainingState,
        asOf: "2024-01-15",
      },
      DEFAULT_RECOVERY_CONFIGURATION,
    );
    assert.ok(state.fatigueAccumulation === "high" || state.fatigueAccumulation === "very_high");
    assert.ok(state.limitingFactors.some((f) => f.includes("training_fatigue")));
  });

  test("detects high subjective soreness/fatigue", () => {
    const highSubjective: RecoveryIndicator[] = baseIndicators.map((i) => ({ ...i, muscleSoreness: 8, fatigue: 8 }));
    const state = computeRecoveryState(
      {
        sleepObservations: baseSleep,
        recoveryIndicators: highSubjective,
        dailyActivity: baseActivity,
        trainingState: baseTrainingState,
        asOf: "2024-01-15",
      },
      DEFAULT_RECOVERY_CONFIGURATION,
    );
    assert.ok(state.limitingFactors.includes("high_muscle_soreness"));
    assert.ok(state.limitingFactors.includes("high_fatigue"));
    assert.strictEqual(state.trainingRecommendation, "active_recovery");
  });

  test("detects poor nutrition adherence", () => {
    const state = computeRecoveryState(
      {
        sleepObservations: baseSleep,
        recoveryIndicators: baseIndicators,
        dailyActivity: baseActivity,
        trainingState: baseTrainingState,
        nutritionAdherence: { caloriesPercent: 70, proteinPercent: 60 },
        asOf: "2024-01-15",
      },
      DEFAULT_RECOVERY_CONFIGURATION,
    );
    assert.ok(state.limitingFactors.includes("poor_nutrition_adherence"));
    assert.ok(state.nutritionRecommendations.includes("increase_protein_intake"));
    assert.ok(state.nutritionRecommendations.includes("ensure_adequate_calories"));
  });

  test("generates activity recommendations for delay/reduce", () => {
    const shortSleep: SleepObservation[] = baseSleep.map((s) => ({ ...s, asleepMinutes: 240 }));
    const state = computeRecoveryState(
      {
        sleepObservations: shortSleep,
        recoveryIndicators: baseIndicators,
        dailyActivity: baseActivity,
        trainingState: baseTrainingState,
        asOf: "2024-01-15",
      },
      DEFAULT_RECOVERY_CONFIGURATION,
    );
    assert.ok(state.activityRecommendations.includes("reduce_daily_steps_target_15_to_20_percent"));
    assert.ok(state.activityRecommendations.includes("prioritize_low_intensity_movement"));
  });

  test("includes basis note with component breakdown", () => {
    const state = computeRecoveryState(
      {
        sleepObservations: baseSleep,
        recoveryIndicators: baseIndicators,
        dailyActivity: baseActivity,
        trainingState: baseTrainingState,
        asOf: "2024-01-15",
      },
      DEFAULT_RECOVERY_CONFIGURATION,
    );
    assert.ok(state.basisNote.includes("Sleep:"));
    assert.ok(state.basisNote.includes("HRV:"));
    assert.ok(state.basisNote.includes("Subjective:"));
    assert.ok(state.basisNote.includes("Training load:"));
    assert.ok(state.basisNote.includes("Nutrition:"));
  });
});

describe("detectRecoveryPlateauSignals", () => {
  const baseTrainingState: TrainingState = {
    currentPlanVersionId: "p1",
    currentPlanStatus: "active",
    trainingGoalKind: "general_fitness",
    weeklySessionFrequency: 3,
    sessionFrequencyPerWeek: 3,
    progressionStatus: {},
    plateauSignals: [],
    confidence: 0.8,
  };

  test("emits excessive_volume_signal for high fatigue", () => {
    const recoveryState = {
      readinessScore: 40,
      confidence: 0.8,
      sleepQualityTrend: "stable" as const,
      sleepAdequacy: "adequate" as const,
      hrvTrend: "stable" as const,
      fatigueAccumulation: "high" as const,
      limitingFactors: [],
      trainingRecommendation: "reduce_volume" as const,
      nutritionRecommendations: [],
      activityRecommendations: [],
      basisNote: "",
    };
    const signals = detectRecoveryPlateauSignals(recoveryState, baseTrainingState);
    assert.ok(signals.some((s) => s.kind === "excessive_volume_signal"));
  });

  test("emits adherence_issue for severe sleep debt", () => {
    const recoveryState = {
      readinessScore: 45,
      confidence: 0.8,
      sleepQualityTrend: "declining" as const,
      sleepAdequacy: "severe_debt" as const,
      hrvTrend: "stable" as const,
      fatigueAccumulation: "moderate" as const,
      limitingFactors: ["severe_sleep_debt"],
      trainingRecommendation: "delay" as const,
      nutritionRecommendations: [],
      activityRecommendations: [],
      basisNote: "",
    };
    const signals = detectRecoveryPlateauSignals(recoveryState, baseTrainingState);
    assert.ok(signals.some((s) => s.kind === "adherence_issue"));
  });

  test("emits declining_performance for declining HRV + low readiness", () => {
    const recoveryState = {
      readinessScore: 40,
      confidence: 0.8,
      sleepQualityTrend: "stable" as const,
      sleepAdequacy: "adequate" as const,
      hrvTrend: "declining" as const,
      fatigueAccumulation: "moderate" as const,
      limitingFactors: [],
      trainingRecommendation: "reduce_volume" as const,
      nutritionRecommendations: [],
      activityRecommendations: [],
      basisNote: "",
    };
    const signals = detectRecoveryPlateauSignals(recoveryState, baseTrainingState);
    assert.ok(signals.some((s) => s.kind === "declining_performance"));
  });

  test("returns empty array for good recovery", () => {
    const recoveryState = {
      readinessScore: 85,
      confidence: 0.9,
      sleepQualityTrend: "improving" as const,
      sleepAdequacy: "adequate" as const,
      hrvTrend: "improving" as const,
      fatigueAccumulation: "low" as const,
      limitingFactors: [],
      trainingRecommendation: "maintain" as const,
      nutritionRecommendations: [],
      activityRecommendations: [],
      basisNote: "",
    };
    const signals = detectRecoveryPlateauSignals(recoveryState, baseTrainingState);
    assert.strictEqual(signals.length, 0);
  });
});