import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  evaluateContextQuality,
  evaluateEvidenceQuality,
  evidenceQualityToSourceSnapshot,
  isStaleBeyond,
  DEFAULT_STALENESS_THRESHOLDS,
  DEFAULT_EVIDENCE_EVALUATION_CONFIG,
} from "../evidence";

describe("evidence quality evaluation", () => {
  test("evaluateEvidenceQuality returns correct structure", () => {
    const result = evaluateEvidenceQuality({
      source: "training_state",
      code: "plateau_signal",
      title: "Bench press stalled",
      observedAt: "2026-10-01T00:00:00.000Z",
      provenance: "measured",
      confidence: "measured",
      sampleSize: 5,
      missingFields: [],
      asOf: new Date("2026-10-06T00:00:00.000Z"),
    });

    assert.equal(result.source, "training_state");
    assert.equal(result.code, "plateau_signal");
    assert.equal(result.title, "Bench press stalled");
    assert.equal(result.confidence, "measured");
    assert.equal(result.provenance, "measured");
    assert.equal(result.stalenessDays, 5);
    assert.equal(result.isStale, false); // 5 days <= 7 day threshold
    assert.equal(result.completenessPercent, 100);
    assert.equal(result.isNoisy, false);
  });

  test("evaluateEvidenceQuality detects staleness", () => {
    const result = evaluateEvidenceQuality({
      source: "nutrition_state",
      code: "protein_intake",
      title: "Protein intake",
      observedAt: "2026-10-01T00:00:00.000Z",
      provenance: "measured",
      confidence: "estimated",
      asOf: new Date("2026-10-10T00:00:00.000Z"),
    });

    // 9 days > 3 day threshold for nutrition
    assert.equal(result.stalenessDays, 9);
    assert.equal(result.isStale, true);
    assert.ok(result.warnings.some((w) => w.includes("staleness")));
  });

  test("evaluateEvidenceQuality detects missing fields", () => {
    const result = evaluateEvidenceQuality({
      source: "body_state",
      code: "weight_trend",
      title: "Weight trend",
      observedAt: "2026-10-06T00:00:00.000Z",
      provenance: "measured",
      confidence: "measured",
      missingFields: ["bodyFatPercent", "circumferencesCm"],
      asOf: new Date("2026-10-06T00:00:00.000Z"),
    });

    assert.equal(result.completenessPercent, 60); // 100 - 2*20
    assert.equal(result.missingFields.length, 2);
    assert.ok(result.warnings.some((w) => w.includes("Missing fields")));
  });

  test("evaluateEvidenceQuality detects noisy evidence", () => {
    const result = evaluateEvidenceQuality({
      source: "training_state",
      code: "progression",
      title: "Progression",
      observedAt: "2026-10-06T00:00:00.000Z",
      provenance: "measured",
      confidence: "measured",
      sampleSize: 1,
      asOf: new Date("2026-10-06T00:00:00.000Z"),
    });

    assert.equal(result.isNoisy, true);
    assert.ok(result.warnings.some((w) => w.includes("sample size")));
  });

  test("isStaleBeyond returns correct result", () => {
    const recent = isStaleBeyond("2026-10-05T00:00:00.000Z", 7, new Date("2026-10-06T00:00:00.000Z"));
    assert.equal(recent.isStale, false);
    assert.equal(recent.stalenessDays, 1);

    const stale = isStaleBeyond("2026-09-20T00:00:00.000Z", 7, new Date("2026-10-06T00:00:00.000Z"));
    assert.equal(stale.isStale, true);
    assert.equal(stale.stalenessDays, 16);
  });

  test("isStaleBeyond handles undefined observedAt", () => {
    const result = isStaleBeyond(undefined, 7, new Date("2026-10-06T00:00:00.000Z"));
    assert.equal(result.isStale, true);
    assert.equal(result.stalenessDays, Number.POSITIVE_INFINITY);
  });

  test("evaluateContextQuality computes overall score", () => {
    const quality = evaluateContextQuality([
      {
        source: "training_state",
        label: "Training Plans & Workouts",
        lastObservedAt: "2026-10-06T00:00:00.000Z",
        stalenessDays: 0,
        isStale: false,
        completenessPercent: 100,
        confidence: "measured",
        missingFields: [],
        warnings: [],
      },
      {
        source: "nutrition_state",
        label: "Nutrition & Meals",
        lastObservedAt: "2026-10-03T00:00:00.000Z",
        stalenessDays: 3,
        isStale: false, // 3 <= 3 day threshold
        completenessPercent: 80,
        confidence: "estimated",
        missingFields: ["targets"],
        warnings: ["Missing fields: targets"],
      },
    ]);

    assert.ok(quality.overallScore > 0);
    assert.ok(quality.overallScore <= 100);
    assert.equal(quality.sources.length, 2);
    assert.ok(Array.isArray(quality.missingDataWarnings));
    assert.ok(Array.isArray(quality.staleDataWarnings));
    assert.ok(Array.isArray(quality.recommendedFollowUpQuestions));
    assert.ok(typeof quality.sufficientForAdvice === "boolean");
  });

  test("evaluateContextQuality with no sources returns zero score", () => {
    const quality = evaluateContextQuality([]);
    assert.equal(quality.overallScore, 0);
    assert.equal(quality.sufficientForAdvice, false);
  });

  test("evaluateContextQuality flags stale data", () => {
    const quality = evaluateContextQuality([
      {
        source: "body_state",
        label: "Body Measurements & Physique",
        lastObservedAt: "2026-09-01T00:00:00.000Z",
        stalenessDays: 35,
        isStale: true,
        completenessPercent: 100,
        confidence: "measured",
        missingFields: [],
        warnings: ["Data is 35 days old"],
      },
    ]);

    assert.ok(quality.staleDataWarnings.length > 0);
    assert.ok(quality.staleDataWarnings.some((w) => w.includes("Body Measurements")));
  });

  test("evaluateContextQuality flags missing data", () => {
    const quality = evaluateContextQuality([
      {
        source: "nutrition_state",
        label: "Nutrition & Meals",
        lastObservedAt: "2026-10-06T00:00:00.000Z",
        stalenessDays: 0,
        isStale: false,
        completenessPercent: 20,
        confidence: "estimated",
        missingFields: ["targets", "trends"],
        warnings: ["Missing fields: targets, trends"],
      },
    ]);

    assert.ok(quality.missingDataWarnings.length > 0);
    assert.ok(quality.missingDataWarnings.some((w) => w.includes("Nutrition")));
  });

  test("evidenceQualityToSourceSnapshot converts correctly", () => {
    const eq = evaluateEvidenceQuality({
      source: "recovery_state",
      code: "readiness_score",
      title: "Readiness",
      observedAt: "2026-10-05T00:00:00.000Z",
      provenance: "measured",
      confidence: "measured",
      sampleSize: 14,
      asOf: new Date("2026-10-06T00:00:00.000Z"),
    });

    const snapshot = evidenceQualityToSourceSnapshot(eq, "Sleep & Recovery");
    assert.equal(snapshot.source, "recovery_state");
    assert.equal(snapshot.label, "Sleep & Recovery");
    assert.equal(snapshot.stalenessDays, 1);
    assert.equal(snapshot.isStale, false);
    assert.equal(snapshot.completenessPercent, 100);
  });

  test("DEFAULT_STALENESS_THRESHOLDS has expected values", () => {
    assert.equal(DEFAULT_STALENESS_THRESHOLDS.training_state, 7);
    assert.equal(DEFAULT_STALENESS_THRESHOLDS.nutrition_state, 3);
    assert.equal(DEFAULT_STALENESS_THRESHOLDS.activity_state, 7);
    assert.equal(DEFAULT_STALENESS_THRESHOLDS.recovery_state, 2);
    assert.equal(DEFAULT_STALENESS_THRESHOLDS.body_state, 28);
    assert.equal(DEFAULT_STALENESS_THRESHOLDS.projection_state, 30);
    assert.equal(DEFAULT_STALENESS_THRESHOLDS.decision_state, 14);
  });

  test("DEFAULT_EVIDENCE_EVALUATION_CONFIG has expected values", () => {
    assert.equal(DEFAULT_EVIDENCE_EVALUATION_CONFIG.minSampleSizeForConfidence, 3);
    assert.equal(DEFAULT_EVIDENCE_EVALUATION_CONFIG.maxStalenessForHighConfidence, 7);
  });
});
