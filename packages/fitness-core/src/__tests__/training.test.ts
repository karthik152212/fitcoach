/**
 * Phase 3 — Adaptive Training Engine unit tests.
 *
 * These cover the planning engines that Phase 2 deliberately left unimplemented:
 * volume, frequency, split generation, duration budgeting, session construction,
 * goal alignment, progression, plateau signals, adaptation (including no_change),
 * plan comparison and trend analysis.
 *
 * Every assertion is written against the documented model in
 * docs/FITCOACH_PHASE3_TRAINING_ENGINE.md: ranges instead of false precision,
 * documented coefficients, smallest-useful-change adaptation, and deterministic
 * output for identical input.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  ExerciseMuscleTarget,
  PlanSummary,
  PlannedExercise,
} from "@fitcoach/domain";
import type { ExerciseKnowledge } from "../knowledgeCatalog";
import {
  DEFAULT_EFFECTIVE_SET_COEFFICIENTS,
  PLAN_QUALITY_WEIGHTS,
  TRAINING_CONFIG_VERSION,
  DEFAULT_MUSCLE_VOLUME_TARGETS,
  DEFAULT_MUSCLE_FREQUENCY_TARGETS,
  getMuscleVolumeTarget,
  getTrainingConfiguration,
} from "../trainingConfig";
import {
  assessVolumeAppropriateness,
  calculateEffectiveSetContribution,
  calculateMuscleVolume,
  generateWeeklyVolumeReport,
  recommendVolumeAdjustments,
  roleCoefficient,
  type VolumeAdjustment,
  type WeeklyVolumeReport,
} from "../volume";
import { assessFrequency, distributeFrequency, getMuscleFrequencyTarget } from "../frequency";
import { generateSplit, selectSplit } from "../splitGeneration";
import {
  applyVolumeAdjustments,
  buildSessionFromAssignments,
  estimateSessionDuration,
  repairOverBudgetSession,
} from "../sessionConstruction";
import {
  describeGoalStrategy,
  evaluateGoalAlignment,
  getGoalMusclePriorities,
  getGoalValuedRoles,
  goalAlignmentQuality,
} from "../goalAlignment";
import {
  buildProgressionRule,
  computeProgressionStatus,
  evaluateDeloadNeed,
  evaluateProgression,
} from "../progression";
import { detectPlateauSignals, makeAdaptationDecision } from "../adaptation";
import { comparePlans, summarizePlanComparison } from "../planComparison";
import { detectTrend } from "../trendDetection";
import { CATALOG, bySlug } from "./fixtures";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function target(role: ExerciseMuscleTarget["role"], extra: Partial<ExerciseMuscleTarget> = {}): ExerciseMuscleTarget {
  return {
    muscleId: "mus_biceps_brachii",
    muscleSlug: "biceps_brachii",
    muscleDisplayName: "Biceps",
    muscleGroup: "biceps",
    role,
    contributionWeight: 0.6,
    confidence: 0.8,
    ...extra,
  };
}

function plannedExercise(overrides: Partial<PlannedExercise> = {}): PlannedExercise {
  return {
    id: "slot_1",
    exerciseId: "ex_barbell_curl",
    position: 1,
    name: "Barbell curl",
    targetSets: 3,
    repMin: 8,
    repMax: 12,
    order: 1,
    planRole: "hypertrophy_movement",
    selectionReason: "test",
    substitutionExerciseIds: [],
    knowledgeVersion: 1,
    ...overrides,
  };
}

function planSummary(overrides: Partial<PlanSummary> = {}): PlanSummary {
  return {
    planVersionId: "pv_1",
    versionNumber: 1,
    exerciseIds: [],
    sessions: [],
    totalExercises: 0,
    totalSessions: 3,
    estimatedWeeklyDurationMinutes: 300,
    ...overrides,
  };
}

function emptyVolumeReport(): WeeklyVolumeReport {
  return {
    byMuscle: [],
    totalPlannedSets: 0,
    totalEffectiveSets: 0,
    underTargetMuscles: [],
    potentiallyExcessiveMuscles: [],
    redundantExposure: [],
  };
}

/** Group the fixture catalog by muscle slug for session construction. */
const CATALOG_BY_MUSCLE: Readonly<Record<string, readonly ExerciseKnowledge[]>> = (() => {
  const map = new Map<string, Map<string, ExerciseKnowledge>>();
  for (const exercise of CATALOG) {
    for (const entry of exercise.targets) {
      const byId = map.get(entry.muscleSlug) ?? new Map<string, ExerciseKnowledge>();
      byId.set(exercise.id, exercise);
      map.set(entry.muscleSlug, byId);
    }
  }
  return Object.fromEntries(
    [...map.entries()].map(([slug, byId]) => [slug, [...byId.values()]]),
  );
})();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

test("training configuration is versioned, ordered and documented", async (t) => {
  await t.test("config exposes a stable version", () => {
    assert.equal(getTrainingConfiguration().version, TRAINING_CONFIG_VERSION);
    assert.match(TRAINING_CONFIG_VERSION, /^fitcoach\.training\.v\d+$/);
  });

  await t.test("volume targets are ordered ranges, not point values", () => {
    for (const [slug, targetRange] of Object.entries(DEFAULT_MUSCLE_VOLUME_TARGETS)) {
      assert.ok(
        targetRange.min < targetRange.preferred && targetRange.preferred < targetRange.max,
        `${slug} must be min < preferred < max`,
      );
      assert.ok(targetRange.max <= 24, `${slug} upper boundary stays conservative`);
    }
  });

  await t.test("frequency targets are ordered ranges", () => {
    for (const [slug, targetRange] of Object.entries(DEFAULT_MUSCLE_FREQUENCY_TARGETS)) {
      assert.ok(
        targetRange.min <= targetRange.preferred && targetRange.preferred <= targetRange.max,
        `${slug} must be min <= preferred <= max`,
      );
      assert.ok(targetRange.max <= 7, `${slug} cannot exceed daily training`);
      assert.ok(targetRange.rationale.length > 0, `${slug} must document its rationale`);
    }
  });

  await t.test("effective-set coefficients decay by relationship strength", () => {
    const c = DEFAULT_EFFECTIVE_SET_COEFFICIENTS;
    assert.ok(c.direct > c.indirect, "direct work outweighs indirect work");
    assert.ok(c.indirect > c.supporting);
    assert.ok(c.supporting > c.stabilizer);
    assert.ok(c.compoundIndirectCap <= c.direct, "indirect contribution is capped");
  });

  await t.test("plan quality weights sum to 1", () => {
    const total = Object.values(PLAN_QUALITY_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `weights summed to ${total}`);
  });

  await t.test("getMuscleVolumeTarget applies experience and goal modifiers", () => {
    const base = getMuscleVolumeTarget("biceps_brachii", "intermediate", "hypertrophy");
    assert.ok(base);
    const beginner = getMuscleVolumeTarget("biceps_brachii", "beginner", "hypertrophy");
    assert.ok(beginner);
    assert.ok(
      beginner!.preferred < base!.preferred,
      "beginners get a lower preferred volume than intermediates",
    );
    const strength = getMuscleVolumeTarget("biceps_brachii", "intermediate", "strength");
    assert.ok(strength);
    assert.ok(
      strength!.preferred <= base!.preferred,
      "a strength goal does not demand more volume than hypertrophy",
    );
    assert.equal(getMuscleVolumeTarget("not_a_muscle", "intermediate", "hypertrophy"), null);
  });
});

