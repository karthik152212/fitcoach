/**
 * Phase 7 — Projection & Trajectory Engine unit tests.
 *
 * Uses native Node.js test runner (node:test) for compatibility with npm test.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  generateProjection,
  detectProjectionDivergences,
  supersedeProjection,
  DEFAULT_PROJECTION_CONFIGURATION,
  type ProjectionConfiguration,
  type ProjectionRequest,
  type DerivedFacts,
} from "../projection";
import type {
  ProjectionTarget,
  ProjectionHorizon,
  ProjectionSnapshot,
  ProjectionMetric,
  CalendarDate,
  UserId,
} from "@fitcoach/domain";

// -----------------------------------------------------------------------------
// Test fixtures
// -----------------------------------------------------------------------------

const createDerivedFacts = (overrides: Partial<DerivedFacts> = {}): DerivedFacts => ({
  weightTrend: {
    slopePerDay: 0.02, // ~0.14 kg/week gain
    confidence: 0.8,
    pointsUsed: 10,
    direction: "increasing",
  },
  bodyFatTrend: {
    slopePerDay: -0.005, // ~-0.035%/week loss
    confidence: 0.7,
    pointsUsed: 8,
    direction: "decreasing",
  },
  muscleMassTrend: {
    slopePerDay: 0.003, // ~0.021 kg/week gain
    confidence: 0.6,
    pointsUsed: 8,
    direction: "increasing",
  },
  measurementTrends: new Map([
    ["chest", { slopePerDay: 0.01, confidence: 0.7, pointsUsed: 8, direction: "increasing" }],
    ["waist", { slopePerDay: -0.005, confidence: 0.6, pointsUsed: 8, direction: "decreasing" }],
    ["left_upper_arm", { slopePerDay: 0.008, confidence: 0.7, pointsUsed: 8, direction: "increasing" }],
  ]),
  strengthTrends: new Map([
    ["bench_press", { slopePerDay: 0.1, confidence: 0.7, pointsUsed: 12, direction: "increasing" }],
    ["squat", { slopePerDay: 0.15, confidence: 0.7, pointsUsed: 12, direction: "increasing" }],
  ]),
  volumeTrend: {
    slopePerDay: 0.05, // ~0.35 sets/week increase
    confidence: 0.7,
    pointsUsed: 10,
    direction: "increasing",
  },
  proteinTrend: {
    slopePerDay: 2, // ~2g/day increase
    confidence: 0.8,
    pointsUsed: 14,
    direction: "increasing",
  },
  caloriesTrend: {
    slopePerDay: 10, // ~10 kcal/day increase
    confidence: 0.8,
    pointsUsed: 14,
    direction: "increasing",
  },
  currentWeightKg: 82,
  currentBodyFatPercent: 18,
  currentMuscleMassKg: 38,
  currentMeasurements: new Map([
    ["chest", 104],
    ["waist", 83],
    ["left_upper_arm", 37],
  ]),
  currentStrength: new Map([
    ["bench_press", 100],
    ["squat", 140],
  ]),
  currentWeeklyVolume: 60,
  currentDailyProteinG: 180,
  currentDailyCaloriesKcal: 2800,
  trainingAdherence: 0.9,
  nutritionAdherence: 0.85,
  sleepAdequacy: "adequate",
  recoveryReadiness: 85,
  ...overrides,
});

const createRequest = (overrides: Partial<ProjectionRequest> = {}): ProjectionRequest => ({
  userId: "user-1" as UserId,
  asOf: "2024-03-01" as CalendarDate,
  horizons: ["current", "1_month", "3_months", "6_months", "12_months"],
  targets: [
    "body_weight_kg",
    "body_fat_percent",
    "muscle_mass_kg",
    "measurement_cm",
    "strength_1rm_kg",
    "volume_weekly_sets",
    "protein_daily_g",
    "calories_daily_kcal",
  ],
  ...overrides,
});

// -----------------------------------------------------------------------------
// generateProjection tests
// -----------------------------------------------------------------------------

function findMetric(metrics: readonly ProjectionMetric[], target: ProjectionTarget, horizon: ProjectionHorizon): ProjectionMetric {
  const found = metrics.find(m => m.target === target && m.horizon === horizon);
  if (!found) throw new Error(`Metric not found: ${target} @ ${horizon}`);
  return found;
}

describe("generateProjection - core projection engine", () => {
  test("generates a valid projection snapshot with all standard horizons", () => {
    const facts = createDerivedFacts();
    const request = createRequest();
    const result = generateProjection(request, facts);

    assert.ok(result.snapshot);
    assert.strictEqual(result.isNew, true);
    assert.strictEqual(result.snapshot.userId, "user-1");
    assert.strictEqual(result.snapshot.status, "current");
    assert.strictEqual(result.snapshot.configVersion, "fitcoach.projection.v1");
    assert.ok(result.snapshot.id);
    assert.ok(result.snapshot.generatedAt);
    assert.ok(result.snapshot.createdAt);
    assert.ok(result.snapshot.updatedAt);
    assert.ok(result.snapshot.summary);
    assert.ok(Array.isArray(result.snapshot.warnings));
  });

  test("generates metrics for all requested targets", () => {
    const facts = createDerivedFacts();
    const request = createRequest();
    const result = generateProjection(request, facts);

    const targetsInMetrics = new Set(result.snapshot.metrics.map((m) => m.target));
    assert.ok(targetsInMetrics.has("body_weight_kg"));
    assert.ok(targetsInMetrics.has("body_fat_percent"));
    assert.ok(targetsInMetrics.has("muscle_mass_kg"));
    assert.ok(targetsInMetrics.has("measurement_cm"));
    assert.ok(targetsInMetrics.has("strength_1rm_kg"));
    assert.ok(targetsInMetrics.has("volume_weekly_sets"));
    assert.ok(targetsInMetrics.has("protein_daily_g"));
    assert.ok(targetsInMetrics.has("calories_daily_kcal"));
  });

  test("generates metrics for all requested horizons", () => {
    const facts = createDerivedFacts();
    const request = createRequest();
    const result = generateProjection(request, facts);

    const horizonsInMetrics = new Set(result.snapshot.metrics.map((m) => m.horizon));
    assert.ok(horizonsInMetrics.has("current"));
    assert.ok(horizonsInMetrics.has("1_month"));
    assert.ok(horizonsInMetrics.has("3_months"));
    assert.ok(horizonsInMetrics.has("6_months"));
    assert.ok(horizonsInMetrics.has("12_months"));
  });

  test("each metric has central, low, high estimates with proper structure", () => {
    const facts = createDerivedFacts();
    const request = createRequest();
    const result = generateProjection(request, facts);

    for (const metric of result.snapshot.metrics) {
      assert.ok(typeof metric.central.value === "number");
      assert.ok(["measured", "estimated", "inferred"].includes(metric.central.provenance));
      assert.ok(["measured", "label_declared", "estimated", "unknown"].includes(metric.central.confidence!));
      assert.ok(typeof metric.low.value === "number");
      assert.ok(typeof metric.high.value === "number");
      assert.ok(metric.low.value <= metric.central.value);
      assert.ok(metric.high.value >= metric.central.value);
      assert.ok(metric.basis);
      assert.ok(typeof metric.confidence === "string");
    }
  });

  test("weight projection: increasing trend produces higher future values", () => {
    const facts = createDerivedFacts({ weightTrend: { slopePerDay: 0.02, confidence: 0.8, pointsUsed: 10, direction: "increasing" } });
    const request = createRequest({ horizons: ["current", "3_months"] });
    const result = generateProjection(request, facts);

    const currentWeight = findMetric(result.snapshot.metrics, "body_weight_kg", "current");
    const futureWeight = findMetric(result.snapshot.metrics, "body_weight_kg", "3_months");

    assert.ok(futureWeight.central.value > currentWeight.central.value);
  });

  test("weight projection: decreasing trend produces lower future values", () => {
    const facts = createDerivedFacts({ weightTrend: { slopePerDay: -0.02, confidence: 0.8, pointsUsed: 10, direction: "decreasing" } });
    const request = createRequest({ horizons: ["current", "3_months"] });
    const result = generateProjection(request, facts);

    const currentWeight = findMetric(result.snapshot.metrics, "body_weight_kg", "current");
    const futureWeight = findMetric(result.snapshot.metrics, "body_weight_kg", "3_months");

    assert.ok(futureWeight.central.value < currentWeight.central.value);
  });

  test("body fat projection: decreasing trend produces lower future values", () => {
    const facts = createDerivedFacts({ bodyFatTrend: { slopePerDay: -0.005, confidence: 0.7, pointsUsed: 8, direction: "decreasing" } });
    const request = createRequest({ horizons: ["current", "6_months"] });
    const result = generateProjection(request, facts);

    const currentBF = findMetric(result.snapshot.metrics, "body_fat_percent", "current");
    const futureBF = findMetric(result.snapshot.metrics, "body_fat_percent", "6_months");

    assert.ok(futureBF.central.value < currentBF.central.value);
  });

  test("body fat projection clamps to physiological range (3-50%)", () => {
    const facts = createDerivedFacts({
      bodyFatTrend: { slopePerDay: -0.1, confidence: 0.7, pointsUsed: 8, direction: "decreasing" },
      currentBodyFatPercent: 10,
    });
    const request = createRequest({ horizons: ["12_months"] });
    const result = generateProjection(request, facts);

    const bf = findMetric(result.snapshot.metrics, "body_fat_percent", "12_months");
    assert.ok(bf);
    assert.ok(bf.central.value >= 3);
    assert.ok(bf.central.value <= 50);
    assert.ok(bf.low.value >= 3);
    assert.ok(bf.high.value <= 50);
  });

  test("muscle mass projection: increasing trend produces higher future values", () => {
    const facts = createDerivedFacts({ muscleMassTrend: { slopePerDay: 0.003, confidence: 0.6, pointsUsed: 8, direction: "increasing" } });
    const request = createRequest({ horizons: ["current", "6_months"] });
    const result = generateProjection(request, facts);

    const currentMM = findMetric(result.snapshot.metrics, "muscle_mass_kg", "current");
    const futureMM = findMetric(result.snapshot.metrics, "muscle_mass_kg", "6_months");

    assert.ok(futureMM.central.value > currentMM.central.value);
  });

  test("muscle mass projection clamps to non-negative", () => {
    const facts = createDerivedFacts({
      muscleMassTrend: { slopePerDay: -0.01, confidence: 0.6, pointsUsed: 8, direction: "decreasing" },
      currentMuscleMassKg: 1,
    });
    const request = createRequest({ horizons: ["6_months"] });
    const result = generateProjection(request, facts);

    const mm = findMetric(result.snapshot.metrics, "muscle_mass_kg", "6_months");
    assert.ok(mm);
    assert.ok(mm.central.value >= 0);
    assert.ok(mm.low.value >= 0);
  });

  test("measurement projection uses strongest trend site", () => {
    const facts = createDerivedFacts({
      measurementTrends: new Map([
        ["chest", { slopePerDay: 0.05, confidence: 0.7, pointsUsed: 8, direction: "increasing" }],
        ["waist", { slopePerDay: 0.001, confidence: 0.7, pointsUsed: 8, direction: "stable" }],
      ]),
    });
    const request = createRequest({ targets: ["measurement_cm"], horizons: ["3_months"] });
    const result = generateProjection(request, facts);

    const metric = result.snapshot.metrics[0];
    assert.ok(metric);
    assert.strictEqual(metric.target, "measurement_cm");
    assert.ok(metric.central.uncertainty?.note?.includes("chest"));
  });

  test("strength projection applies diminishing returns model", () => {
    const facts = createDerivedFacts({
      strengthTrends: new Map([
        ["bench_press", { slopePerDay: 0.1, confidence: 0.7, pointsUsed: 12, direction: "increasing" }],
      ]),
      currentStrength: new Map([["bench_press", 100]]),
    });
    const request = createRequest({ targets: ["strength_1rm_kg"], horizons: ["3_months"] });
    const result = generateProjection(request, facts);

    const metric = result.snapshot.metrics[0];
    assert.ok(metric);
    assert.strictEqual(metric.method, "custom"); // diminishing returns uses custom
    assert.ok(metric.basis.includes("Diminishing"));
  });

  test("strength projection respects adherence assumption", () => {
    const facts = createDerivedFacts({
      strengthTrends: new Map([
        ["squat", { slopePerDay: 0.15, confidence: 0.7, pointsUsed: 12, direction: "increasing" }],
      ]),
      currentStrength: new Map([["squat", 140]]),
      trainingAdherence: 0.5, // Low adherence
    });
    const request = createRequest({ targets: ["strength_1rm_kg"], horizons: ["3_months"] });
    const result = generateProjection(request, facts);

    const metric = result.snapshot.metrics[0];
    assert.ok(metric);
    assert.ok(metric.central.uncertainty?.note?.includes("adjusted"));
  });

  test("volume projection respects adherence assumption", () => {
    const facts = createDerivedFacts({
      volumeTrend: { slopePerDay: 0.05, confidence: 0.7, pointsUsed: 10, direction: "increasing" },
      currentWeeklyVolume: 60,
      trainingAdherence: 0.7,
    });
    const request = createRequest({ targets: ["volume_weekly_sets"], horizons: ["3_months"] });
    const result = generateProjection(request, facts);

    const metric = result.snapshot.metrics[0];
    assert.ok(metric);
    assert.ok(metric.basis.includes("adherence"));
  });

  test("protein projection respects nutrition adherence assumption", () => {
    const facts = createDerivedFacts({
      proteinTrend: { slopePerDay: 2, confidence: 0.8, pointsUsed: 14, direction: "increasing" },
      currentDailyProteinG: 180,
      nutritionAdherence: 0.85,
    });
    const request = createRequest({ targets: ["protein_daily_g"], horizons: ["3_months"] });
    const result = generateProjection(request, facts);

    const metric = result.snapshot.metrics[0];
    assert.ok(metric);
    assert.ok(metric.basis.includes("adherence"));
  });

  test("calories projection floors at 800 kcal", () => {
    const facts = createDerivedFacts({
      caloriesTrend: { slopePerDay: -100, confidence: 0.8, pointsUsed: 14, direction: "decreasing" },
      currentDailyCaloriesKcal: 1000,
    });
    const request = createRequest({ targets: ["calories_daily_kcal"], horizons: ["3_months"] });
    const result = generateProjection(request, facts);

    const metric = result.snapshot.metrics[0];
    assert.ok(metric);
    assert.ok(metric.central.value >= 800);
    assert.ok(metric.low.value >= 800);
  });

  test("insufficient data returns no metrics for that target", () => {
    const facts = createDerivedFacts({
      weightTrend: { slopePerDay: 0, confidence: 0, pointsUsed: 2, direction: "insufficient_data" },
    });
    const request = createRequest({ targets: ["body_weight_kg"], horizons: ["3_months"] });
    const result = generateProjection(request, facts);

    const weightMetrics = result.snapshot.metrics.filter(m => m.target === "body_weight_kg");
    assert.strictEqual(weightMetrics.length, 0);
  });

  test("custom assumption overrides work", () => {
    const facts = createDerivedFacts({ trainingAdherence: 0.9 });
    const request = createRequest({
      assumptionOverrides: { adherence: "0.5" },
    });
    const result = generateProjection(request, facts);

    const adherenceAssumption = result.snapshot.assumptions.find(a => a.code === "training_adherence");
    assert.ok(adherenceAssumption);
    assert.strictEqual(adherenceAssumption.value, "0.5");
  });

  test("projection is deterministic - same input produces same output", () => {
    const facts = createDerivedFacts();
    const request = createRequest();

    const result1 = generateProjection(request, facts);
    const result2 = generateProjection(request, facts);

    // Metrics should be identical (except IDs and timestamps)
    for (let i = 0; i < result1.snapshot.metrics.length; i++) {
      const m1 = result1.snapshot.metrics[i]!;
      const m2 = result2.snapshot.metrics[i]!;
      assert.strictEqual(m1.target, m2.target);
      assert.strictEqual(m1.horizon, m2.horizon);
      assert.strictEqual(m1.central.value, m2.central.value);
      assert.strictEqual(m1.low.value, m2.low.value);
      assert.strictEqual(m1.high.value, m2.high.value);
    }
  });

  test("warnings generated for low data points", () => {
    const facts = createDerivedFacts({
      weightTrend: { slopePerDay: 0.02, confidence: 0.8, pointsUsed: 3, direction: "increasing" },
    });
    const request = createRequest();
    const result = generateProjection(request, facts);

    assert.ok(result.snapshot.warnings.some(w => w.includes("Weight trend based on only 3 readings")));
  });

  test("warnings generated for low adherence assumption", () => {
    const facts = createDerivedFacts({ trainingAdherence: 0.6 });
    const request = createRequest();
    const result = generateProjection(request, facts);

    assert.ok(result.snapshot.warnings.some(w => w.includes("Low training adherence assumed")));
  });

  test("warnings generated for poor sleep adequacy", () => {
    const facts = createDerivedFacts({ sleepAdequacy: "severe_debt" });
    const request = createRequest();
    const result = generateProjection(request, facts);

    assert.ok(result.snapshot.warnings.some(w => w.includes("Sleep adequacy: severe_debt")));
  });

  test("horizon-specific confidence decay", () => {
    const facts = createDerivedFacts({ weightTrend: { slopePerDay: 0.02, confidence: 0.9, pointsUsed: 20, direction: "increasing" } });
    const request = createRequest({ horizons: ["current", "1_month", "6_months", "12_months"] });
    const result = generateProjection(request, facts);

    const current = findMetric(result.snapshot.metrics, "body_weight_kg", "current");
    const m1 = findMetric(result.snapshot.metrics, "body_weight_kg", "1_month");
    const m6 = findMetric(result.snapshot.metrics, "body_weight_kg", "6_months");
    const m12 = findMetric(result.snapshot.metrics, "body_weight_kg", "12_months");

    // Confidence should decay with horizon
    const confValues = [current, m1, m6, m12].map(m => {
      const c = m.central.confidence;
      if (c === "measured") return 0.9;
      if (c === "label_declared") return 0.75;
      if (c === "estimated") return 0.6;
      return 0.3;
    });

    const c0 = confValues[0];
    const c1 = confValues[1];
    const c2 = confValues[2];
    const c3 = confValues[3];
    assert.ok(typeof c0 === "number");
    assert.ok(typeof c1 === "number");
    assert.ok(typeof c2 === "number");
    assert.ok(typeof c3 === "number");
    assert.ok(c0 >= c1);
    assert.ok(c1 >= c2);
    assert.ok(c2 >= c3);
  });

  test("inputs digest contains all required fields", () => {
    const facts = createDerivedFacts();
    const request = createRequest();
    const result = generateProjection(request, facts);

    assert.strictEqual(result.snapshot.inputs.userId, "user-1");
    assert.ok(result.snapshot.inputs.asOf);
    assert.strictEqual(typeof result.snapshot.inputs.trainingWindowDays, "number");
    assert.strictEqual(typeof result.snapshot.inputs.nutritionWindowDays, "number");
    assert.strictEqual(typeof result.snapshot.inputs.bodyWindowDays, "number");
    assert.strictEqual(typeof result.snapshot.inputs.activityWindowDays, "number");
    assert.ok(result.snapshot.inputs.derivedFacts);
    assert.ok(result.snapshot.inputs.activeGoals);
    assert.ok(result.snapshot.inputs.activeInterventions);
  });

  test("assumptions include all categories", () => {
    const facts = createDerivedFacts();
    const request = createRequest();
    const result = generateProjection(request, facts);

    const assumptionCodes = result.snapshot.assumptions.map(a => a.code);
    assert.ok(assumptionCodes.includes("training_adherence"));
    assert.ok(assumptionCodes.includes("nutrition_adherence"));
    assert.ok(assumptionCodes.includes("strength_progression_rate"));
    assert.ok(assumptionCodes.includes("sleep_adequacy"));
    assert.ok(assumptionCodes.includes("body_composition_method"));
    assert.ok(assumptionCodes.includes("measurement_consistency"));
  });
});

// -----------------------------------------------------------------------------
// detectProjectionDivergences tests
// -----------------------------------------------------------------------------

describe("detectProjectionDivergences - divergence detection", () => {
  const createSnapshot = (metrics: Partial<ProjectionMetric>[]): ProjectionSnapshot => ({
    id: "snap-1",
    userId: "user-1",
    generatedAt: "2024-03-01" as CalendarDate,
    status: "current",
    inputs: {
      userId: "user-1",
      asOf: "2024-03-01" as CalendarDate,
      trainingWindowDays: 84,
      nutritionWindowDays: 28,
      bodyWindowDays: 84,
      activityWindowDays: 28,
      derivedFacts: {},
      activeGoals: {},
      activeInterventions: {},
    },
    assumptions: [],
    metrics: metrics as ProjectionMetric[],
    configVersion: "fitcoach.projection.v1",
    summary: "Test",
    warnings: [],
    createdAt: "2024-03-01T00:00:00Z",
    updatedAt: "2024-03-01T00:00:00Z",
  });

  test("detects divergence when actual differs from projected", () => {
    const snapshot = createSnapshot([
      {
        target: "body_weight_kg",
        horizon: "3_months",
        central: { value: 85, provenance: "estimated", confidence: "estimated" },
        low: { value: 83, provenance: "inferred", confidence: "estimated" },
        high: { value: 87, provenance: "inferred", confidence: "estimated" },
        method: "linear_trend_extrapolation",
        confidence: "estimated",
        basis: "test",
      },
    ]);

    const actualValues = new Map<ProjectionTarget, Map<ProjectionHorizon, number>>();
    actualValues.set("body_weight_kg", new Map([["3_months", 88]]));

    const result = detectProjectionDivergences({
      projectionSnapshot: snapshot,
      actualValues,
      significanceThresholdPercent: 5,
    });

    assert.strictEqual(result.divergences.length, 1);
    const div = result.divergences[0];
    assert.ok(div);
    assert.strictEqual(div.target, "body_weight_kg");
    assert.strictEqual(div.horizon, "3_months");
    assert.strictEqual(div.projectedCentral, 85);
    assert.strictEqual(div.actualValue, 88);
    assert.strictEqual(div.absoluteDifference, 3);
    assert.ok(div.relativeDifferencePercent > 0);
  });

  test("marks divergence as significant when exceeding threshold", () => {
    const snapshot = createSnapshot([
      {
        target: "body_weight_kg",
        horizon: "3_months",
        central: { value: 80, provenance: "estimated", confidence: "estimated" },
        low: { value: 78, provenance: "inferred", confidence: "estimated" },
        high: { value: 82, provenance: "inferred", confidence: "estimated" },
        method: "linear_trend_extrapolation",
        confidence: "estimated",
        basis: "test",
      },
    ]);

    const actualValues = new Map<ProjectionTarget, Map<ProjectionHorizon, number>>();
    actualValues.set("body_weight_kg", new Map([["3_months", 88]]));

    const result = detectProjectionDivergences({
      projectionSnapshot: snapshot,
      actualValues,
      significanceThresholdPercent: 5,
    });

    const div = result.divergences[0];
    assert.ok(div);
    assert.ok(div.significant);
  });

  test("does not mark divergence as significant when within threshold", () => {
    const snapshot = createSnapshot([
      {
        target: "body_weight_kg",
        horizon: "3_months",
        central: { value: 85, provenance: "estimated", confidence: "estimated" },
        low: { value: 83, provenance: "inferred", confidence: "estimated" },
        high: { value: 87, provenance: "inferred", confidence: "estimated" },
        method: "linear_trend_extrapolation",
        confidence: "estimated",
        basis: "test",
      },
    ]);

    const actualValues = new Map<ProjectionTarget, Map<ProjectionHorizon, number>>();
    actualValues.set("body_weight_kg", new Map([["3_months", 86]]));

    const result = detectProjectionDivergences({
      projectionSnapshot: snapshot,
      actualValues,
      significanceThresholdPercent: 5,
    });

    const div = result.divergences[0];
    assert.ok(div);
    assert.ok(!div.significant);
  });

  test("handles multiple targets and horizons", () => {
    const snapshot = createSnapshot([
      {
        target: "body_weight_kg",
        horizon: "3_months",
        central: { value: 85, provenance: "estimated", confidence: "estimated" },
        low: { value: 83, provenance: "inferred", confidence: "estimated" },
        high: { value: 87, provenance: "inferred", confidence: "estimated" },
        method: "linear_trend_extrapolation",
        confidence: "estimated",
        basis: "test",
      },
      {
        target: "body_fat_percent",
        horizon: "3_months",
        central: { value: 16, provenance: "estimated", confidence: "estimated" },
        low: { value: 14, provenance: "inferred", confidence: "estimated" },
        high: { value: 18, provenance: "inferred", confidence: "estimated" },
        method: "linear_trend_extrapolation",
        confidence: "estimated",
        basis: "test",
      },
      {
        target: "body_weight_kg",
        horizon: "6_months",
        central: { value: 87, provenance: "estimated", confidence: "estimated" },
        low: { value: 84, provenance: "inferred", confidence: "estimated" },
        high: { value: 90, provenance: "inferred", confidence: "estimated" },
        method: "linear_trend_extrapolation",
        confidence: "estimated",
        basis: "test",
      },
    ]);

    const actualValues = new Map<ProjectionTarget, Map<ProjectionHorizon, number>>();
    actualValues.set("body_weight_kg", new Map([
      ["3_months", 88],
      ["6_months", 90],
    ]));
    actualValues.set("body_fat_percent", new Map([["3_months", 18]]));

    const result = detectProjectionDivergences({
      projectionSnapshot: snapshot,
      actualValues,
      significanceThresholdPercent: 5,
    });

    assert.strictEqual(result.divergences.length, 3);
  });

  test("ignores metrics without actual values", () => {
    const snapshot = createSnapshot([
      {
        target: "body_weight_kg",
        horizon: "3_months",
        central: { value: 85, provenance: "estimated", confidence: "estimated" },
        low: { value: 83, provenance: "inferred", confidence: "estimated" },
        high: { value: 87, provenance: "inferred", confidence: "estimated" },
        method: "linear_trend_extrapolation",
        confidence: "estimated",
        basis: "test",
      },
      {
        target: "muscle_mass_kg",
        horizon: "3_months",
        central: { value: 40, provenance: "estimated", confidence: "estimated" },
        low: { value: 39, provenance: "inferred", confidence: "estimated" },
        high: { value: 41, provenance: "inferred", confidence: "estimated" },
        method: "linear_trend_extrapolation",
        confidence: "estimated",
        basis: "test",
      },
    ]);

    const actualValues = new Map<ProjectionTarget, Map<ProjectionHorizon, number>>();
    actualValues.set("body_weight_kg", new Map([["3_months", 86]]));

    const result = detectProjectionDivergences({
      projectionSnapshot: snapshot,
      actualValues,
      significanceThresholdPercent: 5,
    });

    assert.strictEqual(result.divergences.length, 1);
    const div = result.divergences[0];
    assert.ok(div);
    assert.strictEqual(div.target, "body_weight_kg");
  });

  test("handles zero projected value for relative difference", () => {
    const snapshot = createSnapshot([
      {
        target: "muscle_mass_kg",
        horizon: "3_months",
        central: { value: 0, provenance: "estimated", confidence: "estimated" },
        low: { value: 0, provenance: "inferred", confidence: "estimated" },
        high: { value: 1, provenance: "inferred", confidence: "estimated" },
        method: "linear_trend_extrapolation",
        confidence: "estimated",
        basis: "test",
      },
    ]);

    const actualValues = new Map<ProjectionTarget, Map<ProjectionHorizon, number>>();
    actualValues.set("muscle_mass_kg", new Map([["3_months", 1]]));

    const result = detectProjectionDivergences({
      projectionSnapshot: snapshot,
      actualValues,
      significanceThresholdPercent: 5,
    });

    const div = result.divergences[0];
    assert.ok(div);
    assert.strictEqual(div.relativeDifferencePercent, 100);
    assert.ok(div.significant);
  });
});

// -----------------------------------------------------------------------------
// supersedeProjection tests
// -----------------------------------------------------------------------------

describe("supersedeProjection - snapshot supersession", () => {
  const createSnapshot = (status: "current" | "superseded" = "current", id = "snap-1"): ProjectionSnapshot => ({
    id,
    userId: "user-1",
    generatedAt: "2024-03-01" as CalendarDate,
    status,
    inputs: {
      userId: "user-1",
      asOf: "2024-03-01" as CalendarDate,
      trainingWindowDays: 84,
      nutritionWindowDays: 28,
      bodyWindowDays: 84,
      activityWindowDays: 28,
      derivedFacts: {},
      activeGoals: {},
      activeInterventions: {},
    },
    assumptions: [],
    metrics: [],
    configVersion: "fitcoach.projection.v1",
    summary: "Test",
    warnings: [],
    createdAt: "2024-03-01T00:00:00Z",
    updatedAt: "2024-03-01T00:00:00Z",
  });

  test("creates new snapshot with supersedesId pointing to previous", () => {
    const previous = createSnapshot("current", "snap-1");
    const newSnap = createSnapshot("current", "snap-2");

    const result = supersedeProjection(previous, newSnap);

    assert.strictEqual(result.newSnapshot.id, "snap-2");
    assert.strictEqual(result.newSnapshot.supersedesId, "snap-1");
    assert.strictEqual(result.newSnapshot.status, "current");
  });

  test("marks previous snapshot as superseded", () => {
    const previous = createSnapshot("current", "snap-1");
    const newSnap = createSnapshot("current", "snap-2");

    const result = supersedeProjection(previous, newSnap);

    assert.strictEqual(result.previousSnapshot.id, "snap-1");
    assert.strictEqual(result.previousSnapshot.status, "superseded");
  });

  test("preserves previous snapshot data", () => {
    const previous = createSnapshot("current", "snap-1");
    previous.summary = "Original summary";
    const newSnap = createSnapshot("current", "snap-2");

    const result = supersedeProjection(previous, newSnap);

    assert.strictEqual(result.previousSnapshot.summary, "Original summary");
    assert.strictEqual(result.previousSnapshot.id, "snap-1");
  });

  test("preserves new snapshot data", () => {
    const previous = createSnapshot("current", "snap-1");
    const newSnap = createSnapshot("current", "snap-2");
    newSnap.summary = "New summary with updated data";

    const result = supersedeProjection(previous, newSnap);

    assert.strictEqual(result.newSnapshot.summary, "New summary with updated data");
    assert.strictEqual(result.newSnapshot.id, "snap-2");
  });
});

// -----------------------------------------------------------------------------
// Configuration tests
// -----------------------------------------------------------------------------

describe("DEFAULT_PROJECTION_CONFIGURATION", () => {
  test("has sensible defaults", () => {
    const config = DEFAULT_PROJECTION_CONFIGURATION;

    assert.strictEqual(config.minTrendPoints, 7);
    assert.strictEqual(config.defaultAdherence, 0.85);
    assert.strictEqual(config.defaultProgressionRatePerWeek, 0.015);
    assert.strictEqual(config.maxStandardHorizonMonths, 12);
    assert.strictEqual(config.weightTrendAlpha, 0.3);
    assert.strictEqual(config.measurementTrendAlpha, 0.25);
    assert.strictEqual(config.strengthModel, "diminishing");
    assert.strictEqual(config.confidenceDecayPerMonth, 0.15);
    assert.strictEqual(config.minConfidence, "unknown");
  });

  test("can be overridden", () => {
    const customConfig: ProjectionConfiguration = {
      ...DEFAULT_PROJECTION_CONFIGURATION,
      minTrendPoints: 14,
      defaultAdherence: 0.95,
      strengthModel: "linear",
    };

    assert.strictEqual(customConfig.minTrendPoints, 14);
    assert.strictEqual(customConfig.defaultAdherence, 0.95);
    assert.strictEqual(customConfig.strengthModel, "linear");
  });
});