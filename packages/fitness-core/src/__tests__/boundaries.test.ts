import assert from "node:assert/strict";
import { test } from "node:test";
import type { Goal, User } from "@fitcoach/domain";
import { NotImplementedError } from "../errors";
import { assessMuscleCoverage } from "../muscleCoverage";
import { rankExerciseCandidates } from "../exerciseSelection";
import { findRedundantExercises } from "../redundancy";
import { computeTrainingVolume } from "../volume";
import { recommendProgression } from "../progression";
import { generateSplit } from "../splitGeneration";
import { evaluateGoalAlignment } from "../goalAlignment";
import { detectTrend } from "../trendDetection";
import { runDiagnoses } from "../diagnosis";
import { selectInterventionCandidates } from "../interventionSelection";
import {
  BARBELL_CURL,
  CABLE_CURL,
  CATALOG,
  DOMAIN_EXERCISES,
  RELATIONS,
  TAXONOMY,
  bySlug,
  muscleId,
} from "./fixtures";

function minimalUser(): User {
  const now = "2026-08-25T00:00:00Z";
  return {
    id: "usr_test",
    createdAt: now,
    updatedAt: now,
    timezone: "UTC",
    profile: {},
  };
}

function minimalGoal(): Goal {
  const now = "2026-08-25T00:00:00Z";
  return {
    id: "goal_test",
    createdAt: now,
    updatedAt: now,
    userId: "usr_test",
    kind: "aesthetics_v_taper",
    priorities: ["shoulder_width", "waist_control"],
    effectiveFrom: "2026-08-01",
  };
}

/**
 * Phase 1 shipped fitness-core as explicit stubs so the module boundaries were
 * reviewable before any behaviour existed. Phase 2 implements the knowledge
 * half of those stubs (selection, coverage, redundancy) as thin facades over the
 * real engines. This test pins both facts: the implemented facades no longer
 * throw, and the still-deferred planning modules still do.
 */
test("phase 2 promotes the knowledge facades out of stub state", async (t) => {
  await t.test("muscleCoverage.assessMuscleCoverage is implemented", () => {
    const report = assessMuscleCoverage({
      exercises: DOMAIN_EXERCISES,
      relations: RELATIONS,
      plannedWeeklyVolume: [
        { exerciseId: CABLE_CURL.id, weeklyWorkingSets: 3 },
        { exerciseId: BARBELL_CURL.id, weeklyWorkingSets: 2 },
      ],
      knowledge: CATALOG,
      taxonomy: TAXONOMY,
    });
    const biceps = report.perMuscle.find((entry) => entry.muscleId === muscleId("biceps_brachii"));
    assert.ok(biceps, "biceps must appear in the coverage report");
    assert.ok(biceps.primaryWeeklySets > 0);
    assert.deepEqual(
      report.perMuscle,
      [...report.perMuscle].sort((a, b) => a.muscleId.localeCompare(b.muscleId)),
      "coverage output is deterministically ordered",
    );
  });

  await t.test("muscleCoverage still honours the Phase 1 relation-only contract", () => {
    const report = assessMuscleCoverage({
      exercises: DOMAIN_EXERCISES,
      relations: RELATIONS,
      plannedWeeklyVolume: [{ exerciseId: bySlug("barbell_curl").id, weeklyWorkingSets: 3 }],
    });
    const biceps = report.perMuscle.find((entry) => entry.muscleId === muscleId("biceps_brachii"));
    assert.equal(biceps?.primaryWeeklySets, 3 * 0.85 + 3 * 0.6);
  });

  await t.test("exerciseSelection.rankExerciseCandidates is implemented", () => {
    const ranked = rankExerciseCandidates(DOMAIN_EXERCISES, {
      availableEquipmentIds: ["dumbbells", "adjustable_bench"],
      targetMuscleIds: [muscleId("biceps_brachii")],
      excludedExerciseIds: [],
      excludedMovementPatterns: [],
      goalProfile: "hypertrophy",
      experienceLevel: "intermediate",
      catalog: CATALOG,
    });
    assert.ok(ranked.length >= 2, "at least 2 biceps-targeting candidates");
    // Every candidate must be one the user can perform or is flagged
    for (const candidate of ranked) {
      assert.ok(
        candidate.coveredTargetMuscleIds.includes(muscleId("biceps_brachii")) ||
        candidate.disqualifications.length > 0,
        `${candidate.exercise.id} neither covers biceps nor is disqualified`
      );
    }
    const ids = ranked.map((candidate) => candidate.exercise.id);
    // Engine may include exercises the user lacks equipment for;
    // they are flagged via disqualifications if so.
    // Repeatability
    assert.deepEqual(
      rankExerciseCandidates(DOMAIN_EXERCISES, {
        availableEquipmentIds: ["dumbbells", "adjustable_bench"],
        targetMuscleIds: [muscleId("biceps_brachii")],
        excludedExerciseIds: [],
        excludedMovementPatterns: [],
        goalProfile: "hypertrophy",
        experienceLevel: "intermediate",
        catalog: CATALOG,
      }).map((candidate) => candidate.exercise.id),
      ids,
    );
  });

  await t.test("exerciseSelection returns an honest empty ranking without knowledge", () => {
    assert.deepEqual(
      rankExerciseCandidates(DOMAIN_EXERCISES, {
        availableEquipmentIds: ["dumbbells"],
        targetMuscleIds: [muscleId("biceps_brachii")],
        excludedExerciseIds: [],
        excludedMovementPatterns: [],
      }),
      [],
    );
  });

  await t.test("redundancy.findRedundantExercises is implemented", () => {
    const findings = findRedundantExercises(RELATIONS, [
      bySlug("barbell_curl").id,
      bySlug("incline_dumbbell_curl").id,
    ]);
    assert.ok(findings.length > 0, "the two long-head-biased curls must overlap");
    assert.ok(findings[0]!.explanation.length > 0);
    assert.ok(findings[0]!.sharedMuscleIds.includes(muscleId("biceps_brachii")));
  });
});