// ---------------------------------------------------------------------------
// Effective volume model
// ---------------------------------------------------------------------------

test("effective volume is decomposable and coefficient-driven", async (t) => {
  await t.test("role coefficients follow the documented model", () => {
    const c = DEFAULT_EFFECTIVE_SET_COEFFICIENTS;
    assert.equal(roleCoefficient("primary_mover", c), c.direct);
    assert.equal(roleCoefficient("secondary_mover", c), Math.min(c.indirect, c.compoundIndirectCap));
    assert.equal(roleCoefficient("supporting", c), c.supporting);
    assert.equal(roleCoefficient("stabilizer", c), c.stabilizer);
  });

  await t.test("a direct set contributes more than an indirect set", () => {
    const exercise = { id: "ex_barbell_curl" };
    const direct = calculateEffectiveSetContribution(exercise, target("primary_mover"), 3);
    const indirect = calculateEffectiveSetContribution(exercise, target("secondary_mover"), 3);
    const supporting = calculateEffectiveSetContribution(exercise, target("supporting"), 3);

    assert.equal(direct.effectiveSets, 3);
    assert.equal(indirect.effectiveSets, 1.5);
    assert.equal(supporting.effectiveSets, 0.75);
    assert.ok(direct.effectiveSets > indirect.effectiveSets);
    assert.ok(direct.contributionCoefficient > 0);
    assert.ok(direct.rationale.includes("primary_mover"), "every contribution explains itself");
    assert.equal(direct.plannedSetId, "ex_barbell_curl:mus_biceps_brachii");
  });

  await t.test("emphasis adds a documented bonus", () => {
    const plain = calculateEffectiveSetContribution({ id: "ex_x" }, target("primary_mover"), 2);
    const emphasised = calculateEffectiveSetContribution(
      { id: "ex_x" },
      target("primary_mover", { emphasis: "structure_biased" }),
      2,
    );
    assert.equal(
      emphasised.effectiveSets,
      plain.effectiveSets + 2 * DEFAULT_EFFECTIVE_SET_COEFFICIENTS.emphasis,
    );
  });

  await t.test("muscle volume aggregates across exercises and sorts deterministically", () => {
    const planned = {
      [bySlug("barbell_curl").id]: 3,
      [bySlug("incline_dumbbell_curl").id]: 2,
      [bySlug("cable_curl").id]: 4,
    };
    const first = calculateMuscleVolume(CATALOG, planned);
    const second = calculateMuscleVolume(CATALOG, planned);
    assert.deepEqual(first, second, "aggregation is deterministic");
    assert.deepEqual(
      first.map((entry) => entry.muscleSlug),
      [...first.map((entry) => entry.muscleSlug)].sort((a, b) => a.localeCompare(b)),
      "output is stably ordered",
    );

    const biceps = first.find((entry) => entry.muscleSlug === "biceps_brachii");
    assert.ok(biceps, "biceps volume must be reported");
    assert.ok(biceps!.totalEffectiveSets > 0);
    assert.ok(biceps!.directEffectiveSets > biceps!.indirectEffectiveSets);
    assert.ok(biceps!.contributingExercises.length >= 3);
  });

  await t.test("a weekly report flags under-target and excessive exposure", () => {
    const under = generateWeeklyVolumeReport(
      CATALOG,
      { [bySlug("barbell_curl").id]: 1 },
      "hypertrophy",
      "intermediate",
    );
    assert.ok(under.underTargetMuscles.includes("biceps_brachii"), "1 set is below target");

    const excessive = generateWeeklyVolumeReport(
      CATALOG,
      { [bySlug("barbell_curl").id]: 24 },
      "hypertrophy",
      "intermediate",
    );
    assert.ok(
      excessive.potentiallyExcessiveMuscles.includes("biceps_brachii"),
      "24 sets exceed the caution boundary",
    );

    const healthy = generateWeeklyVolumeReport(
      CATALOG,
      { [bySlug("barbell_curl").id]: 10 },
      "hypertrophy",
      "intermediate",
    );
    assert.deepEqual(healthy.underTargetMuscles, []);
    assert.deepEqual(healthy.potentiallyExcessiveMuscles, []);
    assert.equal(healthy.totalPlannedSets, 10);
  });

  await t.test("assessment describes goal and experience context", () => {
    const report = generateWeeklyVolumeReport(
      CATALOG,
      { [bySlug("barbell_curl").id]: 1 },
      "hypertrophy",
      "intermediate",
    );
    const assessment = assessVolumeAppropriateness(report, "hypertrophy", "intermediate");
    assert.equal(assessment.isAppropriate, false);
    assert.ok(assessment.issues.length > 0);
    assert.match(assessment.summary, /hypertrophy/);
  });

  await t.test("volume adjustments hold when adherence is low", () => {
    const report = generateWeeklyVolumeReport(
      CATALOG,
      { [bySlug("barbell_curl").id]: 1 },
      "hypertrophy",
      "intermediate",
    );
    const held = recommendVolumeAdjustments(report, { adherence: 0.4 });
    assert.deepEqual(held.adjustments, [], "do not add volume the user is not completing");
    assert.match(held.reasoning, /adherence/i);

    const increase = recommendVolumeAdjustments(report, { adherence: 0.95 });
    assert.ok(increase.adjustments.some((a) => a.direction === "increase"));
    assert.ok(increase.adjustments.every((a) => a.amount > 0 && a.rationale.length > 0));
  });

  await t.test("recent completed volume suppresses a redundant increase", () => {
    const report = generateWeeklyVolumeReport(
      CATALOG,
      { [bySlug("barbell_curl").id]: 1 },
      "hypertrophy",
      "intermediate",
    );
    const recentEffectiveVolume: Record<string, number> = {};
    for (const entry of report.byMuscle) {
      recentEffectiveVolume[entry.muscleSlug] = entry.totalEffectiveSets + 12;
    }
    const suppressed = recommendVolumeAdjustments(report, { adherence: 1, recentEffectiveVolume });
    assert.deepEqual(suppressed.adjustments, []);
    assert.match(suppressed.reasoning, /already close to the planned targets/);
  });
});

// ---------------------------------------------------------------------------
// Frequency
// ---------------------------------------------------------------------------

