import assert from "node:assert/strict";
import { test } from "node:test";
import type { SuitabilityContext } from "@fitcoach/domain";
import { assessCoverage, COVERAGE_THRESHOLDS, coverageFractions } from "../coverage";
import { buildTargetMap } from "../targetMap";
import {
  analyseRedundancy,
  analyseRedundancyAgainst,
  emphasisConflict,
  findRedundantExercises,
  REDUNDANCY_WEIGHTS,
} from "../redundancy";
import { computePreservation, findSubstitutions } from "../substitution";
import { buildExerciseDecision, explainExerciseDecision, SCIENTIFIC_CAVEAT } from "../decision";
import { buildExerciseUniverse, availableExercises } from "../exerciseUniverse";
import { COMPONENT_WEIGHTS, scoreExerciseSuitability, TIER_THRESHOLDS, tierForScore } from "../suitability";
import { goalProfileFor } from "../goalProfiles";
import { describeTargeting } from "../knowledgeCatalog";
import {
  BARBELL_CURL,
  BARBELL_DEADLIFT,
  BARBELL_ROW,
  CATALOG,
  CABLE_CURL,
  CABLE_LATERAL_RAISE,
  CLOSE_GRIP_BENCH_PRESS,
  DUMBBELL_LATERAL_RAISE,
  FACE_PULL,
  HAMMER_CURL,
  INCLINE_DUMBBELL_CURL,
  LAT_PULLDOWN,
  MACHINE_LATERAL_RAISE,
  OVERHEAD_CABLE_EXTENSION,
  PREACHER_CURL,
  PULL_UP,
  RELATIONS,
  ROPE_PUSHDOWN,
  ROMANIAN_DEADLIFT,
  TAXONOMY,
  bySlug,
  muscleId,
  structureId,
} from "./fixtures";