test("phase 3 planning engines are implemented and deterministic", async (t) => {
  await t.test("volume.computeTrainingVolume is implemented", () => {
    assert.equal(computeTrainingVolume([]), 0);
    assert.equal(
      computeTrainingVolume([
        { exerciseId: "ex_a", weeklyWorkingSets: 3 },
        { exerciseId: "ex_b", weeklyWorkingSets: 2 },
      ]),
      5,
    );
  });

  await t.test("progression.recommendProgression returns a bounded decision", () => {
    const rested = recommendProgression({ exerciseId: "ex_squat", recentWorkingSets: [] });
    assert.equal(rested.action, "hold", "no evidence means no progression");
    assert.ok(rested.reasoning.length > 0);

    const atTopOfRange = recommendProgression({
      exerciseId: "ex_squat",
      recentWorkingSets: Array.from({ length: 4 }, () => ({ reps: 15, loadKg: 60, rir: 1 })),
    });
    assert.equal(atTopOfRange.action, "progress_reps");

    const review = { exerciseId: "ex_squat", recentWorkingSets: [{ reps: 15, rir: 1 }] };
    assert.deepEqual(
      recommendProgression(review),
      recommendProgression(review),
      "progression is deterministic",
    );
  });

  await t.test("splitGeneration.generateSplit is implemented", () => {
    const request = {
      userId: "usr_test",
      daysPerWeek: 4,
      sessionDurationMinutes: 60,
      experienceLevel: "intermediate" as const,
      availableEquipmentIds: [],
    };
    const proposal = generateSplit(request);
    assert.equal(proposal.sessionsPerWeek, 4);
    assert.equal(proposal.sessionTemplates.length, 4);
    assert.ok(proposal.rationaleNotes.length > 0);
    assert.deepEqual(
      generateSplit(request),
      proposal,
      "split generation is deterministic",
    );
  });

  await t.test("goalAlignment.evaluateGoalAlignment scores a plan against the goal", () => {
    const goal = minimalGoal();
    const goalContext = {
      goalId: goal.id,
      goalKind: goal.kind,
      goalStartDate: goal.effectiveFrom,
      priorities: goal.priorities,
      physiquePriorities: goal.priorities,
    };
    const exposure = { side_delts: 14, lats: 12, chest: 10 };
    const roles = { lateral_delt_isolation: 1, lat_emphasis_pull: 1 };

    const alignment = evaluateGoalAlignment(goalContext, exposure, roles);
    assert.ok(alignment.alignmentScore >= 0 && alignment.alignmentScore <= 1);
    assert.equal(alignment.profile, "v_taper");
    assert.ok(alignment.emphasisedRoles.includes("lateral_delt_isolation"));
    assert.deepEqual(
      evaluateGoalAlignment(goalContext, exposure, roles),
      alignment,
      "goal alignment is deterministic",
    );
  });

  await t.test("trendDetection.detectTrend analyses a metric series", () => {
    const insufficient = detectTrend([
      { date: "2026-08-20", value: 80.2 },
      { date: "2026-08-21", value: 80.4 },
    ]);
    assert.equal(insufficient.direction, "insufficient_data");
    assert.equal(insufficient.slopePerDay, null);
    assert.ok(insufficient.warnings.length > 0);

    const series = () =>
      ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"].map(
        (date, index) => ({ date, value: 80 + index * 0.3 }),
      );
    const rising = detectTrend(series());
    assert.equal(rising.direction, "increasing");
    assert.ok((rising.slopePerDay ?? 0) > 0);
    assert.ok((rising.confidence ?? 0) > 0.5);
    assert.deepEqual(detectTrend(series()), rising, "trend analysis is deterministic");
  });
});

test("deferred diagnosis modules remain explicit stubs", async (t) => {
  await t.test("diagnosis.runDiagnoses throws", () => {
    assert.throws(
      () =>
        runDiagnoses({
          userId: minimalUser().id,
          today: "2026-08-25",
          analysisWindowDays: 14,
          data: {
            workouts: [],
            bodyMeasurements: [],
            activityRecords: [],
            dailyNutrition: [],
            activeInterventions: [],
          },
        }),
      NotImplementedError,
    );
  });

  await t.test("interventionSelection.selectInterventionCandidates throws", () => {
    assert.throws(
      () => selectInterventionCandidates([], { activeInterventions: [], constraints: [] }),
      NotImplementedError,
    );
  });
});