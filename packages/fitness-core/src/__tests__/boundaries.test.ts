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

test("phase 3 planning modules remain explicit stubs", async (t) => {
  await t.test("volume.computeTrainingVolume throws", () => {
    assert.throws(() => computeTrainingVolume([]), NotImplementedError);
  });

  await t.test("progression.recommendProgression throws", () => {
    assert.throws(
      () => recommendProgression({ exerciseId: "ex_squat", recentWorkingSets: [] }),
      NotImplementedError,
    );
  });

  await t.test("splitGeneration.generateSplit throws", () => {
    assert.throws(
      () =>
        generateSplit({
          userId: "usr_test",
          daysPerWeek: 4,
          sessionDurationMinutes: 60,
          experienceLevel: "intermediate",
          availableEquipmentIds: [],
        }),
      NotImplementedError,
    );
  });

  await t.test("goalAlignment.evaluateGoalAlignment throws", () => {
    assert.throws(
      () =>
        evaluateGoalAlignment({
          goal: minimalGoal(),
          inputs: {
            recentMeasurements: [],
            recentWorkouts: [],
            recentNutrition: [],
          },
        }),
      NotImplementedError,
    );
  });

  await t.test("trendDetection.detectTrend throws", () => {
    assert.throws(
      () =>
        detectTrend([
          { date: "2026-08-20", value: 80.2 },
          { date: "2026-08-21", value: 80.4 },
        ]),
      NotImplementedError,
    );
  });

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