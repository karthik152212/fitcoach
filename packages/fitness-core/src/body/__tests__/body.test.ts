/**
 * Body domain unit tests.
 *
 * Uses native Node.js test runner (node:test) for compatibility with npm test.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  detectTrend,
  type TrendPoint,
} from "../../trendDetection";
import {
  analyzeBodyMeasurements,
} from "../measurements";
import {
  type PhysiqueGoalInput,
  createPhysiqueGoal,
  updatePhysiqueGoal,
  defaultPhysiqueGoalForTrainingGoal,
  assessGoalRelativeProgress,
} from "../physiqueGoals";
import {
  assessMuscleDevelopment,
  type MuscleDevelopmentInput,
  getMuscleDevelopmentGaps,
  getMuscleDevelopmentHighlights,
} from "../muscleDevelopment";
import {
  buildBodyAssessment,
  assessDisproportionateDevelopment,
  type DisproportionateAssessmentInput,
} from "../assessment";
import {
  generateBodyRecommendations,
} from "../recommendations";
import {
  getBodyContextForNutrition,
  adjustNutritionTargetsFromBodyContext,
  getBodyContextForTraining,
  getTrainingAdjustmentsFromBodyContext,
  getBodyContextForRecovery,
  getBodyContextForAdaptation,
  generateIntegrationContexts,
  buildBodyContextForIntegration,
} from "../integration";
import type { BodyAssessment, BodyCompositionEstimate } from "../types";
import type { BodyMeasurement, RecoveryState, NutritionTargets } from "@fitcoach/domain";

// -----------------------------------------------------------------------------
// Test fixtures
// -----------------------------------------------------------------------------

const createMeasurement = (
  daysAgo: number,
  bodyWeightKg?: number,
  circumferencesCm?: Record<string, number>
): BodyMeasurement => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const recordedAt = date.toISOString();
  return {
    id: `meas-${daysAgo}`,
    userId: "user-1",
    recordedAt: recordedAt as any,
    bodyWeightKg,
    circumferencesCm,
    createdAt: recordedAt as any,
    updatedAt: recordedAt as any,
  };
};

const createTrendPoint = (date: string, value: number): TrendPoint => ({
  date: date as any,
  value,
});

const sampleMeasurements: readonly BodyMeasurement[] = [
  createMeasurement(56, 80.0, { waist: 85, neck: 38, chest: 100, left_upper_arm: 33, right_upper_arm: 33, hips: 95, left_thigh: 58, right_thigh: 58 }),
  createMeasurement(49, 81.0, { waist: 84.8, neck: 38, chest: 101, left_upper_arm: 33.5, right_upper_arm: 33.3, hips: 95, left_thigh: 58.5, right_thigh: 58.3 }),
  createMeasurement(42, 82.0, { waist: 84.5, neck: 38, chest: 102, left_upper_arm: 34, right_upper_arm: 33.6, hips: 95, left_thigh: 59, right_thigh: 58.6 }),
  createMeasurement(35, 83.0, { waist: 84.3, neck: 38, chest: 103, left_upper_arm: 34.5, right_upper_arm: 33.9, hips: 95, left_thigh: 59.5, right_thigh: 58.9 }),
  createMeasurement(28, 84.0, { waist: 84.0, neck: 38, chest: 104, left_upper_arm: 35, right_upper_arm: 34.2, hips: 95, left_thigh: 60, right_thigh: 59.2 }),
  createMeasurement(21, 85.0, { waist: 83.8, neck: 38, chest: 105, left_upper_arm: 35.5, right_upper_arm: 34.5, hips: 95, left_thigh: 60.5, right_thigh: 59.5 }),
  createMeasurement(14, 86.0, { waist: 83.5, neck: 38, chest: 106, left_upper_arm: 36, right_upper_arm: 34.8, hips: 95, left_thigh: 61, right_thigh: 59.8 }),
  createMeasurement(7, 87.0, { waist: 83.3, neck: 38, chest: 107, left_upper_arm: 36.5, right_upper_arm: 35.1, hips: 95, left_thigh: 61.5, right_thigh: 60.1 }),
  createMeasurement(0, 88.0, { waist: 83.0, neck: 38, chest: 108, left_upper_arm: 37, right_upper_arm: 35.4, hips: 95, left_thigh: 62, right_thigh: 60.4 }),
];

const sampleProfile = { heightCm: 180, sex: "male" as const };

// -----------------------------------------------------------------------------
// Trend Detection Tests
// -----------------------------------------------------------------------------

describe("detectTrend - deterministic least-squares regression", () => {
  test("returns insufficient_data for fewer than 3 points", () => {
    const result = detectTrend([createTrendPoint("2024-01-01", 80), createTrendPoint("2024-01-08", 81)]);
    assert.strictEqual(result.direction, "insufficient_data");
    assert.strictEqual(result.slopePerDay, null);
    assert.strictEqual(result.confidence, null);
  });

  test("detects increasing trend with clear slope", () => {
    const points = [
      createTrendPoint("2024-01-01", 80),
      createTrendPoint("2024-01-08", 81),
      createTrendPoint("2024-01-15", 82),
      createTrendPoint("2024-01-22", 83),
      createTrendPoint("2024-01-29", 84),
    ];
    const result = detectTrend(points);
    assert.strictEqual(result.direction, "increasing");
    assert.ok((result.slopePerDay ?? 0) > 0);
    assert.ok((result.confidence ?? 0) > 0.5);
  });

  test("detects decreasing trend with clear slope", () => {
    const points = [
      createTrendPoint("2024-01-01", 84),
      createTrendPoint("2024-01-08", 83),
      createTrendPoint("2024-01-15", 82),
      createTrendPoint("2024-01-22", 81),
      createTrendPoint("2024-01-29", 80),
    ];
    const result = detectTrend(points);
    assert.strictEqual(result.direction, "decreasing");
    assert.ok((result.slopePerDay ?? 0) < 0);
    assert.ok((result.confidence ?? 0) > 0.5);
  });

  test("detects stable trend when slope is within threshold", () => {
    const points = [
      createTrendPoint("2024-01-01", 80),
      createTrendPoint("2024-01-08", 80.05),
      createTrendPoint("2024-01-15", 80.02),
      createTrendPoint("2024-01-22", 80.03),
      createTrendPoint("2024-01-29", 80.01),
    ];
    const result = detectTrend(points, { stabilityThresholdPerDay: 0.01 });
    assert.strictEqual(result.direction, "stable");
    assert.ok(Math.abs(result.slopePerDay ?? 0) < 0.05);
  });

  test("orders points by date regardless of input order", () => {
    const points = [
      createTrendPoint("2024-01-15", 82),
      createTrendPoint("2024-01-01", 80),
      createTrendPoint("2024-01-22", 83),
      createTrendPoint("2024-01-08", 81),
      createTrendPoint("2024-01-29", 84),
    ];
    const result = detectTrend(points);
    assert.strictEqual(result.direction, "increasing");
    assert.strictEqual(result.pointsUsed, 5);
  });

  test("noise inside stability threshold reads as stable", () => {
    const points = [
      createTrendPoint("2024-01-01", 80),
      createTrendPoint("2024-01-08", 80.1),
      createTrendPoint("2024-01-15", 79.9),
      createTrendPoint("2024-01-22", 80.05),
      createTrendPoint("2024-01-29", 80),
    ];
    const result = detectTrend(points, { stabilityThresholdPerDay: 0.01 });
    assert.strictEqual(result.direction, "stable");
  });
});

// -----------------------------------------------------------------------------
// Body Measurements Analysis Tests
// -----------------------------------------------------------------------------

describe("analyzeBodyMeasurements - full measurement analysis", () => {
  test("computes weight trend with slope and confidence", () => {
    const result = analyzeBodyMeasurements(sampleMeasurements, sampleProfile.heightCm, sampleProfile.sex);
    assert.strictEqual(result.weightTrend.direction, "increasing");
    assert.ok(result.weightTrend.slopeKgPerWeek !== null && result.weightTrend.slopeKgPerWeek > 0);
    assert.ok(result.weightTrend.confidence !== null && result.weightTrend.confidence > 0);
    assert.ok(result.weightTrend.pointsUsed >= 3);
  });

  test("computes circumference trends for all tracked sites", () => {
    const result = analyzeBodyMeasurements(sampleMeasurements, sampleProfile.heightCm, sampleProfile.sex);
    assert.ok(result.circumferenceTrends.length > 0);
    for (const trend of result.circumferenceTrends) {
      assert.ok(["increasing", "decreasing", "stable", "insufficient_data"].includes(trend.direction));
      assert.ok(typeof trend.slopeCmPerWeek === "number" || trend.slopeCmPerWeek === null);
      if (trend.direction === "insufficient_data") {
        assert.strictEqual(trend.confidence, null);
      } else {
        assert.ok(typeof trend.confidence === "number");
        assert.ok(trend.confidence >= 0);
        assert.ok(trend.confidence <= 1);
      }
    }
  });

  test("estimates body composition using multi_site method for male", () => {
    const result = analyzeBodyMeasurements(sampleMeasurements, 180, "male");
    assert.ok(result.composition);
    assert.ok(["multi_site", "weight_waist_neck", "weight_waist_hip", "weight_only"].includes(result.composition?.method ?? ""));
    assert.ok((result.composition?.bodyFatPercent ?? 0) > 0);
    assert.ok((result.composition?.bodyFatPercent ?? 0) < 50);
    assert.ok((result.composition?.confidence ?? 0) > 0);
    assert.ok((result.composition?.confidence ?? 0) <= 1);
  });

  test("estimates body composition for female", () => {
    const femaleMeasurements = sampleMeasurements.map(m => ({
      ...m,
      circumferencesCm: { ...m.circumferencesCm, hips: 95 }
    }));
    const result = analyzeBodyMeasurements(femaleMeasurements, 165, "female");
    assert.ok(result.composition);
    assert.ok(["multi_site", "weight_waist_neck", "weight_waist_hip", "weight_only"].includes(result.composition?.method ?? ""));
    assert.ok((result.composition?.bodyFatPercent ?? 0) > 0);
  });

  test("computes measurement completeness with data quality score", () => {
    const result = analyzeBodyMeasurements(sampleMeasurements, sampleProfile.heightCm, sampleProfile.sex);
    assert.ok(result.completeness);
    assert.ok(result.completeness.weightReadings > 0);
    assert.ok(result.completeness.circumferenceSites.length > 0);
    assert.ok(result.completeness.circumferenceReadings > 0);
    assert.ok(result.completeness.dataQualityScore >= 0);
    assert.ok(result.completeness.dataQualityScore <= 1);
    assert.ok(typeof result.completeness.canEstimateComposition === "boolean");
  });

  test("returns insufficient_data for weight trend with too few points", () => {
    const fewMeasurements = sampleMeasurements.slice(0, 2);
    const result = analyzeBodyMeasurements(fewMeasurements, sampleProfile.heightCm, sampleProfile.sex);
    assert.strictEqual(result.weightTrend.direction, "insufficient_data");
    assert.strictEqual(result.weightTrend.slopeKgPerWeek, null);
  });

  test("handles missing circumference data gracefully", () => {
    const noCircumferences = sampleMeasurements.map(m => ({ ...m, circumferencesCm: {} }));
    const result = analyzeBodyMeasurements(noCircumferences, sampleProfile.heightCm, sampleProfile.sex);
    assert.ok(result.circumferenceTrends.length > 0);
    for (const trend of result.circumferenceTrends) {
      assert.strictEqual(trend.direction, "insufficient_data");
      assert.strictEqual(trend.slopeCmPerWeek, null);
    }
    assert.strictEqual(result.completeness.circumferenceSites.length, 0);
  });
});

// -----------------------------------------------------------------------------
// Physique Goals Tests
// -----------------------------------------------------------------------------

describe("Physique Goals - creation, priority validation, progress assessment", () => {
  const validInput: PhysiqueGoalInput = {
    userId: "user-1",
    direction: "gain",
    priorities: ["chest_development", "shoulder_width", "arm_size"],
    targetTimeframeWeeks: 24,
  };

  test("creates a valid physique goal with all fields", () => {
    const goal = createPhysiqueGoal(validInput);
    assert.ok(goal.id);
    assert.strictEqual(goal.userId, "user-1");
    assert.strictEqual(goal.direction, "gain");
    assert.deepEqual(goal.priorities, ["chest_development", "shoulder_width", "arm_size"]);
    assert.strictEqual(goal.targetTimeframeWeeks, 24);
    assert.ok(goal.createdAt);
    assert.ok(goal.updatedAt);
  });

  test("creates goal with minimal required fields", () => {
    const minimalInput: PhysiqueGoalInput = {
      userId: "user-1",
      direction: "recomp",
      priorities: ["chest_development"],
    };
    const goal = createPhysiqueGoal(minimalInput);
    assert.strictEqual(goal.direction, "recomp");
    assert.deepEqual(goal.priorities, ["chest_development"]);
    assert.strictEqual(goal.targetTimeframeWeeks, undefined);
  });

  test("updates goal and updates timestamp", () => {
    const goal = createPhysiqueGoal(validInput);
    const originalUpdatedAt = goal.updatedAt;

    const updated = updatePhysiqueGoal(goal, { targetTimeframeWeeks: 12, priorities: ["chest_development", "back_width"] });
    assert.strictEqual(updated.targetTimeframeWeeks, 12);
    assert.deepEqual(updated.priorities, ["chest_development", "back_width"]);
    assert.notStrictEqual(updated.updatedAt, originalUpdatedAt);
    assert.strictEqual(updated.id, goal.id);
    assert.strictEqual(updated.createdAt, goal.createdAt);
  });

  test("does not update timestamp when no changes", () => {
    const goal = createPhysiqueGoal(validInput);
    const originalUpdatedAt = goal.updatedAt;
    const updated = updatePhysiqueGoal(goal, {});
    assert.strictEqual(updated.updatedAt, originalUpdatedAt);
  });

  test("creates default physique goal from training goal kind", () => {
    const gainGoal = defaultPhysiqueGoalForTrainingGoal("user-1", "build_muscle");
    assert.strictEqual(gainGoal.direction, "gain");
    assert.ok(gainGoal.priorities.length > 0);

    const loseGoal = defaultPhysiqueGoalForTrainingGoal("user-1", "lose_fat");
    assert.strictEqual(loseGoal.direction, "lose");
    assert.ok(loseGoal.priorities.length > 0);

    const recomGoal = defaultPhysiqueGoalForTrainingGoal("user-1", "recomposition");
    assert.strictEqual(recomGoal.direction, "recomp");
  });

  test("assesses goal-relative progress correctly", () => {
    // For weight-only tests, use a goal with overall_mass priority
    const massGoal = createPhysiqueGoal({ userId: "user-1", direction: "gain", priorities: ["overall_mass"] });

    // Weight increasing for gain goal -> on_track
    assert.strictEqual(assessGoalRelativeProgress(massGoal, "increasing", 0.2, [], undefined), "on_track");

    // Weight decreasing for gain goal -> needs_attention
    assert.strictEqual(assessGoalRelativeProgress(massGoal, "decreasing", -0.2, [], undefined), "needs_attention");

    // Weight stable for recomp with overall_mass -> on_track (maintain)
    const recompMassGoal = createPhysiqueGoal({ userId: "user-1", direction: "recomp", priorities: ["overall_mass"] });
    assert.strictEqual(assessGoalRelativeProgress(recompMassGoal, "stable", 0, [], undefined), "on_track");

    // Insufficient data -> insufficient_data
    const goal = createPhysiqueGoal(validInput);
    assert.strictEqual(assessGoalRelativeProgress(goal, "insufficient_data", null, [], undefined), "insufficient_data");
  });
});

// -----------------------------------------------------------------------------
// Muscle Development Assessment Tests
// -----------------------------------------------------------------------------

describe("Muscle Development Assessment - exposure, measurement, recovery, volume logic", () => {
  const baseInput: MuscleDevelopmentInput = {
    coverageReport: {
      perMuscle: [
        { muscleId: "chest", primaryWeeklySets: 20, secondaryWeeklySets: 20 },
        { muscleId: "side_delts", primaryWeeklySets: 6, secondaryWeeklySets: 2 },
        { muscleId: "biceps", primaryWeeklySets: 8, secondaryWeeklySets: 2 },
        { muscleId: "triceps", primaryWeeklySets: 10, secondaryWeeklySets: 3 },
        { muscleId: "quadriceps", primaryWeeklySets: 14, secondaryWeeklySets: 4 },
      ],
      musclesWithoutDirectWork: ["rear_delts", "forearms"],
    },
    volumeReport: {
      byMuscle: [
        { muscleId: "chest", muscleSlug: "chest", directEffectiveSets: 30, indirectEffectiveSets: 0, supportingEffectiveSets: 0, stabilizingEffectiveSets: 0, emphasisEffectiveSets: 0, totalEffectiveSets: 30, contributingExercises: ["bench_press"] },
        { muscleId: "side_delts", muscleSlug: "side_delts", directEffectiveSets: 6, indirectEffectiveSets: 0, supportingEffectiveSets: 0, stabilizingEffectiveSets: 0, emphasisEffectiveSets: 0, totalEffectiveSets: 6, contributingExercises: ["lateral_raise"] },
        { muscleId: "biceps", muscleSlug: "biceps", directEffectiveSets: 8, indirectEffectiveSets: 0, supportingEffectiveSets: 0, stabilizingEffectiveSets: 0, emphasisEffectiveSets: 0, totalEffectiveSets: 8, contributingExercises: ["curl"] },
        { muscleId: "triceps", muscleSlug: "triceps", directEffectiveSets: 10, indirectEffectiveSets: 0, supportingEffectiveSets: 0, stabilizingEffectiveSets: 0, emphasisEffectiveSets: 0, totalEffectiveSets: 10, contributingExercises: ["pushdown"] },
        { muscleId: "quadriceps", muscleSlug: "quadriceps", directEffectiveSets: 14, indirectEffectiveSets: 0, supportingEffectiveSets: 0, stabilizingEffectiveSets: 0, emphasisEffectiveSets: 0, totalEffectiveSets: 14, contributingExercises: ["squat"] },
      ],
      totalPlannedSets: 68,
      totalEffectiveSets: 68,
      underTargetMuscles: ["side_delts"],
      potentiallyExcessiveMuscles: [],
      redundantExposure: [],
    },
    circumferenceTrends: [
      { site: "chest", direction: "increasing" as const, slopeCmPerWeek: 0.15, confidence: 0.8 },
      { site: "left_upper_arm", direction: "increasing" as const, slopeCmPerWeek: 0.1, confidence: 0.7 },
      { site: "right_upper_arm", direction: "stable" as const, slopeCmPerWeek: 0.02, confidence: 0.6 },
      { site: "waist", direction: "stable" as const, slopeCmPerWeek: -0.01, confidence: 0.8 },
    ],
    recoveryState: {
      readinessScore: 75,
      confidence: 0.8,
      sleepQualityTrend: "stable",
      sleepAdequacy: "adequate",
      hrvTrend: "stable",
      fatigueAccumulation: "low",
      limitingFactors: [],
      trainingRecommendation: "maintain",
      nutritionRecommendations: [],
      activityRecommendations: [],
      basisNote: "test",
    } as RecoveryState,
    physiqueGoalPriorities: ["chest_development", "shoulder_width", "arm_size"],
    experience: "intermediate",
    goalProfile: "gain",
  };

  test("assesses all muscles with exposure score", () => {
    const result = assessMuscleDevelopment(baseInput);
    assert.ok(result.length > 0);
    for (const dev of result) {
      assert.ok(dev.muscle);
      assert.ok(dev.trainingExposureScore >= 0);
      assert.ok(dev.trainingExposureScore <= 100);
      assert.ok(dev.confidence >= 0);
      assert.ok(dev.confidence <= 1);
      assert.ok(Array.isArray(dev.evidence));
    }
  });

  test("assigns developmentStatus based on evidence", () => {
    const result = assessMuscleDevelopment(baseInput);
    for (const dev of result) {
      assert.ok(["progressing", "maintaining", "regressing", "insufficient_data"].includes(dev.developmentStatus));
    }
  });

  test("assigns volumeAppropriateness from volume report", () => {
    const result = assessMuscleDevelopment(baseInput);
    const sideDelts = result.find(d => d.muscle === "side_delts");
    assert.strictEqual(sideDelts?.volumeAppropriateness, "insufficient");

    const chest = result.find(d => d.muscle === "chest");
    assert.strictEqual(chest?.volumeAppropriateness, "appropriate");
  });

  test("assigns recoveryContext from recovery state", () => {
    const result = assessMuscleDevelopment(baseInput);
    for (const dev of result) {
      assert.ok(["supportive", "neutral", "limiting"].includes(dev.recoveryContext));
    }
  });

  test("identifies gaps for priority muscles that are lagging", () => {
    const result = assessMuscleDevelopment(baseInput);
    const gaps = getMuscleDevelopmentGaps(result, baseInput.physiqueGoalPriorities ?? []);
    assert.ok(gaps.includes("side_delts")); // below target volume
  });

  test("identifies highlights for muscles progressing well", () => {
    const result = assessMuscleDevelopment(baseInput);
    const highlights = getMuscleDevelopmentHighlights(result);
    assert.ok(highlights.length > 0);
    // Chest should be highlighted - good exposure, increasing measurement, appropriate volume
    assert.ok(highlights.includes("chest"));
  });

  test("handles insufficient data gracefully", () => {
    const minimalInput: MuscleDevelopmentInput = {
      ...baseInput,
      coverageReport: { perMuscle: [], musclesWithoutDirectWork: [] },
      volumeReport: { byMuscle: [], totalPlannedSets: 0, totalEffectiveSets: 0, underTargetMuscles: [], potentiallyExcessiveMuscles: [], redundantExposure: [] },
      circumferenceTrends: [],
      recoveryState: undefined,
      physiqueGoalPriorities: [],
      experience: "novice",
      goalProfile: "recomp",
    };
    const result = assessMuscleDevelopment(minimalInput);
    assert.strictEqual(result.length, 0);
    assert.deepEqual(getMuscleDevelopmentGaps(result, []), []);
    assert.deepEqual(getMuscleDevelopmentHighlights(result), []);
  });
});

// -----------------------------------------------------------------------------
// Disproportionate Development Assessment Tests
// -----------------------------------------------------------------------------

describe("Disproportionate Development Assessment - all 5 rule types", () => {
  const createBaseInput = (overrides: Partial<DisproportionateAssessmentInput> = {}): DisproportionateAssessmentInput => ({
    asOf: "2024-03-01" as any,
    weightTrend: { direction: "increasing", slopeKgPerWeek: 0.2, confidence: 0.8, pointsUsed: 10, warnings: [], currentWeightKg: 82, averageWeight7dKg: 81.5, averageWeight14dKg: 81 },
    circumferenceTrends: [
      { site: "chest", direction: "increasing", slopeCmPerWeek: 0.15, confidence: 0.8, pointsUsed: 16, warnings: [], latestCm: 104 },
      { site: "waist", direction: "stable", slopeCmPerWeek: 0.01, confidence: 0.7, pointsUsed: 16, warnings: [], latestCm: 83 },
      { site: "left_upper_arm", direction: "increasing", slopeCmPerWeek: 0.12, confidence: 0.75, pointsUsed: 16, warnings: [], latestCm: 38 },
      { site: "right_upper_arm", direction: "stable", slopeCmPerWeek: 0.02, confidence: 0.6, pointsUsed: 16, warnings: [], latestCm: 34 },
    ],
    composition: { bodyFatPercent: 18, uncertaintyPct: 2.5, method: "multi_site", confidence: 0.75, asOf: "2024-03-01" as any, inputs: { weightKg: 82, circumferencesUsed: [], measurementCount: 10 }, basisNote: "test" } as BodyCompositionEstimate,
    completeness: { weightReadings: 10, circumferenceSites: ["chest", "waist", "left_upper_arm", "right_upper_arm"], circumferenceReadings: 10, canEstimateComposition: true, missingForComposition: [], dataQualityScore: 0.8 },
    muscleDevelopment: [
      { muscle: "chest", trainingExposureScore: 80, measurementTrend: "increasing", measurementSlopePerWeek: 0.15, measurementConfidence: 0.8, recoveryContext: "supportive", volumeAppropriateness: "appropriate", developmentStatus: "progressing", confidence: 0.8, evidence: ["strong exposure", "increasing measurement"] },
      { muscle: "side_delts", trainingExposureScore: 30, measurementTrend: "stable", measurementSlopePerWeek: 0.01, measurementConfidence: 0.5, recoveryContext: "neutral", volumeAppropriateness: "insufficient", developmentStatus: "maintaining", confidence: 0.6, evidence: ["low exposure"] },
      { muscle: "biceps", trainingExposureScore: 60, measurementTrend: "increasing", measurementSlopePerWeek: 0.1, measurementConfidence: 0.7, recoveryContext: "supportive", volumeAppropriateness: "appropriate", developmentStatus: "progressing", confidence: 0.7, evidence: [] },
      { muscle: "triceps", trainingExposureScore: 70, measurementTrend: "stable", measurementSlopePerWeek: 0.02, measurementConfidence: 0.6, recoveryContext: "neutral", volumeAppropriateness: "appropriate", developmentStatus: "maintaining", confidence: 0.65, evidence: [] },
    ],
    physiqueGoal: { priorities: ["chest_development", "shoulder_width", "arm_size"] },
    ...overrides,
  });

  test("detects asymmetry_ratio rule for bilateral asymmetry", () => {
    const input = createBaseInput();
    const disproportionate = assessDisproportionateDevelopment(input);
    const result = buildBodyAssessment("user-1", input, disproportionate);
    const asymmetryFlags = result.disproportionateDevelopment.filter(d => d.ruleId === "symmetry_arms");
    assert.ok(asymmetryFlags.length > 0);
    for (const flag of asymmetryFlags) {
      assert.strictEqual(flag.type, "asymmetric");
      // involvedMuscles uses muscle group names (left_upper_arm -> upper_arm)
      assert.ok(flag.involvedMuscles.includes("upper_arm"));
      assert.ok(flag.severity > 0);
      assert.ok(flag.confidence > 0);
      assert.ok(flag.basisNote);
    }
  });

  test("detects training_exposure_vs_priority for lagging priority muscles", () => {
    const input = createBaseInput();
    const disproportionate = assessDisproportionateDevelopment(input);
    const result = buildBodyAssessment("user-1", input, disproportionate);
    const exposureFlags = result.disproportionateDevelopment.filter(d => d.ruleId === "shoulder_width_lagging");
    assert.ok(exposureFlags.length > 0);
    for (const flag of exposureFlags) {
      assert.strictEqual(flag.type, "lagging");
      assert.strictEqual(flag.priorityTag, "shoulder_width");
      assert.strictEqual(flag.recommendedIntervention, "review_training");
    }
  });

  test("detects proportion_ratio_deviation for aesthetic ratios", () => {
    const input = createBaseInput({
      circumferenceTrends: [
        { site: "chest", direction: "increasing", slopeCmPerWeek: 0.15, confidence: 0.8, pointsUsed: 24, warnings: [], latestCm: 104 },
        { site: "waist", direction: "stable", slopeCmPerWeek: 0.01, confidence: 0.7, pointsUsed: 24, warnings: [], latestCm: 83 },
        { site: "left_upper_arm", direction: "increasing", slopeCmPerWeek: 0.12, confidence: 0.75, pointsUsed: 24, warnings: [], latestCm: 38 },
        { site: "right_upper_arm", direction: "stable", slopeCmPerWeek: 0.02, confidence: 0.6, pointsUsed: 24, warnings: [], latestCm: 34 },
        { site: "shoulders", direction: "stable", slopeCmPerWeek: 0.01, confidence: 0.7, pointsUsed: 24, warnings: [], latestCm: 115 },
      ],
    });
    const disproportionate = assessDisproportionateDevelopment(input);
    const result = buildBodyAssessment("user-1", input, disproportionate);
    const proportionFlags = result.disproportionateDevelopment.filter(d => d.ruleId === "proportion_deviation_general");
    for (const flag of proportionFlags) {
      assert.strictEqual(flag.type, "proportion_deviation");
      assert.ok(flag.basisNote);
    }
  });

  test("detects weight_trend_stagnation for stable weight with sufficient data", () => {
    const input = createBaseInput({
      weightTrend: { direction: "stable", slopeKgPerWeek: 0, confidence: 0.8, pointsUsed: 24, warnings: [], currentWeightKg: 82, averageWeight7dKg: 82, averageWeight14dKg: 82 },
      physiqueGoal: { priorities: ["chest_development", "overall_mass"] },
    });
    const disproportionate = assessDisproportionateDevelopment(input);
    const result = buildBodyAssessment("user-1", input, disproportionate);
    const weightFlags = result.disproportionateDevelopment.filter(d => d.ruleId === "overall_mass_stagnation");
    assert.ok(weightFlags.length > 0);
    for (const flag of weightFlags) {
      assert.strictEqual(flag.type, "lagging");
      assert.strictEqual(flag.recommendedIntervention, "adjust_nutrition");
    }
  });

  test("detects waist_trend_stagnation for stable waist during fat loss", () => {
    const input = createBaseInput({
      circumferenceTrends: [
        { site: "waist", direction: "stable", slopeCmPerWeek: 0.01, confidence: 0.8, pointsUsed: 16, warnings: [], latestCm: 83 },
        { site: "chest", direction: "increasing", slopeCmPerWeek: 0.15, confidence: 0.8, pointsUsed: 8, warnings: [], latestCm: 104 },
      ],
      physiqueGoal: { priorities: ["chest_development", "leanness"] },
    });
    const disproportionate = assessDisproportionateDevelopment(input);
    const result = buildBodyAssessment("user-1", input, disproportionate);
    const waistFlags = result.disproportionateDevelopment.filter(d => d.ruleId === "leanness_stagnation");
    assert.ok(waistFlags.length > 0);
    for (const flag of waistFlags) {
      assert.strictEqual(flag.type, "lagging");
      assert.ok(flag.involvedMuscles.includes("waist"));
    }
  });

  test("returns goalRelativeProgress based on assessment", () => {
    const input = createBaseInput({
      physiqueGoal: { priorities: ["chest_development", "shoulder_width"] },
      weightTrend: { direction: "increasing", slopeKgPerWeek: 0.2, confidence: 0.8, pointsUsed: 10, warnings: [], currentWeightKg: 82, averageWeight7dKg: 81.5, averageWeight14dKg: 81 },
    });
    const disproportionate = assessDisproportionateDevelopment(input);
    const result = buildBodyAssessment("user-1", input, disproportionate);
    assert.strictEqual(result.goalRelativeProgress, "on_track");

    const badInput = createBaseInput({
      physiqueGoal: { priorities: ["chest_development"] },
      weightTrend: { direction: "decreasing", slopeKgPerWeek: -0.2, confidence: 0.8, pointsUsed: 10, warnings: [], currentWeightKg: 80, averageWeight7dKg: 80.5, averageWeight14dKg: 81 },
      circumferenceTrends: [
        { site: "chest", direction: "stable", slopeCmPerWeek: 0.01, confidence: 0.8, pointsUsed: 16, warnings: [], latestCm: 104 },
        { site: "waist", direction: "stable", slopeCmPerWeek: 0.01, confidence: 0.7, pointsUsed: 16, warnings: [], latestCm: 83 },
        { site: "left_upper_arm", direction: "increasing", slopeCmPerWeek: 0.12, confidence: 0.75, pointsUsed: 16, warnings: [], latestCm: 38 },
        { site: "right_upper_arm", direction: "stable", slopeCmPerWeek: 0.02, confidence: 0.6, pointsUsed: 16, warnings: [], latestCm: 34 },
      ],
      muscleDevelopment: [
        { muscle: "chest", trainingExposureScore: 80, measurementTrend: "stable", measurementSlopePerWeek: 0.01, measurementConfidence: 0.8, recoveryContext: "supportive", volumeAppropriateness: "appropriate", developmentStatus: "regressing", confidence: 0.8, evidence: ["strong exposure", "stable measurement"] },
        { muscle: "side_delts", trainingExposureScore: 30, measurementTrend: "stable", measurementSlopePerWeek: 0.01, measurementConfidence: 0.5, recoveryContext: "neutral", volumeAppropriateness: "insufficient", developmentStatus: "maintaining", confidence: 0.6, evidence: ["low exposure"] },
        { muscle: "biceps", trainingExposureScore: 60, measurementTrend: "increasing", measurementSlopePerWeek: 0.1, measurementConfidence: 0.7, recoveryContext: "supportive", volumeAppropriateness: "appropriate", developmentStatus: "progressing", confidence: 0.7, evidence: [] },
        { muscle: "triceps", trainingExposureScore: 70, measurementTrend: "stable", measurementSlopePerWeek: 0.02, measurementConfidence: 0.6, recoveryContext: "neutral", volumeAppropriateness: "appropriate", developmentStatus: "maintaining", confidence: 0.65, evidence: [] },
      ],
    });
    const badDisproportionate = assessDisproportionateDevelopment(badInput);
    const badResult = buildBodyAssessment("user-1", badInput, badDisproportionate);
    assert.strictEqual(badResult.goalRelativeProgress, "needs_attention");
  });

  test("generates priorityActions from disproportionate flags", () => {
    const input = createBaseInput();
    const disproportionate = assessDisproportionateDevelopment(input);
    const result = buildBodyAssessment("user-1", input, disproportionate);
    assert.ok(Array.isArray(result.priorityActions));
    assert.ok(result.priorityActions.length > 0);
  });
});

// -----------------------------------------------------------------------------
// Body Recommendations Tests
// -----------------------------------------------------------------------------

describe("Body Recommendations - category, priority, actionability", () => {
  const createAssessment = (overrides: Partial<BodyAssessment> = {}): BodyAssessment => ({
    userId: "user-1",
    asOf: "2024-03-01" as any,
    weightTrend: { direction: "increasing", slopeKgPerWeek: 0.2, confidence: 0.8, pointsUsed: 10, warnings: [], currentWeightKg: 82, averageWeight7dKg: 81.5, averageWeight14dKg: 81 },
    circumferenceTrends: [],
    composition: { bodyFatPercent: 18, uncertaintyPct: 2.5, method: "multi_site", confidence: 0.75, asOf: "2024-03-01" as any, inputs: { weightKg: 82, circumferencesUsed: [], measurementCount: 10 }, basisNote: "test" } as BodyCompositionEstimate,
    completeness: { weightReadings: 10, circumferenceSites: ["chest", "waist"], circumferenceReadings: 10, canEstimateComposition: true, missingForComposition: [], dataQualityScore: 0.8 },
    muscleDevelopment: [
      { muscle: "side_delts", trainingExposureScore: 30, measurementTrend: "stable", measurementSlopePerWeek: 0.01, measurementConfidence: 0.5, recoveryContext: "neutral", volumeAppropriateness: "insufficient", developmentStatus: "maintaining", confidence: 0.6, evidence: ["low exposure"] },
    ],
    disproportionateDevelopment: [
      { ruleId: "shoulder_width_lagging", ruleVersion: 1, priorityTag: "shoulder_width", type: "lagging", involvedMuscles: ["side_delts"], severity: 0.7, confidence: 0.75, observationWeeks: 8, observation: "Side delts priority but only 30/100 exposure", evidence: ["low direct sets"], recommendedIntervention: "review_training", basisNote: "Priority muscle receiving insufficient training stimulus" },
    ],
    goalRelativeProgress: "needs_attention",
    priorityActions: ["Increase lateral delt volume"],
    ...overrides,
  });

  test("generates recommendations with proper category classification", () => {
    const assessment = createAssessment();
    const physiqueGoal = { priorities: ["shoulder_width"] as const, direction: "gain" as const };
    const recs = generateBodyRecommendations({ assessment, physiqueGoal, asOf: assessment.asOf });

    assert.ok(recs.length > 0);
    for (const rec of recs) {
      assert.ok(["maintain", "collect_more_data", "adjust_nutrition", "review_training", "reassess_technique", "no_change"].includes(rec.category));
      assert.ok(typeof rec.priority === "number");
      assert.ok(rec.priority > 0);
      assert.ok(Array.isArray(rec.relatedRules));
      assert.ok(rec.recommendation);
      assert.ok(rec.rationale);
      assert.ok(typeof rec.confidence === "number");
      assert.ok(rec.confidence >= 0);
      assert.ok(rec.confidence <= 1);
      assert.ok(typeof rec.reassessInWeeks === "number");
      assert.ok(rec.reassessInWeeks > 0);
    }
  });

  test("produces review_training category for high-severity disproportionate flags", () => {
    const assessment = createAssessment();
    const physiqueGoal = { priorities: ["shoulder_width"] as const, direction: "gain" as const };
    const recs = generateBodyRecommendations({ assessment, physiqueGoal, asOf: assessment.asOf });

    const trainingRecs = recs.filter(r => r.category === "review_training");
    assert.ok(trainingRecs.length > 0);
    for (const rec of trainingRecs) {
      assert.ok(rec.confidence > 0.5);
    }
  });

  test("produces reassess_technique category for asymmetry findings", () => {
    const assessment = createAssessment({
      disproportionateDevelopment: [
        { ruleId: "symmetry_arms", ruleVersion: 1, priorityTag: "arm_size", type: "asymmetric", involvedMuscles: ["left_upper_arm", "right_upper_arm"], severity: 0.4, confidence: 0.6, observationWeeks: 8, observation: "Left arm 1.2cm larger than right", evidence: ["measurement diff"], recommendedIntervention: "reassess_technique", basisNote: "Bilateral asymmetry >10%" },
      ],
      goalRelativeProgress: "on_track",
    });
    const physiqueGoal = { priorities: ["arm_size"] as const, direction: "gain" as const };
    const recs = generateBodyRecommendations({ assessment, physiqueGoal, asOf: assessment.asOf });

    const techniqueRecs = recs.filter(r => r.category === "reassess_technique");
    assert.ok(techniqueRecs.length > 0);
  });

  test("produces maintain category for positive progress", () => {
    const assessment = createAssessment({
      disproportionateDevelopment: [],
      goalRelativeProgress: "on_track",
      muscleDevelopment: [
        { muscle: "chest", trainingExposureScore: 80, measurementTrend: "increasing", measurementSlopePerWeek: 0.15, measurementConfidence: 0.8, recoveryContext: "supportive", volumeAppropriateness: "appropriate", developmentStatus: "progressing", confidence: 0.8, evidence: [] },
      ],
    });
    const physiqueGoal = { priorities: ["chest_development"] as const, direction: "gain" as const };
    const recs = generateBodyRecommendations({ assessment, physiqueGoal, asOf: assessment.asOf });

    const maintainRecs = recs.filter(r => r.category === "maintain");
    assert.ok(maintainRecs.length > 0);
    for (const rec of maintainRecs) {
      assert.ok(rec.priority <= 5); // Lower priority
    }
  });

  test("includes actionable steps in recommendations", () => {
    const assessment = createAssessment();
    const physiqueGoal = { priorities: ["shoulder_width"] as const, direction: "gain" as const };
    const recs = generateBodyRecommendations({ assessment, physiqueGoal, asOf: assessment.asOf });

    for (const rec of recs) {
      assert.ok(rec.recommendation);
      assert.ok(rec.recommendation.length > 0);
      assert.ok(rec.rationale);
      assert.ok(rec.rationale.length > 0);
    }
  });
});

// -----------------------------------------------------------------------------
// Cross-Engine Integration Context Tests
// -----------------------------------------------------------------------------

describe("Integration Contexts - nutrition, planner, recovery, adaptation", () => {
  const createAssessment = (): BodyAssessment => ({
    userId: "user-1",
    asOf: "2024-03-01" as any,
    weightTrend: { direction: "increasing", slopeKgPerWeek: 0.2, confidence: 0.8, pointsUsed: 10, warnings: [], currentWeightKg: 82, averageWeight7dKg: 81.5, averageWeight14dKg: 81 },
    circumferenceTrends: [
      { site: "chest", direction: "increasing", slopeCmPerWeek: 0.15, confidence: 0.8, pointsUsed: 8, warnings: [], latestCm: 104 },
      { site: "waist", direction: "stable", slopeCmPerWeek: 0.01, confidence: 0.7, pointsUsed: 8, warnings: [], latestCm: 83 },
    ],
    composition: { bodyFatPercent: 18, uncertaintyPct: 2.5, method: "multi_site", confidence: 0.75, asOf: "2024-03-01" as any, inputs: { weightKg: 82, circumferencesUsed: [], measurementCount: 10 }, basisNote: "test" } as BodyCompositionEstimate,
    completeness: { weightReadings: 10, circumferenceSites: ["chest", "waist", "left_upper_arm", "right_upper_arm"], circumferenceReadings: 10, canEstimateComposition: true, missingForComposition: [], dataQualityScore: 0.8 },
    muscleDevelopment: [
      { muscle: "chest", trainingExposureScore: 80, measurementTrend: "increasing", measurementSlopePerWeek: 0.15, measurementConfidence: 0.8, recoveryContext: "supportive", volumeAppropriateness: "appropriate", developmentStatus: "progressing", confidence: 0.8, evidence: [] },
      { muscle: "side_delts", trainingExposureScore: 30, measurementTrend: "stable", measurementSlopePerWeek: 0.01, measurementConfidence: 0.5, recoveryContext: "neutral", volumeAppropriateness: "insufficient", developmentStatus: "maintaining", confidence: 0.6, evidence: ["low exposure"] },
    ],
    disproportionateDevelopment: [
      { ruleId: "shoulder_width_lagging", ruleVersion: 1, priorityTag: "shoulder_width", type: "lagging", involvedMuscles: ["side_delts"], severity: 0.7, confidence: 0.75, observationWeeks: 8, observation: "Side delts priority but only 30/100 exposure", evidence: ["low direct sets"], recommendedIntervention: "review_training", basisNote: "Priority muscle receiving insufficient training stimulus" },
      { ruleId: "symmetry_arms", ruleVersion: 1, priorityTag: "arm_size", type: "asymmetric", involvedMuscles: ["left_upper_arm", "right_upper_arm"], severity: 0.4, confidence: 0.6, observationWeeks: 8, observation: "Left arm 1.2cm larger than right", evidence: ["measurement diff"], recommendedIntervention: "reassess_technique", basisNote: "Bilateral asymmetry >10%" },
    ],
    goalRelativeProgress: "needs_attention",
    priorityActions: ["Increase lateral delt volume"],
  });

  test("getBodyContextForNutrition returns correct shape", () => {
    const assessment = createAssessment();
    const physiqueGoal = { priorities: ["shoulder_width"] as const, direction: "gain" as const };
    const context = getBodyContextForNutrition(assessment, physiqueGoal);

    assert.strictEqual(context.weightTrendDirection, "increasing");
    assert.strictEqual(context.weightSlopeKgPerWeek, 0.2);
    assert.strictEqual(context.compositionConfidence, 0.75);
    assert.strictEqual(context.bodyFatPercent, 18);
    assert.strictEqual(context.physiqueDirection, "gain");
    assert.strictEqual(context.primaryPhysiquePriority, "shoulder_width");
    assert.ok(context.muscleDevelopmentGaps.includes("side_delts"));
    assert.strictEqual(context.dataQualityScore, 0.8);
  });

  test("adjustNutritionTargetsFromBodyContext adjusts calories for gain goal with stable weight", () => {
    const assessment: BodyAssessment = {
      userId: "user-1",
      asOf: "2024-03-01" as any,
      weightTrend: { direction: "stable", slopeKgPerWeek: 0, confidence: 0.8, pointsUsed: 10, warnings: [], currentWeightKg: 82, averageWeight7dKg: 82, averageWeight14dKg: 82 },
      circumferenceTrends: [],
      composition: { bodyFatPercent: 18, uncertaintyPct: 2.5, method: "multi_site", confidence: 0.75, asOf: "2024-03-01" as any, inputs: { weightKg: 82, circumferencesUsed: [], measurementCount: 10 }, basisNote: "test" } as BodyCompositionEstimate,
      completeness: { weightReadings: 10, circumferenceSites: ["chest", "waist"], circumferenceReadings: 10, canEstimateComposition: true, missingForComposition: [], dataQualityScore: 0.8 },
      muscleDevelopment: [],
      disproportionateDevelopment: [],
      goalRelativeProgress: "needs_attention",
      priorityActions: [],
    };
    const physiqueGoal = { priorities: ["chest_development"] as const, direction: "gain" as const };
    const context = getBodyContextForNutrition(assessment, physiqueGoal);

    const baseTargets: NutritionTargets = { caloriesKcal: 2500, proteinGrams: 180, carbohydrateGrams: 250, fatGrams: 85, effectiveFrom: "2024-03-01" as any };
    const adjusted = adjustNutritionTargetsFromBodyContext(baseTargets, context);

    assert.ok(adjusted.caloriesKcal > baseTargets.caloriesKcal);
    assert.ok(adjusted.adjustments.length > 0);
    assert.ok(adjusted.adjustments[0]?.includes("weight not increasing"));
  });

  test("adjustNutritionTargetsFromBodyContext adjusts calories for lose goal with increasing weight", () => {
    const assessment: BodyAssessment = {
      userId: "user-1",
      asOf: "2024-03-01" as any,
      weightTrend: { direction: "increasing", slopeKgPerWeek: 0.3, confidence: 0.8, pointsUsed: 10, warnings: [], currentWeightKg: 82, averageWeight7dKg: 81.5, averageWeight14dKg: 81 },
      circumferenceTrends: [],
      composition: { bodyFatPercent: 18, uncertaintyPct: 2.5, method: "multi_site", confidence: 0.75, asOf: "2024-03-01" as any, inputs: { weightKg: 82, circumferencesUsed: [], measurementCount: 10 }, basisNote: "test" } as BodyCompositionEstimate,
      completeness: { weightReadings: 10, circumferenceSites: ["chest", "waist"], circumferenceReadings: 10, canEstimateComposition: true, missingForComposition: [], dataQualityScore: 0.8 },
      muscleDevelopment: [],
      disproportionateDevelopment: [],
      goalRelativeProgress: "needs_attention",
      priorityActions: [],
    };
    const physiqueGoal = { priorities: ["chest_development"] as const, direction: "lose" as const };
    const context = getBodyContextForNutrition(assessment, physiqueGoal);

    const baseTargets: NutritionTargets = { caloriesKcal: 2500, proteinGrams: 180, carbohydrateGrams: 250, fatGrams: 85, effectiveFrom: "2024-03-01" as any };
    const adjusted = adjustNutritionTargetsFromBodyContext(baseTargets, context);

    assert.ok(adjusted.caloriesKcal < baseTargets.caloriesKcal);
    assert.ok(adjusted.adjustments[0]?.includes("weight not decreasing"));
  });

  test("getBodyContextForTraining returns correct shape with volume and recovery per muscle", () => {
    const assessment = createAssessment();
    const context = getBodyContextForTraining(assessment);

    assert.ok(context.muscleDevelopmentGaps.includes("side_delts"));
    assert.ok(context.disproportionateFlags.includes("shoulder_width_lagging"));
    assert.ok(context.disproportionateFlags.includes("symmetry_arms"));
    assert.ok(context.muscleDevelopmentHighlights.includes("chest"));
    assert.strictEqual(context.volumeAppropriateness["side_delts"], "insufficient");
    assert.strictEqual(context.volumeAppropriateness["chest"], "appropriate");
    assert.strictEqual(context.recoveryContext["side_delts"], "neutral");
    assert.strictEqual(context.recoveryContext["chest"], "supportive");
    assert.strictEqual(context.goalRelativeProgress, "needs_attention");
  });

  test("getTrainingAdjustmentsFromBodyContext produces volume adjustments for gaps", () => {
    const assessment = createAssessment();
    const trainingContext = getBodyContextForTraining(assessment);
    const adjustments = getTrainingAdjustmentsFromBodyContext(trainingContext);

    assert.ok(adjustments.volumeAdjustments.length > 0);
    const sideDeltsAdj = adjustments.volumeAdjustments.find(a => a.muscle === "side_delts");
    assert.ok(sideDeltsAdj);
    assert.strictEqual(sideDeltsAdj?.direction, "increase");
    assert.ok(sideDeltsAdj?.reason.includes("lagging"));
  });

  test("getTrainingAdjustmentsFromBodyContext produces exercise selection hints for asymmetry", () => {
    const assessment = createAssessment();
    const trainingContext = getBodyContextForTraining(assessment);
    const adjustments = getTrainingAdjustmentsFromBodyContext(trainingContext);

    assert.ok(adjustments.exerciseSelectionHints.some(h => h.includes("unilateral")));
  });

  test("getBodyContextForRecovery returns limiting signals for rapid weight change", () => {
    const assessment: BodyAssessment = {
      userId: "user-1",
      asOf: "2024-03-01" as any,
      weightTrend: { direction: "decreasing", slopeKgPerWeek: -0.4, confidence: 0.8, pointsUsed: 10, warnings: [], currentWeightKg: 80, averageWeight7dKg: 80.5, averageWeight14dKg: 81 },
      circumferenceTrends: [],
      composition: { bodyFatPercent: 18, uncertaintyPct: 2.5, method: "multi_site", confidence: 0.75, asOf: "2024-03-01" as any, inputs: { weightKg: 82, circumferencesUsed: [], measurementCount: 10 }, basisNote: "test" } as BodyCompositionEstimate,
      completeness: { weightReadings: 10, circumferenceSites: ["chest", "waist"], circumferenceReadings: 10, canEstimateComposition: true, missingForComposition: [], dataQualityScore: 0.8 },
      muscleDevelopment: [],
      disproportionateDevelopment: [],
      goalRelativeProgress: "needs_attention",
      priorityActions: [],
    };
    const context = getBodyContextForRecovery(assessment);

    assert.ok(context.limitingBodySignals.some(s => s.includes("Rapid weight loss")));
    assert.strictEqual(context.weightTrendImpact, "concerning");
  });

  test("getBodyContextForRecovery identifies muscles with limiting recovery", () => {
    const assessment: BodyAssessment = {
      userId: "user-1",
      asOf: "2024-03-01" as any,
      weightTrend: { direction: "increasing", slopeKgPerWeek: 0.2, confidence: 0.8, pointsUsed: 10, warnings: [], currentWeightKg: 82, averageWeight7dKg: 81.5, averageWeight14dKg: 81 },
      circumferenceTrends: [],
      composition: { bodyFatPercent: 18, uncertaintyPct: 2.5, method: "multi_site", confidence: 0.75, asOf: "2024-03-01" as any, inputs: { weightKg: 82, circumferencesUsed: [], measurementCount: 10 }, basisNote: "test" } as BodyCompositionEstimate,
      completeness: { weightReadings: 10, circumferenceSites: ["chest", "waist"], circumferenceReadings: 10, canEstimateComposition: true, missingForComposition: [], dataQualityScore: 0.8 },
      muscleDevelopment: [
        { muscle: "quadriceps", trainingExposureScore: 80, measurementTrend: "increasing", measurementSlopePerWeek: 0.15, measurementConfidence: 0.8, recoveryContext: "limiting", volumeAppropriateness: "appropriate", developmentStatus: "progressing", confidence: 0.8, evidence: [] },
      ],
      disproportionateDevelopment: [],
      goalRelativeProgress: "needs_attention",
      priorityActions: [],
    };
    const context = getBodyContextForRecovery(assessment);

    assert.ok(context.musclesWithLimitingRecovery.includes("quadriceps"));
  });

  test("getBodyContextForAdaptation returns weight stagnation signal", () => {
    const assessment: BodyAssessment = {
      userId: "user-1",
      asOf: "2024-03-01" as any,
      weightTrend: { direction: "stable", slopeKgPerWeek: 0, confidence: 0.8, pointsUsed: 14, warnings: [], currentWeightKg: 82, averageWeight7dKg: 82, averageWeight14dKg: 82 },
      circumferenceTrends: [],
      composition: { bodyFatPercent: 18, uncertaintyPct: 2.5, method: "multi_site", confidence: 0.75, asOf: "2024-03-01" as any, inputs: { weightKg: 82, circumferencesUsed: [], measurementCount: 10 }, basisNote: "test" } as BodyCompositionEstimate,
      completeness: { weightReadings: 10, circumferenceSites: ["chest", "waist"], circumferenceReadings: 10, canEstimateComposition: true, missingForComposition: [], dataQualityScore: 0.8 },
      muscleDevelopment: [],
      disproportionateDevelopment: [],
      goalRelativeProgress: "needs_attention",
      priorityActions: [],
    };
    const context = getBodyContextForAdaptation(assessment);

    const weightStagnation = context.bodyPlateauSignals.find(s => s.type === "weight_stagnation");
    assert.ok(weightStagnation);
    assert.strictEqual(weightStagnation?.severity, 0.4);
  });

  test("getBodyContextForAdaptation returns muscle development stagnation signals", () => {
    const assessment: BodyAssessment = {
      userId: "user-1",
      asOf: "2024-03-01" as any,
      weightTrend: { direction: "increasing", slopeKgPerWeek: 0.2, confidence: 0.8, pointsUsed: 10, warnings: [], currentWeightKg: 82, averageWeight7dKg: 81.5, averageWeight14dKg: 81 },
      circumferenceTrends: [],
      composition: { bodyFatPercent: 18, uncertaintyPct: 2.5, method: "multi_site", confidence: 0.75, asOf: "2024-03-01" as any, inputs: { weightKg: 82, circumferencesUsed: [], measurementCount: 10 }, basisNote: "test" } as BodyCompositionEstimate,
      completeness: { weightReadings: 10, circumferenceSites: ["chest", "waist"], circumferenceReadings: 10, canEstimateComposition: true, missingForComposition: [], dataQualityScore: 0.8 },
      muscleDevelopment: [
        { muscle: "side_delts", trainingExposureScore: 80, measurementTrend: "stable", measurementSlopePerWeek: 0.01, measurementConfidence: 0.6, recoveryContext: "neutral", volumeAppropriateness: "appropriate", developmentStatus: "maintaining", confidence: 0.6, evidence: [] },
        { muscle: "biceps", trainingExposureScore: 50, measurementTrend: "decreasing", measurementSlopePerWeek: -0.05, measurementConfidence: 0.5, recoveryContext: "neutral", volumeAppropriateness: "appropriate", developmentStatus: "regressing", confidence: 0.5, evidence: [] },
      ],
      disproportionateDevelopment: [],
      goalRelativeProgress: "needs_attention",
      priorityActions: [],
    };
    const context = getBodyContextForAdaptation(assessment);

    const muscleStagnation = context.bodyPlateauSignals.filter(s => s.type === "muscle_development_stagnation");
    assert.strictEqual(muscleStagnation.length, 2);
    assert.strictEqual(muscleStagnation[0]?.severity, 0.5);
    assert.strictEqual(muscleStagnation[1]?.severity, 0.7);
  });

  test("generateIntegrationContexts produces all four contexts", () => {
    const assessment = createAssessment();
    const physiqueGoal = { priorities: ["shoulder_width"] as const, direction: "gain" as const };
    const contexts = generateIntegrationContexts(assessment, physiqueGoal);

    assert.ok(contexts.forNutrition);
    assert.ok(contexts.forTraining);
    assert.ok(contexts.forRecovery);
    assert.ok(contexts.forAdaptation);
  });

  test("buildBodyContextForIntegration returns simplified integration context", () => {
    const assessment = createAssessment();
    const context = buildBodyContextForIntegration(assessment);

    assert.strictEqual(context.weightTrendDirection, "increasing");
    assert.strictEqual(context.weightSlopeKgPerWeek, 0.2);
    assert.strictEqual(context.compositionConfidence, 0.75);
    assert.ok(context.muscleDevelopmentGaps.includes("side_delts"));
    assert.ok(context.disproportionateFlags.includes("shoulder_width_lagging"));
    assert.strictEqual(context.goalRelativeProgress, "needs_attention");
  });
});