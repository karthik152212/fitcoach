/**
 * Phase 5 — Activity Intelligence unit tests.
 *
 * Uses native Node.js test runner (node:test) for compatibility with npm test.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  aggregateDailyActivity,
  deriveActivityTargets,
  computeActivityContext,
  DEFAULT_ACTIVITY_TARGET_CONFIGURATION,
} from "../activity";
import type { ActivityRecord, DailyActivitySummary } from "@fitcoach/domain";

const sampleRecords: ActivityRecord[] = [
  { id: "1", userId: "u1", date: "2024-01-15", kind: "steps", steps: 8000, createdAt: "2024-01-15T00:00:00Z", updatedAt: "2024-01-15T00:00:00Z" },
  {
    id: "2",
    userId: "u1",
    date: "2024-01-15",
    kind: "walk",
    durationMinutes: 30,
    effort: "moderate",
    estimatedCaloriesBurned: 150,
    createdAt: "2024-01-15T00:00:00Z",
    updatedAt: "2024-01-15T00:00:00Z",
  },
  { id: "3", userId: "u1", date: "2024-01-14", kind: "steps", steps: 6500, createdAt: "2024-01-14T00:00:00Z", updatedAt: "2024-01-14T00:00:00Z" },
  {
    id: "4",
    userId: "u1",
    date: "2024-01-14",
    kind: "run",
    durationMinutes: 20,
    effort: "high",
    estimatedCaloriesBurned: 250,
    createdAt: "2024-01-14T00:00:00Z",
    updatedAt: "2024-01-14T00:00:00Z",
  },
];

describe("aggregateDailyActivity", () => {
  test("groups records by date and sums steps", () => {
    const summaries = aggregateDailyActivity(sampleRecords, {});
    assert.strictEqual(summaries.length, 2);
    const day15 = summaries.find((s) => s.date === "2024-01-15")!;
    const day14 = summaries.find((s) => s.date === "2024-01-14")!;
    assert.strictEqual(day15.steps, 8000);
    assert.strictEqual(day14.steps, 6500);
  });

  test("sums cardio minutes from cardio modalities", () => {
    const summaries = aggregateDailyActivity(sampleRecords, {});
    const day15 = summaries.find((s) => s.date === "2024-01-15")!;
    const day14 = summaries.find((s) => s.date === "2024-01-14")!;
    assert.strictEqual(day15.cardioMinutes, 30); // walk
    assert.strictEqual(day14.cardioMinutes, 20); // run
  });

  test("adds training minutes from trainingMinutesByDate", () => {
    const summaries = aggregateDailyActivity(sampleRecords, { "2024-01-15": 60 });
    const day15 = summaries.find((s) => s.date === "2024-01-15")!;
    assert.strictEqual(day15.trainingMinutes, 60);
    assert.strictEqual(day15.activeMinutes, 30 + 60); // cardio + training
  });

  test("sorts by date descending", () => {
    const summaries = aggregateDailyActivity(sampleRecords, {});
    assert.strictEqual(summaries.length, 2);
    assert.strictEqual(summaries[0]!.date, "2024-01-15");
    assert.strictEqual(summaries[1]!.date, "2024-01-14");
  });

  test("includes session records in output", () => {
    const summaries = aggregateDailyActivity(sampleRecords, {});
    const day15 = summaries.find((s) => s.date === "2024-01-15")!;
    assert.strictEqual(day15.sessions.length, 1);
    assert.strictEqual(day15.sessions[0]!.kind, "walk");
  });
});

describe("deriveActivityTargets", () => {
  test("computes baseline steps from config", () => {
    const targets = deriveActivityTargets(
      {
        goalKind: "general_fitness",
        averageStepsLast14Days: 10000, // close to target to avoid progressive cap
        weeklyCardioMinutes: 0,
        trainingDaysPerWeek: 3,
      },
      DEFAULT_ACTIVITY_TARGET_CONFIGURATION,
    );
    // baseline 6000 + 1500*3 = 10500 * 1.1 = 11550
    assert.strictEqual(targets.dailyStepsTarget, 11550);
  });

  test("applies goal multipliers", () => {
    const bodybuilding = deriveActivityTargets(
      {
        goalKind: "bodybuilding",
        averageStepsLast14Days: 10000,
        weeklyCardioMinutes: 0,
        trainingDaysPerWeek: 3,
      },
      DEFAULT_ACTIVITY_TARGET_CONFIGURATION,
    );
    const leanRecomp = deriveActivityTargets(
      {
        goalKind: "lean_recomposition",
        averageStepsLast14Days: 10000,
        weeklyCardioMinutes: 0,
        trainingDaysPerWeek: 3,
      },
      DEFAULT_ACTIVITY_TARGET_CONFIGURATION,
    );
    assert.ok(bodybuilding.dailyStepsTarget < leanRecomp.dailyStepsTarget);
  });

  test("caps step increase at 2000/day", () => {
    const targets = deriveActivityTargets(
      {
        goalKind: "general_fitness",
        averageStepsLast14Days: 3000,
        weeklyCardioMinutes: 0,
        trainingDaysPerWeek: 5,
      },
      DEFAULT_ACTIVITY_TARGET_CONFIGURATION,
    );
    // baseline 6000 + 1500*5 = 13500 * 1.1 = 14850
    // gap = 14850 - 3000 = 11850 > 2000, so capped at 3000 + 2000 = 5000
    assert.strictEqual(targets.dailyStepsTarget, 5000);
    assert.ok(targets.basisNote.includes("Capped: gap"));
  });

  test("maintains slightly above current when already exceeding", () => {
    const targets = deriveActivityTargets(
      {
        goalKind: "general_fitness",
        averageStepsLast14Days: 15000,
        weeklyCardioMinutes: 0,
        trainingDaysPerWeek: 3,
      },
      DEFAULT_ACTIVITY_TARGET_CONFIGURATION,
    );
    // target would be ~11550, but current is 15000, so maintain at 15000 + 500 = 15500 (capped at max 15000)
    assert.strictEqual(targets.dailyStepsTarget, 15000); // maxDailySteps ceiling
    assert.ok(targets.basisNote.includes("Maintenance: already exceeding"));
  });

  test("applies recovery reduction for high fatigue", () => {
    const normal = deriveActivityTargets(
      {
        goalKind: "general_fitness",
        averageStepsLast14Days: 5000,
        weeklyCardioMinutes: 0,
        trainingDaysPerWeek: 3,
      },
      DEFAULT_ACTIVITY_TARGET_CONFIGURATION,
    );
    const highFatigue = deriveActivityTargets(
      {
        goalKind: "general_fitness",
        averageStepsLast14Days: 5000,
        weeklyCardioMinutes: 0,
        trainingDaysPerWeek: 3,
        recoveryState: { fatigueAccumulation: "high", sleepAdequacy: "adequate" },
      },
      DEFAULT_ACTIVITY_TARGET_CONFIGURATION,
    );
    assert.ok(highFatigue.dailyStepsTarget < normal.dailyStepsTarget);
    assert.ok(highFatigue.basisNote.includes("Recovery: fatigue high"));
  });

  test("applies severe sleep debt reduction", () => {
    const normal = deriveActivityTargets(
      {
        goalKind: "general_fitness",
        averageStepsLast14Days: 5000,
        weeklyCardioMinutes: 0,
        trainingDaysPerWeek: 3,
      },
      DEFAULT_ACTIVITY_TARGET_CONFIGURATION,
    );
    const severeDebt = deriveActivityTargets(
      {
        goalKind: "general_fitness",
        averageStepsLast14Days: 5000,
        weeklyCardioMinutes: 0,
        trainingDaysPerWeek: 3,
        recoveryState: { fatigueAccumulation: "moderate", sleepAdequacy: "severe_debt" },
      },
      DEFAULT_ACTIVITY_TARGET_CONFIGURATION,
    );
    assert.ok(severeDebt.dailyStepsTarget < normal.dailyStepsTarget);
  });

  test("computes weekly cardio target", () => {
    const targets = deriveActivityTargets(
      {
        goalKind: "athletic_performance",
        averageStepsLast14Days: 5000,
        weeklyCardioMinutes: 60,
        trainingDaysPerWeek: 4,
      },
      DEFAULT_ACTIVITY_TARGET_CONFIGURATION,
    );
    // baseline 75 + 20*4 = 155 * 1.5 = 232.5 -> 233
    assert.strictEqual(targets.weeklyCardioMinTarget, 233);
  });

  test("computes weekly active minutes target", () => {
    const targets = deriveActivityTargets(
      {
        goalKind: "general_fitness",
        averageStepsLast14Days: 5000,
        weeklyCardioMinutes: 60,
        trainingDaysPerWeek: 3,
        trainingState: { weeklySessionFrequency: 3 },
      },
      DEFAULT_ACTIVITY_TARGET_CONFIGURATION,
    );
    // cardio target + training minutes (3 * 45 = 135)
    assert.ok(targets.weeklyActiveMinTarget > 0);
  });

  test("respects min/max daily steps bounds", () => {
    const minTarget = deriveActivityTargets(
      {
        goalKind: "max_strength",
        averageStepsLast14Days: 1000,
        weeklyCardioMinutes: 0,
        trainingDaysPerWeek: 1,
      },
      DEFAULT_ACTIVITY_TARGET_CONFIGURATION,
    );
    assert.ok(minTarget.dailyStepsTarget >= DEFAULT_ACTIVITY_TARGET_CONFIGURATION.minDailySteps);

    const maxTarget = deriveActivityTargets(
      {
        goalKind: "lean_recomposition",
        averageStepsLast14Days: 20000,
        weeklyCardioMinutes: 500,
        trainingDaysPerWeek: 7,
      },
      DEFAULT_ACTIVITY_TARGET_CONFIGURATION,
    );
    assert.ok(maxTarget.dailyStepsTarget <= DEFAULT_ACTIVITY_TARGET_CONFIGURATION.maxDailySteps);
  });
});

describe("computeActivityContext", () => {
  const sampleSummaries: DailyActivitySummary[] = [
    { date: "2024-01-15", steps: 8000, activeMinutes: 45, cardioMinutes: 30, trainingMinutes: 0, estimatedEeKcal: 300, sessions: [] },
    { date: "2024-01-14", steps: 7500, activeMinutes: 40, cardioMinutes: 20, trainingMinutes: 0, estimatedEeKcal: 280, sessions: [] },
    { date: "2024-01-13", steps: 9000, activeMinutes: 60, cardioMinutes: 45, trainingMinutes: 0, estimatedEeKcal: 400, sessions: [] },
    { date: "2024-01-12", steps: 6000, activeMinutes: 30, cardioMinutes: 15, trainingMinutes: 0, estimatedEeKcal: 250, sessions: [] },
  ];

  test("computes average steps over window", () => {
    const ctx = computeActivityContext(sampleSummaries, 4);
    assert.strictEqual(ctx.averageSteps, Math.round((8000 + 7500 + 9000 + 6000) / 4)); // 7625
  });

  test("computes weekly cardio minutes", () => {
    const ctx = computeActivityContext(sampleSummaries, 4);
    const avgDailyCardio = (30 + 20 + 45 + 15) / 4;
    assert.strictEqual(ctx.weeklyCardioMinutes, Math.round(avgDailyCardio * 7));
  });

  test("computes average active minutes", () => {
    const ctx = computeActivityContext(sampleSummaries, 4);
    assert.strictEqual(ctx.averageActiveMinutes, Math.round((45 + 40 + 60 + 30) / 4));
  });

  test("returns zeros for empty input", () => {
    const ctx = computeActivityContext([], 14);
    assert.strictEqual(ctx.averageSteps, 0);
    assert.strictEqual(ctx.weeklyCardioMinutes, 0);
    assert.strictEqual(ctx.averageActiveMinutes, 0);
  });
});