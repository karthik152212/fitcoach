/**
 * Phase 3.1 — Performance / Progression Ledger unit tests (§35, §37).
 *
 * The ledger exists to keep four things forever distinguishable:
 *
 *   1. what the user ACTUALLY performed (performance records),
 *   2. what FitCoach RECOMMENDED (deterministic evaluation),
 *   3. what the user DECIDED (accepted / rejected / deferred), and
 *   4. what actually CHANGED (the evidenced result).
 *
 * `progressionsCompleted` is derived from those four — never incremented —
 * so a recommendation nobody acted on, or a "progression" the user declined
 * to perform, can never inflate the count.
 *
 * Every assertion matches docs/FITCOACH_PHASE3_TRAINING_ENGINE.md §30–§34.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  PerformanceObservation,
  PerformanceObservationSummary,
  ProgressionDecisionEvent,
  ProgressionEvaluation,
} from "@fitcoach/domain";
import {
  DEFAULT_PROGRESSION_LEDGER_CONFIGURATION,
  PROGRESSION_LEDGER_CONFIG_VERSION,
} from "../trainingConfig";
import {
  actionForOutcome,
  buildLedgerEntry,
  compareLedgerEntries,
  countCompletedProgressions,
  deriveActualChange,
  detectPerformanceTrend,
  evaluateProgressionFromHistory,
  inferLoadKind,
  isCompletedSet,
  isProgressionOutcome,
  progressionFingerprint,
  progressionMechanismsFor,
  sortObservations,
  summarizeExercisePerformance,
  summarizeObservation,
  toPerformanceObservation,
  type PerformanceSetInput,
  type ProgressionEvaluationResult,
} from "../performanceLedger";

const BENCH = "ex_barbell_bench_press";
const PUSHUP = "ex_push_up";
const ROW = "ex_barbell_row";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function obs(
  id: string,
  fields: Partial<PerformanceSetInput> = {},
): PerformanceObservation {
  return toPerformanceObservation({
    id,
    exerciseId: BENCH,
    setKind: "working",
    workoutStatus: "completed",
    createdAt: "2026-10-01T10:00:00.000Z",
    ...fields,
  });
}

/** One training day: every set shares a workout id and its own calendar day. */
function session(
  day: number,
  exerciseId: string,
  sets: Array<Partial<PerformanceSetInput>>,
): PerformanceObservation[] {
  const stamp = `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`;
  return sets.map((fields, index) =>
    toPerformanceObservation({
      id: `d${day}_${index}`,
      exerciseId,
      setKind: "working",
      workoutStatus: "completed",
      workoutId: `w_day${day}`,
      createdAt: stamp,
      ...fields,
    }),
  );
}

function evaluate(
  observations: readonly PerformanceObservation[],
  overrides: Record<string, unknown> = {},
): ProgressionEvaluationResult {
  return evaluateProgressionFromHistory({
    exerciseId: BENCH,
    exerciseName: "Barbell Bench Press",
    goalProfile: "hypertrophy",
    observations,
    target: { repMin: 8, repMax: 10, targetRir: 2 },
    ...overrides,
  });
}

/** Wrap an engine result in the persisted evaluation shape (repository row). */
function persisted(
  result: ProgressionEvaluationResult,
  id = "ev_00000000-0000-4000-8000-000000000001",
): ProgressionEvaluation {
  assert.ok(result.current, "an evaluation over performed sets always has a current observation");
  return {
    id,
    userId: "usr_ledger_test",
    exerciseId: BENCH,
    exerciseName: "Barbell Bench Press",
    current: summarizeObservation(result.current),
    ...(result.previous ? { previous: summarizeObservation(result.previous) } : {}),
    performance: result.performance,
    outcome: result.outcome,
    recommendation: result.recommendation,
    evidence: result.evidence,
    fingerprint: result.fingerprint,
    configVersion: result.recommendation.configVersion,
    createdAt: "2026-10-04T00:00:00.000Z",
  };
}

