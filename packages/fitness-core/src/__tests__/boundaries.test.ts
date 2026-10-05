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

test("every fitness-core module is an explicit stub", async (t) => {
  await t.test("muscleCoverage.assessMuscleCoverage throws", () => {
    assert.throws(
      () => assessMuscleCoverage({ exercises: [], relations: [], plannedWeeklyVolume: [] }),
      NotImplementedError,
    );
  });

  await t.test("exerciseSelection.rankExerciseCandidates throws", () => {
    assert.throws(
      () =>
        rankExerciseCandidates(
          [],
          {
            availableEquipmentIds: [],
            targetMuscleIds: [],
            excludedExerciseIds: [],
            excludedMovementPatterns: [],
          },
        ),
      NotImplementedError,
    );
  });

  await t.test("redundancy.findRedundantExercises throws", () => {
    assert.throws(() => findRedundantExercises([], []), NotImplementedError);
  });

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