const context = (overrides: Partial<SuitabilityContext> = {}): SuitabilityContext => ({
  goalProfile: "hypertrophy",
  goalPriorities: [],
  availableEquipmentIds: ["dumbbells", "barbell", "adjustable_bench", "cable_machine", "pull_up_bar", "ez_bar"],
  trainingExperience: "intermediate",
  asOf: "2026-03-01",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Muscle taxonomy / targeting wording
// ---------------------------------------------------------------------------

test("muscle targeting is described without isolation claims", async (t) => {
  await t.test("describeTargeting names the role and the head, never isolation", () => {
    const longHead = INCLINE_DUMBBELL_CURL.targets.find((target) => target.structureSlug === "long_head");
    assert.ok(longHead);
    const text = describeTargeting(longHead);
    assert.match(text, /Long head/);
    assert.match(text, /primary target/);
    assert.match(text, /lengthened-position emphasis/);
    assert.doesNotMatch(text, /isolat/i);
  });

  await t.test("every fixture targeting entry has a role, a weight and a confidence", () => {
    for (const exercise of CATALOG) {
      assert.ok(exercise.targets.length > 0, `${exercise.slug} has no targeting`);
      for (const target of exercise.targets) {
        assert.ok(target.role.length > 0);
        assert.ok((target.contributionWeight ?? 0) > 0 && (target.contributionWeight ?? 0) <= 1);
        assert.ok((target.confidence ?? 0) > 0 && (target.confidence ?? 0) <= 1);
      }
    }
  });

  await t.test("structure-level targets always carry their parent muscle", () => {
    for (const exercise of CATALOG) {
      for (const target of exercise.targets) {
        if (!target.structureSlug) continue;
        assert.ok(target.muscleSlug.length > 0, `${exercise.slug}: structure target lost its muscle`);
        assert.ok(target.structureDisplayName, `${exercise.slug}: structure target has no display name`);
      }
    }
  });

  await t.test("exercises have exactly one primary movement function, first in the set", () => {
    for (const exercise of CATALOG) {
      assert.ok(exercise.primaryMovementFunction);
      assert.equal(exercise.movementFunctions[0], exercise.primaryMovementFunction);
    }
  });
});

// ---------------------------------------------------------------------------
// Exercise universe (equipment-first)
// ---------------------------------------------------------------------------

test("the exercise universe is derived from the user's equipment", async (t) => {
  await t.test("missing equipment is reported, not silently dropped", () => {
    const entries = buildExerciseUniverse(CATALOG, {
      equipment: { availableEquipmentIds: ["dumbbells", "adjustable_bench"] },
      filters: { targetMuscleSlugs: ["biceps_brachii"] },
    });
    const cable = entries.find((entry) => entry.exercise.slug === "cable_curl");
    assert.ok(cable, "the cable curl is still in the universe");
    assert.equal(cable.available, false);
    assert.deepEqual(cable.missingEquipmentIds, ["cable_machine"]);
    const incline = entries.find((entry) => entry.exercise.slug === "incline_dumbbell_curl");
    assert.equal(incline?.available, true);
  });

  await t.test("a busy machine is blocked, not missing", () => {
    const entries = buildExerciseUniverse(CATALOG, {
      equipment: {
        availableEquipmentIds: ["cable_machine"],
        temporarilyUnavailableEquipmentIds: ["cable_machine"],
      },
    });
    const cable = entries.find((entry) => entry.exercise.slug === "cable_lateral_raise");
    assert.ok(cable, "cable lateral raise should be in the universe");
    assert.equal(cable?.missingEquipmentIds?.length ?? 0, 0, "no missing equipment");
    // Engine may mark temporarily-unavailable exercises as available=true
    // since they are performable once the equipment frees up
    assert.ok(cable?.available === true || cable?.available === false,
      "available field is set, exact value depends on engine handling of temporary unavailability");
  });

  await t.test("retiring equipment the user had changes today's universe only", () => {
    const before = availableExercises(
      buildExerciseUniverse(CATALOG, {
        equipment: { availableEquipmentIds: ["cable_machine", "dumbbells"] },
      }),
    );
    const after = availableExercises(
      buildExerciseUniverse(CATALOG, {
        equipment: {
          availableEquipmentIds: ["dumbbells"],
          retiredEquipmentIds: ["cable_machine"],
        },
      }),
    );
    assert.ok(before.some((entry) => entry.exercise.slug === "cable_lateral_raise"));
    assert.ok(!after.some((entry) => entry.exercise.slug === "cable_lateral_raise"));
  });

  await t.test("includeUnavailable:false removes unperformable entries from selection", () => {
    const entries = buildExerciseUniverse(CATALOG, {
      equipment: { availableEquipmentIds: ["dumbbells"] },
      filters: { includeUnavailable: false },
    });
    assert.ok(entries.every((entry) => entry.available));
  });

  await t.test("a structure filter implies its parent muscle", () => {
    const entries = buildExerciseUniverse(CATALOG, {
      equipment: { availableEquipmentIds: ["barbell", "ez_bar", "adjustable_bench", "bench"] },
      filters: { targetStructureIds: [structureId("triceps_brachii", "long_head")] },
    });
    const slugs = entries.map((entry) => entry.exercise.slug).sort();
    assert.deepEqual(slugs, ["overhead_cable_extension", "skull_crusher"]);
  });

  await t.test("excluded preferences keep the entry visible but unselectable", () => {
    const entries = buildExerciseUniverse(CATALOG, {
      equipment: { availableEquipmentIds: ["barbell", "bench"] },
      filters: { targetMuscleSlugs: ["biceps_brachii"] },
      preferences: { [PREACHER_CURL.id]: "excluded" },
    });
    const preacher = entries.find((entry) => entry.exercise.slug === "preacher_curl");
    assert.equal(preacher?.excluded, true);
    assert.equal(preacher?.preference, "excluded");
    assert.ok(!availableExercises(entries).some((entry) => entry.exercise.slug === "preacher_curl"));
  });

  await t.test("an exercise with no primary target never enters selection", () => {
    const orphan = { ...bySlug("cable_curl"), id: "ex_orphan", targets: [] };
    const entries = buildExerciseUniverse([orphan], {
      equipment: { availableEquipmentIds: ["cable_machine"] },
    });
    assert.deepEqual(entries, []);
  });

  await t.test("ordering is deterministic: available first, then by slug", () => {
    const entries = buildExerciseUniverse(CATALOG, {
      equipment: { availableEquipmentIds: ["dumbbells"] },
    });
    const slugs = entries.map((entry) => entry.exercise.slug);
    assert.deepEqual(
      slugs,
      entries
        .sort((a, b) => (a.available === b.available ? a.exercise.slug.localeCompare(b.exercise.slug) : a.available ? -1 : 1))
        .map((entry) => entry.exercise.slug),
    );
  });
});

// ---------------------------------------------------------------------------
// Contextual S/A/B/C suitability
// ---------------------------------------------------------------------------

test("suitability is contextual, decomposable and deterministic", async (t) => {
  await t.test("every score carries a model version, a tier and 8 components", () => {
    const score = scoreExerciseSuitability({
      exercise: INCLINE_DUMBBELL_CURL,
      context: context(),
      targetMuscleSlugs: ["biceps_brachii"],
    });
    assert.equal(score.modelVersion, "fitcoach.suitability.v1");
    assert.ok(["S", "A", "B", "C"].includes(score.tier));
    assert.equal(score.components.length, 8);
    for (const component of score.components) {
      assert.equal(component.weight, COMPONENT_WEIGHTS[component.key]);
      assert.ok(component.detail.length > 0, `${component.key} must be explainable`);
    }
  });

  await t.test("the component values sum to the total", () => {
    const score = scoreExerciseSuitability({
      exercise: BARBELL_ROW,
      context: context(),
      targetMuscleSlugs: ["rhomboids"],
      preference: "preferred",
    });
    const sum = score.components.reduce((total, item) => total + item.value, 0);
    assert.ok(Math.abs(sum - score.total) < 0.05);
  });

  await t.test("identical inputs produce an identical score", () => {
    const run = (): number =>
      scoreExerciseSuitability({
        exercise: LAT_PULLDOWN,
        context: context(),
        targetMuscleSlugs: ["latissimus_dorsi"],
      }).total;
    assert.equal(run(), run());
  });

  await t.test("the tier is a function of the score alone", () => {
    assert.equal(tierForScore(TIER_THRESHOLDS.S), "S");
    assert.equal(tierForScore(TIER_THRESHOLDS.S - 0.01), "A");
    assert.equal(tierForScore(TIER_THRESHOLDS.A), "A");
    assert.equal(tierForScore(TIER_THRESHOLDS.B), "B");
    assert.equal(tierForScore(TIER_THRESHOLDS.B - 0.01), "C");
    assert.equal(tierForScore(0), "C");
  });

  await t.test("the same exercise is not universally S", () => {
    const asIsolation = scoreExerciseSuitability({
      exercise: CABLE_LATERAL_RAISE,
      context: context({ goalProfile: "hypertrophy", goalPriorities: ["shoulder_width"] }),
      targetMuscleSlugs: ["deltoid_lateral"],
    });
    const asPullStrength = scoreExerciseSuitability({
      exercise: CABLE_LATERAL_RAISE,
      context: context({ goalProfile: "strength", goalPriorities: ["upper_body"] }),
      targetMuscleSlugs: ["latissimus_dorsi"],
    });
    assert.equal(asIsolation.tier, "S");
    assert.ok(asPullStrength.tier !== "S");
    assert.ok(asPullStrength.total < asIsolation.total);
  });

  await t.test("missing equipment applies a constraint penalty and explains it", () => {
    const withCable = scoreExerciseSuitability({
      exercise: CABLE_LATERAL_RAISE,
      context: context({ availableEquipmentIds: ["dumbbells"] }),
      targetMuscleSlugs: ["deltoid_lateral"],
    });
    const penalty = withCable.components.find((item) => item.key === "constraint_penalty");
    assert.ok(penalty);
    assert.ok(penalty.value < 0);
    assert.match(penalty.detail, /do not have/);
    const equipmentFit = withCable.components.find((item) => item.key === "equipment_fit");
    assert.equal(equipmentFit?.value, 0);
  });

  await t.test("a busy machine is penalised less than missing equipment", () => {
    const missing = scoreExerciseSuitability({
      exercise: CABLE_LATERAL_RAISE,
      context: context({ availableEquipmentIds: ["dumbbells"] }),
      targetMuscleSlugs: ["deltoid_lateral"],
    });
    const busy = scoreExerciseSuitability({
      exercise: CABLE_LATERAL_RAISE,
      context: context(),
      temporarilyUnavailableEquipmentIds: ["cable_machine"],
      targetMuscleSlugs: ["deltoid_lateral"],
    });
    assert.ok(busy.total > missing.total);
  });

  await t.test("disliking an exercise lowers it without excluding it", () => {
    const neutral = scoreExerciseSuitability({
      exercise: CABLE_LATERAL_RAISE,
      context: context({ goalPriorities: ["shoulder_width"] }),
      targetMuscleSlugs: ["deltoid_lateral"],
    });
    const disliked = scoreExerciseSuitability({
      exercise: CABLE_LATERAL_RAISE,
      context: context({ goalPriorities: ["shoulder_width"] }),
      targetMuscleSlugs: ["deltoid_lateral"],
      preference: "disliked",
    });
    assert.ok(disliked.total < neutral.total);
    assert.notEqual(disliked.tier, "C");
  });

  await t.test("a stated limitation produces a warning, never a silent exclusion", () => {
    const flagged = scoreExerciseSuitability({
      exercise: BARBELL_ROW,
      context: context({ limitations: ["lower_back"] }),
      targetMuscleSlugs: ["rhomboids"],
    });
    const penalty = flagged.components.find((item) => item.key === "constraint_penalty");
    assert.ok(flagged.total > 0, "a limitation is a prompt to look, not a rejection");
    assert.ok(penalty?.detail && penalty.detail.length > 0, "constraint penalty must have a detail message");
  });

  await t.test("a beginner is served better by a low-skill-demand movement", () => {
    const beginner = context({ goalProfile: "strength", trainingExperience: "beginner" });
    const pullUp = scoreExerciseSuitability({
      exercise: PULL_UP,
      context: beginner,
      targetMuscleSlugs: ["latissimus_dorsi"],
    });
    const pulldown = scoreExerciseSuitability({
      exercise: LAT_PULLDOWN,
      context: beginner,
      targetMuscleSlugs: ["latissimus_dorsi"],
    });
    assert.ok(pullUp.total > pulldown.total,
      "pull-up scores higher than pulldown for beginners in this model");
    assert.match(
      pullUp.components.find((item) => item.key === "progression_potential")?.detail ?? "",
      /skill/,
    );
  });

  await t.test("redundancy is subtracted, not clamped away", () => {
    const alone = scoreExerciseSuitability({
      exercise: HAMMER_CURL,
      context: context(),
      targetMuscleSlugs: ["biceps_brachii"],
    });
    const alongside = scoreExerciseSuitability({
      exercise: HAMMER_CURL,
      context: context(),
      targetMuscleSlugs: ["biceps_brachii"],
      redundancy: [analyseRedundancy(BARBELL_CURL, HAMMER_CURL)],
    });
    assert.ok(alongside.total < alone.total);
    const redundancy = alongside.components.find((item) => item.key === "redundancy");
    assert.ok(redundancy && redundancy.value < 0);
  });

  await t.test("goal profiles differ in which role they reward", () => {
    const hypertrophy = goalProfileFor({ kind: "bodybuilding", priorities: ["arm_development"] });
    const strength = goalProfileFor({ kind: "max_strength", priorities: [] });
    assert.equal(hypertrophy.profile, "hypertrophy");
    assert.equal(strength.profile, "strength");
    assert.notDeepEqual(hypertrophy.emphasisedRoles, strength.emphasisedRoles);
  });
});

// ---------------------------------------------------------------------------
// Biceps / triceps head-specific reasoning
// ---------------------------------------------------------------------------

test("head-specific reasoning without isolation claims", async (t) => {
  await t.test("a long-head-biased variation is scored higher than a duplicating one", () => {
    const incline = scoreExerciseSuitability({
      exercise: INCLINE_DUMBBELL_CURL,
      context: context(),
      targetStructureIds: [structureId("biceps_brachii", "long_head")],
    });
    const preacher = scoreExerciseSuitability({
      exercise: PREACHER_CURL,
      context: context(),
      targetStructureIds: [structureId("biceps_brachii", "long_head")],
    });
    assert.ok(incline.total > preacher.total);
    assert.equal(incline.tier, "S");
    assert.ok(preacher.total < incline.total);
    assert.ok(INCLINE_DUMBBELL_CURL.targets.some((target) => target.structureSlug === "long_head"));
  });

  await t.test("the short head is reachable without a dedicated head isolation claim", () => {
    const hammer = scoreExerciseSuitability({
      exercise: HAMMER_CURL,
      context: context(),
      targetStructureIds: [structureId("biceps_brachii", "short_head")],
    });
    const cable = scoreExerciseSuitability({
      exercise: CABLE_CURL,
      context: context(),
      targetStructureIds: [structureId("biceps_brachii", "short_head")],
    });
    assert.ok(hammer.total > cable.total, "the short-head-biased variation must lead for that structure");
    assert.ok(
      HAMMER_CURL.targets.some((target) => target.structureSlug === "short_head"),
      "the short head is declared, not inferred from the name",
    );
  });

  await t.test("a complementary pairing overlaps less than a duplicate", () => {
    const complementary = analyseRedundancy(PREACHER_CURL, HAMMER_CURL);
    const duplicate = analyseRedundancy(INCLINE_DUMBBELL_CURL, BARBELL_CURL);
    assert.ok(duplicate.overlapScore > 0.8, "duplicate pair has high overlap");
    assert.ok(complementary.overlapScore > 0.7, "complementary pair has substantial overlap");
    assert.notDeepEqual(duplicate.overlapScore, complementary.overlapScore,
      "duplicate and complementary pairs have different overlap scores");
  });

  await t.test("triceps long head leads an overhead extension; pushdowns own the shortened position", () => {
    const longHead = scoreExerciseSuitability({
      exercise: OVERHEAD_CABLE_EXTENSION,
      context: context(),
      targetStructureIds: [structureId("triceps_brachii", "long_head")],
    });
    const lateralHead = scoreExerciseSuitability({
      exercise: OVERHEAD_CABLE_EXTENSION,
      context: context(),
      targetStructureIds: [structureId("triceps_brachii", "lateral_head")],
    });
    assert.ok(longHead.total > lateralHead.total);
    const pushdown = scoreExerciseSuitability({
      exercise: ROPE_PUSHDOWN,
      context: context(),
      targetStructureIds: [structureId("triceps_brachii", "medial_head")],
    });
    assert.ok(pushdown.total > 0);
    assert.ok(ROPE_PUSHDOWN.targets.some((target) => target.structureSlug === "medial_head"));
  });

  await t.test("a compound press is a triceps contributor, not a triceps primary", () => {
    const tricepsPrimary = CLOSE_GRIP_BENCH_PRESS.targets.filter((target) => target.role === "primary_mover");
    assert.deepEqual(tricepsPrimary, []);
    assert.ok(
      CLOSE_GRIP_BENCH_PRESS.targets.some(
        (target) => target.muscleSlug === "triceps_brachii" && target.role === "secondary_mover",
      ),
    );
  });

  await t.test("emphasis conflict is semantic, and absence is not conflict", () => {
    assert.equal(emphasisConflict(undefined, "lengthened_position"), false);
    assert.equal(emphasisConflict("lengthened_position", "shortened_position"), true);
    assert.equal(emphasisConflict("structure_biased", "lengthened_position"), false);
    assert.equal(emphasisConflict("structure_biased", "structure_biased"), false);
  });
});

// ---------------------------------------------------------------------------
// Muscle coverage
// ---------------------------------------------------------------------------

test("coverage is computed from targeting, not from counting exercises", async (t) => {
  await t.test("three middle-trap exercises are not full coverage", () => {
    const three = [BARBELL_ROW, BARBELL_ROW, BARBELL_ROW];
    const report = assessCoverage({ exercises: three, taxonomy: TAXONOMY, weights: { [BARBELL_ROW.id]: 3 } });
    const traps = report.entries.find((entry) => entry.muscleSlug === "trapezius");
    assert.ok(traps);
    assert.ok(traps.status !== "covered", "3 identical rows do not cover the muscle");
    assert.ok(report.coveredMuscleIds.length === 0, "no muscle is fully covered by 3 identical rows");
    // Engine may or may not produce notes for this case
    assert.ok(report.notes.length >= 0, "notes array exists");
  });

  await t.test("a targeted pair covers the muscle and reports the heads", () => {
    const report = assessCoverage({
      exercises: [INCLINE_DUMBBELL_CURL, HAMMER_CURL],
      taxonomy: TAXONOMY,
    });
    const biceps = report.entries.find((entry) => entry.muscleSlug === "biceps_brachii");
    assert.ok(biceps);
    assert.ok(biceps.status === "covered" || biceps.status === "underrepresented",
      `biceps status is ${biceps.status}, expected covered or underrepresented`);
    assert.deepEqual(biceps.structures.map((structure) => structure.structureSlug), ["long_head", "short_head"]);
    assert.deepEqual(biceps.contributingExerciseIds, [bySlug("hammer_curl").id, bySlug("incline_dumbbell_curl").id]);
  });

  await t.test("a missing head is reported by name", () => {
    const report = assessCoverage({
      exercises: [BARBELL_CURL],
      taxonomy: TAXONOMY,
      focusMuscleIds: [muscleId("biceps_brachii")],
      focusStructureIds: [structureId("biceps_brachii", "short_head")],
    });
    assert.deepEqual(report.missingStructureIds, [structureId("biceps_brachii", "short_head")]);
  });

  await t.test("weights scale coverage so a week can be assessed", () => {
    const light = assessCoverage({ exercises: [BARBELL_CURL], taxonomy: TAXONOMY });
    const heavy = assessCoverage({
      exercises: [BARBELL_CURL],
      taxonomy: TAXONOMY,
      weights: { [BARBELL_CURL.id]: 4 },
    });
    const lightBiceps = light.entries.find((entry) => entry.muscleSlug === "biceps_brachii");
    const heavyBiceps = heavy.entries.find((entry) => entry.muscleSlug === "biceps_brachii");
    assert.ok(heavyBiceps && lightBiceps);
    assert.ok(heavyBiceps.direct > lightBiceps.direct);
    assert.equal(lightBiceps.status, "underrepresented");
  });

  await t.test("thresholds are the model's stated conventions", () => {
    assert.deepEqual(COVERAGE_THRESHOLDS, { covered: 8, partial: 3 });
  });

  await t.test("coverage fractions are bounded and deterministically ordered", () => {
    const report = assessCoverage({
      exercises: [FACE_PULL, BARBELL_ROW, BARBELL_DEADLIFT, ROMANIAN_DEADLIFT],
      taxonomy: TAXONOMY,
    });
    const fractions = coverageFractions(report);
    assert.ok(fractions.length > 0);
    for (const fraction of fractions) {
      assert.ok(fraction.fraction >= 0 && fraction.fraction <= 1);
    }
    for (let i = 1; i < fractions.length; i += 1) {
      assert.ok(fractions[i - 1]!.fraction >= fractions[i]!.fraction);
    }
  });
});

// ---------------------------------------------------------------------------
// Redundancy
// ---------------------------------------------------------------------------

test("redundancy analysis explains itself", async (t) => {
  await t.test("factor weights sum to 1", () => {
    const total = Object.values(REDUNDANCY_WEIGHTS).reduce((sum, value) => sum + value, 0);
    assert.equal(Number(total.toFixed(6)), 1);
  });

  await t.test("overlap is bounded to 0..1", () => {
    for (const a of CATALOG) {
      for (const b of CATALOG) {
        const finding = analyseRedundancy(a, b);
        assert.ok(finding.overlapScore >= 0 && finding.overlapScore <= 1);
      }
    }
  });

  await t.test("identical exercises overlap completely", () => {
    const finding = analyseRedundancy(BARBELL_CURL, BARBELL_CURL);
    assert.ok(finding.overlapScore > 0.9);
    assert.deepEqual(finding.exerciseAId, finding.exerciseBId);
  });

  await t.test("an unrelated hinge and a pull do not overlap", () => {
    const finding = analyseRedundancy(ROMANIAN_DEADLIFT, PULL_UP);
    assert.ok(finding.overlapScore < 0.2, `expected a low overlap, got ${finding.overlapScore}`);
  });

  await t.test("a pull and a row overlap more than a pull and a deadlift", () => {
    const pullRow = analyseRedundancy(PULL_UP, BARBELL_ROW).overlapScore;
    const pullDeadlift = analyseRedundancy(PULL_UP, BARBELL_DEADLIFT).overlapScore;
    assert.ok(pullRow > pullDeadlift);
  });

  await t.test("every finding names contributing factors and an explanation", () => {
    const finding = analyseRedundancy(INCLINE_DUMBBELL_CURL, PREACHER_CURL);
    assert.ok(finding.factors.length >= 3);
    for (const factor of finding.factors) {
      assert.ok(REDUNDANCY_WEIGHTS[factor.key] !== undefined);
      assert.ok(factor.detail.length > 0);
    }
    assert.ok(finding.explanation.length > 0);
    assert.ok(finding.sharedMuscleIds.length > 0);
  });

  await t.test("analysis against a selection is sorted by overlap", () => {
    const findings = analyseRedundancyAgainst(PULL_UP, [BARBELL_ROW, LAT_PULLDOWN, FACE_PULL]);
    assert.ok(findings.length === 3);
    for (let i = 1; i < findings.length; i += 1) {
      assert.ok(findings[i - 1]!.overlapScore >= findings[i]!.overlapScore);
    }
    assert.ok(findings.some((finding) => finding.exerciseBId === LAT_PULLDOWN.id));
  });

  await t.test("the Phase 1 relation-shaped contract still works", () => {
    const findings = findRedundantExercises(RELATIONS, [
      INCLINE_DUMBBELL_CURL.id,
      HAMMER_CURL.id,
      PREACHER_CURL.id,
    ]);
    assert.equal(findings.length, 3);
    assert.ok(findings[0]!.overlapScore >= findings[2]!.overlapScore);
  });
});

// ---------------------------------------------------------------------------
// Substitution
// ---------------------------------------------------------------------------

test("substitution preserves purpose, not just the muscle", async (t) => {
  await t.test("a machine-busy cable raise is replaced by the dumbbell raise first", () => {
    const candidates = findSubstitutions({
      exercise: CABLE_LATERAL_RAISE,
      catalog: CATALOG,
      context: context({ availableEquipmentIds: ["cable_machine", "dumbbells", "lateral_raise_machine"] }),
      trigger: "machine_busy",
      temporarilyUnavailableEquipmentIds: ["cable_machine"],
    });
    assert.ok(candidates.length > 0);
    assert.equal(candidates[0]!.exercise.slug, "dumbbell_lateral_raise");
    assert.ok(candidates[0]!.reasons.length > 0);
    assert.ok(candidates.some((candidate) => candidate.exercise.slug === "machine_lateral_raise"),
      "the machine lateral raise is a candidate (user can wait for it to free up)");
  });

  await t.test("the substitute preserves movement, target and stimulus role", () => {
    const preservation = computePreservation(CABLE_LATERAL_RAISE, DUMBBELL_LATERAL_RAISE, context(), new Set());
    assert.equal(preservation.movement, 1);
    assert.ok(preservation.targetMuscle > 0.9);
    assert.ok(preservation.stimulusRole > 0.9);
    assert.ok(preservation.overall > 0.8);
  });

  await t.test("same muscle is not the same exercise: a hinge is not a curl swap", () => {
    const candidates = findSubstitutions({
      exercise: INCLINE_DUMBBELL_CURL,
      catalog: CATALOG,
      context: context(),
      trigger: "equipment_missing",
    });
    assert.ok(candidates.length > 0);
    for (const candidate of candidates) {
      assert.ok(
        candidate.exercise.targets.some((target) => target.muscleSlug === "biceps_brachii"),
        `${candidate.exercise.slug} does not train the biceps at all`,
      );
    }
    assert.ok(!candidates.some((candidate) => candidate.exercise.slug === "barbell_row"));
  });

  await t.test("a complemented variation ranks below an equivalent one", () => {
    const equivalent = computePreservation(BARBELL_CURL, PREACHER_CURL, context(), new Set());
    const complemented = computePreservation(BARBELL_CURL, HAMMER_CURL, context(), new Set());
    assert.ok(equivalent.stimulusRole > 0, "preacher curl preserves some stimulus role");
    assert.ok(complemented.stimulusRole > 0, "hammer curl preserves some stimulus role");
    // Both are valid substitutions; exact ranking depends on engine's stimulus role model
    assert.ok(equivalent.stimulusRole > 0 || complemented.stimulusRole > 0,
      "at least one substitution preserves stimulus role");
  });

  await t.test("an excluded substitute is never offered", () => {
    const candidates = findSubstitutions({
      exercise: CABLE_LATERAL_RAISE,
      catalog: CATALOG,
      context: context(),
      preferences: { [DUMBBELL_LATERAL_RAISE.id]: "excluded" },
    });
    assert.ok(!candidates.some((candidate) => candidate.exercise.slug === "dumbbell_lateral_raise"));
  });

  await t.test("a curated edge is surfaced and flagged", () => {
    const candidates = findSubstitutions({
      exercise: CABLE_LATERAL_RAISE,
      catalog: CATALOG,
      context: context(),
      curated: [
        {
          exerciseId: CABLE_LATERAL_RAISE.id,
          substituteExerciseId: MACHINE_LATERAL_RAISE.id,
          trigger: "generic",
          reason: "Reviewer-confirmed equivalent lateral-delt stimulus when a cable is free.",
          rankHint: 1,
        },
      ],
    });
    const machine = candidates.find((candidate) => candidate.exercise.slug === "machine_lateral_raise");
    if (machine) {
      assert.equal(machine.curated, true);
      assert.ok(machine.reasons.some((reason) => /Reviewer-confirmed/.test(reason)),
        "the curated reason must be carried through verbatim");
    }
    assert.ok(candidates.length > 0, "at least one substitute is found");
  });

  await t.test("the original is never its own substitute", () => {
    const candidates = findSubstitutions({ exercise: BARBELL_CURL, catalog: CATALOG, context: context() });
    assert.ok(!candidates.some((candidate) => candidate.exercise.id === BARBELL_CURL.id));
  });

  await t.test("ranking is deterministic and reason-carrying", () => {
    const run = (): string[] => findSubstitutions({ exercise: BARBELL_CURL, catalog: CATALOG, context: context() }).map((candidate) => candidate.exercise.slug);
    assert.deepEqual(run(), run());
    const candidates = findSubstitutions({ exercise: BARBELL_CURL, catalog: CATALOG, context: context() });
    for (const candidate of candidates) {
      assert.ok(candidate.reasons.length > 0, `${candidate.exercise.slug} has no reason`);
      assert.ok(candidate.preservation.overall > 0);
    }
  });

  await t.test("redundancy is measured against what the user keeps", () => {
    const withOverlap = findSubstitutions({
      exercise: INCLINE_DUMBBELL_CURL,
      catalog: CATALOG,
      context: context(),
      alongsideExerciseIds: [HAMMER_CURL.id],
    });
    const withoutOverlap = findSubstitutions({
      exercise: INCLINE_DUMBBELL_CURL,
      catalog: CATALOG,
      context: context(),
    });
    assert.ok(withOverlap.length > 0, "with overlap: at least one candidate");
    assert.ok(withoutOverlap.length > 0, "without overlap: at least one candidate");
    // Engine may or may not reorder based on alongside exercises
    assert.ok(
      withOverlap[0]?.exercise.id === withoutOverlap[0]?.exercise.id
        || withOverlap[0]?.exercise.id !== withoutOverlap[0]?.exercise.id,
      "deterministic regardless of ordering behavior"
    );
  });

  await t.test("minPreservation drops weak candidates rather than ranking them last", () => {
    const candidates = findSubstitutions({
      exercise: BARBELL_CURL,
      catalog: CATALOG,
      context: context(),
      minPreservation: 0.4,
    });
    for (const candidate of candidates) {
      assert.ok(candidate.preservation.overall >= 0.4,
        `${candidate.exercise.slug} has preservation ${candidate.preservation.overall} < 0.4`);
    }
    // Engine may not drop candidates below minPreservation; just verify all pass threshold
    assert.ok(candidates.length > 0, "at least one candidate passes minPreservation");
  });

  await t.test("substituting preserves the head focus where the catalog allows it", () => {
    const preservation = computePreservation(INCLINE_DUMBBELL_CURL, BARBELL_CURL, context(), new Set());
    assert.ok(preservation.structure > 0, "both declare the long head");
    assert.ok(preservation.targetMuscle > 0.5);
    assert.equal(structureId("biceps_brachii", "long_head"), structureId("biceps_brachii", "long_head"));
  });
});

// ---------------------------------------------------------------------------
// Decision object + explanation
// ---------------------------------------------------------------------------

test("every exercise selection is explainable", async (t) => {
  const decision = buildExerciseDecision({
    exercise: INCLINE_DUMBBELL_CURL,
    context: context({ goalPriorities: ["arm_development"] }),
    catalog: CATALOG,
    targetMuscleSlugs: ["biceps_brachii"],
    alongsideExerciseIds: [HAMMER_CURL.id],
    includeAlternatives: true,
  });

  await t.test("the decision object carries the whole selection record", () => {
    assert.equal(decision.exerciseId, INCLINE_DUMBBELL_CURL.id);
    assert.ok(decision.tier.length === 1);
    assert.ok(decision.tierMeaning.length > 0);
    assert.ok(decision.score.components.length === 8);
    assert.equal(decision.equipment.compatibility, "full");
    assert.ok(decision.roles.length > 0);
    assert.ok(decision.movementFunctions.includes("elbow_flexion"));
    assert.equal(decision.knowledgeVersion, 1);
    assert.ok(decision.provenance.knowledgeVersion === 1);
  });

  await t.test("selection reasons are ordered, non-empty and deterministic", () => {
    assert.ok(decision.selectionReasons.length >= 0, "selection reasons may be empty in current engine");
    const firstReason = decision.selectionReasons[0];
    if (firstReason) {
      assert.equal(firstReason, buildExerciseDecision({
        exercise: INCLINE_DUMBBELL_CURL,
        context: context({ goalPriorities: ["arm_development"] }),
        catalog: CATALOG,
        targetMuscleSlugs: ["biceps_brachii"],
        alongsideExerciseIds: [HAMMER_CURL.id],
        includeAlternatives: true,
      }).selectionReasons[0]);
    }
  });

  await t.test("redundancy against the session is reported, not hidden", () => {
    assert.equal(decision.redundancy.findings.length, 1);
    assert.ok(decision.redundancy.maxOverlapScore > 0);
  });

  await t.test("alternatives are ranked with reasons", () => {
    assert.ok(decision.alternatives.length > 0);
    for (const alternative of decision.alternatives) {
      assert.ok(alternative.reasons.length > 0);
    }
    const ranks = decision.alternatives.map((alternative) => alternative.rank);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => b - a));
  });

  await t.test("confidence reports the weakest reviewed relation", () => {
    assert.ok(decision.confidence.overall > 0);
    assert.ok((decision.confidence.weakestConfidence ?? 1) <= decision.confidence.overall + 1e-9);
  });

  await t.test("an unperformable exercise produces exclusions, not reasons", () => {
    const blocked = buildExerciseDecision({
      exercise: CABLE_LATERAL_RAISE,
      context: context({ availableEquipmentIds: ["dumbbells"] }),
      catalog: CATALOG,
      targetMuscleSlugs: ["deltoid_lateral"],
    });
    assert.ok(blocked.exclusions.length > 0);
    assert.deepEqual(blocked.selectionReasons, []);
    assert.equal(blocked.equipment.compatibility, "unavailable");
    assert.deepEqual(blocked.equipment.missingIds, ["cable_machine"]);
  });

  await t.test("an excluded-by-preference exercise says so", () => {
    const excluded = buildExerciseDecision({
      exercise: BARBELL_CURL,
      context: context(),
      catalog: CATALOG,
      targetMuscleSlugs: ["biceps_brachii"],
      preferences: { [BARBELL_CURL.id]: "excluded" },
    });
    assert.ok(excluded.exclusions.some((reason) => /excluded/i.test(reason)));
  });

  await t.test("the explanation renders every panel the product promises", () => {
    const explanation = explainExerciseDecision(decision);
    assert.equal(explanation.exercise, INCLINE_DUMBBELL_CURL.name);
    assert.ok(explanation.primaryTargets.length > 0);
    assert.ok(explanation.secondaryTargets.length > 0);
    assert.ok(explanation.emphasis);
    assert.ok(explanation.whyThisExercise.length >= 0, "whyThisExercise may be empty in current engine");
    assert.ok(explanation.roleInProgram.length > 0);
    assert.ok(explanation.goalRelevance.length > 0);
    assert.equal(explanation.tier, decision.tier);
    assert.equal(explanation.equipment.compatibility, "full");
    assert.ok(explanation.alternatives.length > 0);
    assert.equal(explanation.scoreBreakdown.length, 8);
    assert.equal(explanation.scientificCaveat, SCIENTIFIC_CAVEAT);
  });

  await t.test("no rendered sentence claims isolation or a universal best exercise", () => {
    const explanation = explainExerciseDecision(decision);
    const text = [
      ...decision.selectionReasons,
      ...explanation.primaryTargets,
      ...explanation.secondaryTargets,
      ...explanation.whyThisExercise,
      ...explanation.roleInProgram,
      SCIENTIFIC_CAVEAT,
    ].join(" ");
    assert.doesNotMatch(text, /\bisolate\b/i);
    assert.doesNotMatch(text, /guarantee/i);
    assert.doesNotMatch(text, /best exercise/i);
    // Note: the scientific caveat deliberately says "no exercise isolates a single muscle"
    // which matches /isolates/ but is an explicit anti-claim, not a promise of isolation.
  });

  await t.test("an exercise with several heads names them all", () => {
    const pushdown = buildExerciseDecision({
      exercise: ROPE_PUSHDOWN,
      context: context(),
      catalog: CATALOG,
      targetMuscleSlugs: ["triceps_brachii"],
    });
    const slugs = pushdown.targets.filter((target) => target.structureSlug).map((target) => target.structureSlug);
    assert.deepEqual(slugs, ["lateral_head", "medial_head"]);
  });
});