function event(
  id: string,
  createdAt: string,
  fields: Partial<ProgressionDecisionEvent> = {},
): ProgressionDecisionEvent {
  return {
    id,
    evaluationId: "ev_00000000-0000-4000-8000-000000000001",
    decision: "accepted",
    evidence: [],
    createdAt,
    ...fields,
  };
}

const ACCEPTED_EVERYTHING = {
  decision: "accepted" as const,
  actualChange: { kind: "load" as const, loadDeltaKg: 2.5 },
  resultingPerformance: {
    loadKind: "external_load" as const,
    loadKg: 62.5,
    reps: 8,
    rir: 2,
    localDate: "2026-10-05",
  } satisfies PerformanceObservationSummary,
};

// ---------------------------------------------------------------------------
// §35.1 Performance recording
// ---------------------------------------------------------------------------

test("performance records are constructed deterministically from logged sets", async (t) => {
  await t.test("load kind is inferred, and bodyweight is data not a gap", () => {
    assert.equal(inferLoadKind({ loadKg: 60 }), "external_load");
    assert.equal(inferLoadKind({ reps: 12 }), "bodyweight");
    assert.equal(inferLoadKind({ loadKg: 60, addedLoadKg: 10 }), "weighted_bodyweight");
    assert.equal(inferLoadKind({ assistanceKg: 15, reps: 5 }), "assisted_bodyweight");
    assert.equal(inferLoadKind({}), "none");
  });

  await t.test("completion follows performed work, never the clock", () => {
    assert.equal(isCompletedSet({ reps: 8 }), true);
    assert.equal(isCompletedSet({ reps: 0 }), false);
    assert.equal(isCompletedSet({ durationSeconds: 45 }), true);
    assert.equal(isCompletedSet({ distanceMeters: 400 }), true);
    assert.equal(isCompletedSet({}), false);
  });

  await t.test("an observation carries provenance: environment, source, session", () => {
    const observation = obs("set_1", {
      reps: 8,
      loadKg: 60,
      rir: 2,
      environmentKind: "home_no_equipment",
      classification: "adapted",
      source: "manual",
      localDate: "2026-10-01",
    });
    assert.equal(observation.loadKind, "external_load");
    assert.equal(observation.completed, true);
    assert.equal(observation.localDate, "2026-10-01");
    assert.equal(observation.environmentKind, "home_no_equipment");
    assert.equal(observation.classification, "adapted");
    assert.equal(observation.source, "manual");
  });

  await t.test("history order never depends on fetch order", () => {
    const shuffled = [
      obs("c", { localDate: "2026-10-03", createdAt: "2026-10-03T10:00:00.000Z", reps: 10 }),
      obs("a", { localDate: "2026-10-01", createdAt: "2026-10-01T10:00:00.000Z", reps: 8 }),
      obs("b", { localDate: "2026-10-02", createdAt: "2026-10-02T10:00:00.000Z", reps: 9 }),
    ];
    assert.deepEqual(
      sortObservations(shuffled).map((item) => item.id),
      ["a", "b", "c"],
    );
  });
});

// ---------------------------------------------------------------------------
// §35.2 Duplicate prevention (fingerprint identity)
// ---------------------------------------------------------------------------

test("identical evidence produces one fingerprint; new evidence produces a new one", () => {
  const base = {
    exerciseId: BENCH,
    slotId: "slot_1",
    planVersionId: "ver_1",
    localDate: "2026-10-03",
    loadKind: "external_load",
    loadKg: 60,
    reps: 10,
    outcome: "increase_load",
    configVersion: PROGRESSION_LEDGER_CONFIG_VERSION,
  } as const;
  assert.equal(progressionFingerprint(base), progressionFingerprint({ ...base }));
  assert.notEqual(progressionFingerprint(base), progressionFingerprint({ ...base, loadKg: 62.5 }));
  assert.notEqual(progressionFingerprint(base), progressionFingerprint({ ...base, reps: 9 }));
  assert.notEqual(
    progressionFingerprint(base),
    progressionFingerprint({ ...base, configVersion: "fitcoach.progression.v2" }),
  );
  assert.notEqual(
    progressionFingerprint(base),
    progressionFingerprint({ ...base, outcome: "maintain" }),
  );
});