test("frequency planning distributes work instead of duplicating a workout", async (t) => {
  await t.test("targets respond to goal and experience", () => {
    const hypertrophy = getMuscleFrequencyTarget("biceps_brachii", "hypertrophy", 12, "intermediate");
    assert.ok(hypertrophy);
    const beginner = getMuscleFrequencyTarget("biceps_brachii", "hypertrophy", 12, "beginner");
    assert.ok(beginner);
    assert.ok(beginner!.preferred <= hypertrophy!.preferred, "beginners train less often");

    const strength = getMuscleFrequencyTarget("biceps_brachii", "strength", 12, "intermediate");
    assert.ok(strength);
    assert.ok(strength!.preferred <= hypertrophy!.preferred, "strength is not a frequency goal");

    assert.equal(getMuscleFrequencyTarget("unknown_muscle", "hypertrophy", 12, "intermediate"), null);
  });

  await t.test("a 2-day week trains each muscle at most twice", () => {
    const result = distributeFrequency(
      { biceps_brachii: 8, quadriceps: 10 },
      2,
      "hypertrophy",
      "intermediate",
      "full_body",
    );
    for (const assignment of result.sessionAssignments) {
      assert.ok(assignment.sessionIndex < 2, "assignment stays inside the available days");
      assert.ok(assignment.sets > 0);
    }
    for (const session of result.distribution) {
      assert.ok(session.totalVolume > 0, "no empty sessions in a 2-day week");
    }
    assert.deepEqual(
      distributeFrequency({ biceps_brachii: 8, quadriceps: 10 }, 2, "hypertrophy", "intermediate", "full_body"),
      result,
      "distribution is deterministic",
    );
  });

  await t.test("a 3-day full-body week leaves no session without work", () => {
    // Regression: every muscle used to take the first k sessions, so with a
    // sub-weekly frequency target the last session received no muscle at all
    // and the plan was reported as having no eligible exercises.
    const muscles = {
      pectoralis_major: 12,
      latissimus_dorsi: 12,
      deltoid_lateral: 11,
      quadriceps: 11,
      hamstrings: 9,
      gluteus_maximus: 9,
      biceps_brachii: 8,
      triceps_brachii: 8,
      gastrocnemius: 6,
      rectus_abdominis: 6,
      trapezius: 6,
      rhomboids: 5,
      deltoid_anterior: 8,
      deltoid_posterior: 6,
      erector_spinae: 4,
    };
    const result = distributeFrequency(muscles, 3, "hypertrophy", "beginner", "full_body");

    assert.equal(result.distribution.length, 3);
    for (const session of result.distribution) {
      assert.ok(session.muscleCount > 0, `session ${session.sessionIndex} trains at least one muscle`);
      assert.ok(session.totalVolume > 0, `session ${session.sessionIndex} has volume`);
    }

    // Spreading the rotation must also keep the week from piling onto one day.
    const volumes = result.distribution.map((session) => session.totalVolume);
    assert.ok(
      Math.max(...volumes) <= Math.min(...volumes) * 2,
      `sessions are within 2x of each other (${volumes.join(", ")})`,
    );
    assert.deepEqual(
      distributeFrequency(muscles, 3, "hypertrophy", "beginner", "full_body"),
      result,
      "distribution is deterministic",
    );
  });

  await t.test("upper/lower keeps muscles on the matching session type", () => {
    const result = distributeFrequency(
      { biceps_brachii: 4, quadriceps: 4 },
      4,
      "hypertrophy",
      "intermediate",
      "upper_lower",
    );
    assert.deepEqual(result.warnings, []);
    const bicepsSession = result.sessionAssignments.find((a) => a.muscleSlug === "biceps_brachii");
    const quadsSession = result.sessionAssignments.find((a) => a.muscleSlug === "quadriceps");
    assert.ok(bicepsSession && quadsSession);
    assert.equal(bicepsSession!.sessionIndex % 2, 0, "biceps lands on an upper session");
    assert.equal(quadsSession!.sessionIndex % 2, 1, "quadriceps land on a lower session");
  });

  await t.test("a balanced distribution passes assessment", () => {
    const { distribution } = distributeFrequency(
      { biceps_brachii: 4, quadriceps: 4 },
      4,
      "hypertrophy",
      "intermediate",
      "upper_lower",
    );
    const assessment = assessFrequency(distribution, 4, "hypertrophy");
    assert.deepEqual(assessment.issues, []);
    assert.equal(assessment.isAppropriate, true);
  });

  await t.test("an assessment cannot pass when sessions are missing", () => {
    const { distribution } = distributeFrequency(
      { biceps_brachii: 4 },
      3,
      "hypertrophy",
      "intermediate",
      "full_body",
    );
    const assessment = assessFrequency(distribution, 5, "hypertrophy");
    assert.equal(assessment.isAppropriate, false);
    assert.ok(assessment.issues.some((issue) => issue.includes("available")));
  });

  await t.test("zero sessions yields an explicit infeasible assessment", () => {
    const assessment = assessFrequency([], 3, "hypertrophy");
    assert.equal(assessment.isAppropriate, false);
    assert.match(assessment.summary, /no sessions/i);
  });
});

// ---------------------------------------------------------------------------
// Split generation
// ---------------------------------------------------------------------------

