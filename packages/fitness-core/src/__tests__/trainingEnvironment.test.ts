/**
 * Phase 3.1 — Training Environment unit tests (§12–§23, §36, §37).
 *
 * The environment is a first-class domain input, not an `if (!canGoGym)`:
 * resolution is interval-based and deterministic, substitution is scored and
 * honesty-labelled, and NOTHING here ever claims a no-equipment session is
 * equivalent to the gym plan it replaces — especially for pulling/back work.
 *
 * Every assertion matches docs/FITCOACH_PHASE3_TRAINING_ENGINE.md §35–§41.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  ExercisePreferenceKind,
  PlannedExercise,
  TrainingEnvironment,
  TrainingEnvironmentKind,
  TrainingEnvironmentPeriod,
} from "@fitcoach/domain";
import { ENVIRONMENT_VERSION } from "@fitcoach/domain";
import type { ExerciseKnowledge } from "../knowledgeCatalog";
import {
  DEFAULT_ENVIRONMENT_CONFIGURATION,
  ENVIRONMENT_CONFIG_VERSION,
  getEnvironmentConfiguration,
} from "../trainingConfig";
import { estimateSessionDuration } from "../sessionConstruction";
import {
  adaptExercisesToEnvironment,
  environmentChangeNeeded,
  environmentLimitations,
  environmentProgressionMechanisms,
  resolveTrainingEnvironment,
  summarizeEnvironmentConstraint,
} from "../trainingEnvironment";
import { ex, target } from "./fixtures";

// ---------------------------------------------------------------------------
// Fixture catalog — spans the cases that matter for environment adaptation:
// equipment-bound work, equipment-free work, and the pulling/back problem.
// ---------------------------------------------------------------------------

const CATALOG: ExerciseKnowledge[] = [
  ex({
    slug: "barbell_bench_press",
    name: "Barbell Bench Press",
    category: "compound",
    movementPattern: "horizontal_push",
    primaryMovementFunction: "horizontal_press",
    movementFunctions: ["horizontal_press"],
    roles: ["compound_movement", "horizontal_push"],
    equipment: ["eq_barbell", "eq_bench"],
    targets: [
      target({ muscle: "pectoralis_major", display: "Pectorals", group: "chest", role: "primary_mover" }),
      target({ muscle: "deltoid_anterior", display: "Front delt", group: "front_delts", role: "secondary_mover" }),
      target({ muscle: "triceps_brachii", display: "Triceps", group: "triceps", role: "secondary_mover" }),
    ],
  }),
  ex({
    slug: "push_up",
    name: "Push-Up",
    category: "compound",
    movementPattern: "horizontal_push",
    primaryMovementFunction: "horizontal_press",
    movementFunctions: ["horizontal_press"],
    roles: ["compound_movement", "horizontal_push"],
    equipment: [],
    targets: [
      target({ muscle: "pectoralis_major", display: "Pectorals", group: "chest", role: "primary_mover" }),
      target({ muscle: "deltoid_anterior", display: "Front delt", group: "front_delts", role: "secondary_mover" }),
      target({ muscle: "triceps_brachii", display: "Triceps", group: "triceps", role: "secondary_mover" }),
    ],
  }),
  ex({
    slug: "barbell_row",
    name: "Barbell Row",
    category: "compound",
    movementPattern: "horizontal_pull",
    primaryMovementFunction: "horizontal_pull",
    movementFunctions: ["horizontal_pull", "elbow_flexion"],
    roles: ["compound_movement", "horizontal_pull"],
    equipment: ["eq_barbell"],
    targets: [
      target({ muscle: "latissimus_dorsi", display: "Lats", group: "lats", role: "primary_mover" }),
      target({ muscle: "rhomboids", display: "Rhomboids", group: "upper_back", role: "primary_mover" }),
      target({ muscle: "trapezius", display: "Traps", group: "traps", role: "secondary_mover" }),
      target({ muscle: "biceps_brachii", display: "Biceps", group: "biceps", role: "secondary_mover" }),
    ],
  }),
  ex({
    slug: "pull_up",
    name: "Pull-Up",
    category: "compound",
    movementPattern: "vertical_pull",
    primaryMovementFunction: "vertical_pull",
    movementFunctions: ["vertical_pull", "elbow_flexion"],
    roles: ["compound_movement", "vertical_pull"],
    equipment: ["eq_pullup_bar"],
    targets: [
      target({ muscle: "latissimus_dorsi", display: "Lats", group: "lats", role: "primary_mover" }),
      target({ muscle: "biceps_brachii", display: "Biceps", group: "biceps", role: "secondary_mover" }),
    ],
  }),
  ex({
    slug: "dumbbell_row",
    name: "Dumbbell Row",
    category: "compound",
    movementPattern: "horizontal_pull",
    primaryMovementFunction: "horizontal_pull",
    movementFunctions: ["horizontal_pull", "elbow_flexion"],
    roles: ["compound_movement", "horizontal_pull"],
    equipment: ["eq_dumbbells"],
    targets: [
      target({ muscle: "latissimus_dorsi", display: "Lats", group: "lats", role: "primary_mover" }),
      target({ muscle: "rhomboids", display: "Rhomboids", group: "upper_back", role: "primary_mover" }),
      target({ muscle: "biceps_brachii", display: "Biceps", group: "biceps", role: "secondary_mover" }),
    ],
  }),
  ex({
    slug: "barbell_back_squat",
    name: "Barbell Back Squat",
    category: "compound",
    movementPattern: "squat",
    primaryMovementFunction: "squat",
    movementFunctions: ["squat", "knee_extension"],
    roles: ["compound_movement"],
    equipment: ["eq_barbell"],
    targets: [
      target({ muscle: "quadriceps", display: "Quadriceps", group: "quadriceps", role: "primary_mover" }),
      target({ muscle: "gluteus_maximus", display: "Glutes", group: "glutes", role: "secondary_mover" }),
    ],
  }),
  ex({
    slug: "bodyweight_squat",
    name: "Bodyweight Squat",
    category: "compound",
    movementPattern: "squat",
    primaryMovementFunction: "squat",
    movementFunctions: ["squat", "knee_extension"],
    roles: ["compound_movement"],
    equipment: [],
    targets: [
      target({ muscle: "quadriceps", display: "Quadriceps", group: "quadriceps", role: "primary_mover" }),
      target({ muscle: "gluteus_maximus", display: "Glutes", group: "glutes", role: "secondary_mover" }),
    ],
  }),
  ex({
    slug: "plank",
    name: "Plank",
    category: "isolation",
    movementPattern: "core",
    primaryMovementFunction: "anti_extension",
    movementFunctions: ["anti_extension"],
    roles: ["isolation_movement"],
    equipment: [],
    targets: [
      target({ muscle: "abdominals", display: "Abs", group: "abdominals", role: "primary_mover" }),
    ],
  }),
];

const bySlug = (slug: string): ExerciseKnowledge => {
  const found = CATALOG.find((entry) => entry.slug === slug);
  if (!found) throw new Error(`fixture exercise ${slug} not found`);
  return found;
};

const OWNED = [
  { id: "eq_barbell", slug: "barbell" },
  { id: "eq_bench", slug: "bench" },
  { id: "eq_dumbbells", slug: "dumbbells" },
  { id: "eq_pullup_bar", slug: "pull_up_bar" },
  { id: "eq_cable", slug: "cable_machine" },
];

function period(
  kind: TrainingEnvironmentKind,
  fields: Partial<TrainingEnvironmentPeriod> = {},
): TrainingEnvironmentPeriod {
  return {
    id: `period_${kind}_${fields.effectiveFrom ?? "2026-10-01"}`,
    userId: "usr_env_test",
    kind,
    availableEquipmentIds: [],
    unavailableEquipmentIds: [],
    effectiveFrom: "2026-10-01",
    isTemporary: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...fields,
  };
}

function resolve(
  asOf: string,
  periods: readonly TrainingEnvironmentPeriod[] = [],
  owned = OWNED,
): TrainingEnvironment {
  return resolveTrainingEnvironment({ asOf, periods, ownedEquipment: owned });
}

function planned(
  slug: string,
  overrides: Partial<PlannedExercise> = {},
): PlannedExercise {
  const knowledge = bySlug(slug);
  return {
    id: `slot_${slug}`,
    exerciseId: knowledge.id,
    position: 0,
    name: knowledge.name,
    targetSets: 3,
    order: 0,
    planRole: "compound_movement",
    selectionReason: "Fixture prescription",
    substitutionExerciseIds: [],
    knowledgeVersion: knowledge.knowledgeVersion,
    ...overrides,
  };
}

const NO_EQUIPMENT = () => resolve("2026-10-03", [period("home_no_equipment")]);

// ---------------------------------------------------------------------------
// §36.1–§36.4 Environment kinds
// ---------------------------------------------------------------------------

test("environment kinds resolve to distinct, explicit equipment universes", async (t) => {
  await t.test("gym: default, unconstrained, nothing knowingly reduced", () => {
    const gym = resolve("2026-10-01");
    assert.equal(gym.kind, "gym");
    assert.equal(gym.source, "default");
    assert.equal(gym.constrained, false);
    assert.equal(gym.isTemporary, false);
    assert.deepEqual([...gym.availableEquipmentIds], [
      "eq_barbell",
      "eq_bench",
      "eq_cable",
      "eq_dumbbells",
      "eq_pullup_bar",
    ]);
    assert.deepEqual([...gym.limitations], []);
  });

  await t.test("home: owned-but-disallowed equipment is explicitly unavailable", () => {
    const home = resolve("2026-10-03", [period("home")]);
    assert.equal(home.kind, "home");
    assert.equal(home.source, "period");
    assert.equal(home.constrained, true);
    assert.deepEqual([...home.availableEquipmentIds], ["eq_dumbbells", "eq_pullup_bar"]);
    const equipmentLimitations = home.limitations.filter((item) => item.kind === "equipment");
    assert.ok(equipmentLimitations.some((item) => item.subject === "eq_barbell"));
    assert.ok(equipmentLimitations.some((item) => item.subject === "eq_cable"));
  });

  await t.test("home_no_equipment: no equipment and no external-load progression", () => {
    const home = NO_EQUIPMENT();
    assert.deepEqual([...home.availableEquipmentIds], []);
    const loadLimitation = home.limitations.find((item) => item.kind === "load_progression");
    assert.ok(loadLimitation);
    assert.ok(loadLimitation.description.includes("External-load progression is unavailable"));
    assert.equal(loadLimitation.retainedStimulus, 0.5);
  });

  await t.test("home_limited_equipment: keeps what helps, drops what cannot come", () => {
    const limited = resolve("2026-10-03", [period("home_limited_equipment")]);
    assert.deepEqual([...limited.availableEquipmentIds], ["eq_dumbbells", "eq_pullup_bar"]);
    assert.equal(
      limited.limitations.some((item) => item.kind === "load_progression"),
      false,
      "limited equipment still allows load progression",
    );
  });
});

// ---------------------------------------------------------------------------
// §36.5–§36.6 Temporary periods: start, end, exclusivity
// ---------------------------------------------------------------------------

test("temporary environment periods start and end exactly as recorded", async (t) => {
  const weeks = period("home_no_equipment", {
    effectiveFrom: "2026-10-05",
    effectiveTo: "2026-10-12",
    reason: "gym closed for maintenance",
    isTemporary: true,
  });

  await t.test("before the start the default applies", () => {
    const env = resolve("2026-10-04", [weeks]);
    assert.equal(env.kind, "gym");
    assert.equal(env.source, "default");
  });

  await t.test("inside the window the period applies, with its reason", () => {
    const env = resolve("2026-10-05", [weeks]);
    assert.equal(env.kind, "home_no_equipment");
    assert.equal(env.source, "period");
    assert.equal(env.reason, "gym closed for maintenance");
    assert.equal(env.effectiveTo, "2026-10-12");
  });

  await t.test("the end is exclusive: the day after, the gym is back", () => {
    const env = resolve("2026-10-12", [weeks]);
    assert.equal(env.kind, "gym");
    assert.equal(env.source, "default");
  });

  await t.test("the goal is untouched by environment rows", () => {
    // The environment carries no goal fields at all — the shape itself keeps
    // §14 honest: only the exercise universe and constraints change.
    const env = NO_EQUIPMENT();
    const keys = Object.keys(env).sort();
    assert.deepEqual(keys, [
      "availableEquipmentIds",
      "constrained",
      "effectiveFrom",
      "isTemporary",
      "kind",
      "limitations",
      "source",
      "unavailableEquipmentIds",
    ]);
  });
});

test("resolution is deterministic under row reordering", () => {
  const a = period("home_no_equipment", { id: "p_a", effectiveFrom: "2026-10-01" });
  const b = period("home_limited_equipment", { id: "p_b", effectiveFrom: "2026-10-03" });
  const first = resolve("2026-10-04", [a, b]);
  const second = resolve("2026-10-04", [b, a]);
  assert.deepEqual(first, second);
  assert.equal(first.kind, "home_limited_equipment", "the later period wins");
});

// ---------------------------------------------------------------------------
// §36.7–§36.10 Exercise universe, constraints, substitution
// ---------------------------------------------------------------------------

test("adaptExercisesToEnvironment reshapes the exercise universe honestly", async (t) => {
  const session = [
    planned("barbell_bench_press"),
    planned("barbell_row"),
    planned("barbell_back_squat"),
    planned("plank"),
  ];

  await t.test("equipment-free work passes through untouched", () => {
    const result = adaptExercisesToEnvironment({
      exercises: session,
      catalog: CATALOG,
      environment: NO_EQUIPMENT(),
    });
    const plank = result.exercises.find((item) => item.name === "Plank");
    assert.ok(plank);
    assert.equal(plank.exerciseId, bySlug("plank").id);
    assert.equal(
      result.substitutions.some((item) => item.originalExerciseName === "Plank"),
      false,
    );
  });

  await t.test("unavailable equipment forces an explicit substitution", () => {
    const result = adaptExercisesToEnvironment({
      exercises: session,
      catalog: CATALOG,
      environment: NO_EQUIPMENT(),
    });
    const benchSub = result.substitutions.find(
      (item) => item.originalExerciseName === "Barbell Bench Press",
    );
    assert.ok(benchSub, "bench press must be substituted, not silently kept");
    assert.equal(benchSub.replacementExerciseName, "Push-Up");
    assert.equal(benchSub.reason, "equipment_unavailable");
    assert.deepEqual(benchSub.musclesPreserved, ["pectoralis_major"]);
  });

  await t.test("a substitution never requires unavailable equipment", () => {
    for (const kind of [
      "home_no_equipment",
      "home_limited_equipment",
      "home",
      "hotel",
      "travel",
    ] as const) {
      const environment = resolve("2026-10-03", [period(kind)]);
      const available = new Set(environment.availableEquipmentIds);
      const result = adaptExercisesToEnvironment({
        exercises: session,
        catalog: CATALOG,
        environment,
      });
      for (const exercise of result.exercises) {
        const knowledge = CATALOG.find((item) => item.id === exercise.exerciseId);
        assert.ok(knowledge, `adapted exercise ${exercise.exerciseId} must exist in catalog`);
        for (const equipmentId of knowledge.requiredEquipmentIds) {
          assert.ok(
            available.has(equipmentId),
            `${knowledge.slug} requires ${equipmentId} which ${kind} does not provide`,
          );
        }
      }
    }
  });

  await t.test("equivalence is never overstated without load progression", () => {
    const result = adaptExercisesToEnvironment({
      exercises: session,
      catalog: CATALOG,
      environment: NO_EQUIPMENT(),
    });
    for (const substitution of result.substitutions) {
      assert.notEqual(
        substitution.equivalence,
        "equivalent",
        `${substitution.originalExerciseName} → ${substitution.replacementExerciseName} must not claim equivalence`,
      );
      assert.ok(substitution.stimulusSimilarity > 0 && substitution.stimulusSimilarity <= 1);
      assert.ok(substitution.relationship.includes("substitution"));
    }
    const benchSub = result.substitutions.find(
      (item) => item.originalExerciseName === "Barbell Bench Press",
    );
    assert.ok(benchSub);
    assert.equal(benchSub.equivalence, "partial");
    assert.ok(benchSub.relationship.includes("external-load progression unavailable"));
  });

  await t.test("excluded exercises are never selected as replacements", () => {
    const pushUp = bySlug("push_up");
    const result = adaptExercisesToEnvironment({
      exercises: [planned("barbell_bench_press")],
      catalog: CATALOG,
      environment: NO_EQUIPMENT(),
      preferences: { [pushUp.id]: "excluded" } as Readonly<Record<string, ExercisePreferenceKind>>,
    });
    assert.equal(result.exercises.length, 0, "no eligible replacement means drop, not force");
    assert.ok(result.warnings.some((warning) => warning.includes("Barbell Bench Press")));
    assert.deepEqual(result.muscleCoverageLost, ["pectoralis_major"]);
  });
});

// ---------------------------------------------------------------------------
// §36.11–§36.12 Muscle coverage and the back/pulling limitation
// ---------------------------------------------------------------------------

test("pulling/back limitations are stated, never papered over", async (t) => {
  const session = [planned("barbell_row"), planned("pull_up")];
  const environment = NO_EQUIPMENT();
  const result = adaptExercisesToEnvironment({
    exercises: session,
    catalog: CATALOG,
    environment,
  });

  await t.test("no-equipment work cannot stand in for loaded pulling", () => {
    // Neither lats exercise has an equipment-free candidate: both slots are
    // removed rather than faked (§18).
    assert.equal(result.exercises.length, 0);
    assert.deepEqual(result.muscleCoverageLost, ["latissimus_dorsi", "rhomboids"]);
    assert.ok(result.warnings.length >= 2);
    for (const warning of result.warnings) {
      assert.ok(warning.includes("removed rather than faked"));
    }
  });

  await t.test("an explicit back limitation travels with the adaptation", () => {
    const backLimitation = result.limitations.find(
      (item) => item.subject === "back" && item.description.includes("Loaded pulling"),
    );
    assert.ok(backLimitation, "the pulling shortfall must be an explicit limitation");
    assert.ok(backLimitation.retainedStimulus < 0.5);
    const loadLimitation = result.limitations.find((item) => item.kind === "load_progression");
    assert.ok(loadLimitation);
  });

  await t.test("the honesty note explains the compromise in user terms", () => {
    assert.ok(result.honestyNote.includes("cannot fully reproduce the pulling work"));
    assert.ok(result.honestyNote.includes("temporary plan"));
    assert.equal(result.loadProgressionAvailable, false);
  });

  await t.test("with a pull-up bar, vertical pulling survives", () => {
    const limited = resolve("2026-10-03", [period("home_limited_equipment")]);
    const kept = adaptExercisesToEnvironment({
      exercises: [planned("pull_up")],
      catalog: CATALOG,
      environment: limited,
    });
    assert.equal(kept.exercises.length, 1);
    const keptPullUp = kept.exercises.find((item) => item.name === "Pull-Up");
    assert.ok(keptPullUp);
    assert.equal(keptPullUp.exerciseId, bySlug("pull_up").id);
    assert.deepEqual(kept.muscleCoverageLost, []);
  });
});

// ---------------------------------------------------------------------------
// §36.11 Muscle coverage preservation (positive direction)
// ---------------------------------------------------------------------------

test("muscle coverage preserved and lost are tracked explicitly", () => {
  const result = adaptExercisesToEnvironment({
    exercises: [planned("barbell_bench_press"), planned("barbell_back_squat"), planned("plank")],
    catalog: CATALOG,
    environment: NO_EQUIPMENT(),
  });
  assert.deepEqual(result.muscleCoveragePreserved, [
    "abdominals",
    "pectoralis_major",
    "quadriceps",
  ]);
  assert.deepEqual(result.muscleCoverageLost, []);
});

// ---------------------------------------------------------------------------
// §36.13–§36.14 No blind volume inflation; duration stays budgetable
// ---------------------------------------------------------------------------

test("environment adaptation never inflates volume and stays duration-budgetable", async (t) => {
  const session = [
    planned("barbell_bench_press", { targetSets: 4 }),
    planned("barbell_row", { targetSets: 4 }),
    planned("barbell_back_squat", { targetSets: 4 }),
    planned("plank", { targetSets: 2 }),
  ];
  const result = adaptExercisesToEnvironment({
    exercises: session,
    catalog: CATALOG,
    environment: NO_EQUIPMENT(),
  });

  await t.test("set counts are carried over, never multiplied (§19)", () => {
    const before = session.reduce((sum, item) => sum + item.targetSets, 0);
    const after = result.exercises.reduce((sum, item) => sum + item.targetSets, 0);
    assert.ok(after <= before, `adapted volume ${after} must not exceed ${before}`);
    for (const exercise of result.exercises) assert.ok(exercise.targetSets >= 1);
  });

  await t.test("the adapted session fits the same duration budget (§20)", () => {
    const duration = estimateSessionDuration(
      result.exercises,
      "full_body",
      { maxSessionDurationMinutes: 60, trainingExperience: "intermediate" },
      "hypertrophy",
    );
    assert.ok(duration.estimatedMinutes > 0);
    assert.ok(
      duration.estimatedMinutes <= 60,
      `bodyweight session estimated at ${duration.estimatedMinutes}min must fit 60min`,
    );
  });
});

// ---------------------------------------------------------------------------
// §36.19 Determinism
// ---------------------------------------------------------------------------

test("the same environment and session always adapt identically", () => {
  const session = [
    planned("barbell_bench_press"),
    planned("barbell_row"),
    planned("barbell_back_squat"),
  ];
  const environment = NO_EQUIPMENT();
  const first = adaptExercisesToEnvironment({ exercises: session, catalog: CATALOG, environment });
  const second = adaptExercisesToEnvironment({
    exercises: session,
    catalog: [...CATALOG].reverse(),
    environment,
  });
  assert.deepEqual(first, second);

  // And the resolved environment itself is order-independent.
  const p1 = period("home_no_equipment", { id: "p1", effectiveFrom: "2026-10-01" });
  const p2 = period("home", { id: "p2", effectiveFrom: "2026-09-01" });
  assert.deepEqual(resolve("2026-10-03", [p1, p2]), resolve("2026-10-03", [p2, p1]));
});

// ---------------------------------------------------------------------------
// §36.20 no_change where adaptation is not justified
// ---------------------------------------------------------------------------

test("no environment change means no adaptation is demanded", async (t) => {
  await t.test("environmentChangeNeeded only fires on a real difference", () => {
    assert.equal(environmentChangeNeeded(undefined, "gym"), false);
    assert.equal(environmentChangeNeeded("gym", "gym"), false);
    assert.equal(environmentChangeNeeded("gym", "home_no_equipment"), true);
    assert.equal(environmentChangeNeeded("home", "gym"), true);
  });

  await t.test("a gym environment adapts nothing", () => {
    const session = [planned("barbell_bench_press"), planned("barbell_row")];
    const result = adaptExercisesToEnvironment({
      exercises: session,
      catalog: CATALOG,
      environment: resolve("2026-10-03"),
    });
    assert.deepEqual(result.substitutions, []);
    assert.deepEqual(
      result.exercises.map((item) => item.exerciseId),
      session.map((item) => item.exerciseId),
    );
    assert.deepEqual(result.warnings, []);
  });
});

// ---------------------------------------------------------------------------
// Configuration + progression mechanisms (§17, §34)
// ---------------------------------------------------------------------------

test("environment configuration is versioned and drives every behaviour", async (t) => {
  await t.test("versions are pinned, never silently redefined", () => {
    assert.equal(ENVIRONMENT_CONFIG_VERSION, "fitcoach.environment.v1");
    assert.equal(ENVIRONMENT_VERSION, "fitcoach.environment.v1");
    assert.equal(DEFAULT_ENVIRONMENT_CONFIGURATION.version, "fitcoach.environment.v1");
  });

  await t.test("progression mechanisms differ by environment, explicitly", () => {
    const gym = resolve("2026-10-01");
    const home = NO_EQUIPMENT();
    assert.deepEqual([...environmentProgressionMechanisms(gym)], [
      "load",
      "reps",
      "rir",
      "sets",
    ]);
    assert.deepEqual([...environmentProgressionMechanisms(home)], [
      "reps",
      "rir",
      "variation",
      "rom",
      "tempo",
      "sets",
    ]);
  });

  await t.test("the constraint summary is a deterministic inventory", () => {
    const summary = summarizeEnvironmentConstraint(NO_EQUIPMENT());
    assert.equal(summary.kind, "home_no_equipment");
    assert.equal(summary.loadProgressionAvailable, false);
    assert.deepEqual([...summary.unsupportedMovementPatterns], [
      "horizontal_pull",
      "vertical_pull",
    ]);
    assert.ok(summary.constrainedMuscleSlugs.includes("latissimus_dorsi"));
    assert.ok(summary.honestyNote.length > 0);
    assert.equal(
      summarizeEnvironmentConstraint(NO_EQUIPMENT()).honestyNote,
      summary.honestyNote,
    );
  });

  await t.test("every environment kind has a profile and an honesty note", () => {
    for (const kind of [
      "gym",
      "home",
      "home_no_equipment",
      "home_limited_equipment",
      "hotel",
      "travel",
      "outdoor",
      "custom",
    ] as const) {
      const profile = getEnvironmentConfiguration(kind);
      assert.equal(profile.version, "fitcoach.environment.v1");
      assert.ok(profile.honestyNote.length > 0, `${kind} needs an honesty note`);
      assert.ok(Array.isArray(profile.constrainedMuscleSlugs));
    }
  });
});

// ---------------------------------------------------------------------------
// §37 Invariants — claims that must hold for every environment input
// ---------------------------------------------------------------------------

test("environment invariants hold for arbitrary inputs", async (t) => {
  await t.test("environment limitations are stable and sorted within each kind", () => {
    const first = environmentLimitations("home_no_equipment");
    const second = environmentLimitations("home_no_equipment");
    assert.deepEqual(first, second);
    const subjectsOf = (kind: string) =>
      first.filter((item) => item.kind === kind).map((item) => item.subject);
    for (const kind of ["muscle_coverage", "movement_pattern", "equipment"]) {
      const subjects = subjectsOf(kind);
      assert.deepEqual(subjects, [...subjects].sort(), `${kind} subjects must be sorted`);
    }
    assert.equal(first.at(-1)?.kind, "load_progression");
  });

  await t.test("unavailable equipment is never reported as available", () => {
    const environment = resolve("2026-10-03", [
      period("home", { unavailableEquipmentIds: ["eq_dumbbells"] }),
    ]);
    assert.ok(!environment.availableEquipmentIds.includes("eq_dumbbells"));
    assert.ok(environment.unavailableEquipmentIds.includes("eq_dumbbells"));
  });

  await t.test("adaptation output is a subset-plus-substitutes of the input", () => {
    const session = [planned("barbell_bench_press"), planned("plank")];
    const result = adaptExercisesToEnvironment({
      exercises: session,
      catalog: CATALOG,
      environment: NO_EQUIPMENT(),
    });
    assert.ok(result.exercises.length <= session.length);
    const inputIds = new Set(session.map((item) => item.id));
    for (const exercise of result.exercises) {
      assert.ok(inputIds.has(exercise.id), "slots are never invented by adaptation");
      assert.ok(exercise.selectionReason.includes("Substituted") || exercise.id.includes("_"));
    }
    // A substituted slot names its origin in the decision snapshot (§26).
    for (const exercise of result.exercises) {
      if (exercise.exerciseDecisionSnapshot?.substitutedFromExerciseId) {
        assert.equal(exercise.exerciseDecisionSnapshot.environmentKind, "home_no_equipment");
        assert.ok((exercise.exerciseDecisionSnapshot.stimulusSimilarity ?? 0) > 0);
      }
    }
  });

  await t.test("no environment can silently re-activate unsupported patterns", () => {
    const result = adaptExercisesToEnvironment({
      exercises: [planned("barbell_row")],
      catalog: CATALOG,
      environment: NO_EQUIPMENT(),
    });
    for (const exercise of result.exercises) {
      const knowledge = CATALOG.find((item) => item.id === exercise.exerciseId);
      assert.ok(knowledge);
      assert.notEqual(knowledge.movementPattern, "horizontal_pull");
      assert.notEqual(knowledge.movementPattern, "vertical_pull");
    }
  });
});