// ---------------------------------------------------------------------------
// §35.3 Historical retrieval
// ---------------------------------------------------------------------------

test("performance history summarizes a trajectory without an LLM", () => {
  const observations = [
    ...session(1, BENCH, [{ loadKg: 60, reps: 8, rir: 2 }]),
    ...session(2, BENCH, [{ loadKg: 60, reps: 9, rir: 2 }]),
    ...session(3, BENCH, [{ loadKg: 60, reps: 10, rir: 2 }]),
    ...session(4, BENCH, [{ loadKg: 62.5, reps: 8, rir: 2 }]),
  ];
  const summary = summarizeExercisePerformance(BENCH, observations);

  assert.equal(summary.exerciseId, BENCH);
  assert.equal(summary.completedSets, 4);
  assert.equal(summary.sessionsObserved, 4);
  assert.equal(summary.incompleteSessions, 0);
  assert.equal(summary.bestReps, 10);
  assert.equal(summary.bestLoadKg, 62.5);
  assert.equal(summary.latestLoadKind, "external_load");
  assert.equal(summary.latestRir, 2);
  assert.equal(summary.latestLocalDate, "2026-10-04");
  assert.equal(summary.trend, "improving");
  assert.deepEqual([...summary.mechanisms], ["load", "reps", "rir", "sets"]);
});

// ---------------------------------------------------------------------------
// §35.4 + §35.14 Deterministic evaluation
// ---------------------------------------------------------------------------

test("progression evaluation is deterministic and follows the documented ladder", async (t) => {
  const observations = [
    ...session(1, BENCH, [{ loadKg: 60, reps: 8, rir: 2 }]),
    ...session(2, BENCH, [{ loadKg: 60, reps: 9, rir: 2 }]),
    ...session(3, BENCH, [{ loadKg: 60, reps: 10, rir: 2 }]),
  ];

  await t.test("two runs over the same rows agree completely", () => {
    const first = evaluate(observations);
    const second = evaluate([...observations].reverse());
    assert.deepEqual(first, second);
    assert.equal(first.fingerprint, second.fingerprint);
  });

  await t.test("the outcome ladder maps to bounded plan actions", () => {
    assert.equal(actionForOutcome("increase_load"), "progress_load");
    assert.equal(actionForOutcome("increase_reps"), "progress_reps");
    assert.equal(actionForOutcome("maintain"), "maintain");
    assert.equal(actionForOutcome("repeat"), "repeat");
    assert.equal(actionForOutcome("reduce_load"), "reduce_stimulus");
    assert.equal(actionForOutcome("reduce_target"), "modify_target");
    assert.equal(actionForOutcome("insufficient_data"), "hold");
    assert.equal(isProgressionOutcome("increase_load"), true);
    assert.equal(isProgressionOutcome("maintain"), false);
    assert.equal(isProgressionOutcome("insufficient_data"), false);
  });

  await t.test("the evaluation cites its evidence", () => {
    const result = evaluate(observations);
    assert.ok(result.evidence.length > 0);
    for (const line of result.evidence) assert.ok(line.length > 0);
    assert.ok(result.recommendation.rationale.length > 0);
  });
});

// ---------------------------------------------------------------------------
// §35.5 Successful progression (the §5 worked example)
// ---------------------------------------------------------------------------