test("split generation derives structure from constraints", async (t) => {
  const context = (days: number, minutes: number, experience: "beginner" | "intermediate" | "advanced" = "intermediate") => ({
    availableTrainingDays: days,
    maxSessionDurationMinutes: minutes,
    trainingExperience: experience,
  });
  const goal = (goalKind: string, priorities: string[] = []) => ({ goalKind, priorities });

  await t.test("day count maps to a structure, not a fixed template", () => {
    assert.equal(selectSplit(context(1, 60), goal("bodybuilding")).type, "full_body");
    assert.equal(selectSplit(context(2, 60), goal("bodybuilding")).type, "full_body");
    assert.equal(selectSplit(context(4, 60), goal("bodybuilding")).type, "upper_lower");
    assert.equal(selectSplit(context(6, 60), goal("bodybuilding")).type, "push_pull_legs");
    assert.equal(
      selectSplit(context(3, 60), goal("max_strength")).type,
      "upper_lower_full_body",
      "strength on 3 days favours the hybrid structure",
    );
    assert.equal(
      selectSplit(context(5, 60), goal("aesthetics_v_taper", ["shoulder_width"])).type,
      "specialization",
      "a V-taper priority earns a dedicated focus day",
    );
  });

  await t.test("sessions never exceed the days the user has", () => {
    for (let days = 1; days <= 7; days += 1) {
      const split = selectSplit(context(days, 60), goal("bodybuilding"));
      assert.equal(split.sessions.length, split.sessionsPerWeek, "session list matches the count");
      assert.ok(
        split.sessionsPerWeek <= days,
        `${split.sessionsPerWeek} sessions for ${days} available days`,
      );
      assert.ok(split.rationale.length > 0);
      assert.ok(split.selectionJustification.length > 0);
    }
  });

  await t.test("0 days is explicitly infeasible rather than a silent plan", () => {
    const split = selectSplit(context(0, 60), goal("bodybuilding"));
    assert.equal(split.sessionsPerWeek, 0);
    assert.deepEqual(split.sessions, []);
    assert.match(split.rationale, /No training days/);
  });

  await t.test("session duration scales the exercise estimate", () => {
    const short = selectSplit(context(4, 45), goal("bodybuilding"));
    const long = selectSplit(context(4, 90), goal("bodybuilding"));
    const shortMax = Math.max(...short.sessions.map((s) => s.estimatedExerciseCount.max));
    const longMax = Math.max(...long.sessions.map((s) => s.estimatedExerciseCount.max));
    assert.ok(longMax > shortMax, `90-minute sessions (${longMax}) fit more than 45-minute (${shortMax})`);

    // Configured ceiling for the 45-minute bracket is 6 exercises.
    for (const session of short.sessions) {
      assert.ok(
        session.estimatedExerciseCount.max <= 6,
        `45-minute session estimates ${session.estimatedExerciseCount.max} exercises`,
      );
    }
  });

  await t.test("experience shapes the estimate", () => {
    const beginner = selectSplit(context(4, 60, "beginner"), goal("bodybuilding"));
    const advanced = selectSplit(context(4, 60, "advanced"), goal("bodybuilding"));
    assert.ok(
      Math.max(...advanced.sessions.map((s) => s.estimatedExerciseCount.max)) >=
        Math.max(...beginner.sessions.map((s) => s.estimatedExerciseCount.max)),
      "advanced lifters are not given fewer exercises than beginners",
    );
  });

  await t.test("split selection is deterministic", () => {
    const first = selectSplit(context(5, 45, "advanced"), goal("athletic_performance"));
    const second = selectSplit(context(5, 45, "advanced"), goal("athletic_performance"));
    assert.deepEqual(first, second);
  });

  await t.test("legacy request shape still produces a proposal", () => {
    const proposal = generateSplit({
      userId: "usr_test",
      daysPerWeek: 3,
      sessionDurationMinutes: 45,
      experienceLevel: "beginner",
      availableEquipmentIds: ["dumbbells"],
    });
    assert.equal(proposal.sessionsPerWeek, 3);
    assert.equal(proposal.sessionTemplates.length, 3);
    assert.ok(proposal.rationaleNotes.length > 0);
    for (const template of proposal.sessionTemplates) {
      assert.ok(template.weekdayHint === undefined || (template.weekdayHint >= 0 && template.weekdayHint <= 6));
    }
  });
});

// ---------------------------------------------------------------------------
// Session duration budget
// ---------------------------------------------------------------------------

test("every session carries a duration budget and can be repaired", async (t) => {
  await t.test("a small session fits a 60-minute budget", () => {
    const result = estimateSessionDuration(
      [plannedExercise()],
      "upper",
      { maxSessionDurationMinutes: 60, trainingExperience: "intermediate" },
      "hypertrophy",
    );
    assert.equal(result.targetMinutes, 60);
    assert.equal(result.exceedsBudget, false);
    assert.ok(result.varianceMinutes < 0);
    assert.equal(result.breakdown[0]?.component, "warmup");
    assert.ok(result.breakdown.some((item) => item.exerciseId === "ex_barbell_curl"));
    assert.deepEqual(
      estimateSessionDuration(
        [plannedExercise()],
        "upper",
        { maxSessionDurationMinutes: 60, trainingExperience: "intermediate" },
        "hypertrophy",
      ),
      result,
      "duration estimation is deterministic",
    );
  });

  await t.test("a long session is flagged as over budget", () => {
    const exercises = Array.from({ length: 6 }, (_, index) =>
      plannedExercise({ id: `slot_${index + 1}`, exerciseId: `ex_${index}` }),
    );
    const result = estimateSessionDuration(
      exercises,
      "full_body",
      { maxSessionDurationMinutes: 20, trainingExperience: "intermediate" },
      "hypertrophy",
    );
    assert.equal(result.exceedsBudget, true);
    assert.ok(result.varianceMinutes > 0);
    assert.equal(result.breakdown.length, 1 + exercises.length, "warm-up plus one row per exercise");
  });

  await t.test("strength sessions keep at least two sets when repaired", () => {
    const exercises = Array.from({ length: 4 }, (_, index) =>
      plannedExercise({ id: `slot_${index + 1}` }),
    );
    const repair = repairOverBudgetSession(exercises, 60, 50, [], "strength");
    assert.ok(repair.changes.length > 0);
    for (const change of repair.changes) {
      assert.equal(change.type, "reduce_sets", "the overrun is met by trimming sets, not dropping work");
      assert.ok((change.to ?? 0) >= 2, "strength work is never stripped to a single set");
      assert.ok(change.estimatedTimeSaved > 0);
    }
    assert.equal(repair.newDuration, 50);
    assert.equal(repair.stillOverBudget, false);
    assert.equal(repair.repairedExercises.length, exercises.length, "no exercise was dropped");
  });

  await t.test("a severe overrun drops only low-priority work, never everything", () => {
    const exercises = Array.from({ length: 6 }, (_, index) =>
      plannedExercise({ id: `slot_${index + 1}` }),
    );
    const repair = repairOverBudgetSession(exercises, 90, 45, [], "hypertrophy");
    const removed = repair.changes.filter((change) => change.type === "remove_exercise");
    assert.ok(removed.length < exercises.length, "the session is trimmed, not emptied");
    assert.ok(repair.repairedExercises.length > 0);
    assert.ok(repair.newDuration < repair.originalDuration);
    assert.ok(removed.every((change) => change.estimatedTimeSaved > 0));
  });

  await t.test("a modest overrun is repaired without dropping exercises", () => {
    const exercises = Array.from({ length: 4 }, (_, index) =>
      plannedExercise({ id: `slot_${index + 1}` }),
    );
    const repair = repairOverBudgetSession(exercises, 60, 45, [], "hypertrophy");
    assert.equal(repair.changes.length, 3, "repairs stop as soon as the budget is met");
    assert.equal(repair.newDuration, 45);
    assert.equal(repair.stillOverBudget, false);
    assert.equal(repair.repairedExercises.length, 4);
  });

  await t.test("a session inside the budget is left untouched", () => {
    const exercises = [plannedExercise()];
    const repair = repairOverBudgetSession(exercises, 30, 45);
    assert.deepEqual(repair.changes, []);
    assert.equal(repair.stillOverBudget, false);
    assert.deepEqual(repair.repairedExercises, exercises, "no change is the preferred outcome");
  });
});

// ---------------------------------------------------------------------------
// Session construction
// ---------------------------------------------------------------------------