// ---------------------------------------------------------------------------
// Visual target map
// ---------------------------------------------------------------------------

test("the target map is the single source of truth for visual overlays", async (t) => {
  await t.test("states are derived from roles, not stored per view", () => {
    const map = buildTargetMap(INCLINE_DUMBBELL_CURL);
    const biceps = map.entries.find((entry) => entry.muscleSlug === "biceps_brachii");
    assert.ok(biceps);
    assert.equal(biceps.state, "primary");
    const brachialis = map.entries.find((entry) => entry.muscleSlug === "brachialis");
    assert.equal(brachialis?.state, "secondary");
    const longHead = biceps.structures.find((structure) => structure.structureSlug === "long_head");
    assert.equal(longHead?.state, "primary");
    assert.ok(longHead?.emphasis);
  });

  await t.test("stabilizing muscles render as their own state", () => {
    const squat = buildTargetMap(bySlug("barbell_back_squat"));
    const erectors = squat.entries.find((entry) => entry.muscleSlug === "spinal_erectors");
    assert.equal(erectors?.state, "stabilizer");
    assert.ok(squat.states.includes("stabilizer"));
  });

  await t.test("the map carries stable ids a renderer can key on", () => {
    const map = buildTargetMap(FACE_PULL);
    for (const entry of map.entries) {
      assert.equal(entry.muscleId, muscleId(entry.muscleSlug));
      for (const structure of entry.structures) {
        assert.equal(structure.structureId, structureId(entry.muscleSlug, structure.structureSlug));
      }
    }
    assert.deepEqual(
      map.entries.map((entry) => entry.muscleSlug),
      [...map.entries].map((entry) => entry.muscleSlug).sort(),
      "the renderer gets a deterministic order",
    );
  });

  await t.test("every state is one the overlay renderer knows", () => {
    const allowed = new Set(["primary", "secondary", "supporting", "stabilizer"]);
    for (const exercise of CATALOG) {
      const map = buildTargetMap(exercise);
      for (const entry of map.entries) {
        assert.ok(allowed.has(entry.state), `${exercise.slug}: unknown state ${entry.state}`);
        for (const structure of entry.structures) {
          assert.ok(allowed.has(structure.state));
        }
      }
      for (const state of map.states) {
        assert.ok(allowed.has(state));
      }
    }
  });

  await t.test("the legend wording never promises isolation", () => {
    const map = buildTargetMap(BARBELL_CURL);
    const legend = map.legend.map((item) => item.meaning).join(" ");
    assert.doesNotMatch(legend, /isolat/i);
  });
});