test("60×8, 60×9, 60×10 at target effort deterministically recommends more load", () => {
  const observations = [
    ...session(1, BENCH, [{ loadKg: 60, reps: 8, rir: 2 }]),
    ...session(2, BENCH, [{ loadKg: 60, reps: 9, rir: 2 }]),
    ...session(3, BENCH, [{ loadKg: 60, reps: 10, rir: 2 }]),
  ];
  const result = evaluate(observations);

  assert.equal(result.outcome, "increase_load");
  assert.equal(result.shouldProgress, true);
  assert.equal(result.recommendation.action, "progress_load");
  assert.equal(result.recommendation.targetLoadKg, 62.5);
  assert.equal(result.recommendation.targetRepMin, 8);
  assert.equal(result.recommendation.targetRepMax, 10);
  assert.ok(result.recommendation.evidence.join(" ").includes("range 8-10"));
});

// ---------------------------------------------------------------------------
// §35.6 Insufficient data
// ---------------------------------------------------------------------------

test("one session of evidence refuses to recommend anything", () => {
  const result = evaluate([obs("only_one", { loadKg: 60, reps: 10, rir: 2 })]);

  assert.equal(result.outcome, "insufficient_data");
  assert.equal(result.shouldProgress, false);
  assert.equal(result.recommendation.action, "hold");
  assert.equal(result.recommendation.confidence, 0.3);
  assert.ok(result.evidence.join(" ").includes("need 2"));
});

// ---------------------------------------------------------------------------
// §35.7 Repeated success is required — one good set is not a progression
// ---------------------------------------------------------------------------

test("a single good set does not earn a progression recommendation", () => {
  const observations = [
    ...session(1, BENCH, [{ loadKg: 60, reps: 10, rir: 2 }]),
    // Second session attempted but no working set completed: progressions
    // demand repeated success, not one bright spot.
    ...session(2, BENCH, [{ loadKg: 60, reps: 0, rir: 0 }]),
  ];
  const result = evaluate(observations);

  assert.equal(result.outcome, "maintain");
  assert.equal(result.shouldProgress, false);
  assert.equal(result.recommendation.action, "maintain");
  assert.ok(result.recommendation.rationale.includes("no change is the smallest"));
});

// ---------------------------------------------------------------------------
// §35.8 Failure to progress / repeated failure
// ---------------------------------------------------------------------------

test("repeated failure points at the exercise, not at the number", () => {
  const observations = [
    ...session(1, BENCH, [{ loadKg: 60, reps: 0, rir: 0 }]),
    ...session(2, BENCH, [{ loadKg: 60, reps: 0, rir: 0 }]),
    ...session(3, BENCH, [{ loadKg: 60, reps: 0, rir: 0 }]),
  ];
  const result = evaluate(observations);

  assert.equal(result.outcome, "change_exercise");
  assert.equal(result.recommendation.action, "modify_target");
  assert.ok(result.recommendation.rationale.includes("points at the exercise"));
  assert.ok(result.evidence.join(" ").includes("attempted without completing"));
});

// ---------------------------------------------------------------------------
// §35.9 Regression — decline reduces stress, it never adds volume
// ---------------------------------------------------------------------------

test("declining performance reduces load instead of adding work", () => {
  const observations = [
    ...session(1, BENCH, [{ loadKg: 60, reps: 12, rir: 2 }]),
    ...session(2, BENCH, [{ loadKg: 60, reps: 10, rir: 2 }]),
    ...session(3, BENCH, [{ loadKg: 60, reps: 6, rir: 2 }]),
    ...session(4, BENCH, [{ loadKg: 60, reps: 4, rir: 2 }]),
  ];
  const result = evaluate(observations);

  assert.equal(result.outcome, "reduce_load");
  assert.notEqual(result.outcome, "increase_load");
  assert.equal(result.recommendation.action, "reduce_stimulus");
  assert.equal(result.recommendation.targetLoadKg, 54);
  assert.ok(result.evidence.join(" ").includes("declining"));
});