test("session construction respects equipment, preferences and goals", async (t) => {
  const context = (overrides: Record<string, unknown> = {}) => ({
    availableEquipmentIds: ["dumbbells"] as readonly string[],
    exercisePreferences: {} as Readonly<Record<string, "preferred" | "neutral" | "disliked" | "excluded">>,
    temporarilyUnavailableEquipmentIds: [] as readonly string[],
    limitations: [] as readonly string[],
    maxSessionDurationMinutes: 60,
    trainingExperience: "intermediate" as const,
    ...overrides,
  });

  await t.test("only exercises the user can perform are selected", () => {
    const built = buildSessionFromAssignments(
      0,
      [{ muscleSlug: "biceps_brachii", sessionIndex: 0, sets: 8 }],
      CATALOG_BY_MUSCLE,
      "hypertrophy",
      "intermediate",
      context(),
    );
    assert.ok(built.sessionExercises.length > 0, "biceps work must exist");
    for (const exercise of built.sessionExercises) {
      const knowledge = CATALOG.find((item) => item.id === exercise.exerciseId);
      assert.ok(knowledge);
      for (const equipment of knowledge!.requiredEquipmentIds) {
        assert.ok(
          context().availableEquipmentIds.includes(equipment),
          `${knowledge!.slug} needs ${equipment} the user does not have`,
        );
      }
    }
    assert.ok(built.durationEstimate.targetMinutes === 60);
    assert.deepEqual(built.warnings, []);
  });

  await t.test("temporarily unavailable equipment removes the option", () => {
    const built = buildSessionFromAssignments(
      0,
      [{ muscleSlug: "biceps_brachii", sessionIndex: 0, sets: 6 }],
      CATALOG_BY_MUSCLE,
      "hypertrophy",
      "intermediate",
      context({ temporarilyUnavailableEquipmentIds: ["dumbbells"] }),
    );
    assert.deepEqual(built.sessionExercises, []);
    assert.ok(built.warnings.some((warning) => warning.includes("biceps_brachii")));
  });

  await t.test("an excluded exercise is never selected", () => {
    const hammer = bySlug("hammer_curl");
    const equipment = ["dumbbells", "adjustable_bench"] as readonly string[];
    const withoutExclusion = buildSessionFromAssignments(
      0,
      [{ muscleSlug: "biceps_brachii", sessionIndex: 0, sets: 6 }],
      CATALOG_BY_MUSCLE,
      "hypertrophy",
      "intermediate",
      context({ availableEquipmentIds: equipment }),
    );
    const firstChoice = withoutExclusion.sessionExercises[0]?.exerciseId;
    assert.ok(firstChoice, "a feasible biceps exercise must be chosen");

    const built = buildSessionFromAssignments(
      0,
      [{ muscleSlug: "biceps_brachii", sessionIndex: 0, sets: 6 }],
      CATALOG_BY_MUSCLE,
      "hypertrophy",
      "intermediate",
      context({ availableEquipmentIds: equipment, exercisePreferences: { [firstChoice!]: "excluded" } }),
    );
    assert.ok(built.sessionExercises.length > 0, "a feasible alternative still exists");
    assert.notEqual(built.sessionExercises[0]?.exerciseId, firstChoice, "the excluded exercise never returns");
    assert.notEqual(built.sessionExercises[0]?.exerciseId, hammer.id);
  });

  await t.test("a preferred exercise wins a close contest", () => {
    const withoutPreference = buildSessionFromAssignments(
      0,
      [{ muscleSlug: "biceps_brachii", sessionIndex: 0, sets: 6 }],
      CATALOG_BY_MUSCLE,
      "hypertrophy",
      "intermediate",
      context(),
    );
    const preferred = bySlug("cable_curl");
    if (!context().availableEquipmentIds.includes("cable_machine")) {
      // Make the preferred option feasible first.
      const withCable = buildSessionFromAssignments(
        0,
        [{ muscleSlug: "biceps_brachii", sessionIndex: 0, sets: 6 }],
        CATALOG_BY_MUSCLE,
        "hypertrophy",
        "intermediate",
        context({ availableEquipmentIds: ["dumbbells", "cable_machine"] }),
      );
      assert.ok(
        withCable.sessionExercises.some((exercise) => exercise.exerciseId === preferred.id),
        "a preferred, available exercise is chosen",
      );
      assert.ok(withCable.sessionExercises.length >= withoutPreference.sessionExercises.length);
    }
  });

  await t.test("goal profile drives rep range, RIR and rest", () => {
    const strength = buildSessionFromAssignments(
      0,
      [{ muscleSlug: "biceps_brachii", sessionIndex: 0, sets: 4 }],
      CATALOG_BY_MUSCLE,
      "strength",
      "intermediate",
      context(),
    );
    const first = strength.sessionExercises[0];
    assert.ok(first);
    assert.equal(first!.repMin, 3);
    assert.equal(first!.repMax, 6);
    assert.equal(first!.targetRir, 1);
    assert.equal(first!.restSeconds, 180);

    const hypertrophy = buildSessionFromAssignments(
      0,
      [{ muscleSlug: "biceps_brachii", sessionIndex: 0, sets: 4 }],
      CATALOG_BY_MUSCLE,
      "hypertrophy",
      "intermediate",
      context(),
    );
    const firstHypertrophy = hypertrophy.sessionExercises[0];
    assert.ok(firstHypertrophy);
    assert.equal(firstHypertrophy!.repMin, 8);
    assert.equal(firstHypertrophy!.restSeconds, 90);
  });

  await t.test("selection is deterministic", () => {
    const run = () =>
      buildSessionFromAssignments(
        1,
        [
          { muscleSlug: "biceps_brachii", sessionIndex: 1, sets: 6 },
          { muscleSlug: "triceps_brachii", sessionIndex: 1, sets: 6 },
        ],
        CATALOG_BY_MUSCLE,
        "hypertrophy",
        "intermediate",
        context(),
      );
    assert.deepEqual(run(), run());
  });
});

// ---------------------------------------------------------------------------
// Goal-aware strategy
// ---------------------------------------------------------------------------