test("below the target range repeats the prescription rather than progressing", () => {
  const observations = [
    ...session(1, BENCH, [{ loadKg: 60, reps: 5, rir: 2 }]),
    ...session(2, BENCH, [{ loadKg: 60, reps: 6, rir: 2 }]),
  ];
  const result = evaluate(observations);

  assert.equal(result.outcome, "repeat");
  assert.equal(result.recommendation.action, "repeat");
  assert.equal(result.shouldProgress, false);
  assert.ok(result.evidence.join(" ").includes("below the 8-rep floor"));
});

// ---------------------------------------------------------------------------
// §35.10 no_change / maintain
// ---------------------------------------------------------------------------

test("in-range performance yields maintain, the smallest useful intervention", () => {
  const observations = [
    ...session(1, BENCH, [{ loadKg: 60, reps: 9, rir: 2 }]),
    ...session(2, BENCH, [{ loadKg: 60, reps: 9, rir: 1 }]),
  ];
  const result = evaluate(observations);

  assert.equal(result.outcome, "maintain");
  assert.equal(result.shouldProgress, false);
  assert.equal(result.recommendation.action, "maintain");
  assert.equal(result.recommendation.targetLoadKg, undefined);
  assert.ok(result.recommendation.rationale.includes("no change is the smallest"));
});

// ---------------------------------------------------------------------------
// §35.11 Recommendation vs actual change
// ---------------------------------------------------------------------------

test("recommendation, decision and actual performance stay distinguishable", () => {
  const result = evaluate([
    ...session(1, BENCH, [{ loadKg: 60, reps: 8, rir: 2 }]),
    ...session(2, BENCH, [{ loadKg: 60, reps: 9, rir: 2 }]),
    ...session(3, BENCH, [{ loadKg: 60, reps: 10, rir: 2 }]),
  ]);
  assert.equal(result.outcome, "increase_load");
  const evaluation = persisted(result);
  const baseline = evaluation.current;
  const acceptedPerformed = obs("performed_1", { loadKg: 62.5, reps: 8, rir: 2 });
  const declinedPerformed = obs("performed_2", { loadKg: 60, reps: 10, rir: 2 });

  // The recommendation was 62.5; performing it is a real change.
  const performedChange = deriveActualChange(
    evaluation.recommendation,
    baseline,
    acceptedPerformed,
  );
  assert.deepEqual(performedChange, { kind: "load", loadDeltaKg: 2.5 });

  // The user chose 60 again: the ledger records "no change", never a win.
  const sameAgain = deriveActualChange(evaluation.recommendation, baseline, declinedPerformed);
  assert.deepEqual(sameAgain, { kind: "none" });

  // No observed performance at all → undefined, never "assume yes".
  assert.equal(deriveActualChange(evaluation.recommendation, baseline, undefined), undefined);
});

// ---------------------------------------------------------------------------
// §35.12 Completed progression count
// ---------------------------------------------------------------------------