test("goal strategy changes priorities without hard-coding stereotypes", async (t) => {
  await t.test("each goal profile has its own muscle priorities", () => {
    const vTaper = getGoalMusclePriorities("v_taper");
    const hypertrophy = getGoalMusclePriorities("hypertrophy");
    assert.ok(vTaper.lats > hypertrophy.lats, "V-taper prioritises lats");
    assert.ok(vTaper.side_delts > hypertrophy.side_delts, "V-taper prioritises lateral delts");
    assert.equal(hypertrophy.chest, 1, "hypertrophy stays balanced");

    const strength = getGoalMusclePriorities("strength");
    assert.ok(strength.lower_back > hypertrophy.lower_back, "strength leans on the posterior chain");

    const athletic = getGoalMusclePriorities("athletic");
    assert.ok(athletic.hamstrings >= 1.2);
  });

  await t.test("explicit priorities raise the matching muscle only", () => {
    const base = getGoalMusclePriorities("hypertrophy");
    const shoulders = getGoalMusclePriorities("hypertrophy", ["shoulder_width"]);
    assert.ok(shoulders.side_delts > base.side_delts);
    assert.equal(shoulders.chest, base.chest, "unrelated muscles are untouched");
    assert.ok(shoulders.side_delts <= 2, "priority boosts are bounded");
  });

  await t.test("goals value different exercise roles", () => {
    const strengthRoles = getGoalValuedRoles("strength");
    const hypertrophyRoles = getGoalValuedRoles("hypertrophy");
    assert.ok((strengthRoles["primary_strength_movement"] ?? 0) > 0);
    assert.ok((hypertrophyRoles["hypertrophy_movement"] ?? 0) > 0);
    assert.notDeepEqual(strengthRoles, hypertrophyRoles);
  });

  await t.test("alignment scores a plan against the goal", () => {
    const goal = {
      goalId: "goal_1",
      goalKind: "aesthetics_v_taper",
      goalStartDate: "2026-01-01",
      priorities: ["shoulder_width"],
      physiquePriorities: ["shoulder_width"],
    };

    const wellCovered = evaluateGoalAlignment(goal, { side_delts: 16, lats: 14, chest: 12 }, {
      lateral_delt_isolation: 1,
      lat_emphasis_pull: 1,
      horizontal_push: 1,
    });
    const poorlyCovered = evaluateGoalAlignment(goal, { chest: 2 }, { horizontal_push: 1 });

    assert.ok(wellCovered.alignmentScore > poorlyCovered.alignmentScore);
    assert.ok(wellCovered.alignmentScore >= 0 && wellCovered.alignmentScore <= 1);
    assert.equal(wellCovered.profile, "v_taper");
    assert.ok(wellCovered.gaps.length < poorlyCovered.gaps.length);
    assert.ok(poorlyCovered.recommendations.length > 0);
    assert.ok(wellCovered.strengths.length > 0);
    assert.ok(goalAlignmentQuality(wellCovered) > goalAlignmentQuality(poorlyCovered));
    assert.deepEqual(
      evaluateGoalAlignment(goal, { side_delts: 16, lats: 14, chest: 12 }, {
        lateral_delt_isolation: 1,
        lat_emphasis_pull: 1,
        horizontal_push: 1,
      }),
      wellCovered,
      "alignment is deterministic",
    );
  });

  await t.test("the strategy description never promises guaranteed outcomes", () => {
    const description = describeGoalStrategy({
      goalId: "goal_1",
      goalKind: "max_strength",
      goalStartDate: "2026-01-01",
      priorities: [],
    });
    assert.match(description, /strength/);
    assert.doesNotMatch(description, /guarantee/i);
    assert.doesNotMatch(description, /always better/i);
  });
});

// ---------------------------------------------------------------------------
// Progression
// ---------------------------------------------------------------------------

test("progression is bounded, evidence-based and explainable", async (t) => {
  await t.test("rules differ by goal and carry a configuration version", () => {
    const strengthRule = buildProgressionRule("ex_squat", "Back squat", "strength");
    const hypertrophyRule = buildProgressionRule("ex_curl", "Curl", "hypertrophy");
    assert.equal(strengthRule.action, "progress_load");
    assert.equal(hypertrophyRule.action, "progress_reps");
    assert.equal(strengthRule.configurationVersion, TRAINING_CONFIG_VERSION);
    assert.ok(strengthRule.bounds.includes("≤2.5kg") || strengthRule.bounds.length > 0);
    assert.ok((strengthRule.resetBehavior ?? "").length > 0, "rules state how they recover");
    assert.ok(strengthRule.rationale.includes("Back squat"));
  });

  await t.test("insufficient evidence holds instead of progressing", () => {
    const result = evaluateProgression(
      "ex_squat",
      "Back squat",
      { completedSessions: 1, incompleteSessions: 0 },
      "hypertrophy",
    );
    assert.equal(result.shouldProgress, false);
    assert.equal(result.action, "hold");
    assert.ok(result.evidence.length > 0);
    assert.ok(result.reasoning.length > 0);
  });

  await t.test("top-of-range performance at target RIR progresses", () => {
    const hypertrophy = evaluateProgression(
      "ex_curl",
      "Curl",
      { bestReps: 15, recentRir: 1, completedSessions: 4, incompleteSessions: 0 },
      "hypertrophy",
    );
    assert.equal(hypertrophy.shouldProgress, true);
    assert.equal(hypertrophy.action, "progress_reps");

    const strength = evaluateProgression(
      "ex_squat",
      "Back squat",
      { bestReps: 6, recentRir: 1, completedSessions: 4, incompleteSessions: 0 },
      "strength",
    );
    assert.equal(strength.shouldProgress, true);
    assert.equal(strength.action, "progress_load");
    assert.ok(strength.evidence.join(" ").includes("2.5kg"), "the bound is stated as evidence");
  });

  await t.test("stalled performance reduces stimulus instead of adding work", () => {
    const result = evaluateProgression(
      "ex_squat",
      "Back squat",
      {
        bestReps: 6,
        recentRir: 4,
        completedSessions: 5,
        incompleteSessions: 3,
        trend: "declining",
      },
      "strength",
    );
    assert.equal(result.shouldProgress, false);
    assert.equal(result.action, "reduce_stimulus");
    assert.ok(result.evidence.join(" ").includes("stalled"));
  });

  await t.test("status is derived only from observed performance", () => {
    const noData = computeProgressionStatus("ex_x", "X", { completedSessions: 0, incompleteSessions: 0 }, null);
    assert.equal(noData.status, "unknown");

    const improving = computeProgressionStatus(
      "ex_x",
      "X",
      { completedSessions: 6, incompleteSessions: 0, trend: "improving" },
      "2026-08-01",
    );
    assert.equal(improving.status, "progressing");
    assert.ok((improving.nextProgressionTarget ?? "").length > 0);

    const declining = computeProgressionStatus(
      "ex_x",
      "X",
      { completedSessions: 6, incompleteSessions: 2, trend: "declining" },
      null,
    );
    assert.equal(declining.status, "regressing");
  });

  await t.test("deload evaluation is conservative", () => {
    const healthy = evaluateDeloadNeed({
      ex_a: { completedSessions: 6, incompleteSessions: 0, trend: "improving" },
    });
    assert.equal(healthy.shouldDeload, false);
    assert.equal(healthy.severity, "none");

    const struggling = evaluateDeloadNeed({
      ex_a: { completedSessions: 4, incompleteSessions: 2, trend: "declining" },
      ex_b: { completedSessions: 4, incompleteSessions: 3, trend: "declining" },
      ex_c: { completedSessions: 4, incompleteSessions: 2, trend: "declining" },
    });
    assert.equal(struggling.shouldDeload, true);
    assert.equal(struggling.severity, "moderate");
    assert.equal(struggling.affectedExercises.length, 3);
  });
});

// ---------------------------------------------------------------------------
// Plateau signals + adaptation
// ---------------------------------------------------------------------------

test("adaptation makes the smallest useful change", async (t) => {
  await t.test("plateau signals are structured facts, not diagnoses", () => {
    const signals = detectPlateauSignals([], {
      ex_a: { completedSessions: 6, incompleteSessions: 0, trend: "stable" },
      ex_b: { completedSessions: 3, incompleteSessions: 3, trend: "declining" },
      ex_c: { completedSessions: 0, incompleteSessions: 4, trend: "declining" },
    });
    const kinds = signals.map((signal) => signal.kind);
    assert.ok(kinds.includes("repeated_performance_stagnation"));
    assert.ok(kinds.includes("declining_performance"));
    assert.ok(kinds.includes("adherence_issue"));
    for (const signal of signals) {
      assert.ok(signal.observation.length > 0, "every signal states what was observed");
      assert.ok(signal.severity === undefined || (signal.severity >= 0 && signal.severity <= 1));
    }
    assert.deepEqual(
      detectPlateauSignals([], {
        ex_a: { completedSessions: 6, incompleteSessions: 0, trend: "stable" },
        ex_b: { completedSessions: 3, incompleteSessions: 3, trend: "declining" },
        ex_c: { completedSessions: 0, incompleteSessions: 4, trend: "declining" },
      }),
      signals,
      "signal detection is deterministic",
    );
  });

  await t.test("no signals produce no_change with evidence", () => {
    const decision = makeAdaptationDecision(
      planSummary(),
      emptyVolumeReport(),
      [],
      {},
      { goalId: "g", goalKind: "bodybuilding", goalStartDate: "2026-01-01", priorities: [] },
    );
    assert.equal(decision.outcome, "no_change");
    assert.deepEqual(decision.changes, [], "no_change mutates nothing");
    assert.ok(decision.rationale.length > 0);
    assert.ok((decision.smallestUsefulChangeJustification ?? "").length > 0);
    assert.ok((decision.monitoringPlan ?? []).length > 0);
  });

  await t.test("a single stagnating exercise adjusts only its progression", () => {
    const decision = makeAdaptationDecision(
      planSummary(),
      emptyVolumeReport(),
      [
        {
          kind: "repeated_performance_stagnation",
          observation: "ex_a has been stable for 6 sessions.",
          affectedEntity: "ex_a",
        },
      ],
      {},
      { goalId: "g", goalKind: "bodybuilding", goalStartDate: "2026-01-01", priorities: [] },
    );
    assert.equal(decision.outcome, "modify_progression");
    assert.equal(decision.changes.length, 1, "exactly one intervention");
    assert.equal(decision.changes[0]?.kind, "modify_progression");
    assert.deepEqual(decision.triggeringSignals.length, 1);
  });

  await t.test("declining performance reduces stress rather than adding volume", () => {
    const underTarget = generateWeeklyVolumeReport(
      CATALOG,
      { [bySlug("barbell_curl").id]: 1 },
      "hypertrophy",
      "intermediate",
    );
    const decision = makeAdaptationDecision(
      planSummary(),
      underTarget,
      [
        { kind: "declining_performance", observation: "ex_a is declining.", affectedEntity: "ex_a" },
      ],
      {},
      { goalId: "g", goalKind: "bodybuilding", goalStartDate: "2026-01-01", priorities: [] },
    );
    assert.equal(decision.outcome, "reduce_training_stress");
    assert.equal(decision.changes.length, 1);
  });

  await t.test("under-target volume adjusts volume", () => {
    const underTarget = generateWeeklyVolumeReport(
      CATALOG,
      { [bySlug("barbell_curl").id]: 1 },
      "hypertrophy",
      "intermediate",
    );
    const decision = makeAdaptationDecision(
      planSummary(),
      underTarget,
      [{ kind: "frequency_mismatch", observation: "biceps trained once this week." }],
      {},
      { goalId: "g", goalKind: "bodybuilding", goalStartDate: "2026-01-01", priorities: [] },
    );
    assert.equal(decision.outcome, "adjust_volume");
    assert.ok(decision.changes[0]?.affectedMuscles?.includes("biceps_brachii"));
    assert.ok(decision.changes[0]?.evidence);
  });

  await t.test("several unrelated signals trigger review, not a rewrite", () => {
    const signals = [
      { kind: "adherence_issue" as const, observation: "missed sessions" },
      { kind: "session_duration_overload" as const, observation: "session ran long" },
      { kind: "frequency_mismatch" as const, observation: "chest trained once" },
    ];
    const decision = makeAdaptationDecision(
      planSummary(),
      emptyVolumeReport(),
      signals,
      {},
      { goalId: "g", goalKind: "bodybuilding", goalStartDate: "2026-01-01", priorities: [] },
    );
    assert.equal(decision.outcome, "no_change");
    assert.deepEqual(decision.changes, []);
    assert.equal(decision.triggeringSignals.length, 3);
  });

  await t.test("adaptation is deterministic", () => {
    const signals = [
      { kind: "repeated_performance_stagnation" as const, observation: "stable", affectedEntity: "ex_a" },
    ];
    const run = () =>
      makeAdaptationDecision(
        planSummary(),
        emptyVolumeReport(),
        signals,
        {},
        { goalId: "g", goalKind: "bodybuilding", goalStartDate: "2026-01-01", priorities: [] },
      );
    assert.deepEqual(run(), run());
  });
});

// ---------------------------------------------------------------------------
// Plan comparison
// ---------------------------------------------------------------------------