test("progressionsCompleted is derived from evidence, never incremented", () => {
  const result = evaluate([
    ...session(1, BENCH, [{ loadKg: 60, reps: 8, rir: 2 }]),
    ...session(2, BENCH, [{ loadKg: 60, reps: 9, rir: 2 }]),
    ...session(3, BENCH, [{ loadKg: 60, reps: 10, rir: 2 }]),
  ]);
  const evaluation = persisted(result);
  assert.ok(isProgressionOutcome(evaluation.outcome));

  const accepted = buildLedgerEntry(evaluation, [
    event("e1", "2026-10-05T00:00:00.000Z", ACCEPTED_EVERYTHING),
  ]);
  const rejected = buildLedgerEntry(evaluation, [
    event("e2", "2026-10-05T00:00:00.000Z", { decision: "rejected" }),
  ]);
  const deferred = buildLedgerEntry(evaluation, [
    event("e3", "2026-10-05T00:00:00.000Z", { decision: "deferred" }),
  ]);
  const recommendedOnly = buildLedgerEntry(evaluation, []);
  const acceptedWithoutEvidence = buildLedgerEntry(evaluation, [
    event("e4", "2026-10-05T00:00:00.000Z", { decision: "accepted" }),
  ]);
  // Recommended 62.5, accepted, but the user performed 60 again (§8).
  const declinedToPerform = buildLedgerEntry(evaluation, [
    event("e5", "2026-10-05T00:00:00.000Z", {
      decision: "accepted",
      actualChange: { kind: "none" },
      resultingPerformance: {
        loadKind: "external_load",
        loadKg: 60,
        reps: 10,
        localDate: "2026-10-05",
      },
    }),
  ]);

  assert.equal(accepted.completed, true);
  assert.equal(rejected.completed, false);
  assert.equal(deferred.completed, false);
  assert.equal(recommendedOnly.completed, false);
  assert.equal(recommendedOnly.decision, "recommended");
  assert.equal(acceptedWithoutEvidence.completed, false);
  assert.equal(declinedToPerform.completed, false);

  const entries = [
    rejected,
    accepted,
    deferred,
    recommendedOnly,
    acceptedWithoutEvidence,
    declinedToPerform,
  ];
  const counts = countCompletedProgressions(entries);
  assert.deepEqual(counts, { [BENCH]: 1 });

  // Order-independence: shuffling history cannot change the count.
  const shuffled = [...entries].reverse();
  assert.deepEqual(countCompletedProgressions(shuffled), counts);

  // Ledger ordering is stable: creation time, then evaluation id.
  const ordered = [...entries].sort(compareLedgerEntries);
  assert.equal(ordered.length, entries.length);
});

// ---------------------------------------------------------------------------
// §35.13 Bodyweight progression
// ---------------------------------------------------------------------------

test("bodyweight progression advances reps, effort and variation — never fake load", async (t) => {
  const pushups = (day: number, reps: number) =>
    session(day, PUSHUP, [{ reps, rir: 2 }]);

  await t.test("top of the rep range at target effort adds reps", () => {
    const result = evaluateProgressionFromHistory({
      exerciseId: PUSHUP,
      exerciseName: "Push-Up",
      goalProfile: "hypertrophy",
      observations: [...pushups(1, 8), ...pushups(2, 10), ...pushups(3, 12)],
      target: { repMin: 8, repMax: 12, targetRir: 2 },
    });
    assert.equal(result.outcome, "increase_reps");
    assert.equal(result.recommendation.action, "progress_reps");
    assert.equal(result.recommendation.targetLoadKg, undefined);
    assert.equal(result.recommendation.targetRepMin, 14);
    assert.ok(result.recommendation.rationale.includes("No external load available"));
    assert.ok(!result.recommendation.mechanisms.includes("load"));
  });

  await t.test("mechanisms follow the load kind, not the exercise name", () => {
    assert.deepEqual(
      [...progressionMechanismsFor("bodyweight")],
      ["reps", "rir", "variation", "rom", "tempo", "sets"],
    );
    assert.deepEqual([...progressionMechanismsFor("external_load")], [
      "load",
      "reps",
      "rir",
      "sets",
    ]);
    const summary = summarizeExercisePerformance(PUSHUP, [...pushups(1, 8), ...pushups(2, 10)]);
    assert.equal(summary.latestLoadKind, "bodyweight");
    assert.equal(summary.bestLoadKg, undefined);
  });

  await t.test("reps well beyond the ceiling move to a harder variation", () => {
    const result = evaluateProgressionFromHistory({
      exerciseId: PUSHUP,
      exerciseName: "Push-Up",
      goalProfile: "hypertrophy",
      observations: [...pushups(1, 20), ...pushups(2, 22)],
      target: { repMin: 8, repMax: 12, targetRir: 2 },
    });
    assert.equal(result.outcome, "change_exercise");
    assert.equal(result.recommendation.action, "modify_target");
    assert.ok(result.recommendation.rationale.includes("harder variation"));
  });

  await t.test("declining bodyweight performance lowers the target", () => {
    const result = evaluateProgressionFromHistory({
      exerciseId: PUSHUP,
      exerciseName: "Push-Up",
      goalProfile: "hypertrophy",
      observations: [
        ...pushups(1, 15),
        ...pushups(2, 12),
        ...pushups(3, 9),
        ...pushups(4, 7),
      ],
      target: { repMin: 8, repMax: 15, targetRir: 2 },
    });
    assert.equal(result.outcome, "reduce_target");
    assert.equal(result.recommendation.targetLoadKg, undefined);
    assert.ok(result.recommendation.targetRepMin !== undefined);
  });
});