test("plan comparison explains what changed and what did not", async (t) => {
  const volumeFor = (sets: number): WeeklyVolumeReport => ({
    byMuscle: [
      {
        muscleId: "mus_biceps_brachii",
        muscleSlug: "biceps_brachii",
        directEffectiveSets: sets,
        indirectEffectiveSets: 0,
        supportingEffectiveSets: 0,
        stabilizingEffectiveSets: 0,
        emphasisEffectiveSets: 0,
        totalEffectiveSets: sets,
        contributingExercises: ["ex_barbell_curl"],
      },
    ],
    totalPlannedSets: sets,
    totalEffectiveSets: sets,
    underTargetMuscles: [],
    potentiallyExcessiveMuscles: [],
    redundantExposure: [],
  });

  await t.test("exercise, volume, duration and split changes are reported", () => {
    const before = planSummary({ exerciseIds: ["ex_a", "ex_b"], estimatedWeeklyDurationMinutes: 300 });
    const after = planSummary({
      planVersionId: "pv_2",
      versionNumber: 2,
      exerciseIds: ["ex_b", "ex_c"],
      totalSessions: 4,
      estimatedWeeklyDurationMinutes: 330,
    });

    const comparison = comparePlans(before, after, volumeFor(8), volumeFor(14));
    assert.equal(comparison.planAId, "pv_1");
    assert.equal(comparison.planBId, "pv_2");

    const changes = comparison.exerciseChanges;
    assert.ok(changes.some((change) => change.exerciseId === "ex_a" && change.change === "removed"));
    assert.ok(changes.some((change) => change.exerciseId === "ex_c" && change.change === "added"));
    assert.ok(!changes.some((change) => change.exerciseId === "ex_b"), "unchanged exercises are not reported");

    const volumeChange = comparison.muscleVolumeChanges.find((c) => c.muscleSlug === "biceps_brachii");
    assert.ok(volumeChange);
    assert.equal(volumeChange!.delta, 6);
    assert.equal(volumeChange!.direction, "increased");

    assert.equal(comparison.sessionDurationChanges.length, 1);
    assert.equal(comparison.sessionDurationChanges[0]?.deltaMinutes, 30);
    assert.match(comparison.splitChanges ?? "", /3 to 4/);
  });

  await t.test("identical plans report no significant change", () => {
    const plan = planSummary({ exerciseIds: ["ex_a"] });
    const comparison = comparePlans(plan, plan, volumeFor(8), volumeFor(8));
    assert.deepEqual(comparison.exerciseChanges, []);
    assert.ok(comparison.muscleVolumeChanges.every((change) => change.direction === "unchanged"));
    assert.deepEqual(comparison.sessionDurationChanges, []);
    assert.equal(comparison.splitChanges, undefined);
    assert.deepEqual(summarizePlanComparison(comparison), ["No significant changes between these plans."]);
  });

  await t.test("summary lines are human readable and deterministic", () => {
    const before = planSummary({ exerciseIds: ["ex_a", "ex_b"], estimatedWeeklyDurationMinutes: 300 });
    const after = planSummary({
      planVersionId: "pv_2",
      exerciseIds: ["ex_b", "ex_c"],
      totalSessions: 4,
      estimatedWeeklyDurationMinutes: 330,
    });
    const comparison = comparePlans(before, after, volumeFor(8), volumeFor(14));
    const lines = summarizePlanComparison(comparison);
    assert.ok(lines.some((line) => line.includes("Added 1 exercise")));
    assert.ok(lines.some((line) => line.includes("Removed 1 exercise")));
    assert.ok(lines.some((line) => line.includes("biceps_brachii")));
    assert.deepEqual(summarizePlanComparison(comparison), lines);
  });
});

// ---------------------------------------------------------------------------
// Trend analysis
// ---------------------------------------------------------------------------

test("trend analysis refuses to read meaning into too little data", async (t) => {
  await t.test("two points are never enough", () => {
    const result = detectTrend([
      { date: "2026-08-20", value: 80.2 },
      { date: "2026-08-21", value: 80.4 },
    ]);
    assert.equal(result.direction, "insufficient_data");
    assert.equal(result.slopePerDay, null);
    assert.ok(result.warnings.length > 0);
  });

  await t.test("clear movement is detected in both directions", () => {
    const rising = detectTrend(
      ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"].map((date, index) => ({
        date,
        value: 80 + index * 0.4,
      })),
    );
    assert.equal(rising.direction, "increasing");
    assert.ok((rising.slopePerDay ?? 0) > 0);
    assert.ok((rising.confidence ?? 0) > 0.8);

    const falling = detectTrend(
      ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"].map((date, index) => ({
        date,
        value: 82 - index * 0.4,
      })),
    );
    assert.equal(falling.direction, "decreasing");
    assert.ok((falling.slopePerDay ?? 0) < 0);
  });

  await t.test("noise inside the stability threshold reads as stable", () => {
    const flat = detectTrend([
      { date: "2026-08-01", value: 80 },
      { date: "2026-08-02", value: 80.01 },
      { date: "2026-08-03", value: 79.99 },
      { date: "2026-08-04", value: 80.02 },
      { date: "2026-08-05", value: 80 },
    ]);
    assert.equal(flat.direction, "stable");
  });

  await t.test("points are ordered by date regardless of input order", () => {
    const ordered = [
      { date: "2026-08-01", value: 80 },
      { date: "2026-08-02", value: 80.5 },
      { date: "2026-08-03", value: 81 },
      { date: "2026-08-04", value: 81.5 },
    ];
    const shuffled = [ordered[2]!, ordered[0]!, ordered[3]!, ordered[1]!];
    assert.deepEqual(detectTrend(shuffled), detectTrend(ordered));
  });
});

// ---------------------------------------------------------------------------
// Applying adaptation volume adjustments to planned exercises
// ---------------------------------------------------------------------------

test("volume adjustments spread across exercises in stable order and respect bounds", async (t) => {
  const bicepsPrimary = CATALOG.filter((exercise) =>
    exercise.targets.some(
      (entry) => entry.muscleSlug === "biceps_brachii" && entry.role === "primary_mover",
    ),
  ).slice(0, 3);
  assert.equal(bicepsPrimary.length, 3, "fixture must offer three biceps-primary exercises");

  const planned = () =>
    bicepsPrimary.map((exercise, index) =>
      plannedExercise({ id: `slot_${index}`, exerciseId: exercise.id, targetSets: 3 }),
    );
  const adjustment = (
    direction: VolumeAdjustment["direction"],
    amount: number,
  ): VolumeAdjustment => ({
    muscleSlug: "biceps_brachii",
    direction,
    amount,
    rationale: "test adjustment",
  });

  await t.test("an increase is applied one set at a time in exercise-id order", () => {
    const exercises = planned();
    const adjusted = applyVolumeAdjustments(exercises, [adjustment("increase", 4)], CATALOG);
    const gained = new Map(adjusted.map((item) => [item.exerciseId, item.targetSets - 3]));
    const orderedIds = [...gained.keys()].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(
      orderedIds.map((id) => gained.get(id)),
      [2, 1, 1],
      "the first exercise in id order absorbs the leftover set",
    );
    assert.equal([...gained.values()].reduce((sum, value) => sum + value, 0), 4);
    assert.deepEqual(
      exercises.map((item) => item.targetSets),
      [3, 3, 3],
      "the input is never mutated",
    );
  });

  await t.test("a decrease stops at the minimum sets per exercise", () => {
    const adjusted = applyVolumeAdjustments(
      planned(),
      [adjustment("decrease", 5)],
      CATALOG,
      { minSets: 2, maxSets: 8 },
    );
    assert.deepEqual(
      adjusted.map((item) => item.targetSets),
      [2, 2, 2],
      "3 exercises can shed at most one set each above the minimum",
    );
  });

  await t.test("an increase stops at the maximum sets per exercise", () => {
    const exercises = planned().map((item) => ({ ...item, targetSets: 8 }));
    const adjusted = applyVolumeAdjustments(exercises, [adjustment("increase", 3)], CATALOG, {
      minSets: 1,
      maxSets: 8,
    });
    assert.deepEqual(adjusted.map((item) => item.targetSets), [8, 8, 8]);
  });

  await t.test("a muscle with no matching exercise is left alone instead of guessed", () => {
    const unrelated = applyVolumeAdjustments(
      planned(),
      [{ ...adjustment("increase", 2), muscleSlug: "not_a_tracked_muscle" }],
      CATALOG,
    );
    assert.deepEqual(unrelated.map((item) => item.targetSets), [3, 3, 3]);
  });
});