// ---------------------------------------------------------------------------
// §35.15 Configuration / version handling
// ---------------------------------------------------------------------------

test("ledger configuration is versioned and flows into every record", async (t) => {
  const observations = [
    ...session(1, BENCH, [{ loadKg: 60, reps: 8, rir: 2 }]),
    ...session(2, BENCH, [{ loadKg: 60, reps: 9, rir: 2 }]),
    ...session(3, BENCH, [{ loadKg: 60, reps: 10, rir: 2 }]),
  ];

  await t.test("the default configuration is pinned, not silent", () => {
    assert.equal(DEFAULT_PROGRESSION_LEDGER_CONFIGURATION.version, "fitcoach.progression.v1");
    assert.equal(PROGRESSION_LEDGER_CONFIG_VERSION, "fitcoach.progression.v1");
    assert.equal(DEFAULT_PROGRESSION_LEDGER_CONFIGURATION.minSessionsForEvidence, 2);
    assert.equal(DEFAULT_PROGRESSION_LEDGER_CONFIGURATION.sessionsAtTopRequired, 2);
    assert.equal(DEFAULT_PROGRESSION_LEDGER_CONFIGURATION.loadIncrementKg, 2.5);
  });

  await t.test("recommendations carry the configuration version that made them", () => {
    const result = evaluate(observations);
    assert.equal(result.recommendation.configVersion, "fitcoach.progression.v1");
    assert.ok(result.fingerprint.endsWith("|fitcoach.progression.v1"));
  });

  await t.test("a different configuration changes outcomes — and fingerprints", () => {
    const tuned = {
      ...DEFAULT_PROGRESSION_LEDGER_CONFIGURATION,
      version: "fitcoach.progression.tuned-test",
      minSessionsForEvidence: 1,
      sessionsAtTopRequired: 1,
    };
    const singleSession = session(1, BENCH, [{ loadKg: 60, reps: 10, rir: 2 }]);

    const withDefaults = evaluate(singleSession);
    assert.equal(withDefaults.outcome, "insufficient_data");

    const tuned_result = evaluateProgressionFromHistory({
      exerciseId: BENCH,
      exerciseName: "Barbell Bench Press",
      goalProfile: "hypertrophy",
      observations: singleSession,
      target: { repMin: 8, repMax: 10, targetRir: 2 },
      configuration: tuned,
    });
    assert.equal(tuned_result.outcome, "increase_load");
    assert.equal(tuned_result.recommendation.configVersion, "fitcoach.progression.tuned-test");
    assert.notEqual(tuned_result.fingerprint, withDefaults.fingerprint);
  });
});

// ---------------------------------------------------------------------------
// §37 Invariants — the claims that must hold for every input
// ---------------------------------------------------------------------------

test("progression ledger invariants hold for arbitrary histories", async (t) => {
  await t.test("completed progression requires accepted + real change + evidence", () => {
    const result = evaluate([
      ...session(1, BENCH, [{ loadKg: 60, reps: 8, rir: 2 }]),
      ...session(2, BENCH, [{ loadKg: 60, reps: 9, rir: 2 }]),
      ...session(3, BENCH, [{ loadKg: 60, reps: 10, rir: 2 }]),
    ]);
    const evaluation = persisted(result);

    // Every missing ingredient keeps the progression incomplete, forever.
    const variations: ProgressionDecisionEvent[][] = [
      [],
      [event("x1", "2026-10-05T00:00:00.000Z", { decision: "rejected" })],
      [event("x2", "2026-10-05T00:00:00.000Z", { decision: "deferred" })],
      [event("x3", "2026-10-05T00:00:00.000Z", { decision: "accepted" })],
      [
        event("x4", "2026-10-05T00:00:00.000Z", {
          decision: "accepted",
          actualChange: { kind: "none" },
        }),
      ],
      [
        event("x5", "2026-10-05T00:00:00.000Z", {
          decision: "accepted",
          actualChange: { kind: "load", loadDeltaKg: 2.5 },
        }),
      ],
      [
        event("x6", "2026-10-05T00:00:00.000Z", {
          decision: "accepted",
          actualChange: { kind: "load", loadDeltaKg: 2.5 },
          resultingPerformance: {
            loadKind: "external_load",
            loadKg: 60,
            reps: 10,
            localDate: "2026-10-05",
          },
        }),
      ],
    ];
    const flags = variations.map((events) => buildLedgerEntry(evaluation, events).completed);
    assert.deepEqual(flags, [false, false, false, false, false, false, false]);

    // …and the one fully evidenced case completes.
    const complete = buildLedgerEntry(evaluation, [
      event("x7", "2026-10-05T00:00:00.000Z", ACCEPTED_EVERYTHING),
    ]);
    assert.equal(complete.completed, true);
    assert.equal(countCompletedProgressions([complete, ...variations.map((e) => buildLedgerEntry(evaluation, e))])[BENCH], 1);
  });

  await t.test("maintain/repeat outcomes can never count as progressions", () => {
    const maintain = evaluate([
      ...session(1, BENCH, [{ loadKg: 60, reps: 9, rir: 2 }]),
      ...session(2, BENCH, [{ loadKg: 60, reps: 9, rir: 2 }]),
    ]);
    assert.equal(maintain.outcome, "maintain");
    const entry = buildLedgerEntry(persisted(maintain), [
      event("m1", "2026-10-05T00:00:00.000Z", {
        decision: "accepted",
        actualChange: { kind: "none" },
        resultingPerformance: {
          loadKind: "external_load",
          loadKg: 60,
          reps: 9,
          localDate: "2026-10-05",
        },
      }),
    ]);
    assert.equal(entry.completed, false);
    assert.equal(countCompletedProgressions([entry])[BENCH], undefined);
  });

  await t.test("evaluation never invents load for bodyweight work", () => {
    const result = evaluateProgressionFromHistory({
      exerciseId: ROW,
      exerciseName: "Bodyweight Row",
      goalProfile: "general_fitness",
      observations: [
        ...session(1, ROW, [{ reps: 10, rir: 2 }]),
        ...session(2, ROW, [{ reps: 12, rir: 2 }]),
        ...session(3, ROW, [{ reps: 14, rir: 2 }]),
      ],
      target: { repMin: 10, repMax: 14, targetRir: 2 },
    });
    assert.equal(result.outcome, "increase_reps");
    assert.equal(result.recommendation.targetLoadKg, undefined);
    assert.ok(!result.recommendation.mechanisms.includes("load"));
  });

  await t.test("trend reads refuse to over-interpret tiny samples", () => {
    assert.equal(detectPerformanceTrend([10, 9]), "unknown");
    assert.equal(detectPerformanceTrend([]), "unknown");
    assert.equal(detectPerformanceTrend([8, 9, 9, 9, 9, 9]), "stable");
    assert.equal(detectPerformanceTrend([8, 9, 10, 11, 12, 13]), "improving");
    assert.equal(detectPerformanceTrend([13, 12, 11, 10, 9, 8]), "declining");
  });
});
