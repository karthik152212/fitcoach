import assert from "node:assert/strict";
import { test } from "node:test";
import type { NutrientAmounts, Profile } from "@fitcoach/domain";
import {
  compareUuidv7,
  decimalToNumber,
  foodNutrientsFromRow,
  foodNutrientsToColumns,
  isUuid,
  isUuidv7,
  itemSnapshotColumns,
  itemSnapshotFromRow,
  newUuidv7,
  roundNutrients,
  toCalendarDate,
  toTimestamp,
  totalsSnapshotColumns,
  totalsSnapshotFromRow,
  uuidv7TimestampMs,
} from "..";
import { changedMaterialFields } from "../repositories/identity";
import {
  ConflictError,
  ConstraintValidationError,
  ImmutableRecordError,
  NotFoundError,
  RepositoryError,
  toRepositoryError,
} from "../errors";
import { SEED_FIXED_IDS } from "../seed/fixtures";
import { BODYWEIGHT_EXERCISES } from "../seed/knowledgeExercisesBodyweight";
import { KNOWLEDGE_EXERCISES, KNOWLEDGE_SUBSTITUTIONS } from "../seed/knowledgeExercises";
import {
  KNOWLEDGE_EQUIPMENT,
  KNOWLEDGE_MOVEMENT_FUNCTIONS,
  KNOWLEDGE_MUSCLES,
} from "../seed/knowledgeTaxonomy";
import { formSteps } from "../seed/knowledgeTypes";
import { REQUIRED_FORM_GUIDANCE_KEYS } from "@fitcoach/domain";

// ---------------------------------------------------------------------------
// UUIDv7
// ---------------------------------------------------------------------------

test("newUuidv7 produces canonical version-7 UUIDs", () => {
  const id = newUuidv7();
  assert.match(
    id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(isUuidv7(id), true);
  assert.equal(isUuid(id), true);
});

test("uuidv7 ids are strictly increasing, including within one millisecond", () => {
  const ids: string[] = [];
  for (let i = 0; i < 5_000; i += 1) {
    ids.push(newUuidv7());
  }
  for (let i = 1; i < ids.length; i += 1) {
    assert.ok(ids[i]! > ids[i - 1]!, `id ${i} must sort after ${i - 1}`);
  }
  // Lexicographic order equals generation order → time-sortable ids.
  const sorted = [...ids].sort();
  assert.deepEqual(sorted, ids);
});

test("uuidv7 stays monotonic when the clock moves backwards", () => {
  const base = Date.now() + 60_000;
  const forward = newUuidv7(base);
  const backward = newUuidv7(base - 60_000); // one minute behind
  assert.ok(backward > forward, "a backwards clock must not produce a smaller id");
});

test("uuidv7 embeds a decodable timestamp", () => {
  const now = Date.now() + 120_000; // fixed, injectable clock (after prior tests)
  const id = newUuidv7(now);
  assert.equal(uuidv7TimestampMs(id), now);
  assert.throws(() => uuidv7TimestampMs("not-a-uuid"), RangeError);
  assert.throws(() => uuidv7TimestampMs("3b2c1d0e-9a8b-4c5d-8e7f-0a1b2c3d4e5f"), RangeError);
});

test("isUuidv7 rejects other versions, variants and garbage", () => {
  assert.equal(isUuidv7("3b2c1d0e-9a8b-4c5d-8e7f-0a1b2c3d4e5f"), false); // v4
  assert.equal(isUuidv7("3b2c1d0e-9a8b-7c5d-ce7f-0a1b2c3d4e5f"), false); // variant 11xx
  assert.equal(isUuidv7(""), false);
  assert.equal(isUuidv7("nope"), false);
  assert.equal(isUuid("nope"), false);
  // Fixed fixture ids are valid UUIDv7s (zero timestamp, reserved for seed).
  assert.equal(isUuidv7(SEED_FIXED_IDS.oats), true);
});

test("compareUuidv7 orders ids by time", () => {
  const older = newUuidv7(Date.now() + 180_000);
  const newer = newUuidv7(Date.now() + 240_000);
  assert.equal(compareUuidv7(older, newer), -1);
  assert.equal(compareUuidv7(newer, older), 1);
  assert.equal(compareUuidv7(older, older.toLowerCase()), 0);
});

test("newUuidv7 rejects out-of-range timestamps", () => {
  assert.throws(() => newUuidv7(-1), RangeError);
  assert.throws(() => newUuidv7(Number.NaN), RangeError);
});

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

test("roundNutrients applies deterministic column precision", () => {
  const messy: NutrientAmounts = {
    caloriesKcal: 303.235,
    proteinGrams: 10.5649,
    carbohydrateGrams: 54.1651,
    fatGrams: 5.2,
    fiberGrams: 8.08449,
  };
  const rounded = roundNutrients(messy);
  assert.equal(rounded.caloriesKcal, 303.24); // 2 decimals
  assert.equal(rounded.proteinGrams, 10.565); // 3 decimals
  assert.equal(rounded.carbohydrateGrams, 54.165);
  assert.equal(rounded.fiberGrams, 8.084);
  assert.equal(rounded.sugarsGrams, undefined);
  assert.throws(() => roundNutrients({ ...messy, caloriesKcal: Number.NaN }), RangeError);
});

test("food nutrient columns round-trip through row mapping", () => {
  const nutrients: NutrientAmounts = {
    caloriesKcal: 379,
    proteinGrams: 13.2,
    carbohydrateGrams: 67.7,
    fatGrams: 6.5,
    fiberGrams: 10.1,
  };
  const columns = foodNutrientsToColumns(nutrients);
  const back = foodNutrientsFromRow(columns);
  assert.equal(back.caloriesKcal, 379);
  assert.equal(back.proteinGrams, 13.2);
  assert.equal(back.carbohydrateGrams, 67.7);
  assert.equal(back.fatGrams, 6.5);
  assert.equal(back.fiberGrams, 10.1);
  assert.equal(back.sugarsGrams, undefined);
});

test("snapshot column shapes match meal_items and meals/daily tables", () => {
  const snapshot: NutrientAmounts = {
    caloriesKcal: 200.5,
    proteinGrams: 30.25,
    carbohydrateGrams: 10,
    fatGrams: 5,
    fiberGrams: 2,
  };
  const item = itemSnapshotColumns(snapshot);
  assert.deepEqual(item, {
    caloriesKcal: 200.5,
    proteinG: 30.25,
    carbohydrateG: 10,
    fatG: 5,
    fiberG: 2,
  });
  const totals = totalsSnapshotColumns(snapshot);
  assert.deepEqual(totals, {
    totalCaloriesKcal: 200.5,
    totalProteinG: 30.25,
    totalCarbohydrateG: 10,
    totalFatG: 5,
    totalFiberG: 2,
  });
  assert.deepEqual(itemSnapshotFromRow(item), {
    caloriesKcal: 200.5,
    proteinGrams: 30.25,
    carbohydrateGrams: 10,
    fatGrams: 5,
    fiberGrams: 2,
  });
  assert.deepEqual(totalsSnapshotFromRow(totals), {
    caloriesKcal: 200.5,
    proteinGrams: 30.25,
    carbohydrateGrams: 10,
    fatGrams: 5,
    fiberGrams: 2,
  });
});

test("timestamp and calendar-date mapping are exact", () => {
  assert.equal(toTimestamp(new Date("2026-08-25T07:30:00Z")), "2026-08-25T07:30:00.000Z");
  assert.equal(toCalendarDate(new Date("2026-08-25T00:00:00.000Z")), "2026-08-25");
  assert.equal(toCalendarDate(new Date("2026-12-31T23:59:59.999Z")), "2026-12-31");
  assert.equal(decimalToNumber(null), undefined);
  assert.equal(decimalToNumber("12.50"), 12.5);
});

// ---------------------------------------------------------------------------
// Profile revisions (approved decision 3)
// ---------------------------------------------------------------------------

test("changedMaterialFields detects coaching-relevant changes only", () => {
  const before: Profile = {
    heightCm: 178,
    sex: "male",
    trainingExperience: "intermediate",
    trainingDaysPerWeek: 4,
    sessionDurationMinutes: 60,
    limitations: ["knee"],
    unitSystem: "metric",
  };

  const unitOnly: Profile = { ...before, unitSystem: "imperial" };
  assert.deepEqual(changedMaterialFields(before, unitOnly), []);

  const heightOnly: Profile = { ...before, heightCm: 180 };
  assert.deepEqual(changedMaterialFields(before, heightOnly), ["heightCm"]);

  const limitationOrder: Profile = { ...before, limitations: ["knee"] };
  assert.deepEqual(changedMaterialFields(before, limitationOrder), [], "order is irrelevant");

  const cleared: Profile = { ...before, limitations: undefined };
  assert.deepEqual(changedMaterialFields(before, cleared), ["limitations"]);
});

// ---------------------------------------------------------------------------
// Error taxonomy
// ---------------------------------------------------------------------------

test("toRepositoryError maps Prisma codes and append-only triggers", () => {
  const unique = toRepositoryError({ code: "P2002", message: "Unique constraint" });
  assert.ok(unique instanceof ConflictError);
  assert.equal(unique.kind, "conflict");

  const fk = toRepositoryError({ code: "P2003", message: "FK" });
  assert.equal(fk.kind, "validation");

  const check = toRepositoryError({ code: "P2004", message: "Check" });
  assert.equal(check.kind, "validation");

  const missing = toRepositoryError({ code: "P2025", message: "Record not found" });
  assert.ok(missing instanceof NotFoundError);

  const appendOnly = toRepositoryError(
    new Error("table body_measurements is append-only; record a new row instead of updating"),
  );
  assert.ok(appendOnly instanceof ImmutableRecordError);

  const frozen = toRepositoryError(new Error("exercise_set x belongs to a finished workout and is frozen"));
  assert.ok(frozen instanceof ImmutableRecordError);

  const unknown = toRepositoryError(new Error("boom"));
  assert.ok(unknown instanceof RepositoryError);
  assert.equal(unknown.kind, "internal");

  // Idempotent pass-through.
  const already = new ConflictError("dup");
  assert.equal(toRepositoryError(already), already);
});

test("ConstraintValidationError is a RepositoryError with validation kind", () => {
  const error = new ConstraintValidationError("bad");
  assert.ok(error instanceof RepositoryError);
  assert.equal(error.kind, "validation");
});

// ---------------------------------------------------------------------------
// Seed fixture invariants (pure, no database)
// ---------------------------------------------------------------------------

test("knowledge fixtures are internally consistent", () => {
  const equipmentSlugs = new Set(KNOWLEDGE_EQUIPMENT.map((item) => item.slug));
  assert.equal(equipmentSlugs.size, KNOWLEDGE_EQUIPMENT.length, "equipment slugs unique");

  const muscleSlugs = new Set(KNOWLEDGE_MUSCLES.map((item) => item.slug));
  assert.equal(muscleSlugs.size, KNOWLEDGE_MUSCLES.length, "muscle slugs unique");

  const functionSlugs = new Set(KNOWLEDGE_MOVEMENT_FUNCTIONS.map((item) => item.slug));
  assert.equal(functionSlugs.size, KNOWLEDGE_MOVEMENT_FUNCTIONS.length, "function slugs unique");

  const structureKey = new Set<string>();
  for (const muscle of KNOWLEDGE_MUSCLES) {
    for (const structure of muscle.structures ?? []) {
      const key = `${muscle.slug}/${structure.slug}`;
      assert.ok(!structureKey.has(key), `structure ${key} unique`);
      structureKey.add(key);
    }
  }

  const exerciseSlugs = new Set(KNOWLEDGE_EXERCISES.map((item) => item.slug));
  assert.equal(exerciseSlugs.size, KNOWLEDGE_EXERCISES.length, "exercise slugs unique");

  const variationKeys = new Set(KNOWLEDGE_EXERCISES.map((item) => item.variationKey));
  assert.equal(
    variationKeys.size,
    KNOWLEDGE_EXERCISES.length,
    "variation keys unique across the catalog",
  );

  for (const exercise of KNOWLEDGE_EXERCISES) {
    for (const equipment of exercise.equipment) {
      assert.ok(equipmentSlugs.has(equipment), `${exercise.slug} references equipment ${equipment}`);
    }
    for (const relation of exercise.relations) {
      assert.ok(muscleSlugs.has(relation.muscle), `${exercise.slug} references muscle ${relation.muscle}`);
      if (relation.weight !== undefined) {
        assert.ok(relation.weight > 0 && relation.weight <= 1, "weight in (0, 1]");
      }
      if (relation.confidence !== undefined) {
        assert.ok(relation.confidence > 0 && relation.confidence <= 1, "confidence in (0, 1]");
      }
    }
    assert.ok(exercise.relations.length > 0, `${exercise.slug} has at least one muscle relation`);

    for (const relation of exercise.structureRelations ?? []) {
      assert.ok(
        structureKey.has(`${relation.muscle}/${relation.structure}`),
        `${exercise.slug} references structure ${relation.muscle}/${relation.structure}`,
      );
    }

    // A variation may never reference an unmodelled muscle or structure.
    for (const relation of exercise.structureRelations ?? []) {
      assert.ok(muscleSlugs.has(relation.muscle), `${exercise.slug} structure muscle exists`);
    }

    for (const fn of exercise.movementFunctions) {
      assert.ok(functionSlugs.has(fn), `${exercise.slug} references function ${fn}`);
    }
    assert.ok(
      exercise.movementFunctions.includes(exercise.primaryMovementFunction),
      `${exercise.slug} primary function is in its function set`,
    );

    const steps = formSteps(exercise.form);
    const keys = new Set(steps.map((step) => step.key));
    for (const required of REQUIRED_FORM_GUIDANCE_KEYS) {
      assert.ok(keys.has(required), `${exercise.slug} form guidance includes ${required}`);
    }
  }

  // Substitutions must reference real exercises and never point at themselves.
  for (const substitution of KNOWLEDGE_SUBSTITUTIONS) {
    assert.ok(exerciseSlugs.has(substitution.exercise), `substitution source ${substitution.exercise}`);
    assert.ok(exerciseSlugs.has(substitution.substitute), `substitution target ${substitution.substitute}`);
    assert.notEqual(substitution.exercise, substitution.substitute, "no self substitution");
    assert.ok(substitution.reason.length > 0, "substitution carries a reason");
  }

  // Every major muscle group used by training logic has a fixture muscle.
  for (const slug of ["pectoralis_major", "latissimus_dorsi", "quadriceps", "hamstrings"]) {
    assert.ok(muscleSlugs.has(slug), `fixture muscle ${slug} present`);
  }
});

// ---------------------------------------------------------------------------
// Phase 3.1.1 — equipment-free catalogue invariants (pure, no database)
// ---------------------------------------------------------------------------

test("aliases never collide with another exercise's slug or alias", () => {
  const slugs = new Set(KNOWLEDGE_EXERCISES.map((item) => item.slug));
  const seen = new Map<string, string>();
  for (const exercise of KNOWLEDGE_EXERCISES) {
    for (const alias of exercise.aliases ?? []) {
      const key = alias.toLowerCase();
      assert.ok(!slugs.has(key), `alias "${alias}" on ${exercise.slug} shadows a canonical slug`);
      const owner = seen.get(key);
      assert.ok(!owner, `alias "${alias}" is declared by both ${owner} and ${exercise.slug}`);
      seen.set(key, exercise.slug);
    }
  }
});

test("equipment-free entries genuinely require nothing and stay honest about pulling", () => {
  const equipmentFree = KNOWLEDGE_EXERCISES.filter((item) => item.equipment.length === 0);
  assert.ok(
    equipmentFree.length >= 25,
    `expected a materially expanded no-equipment catalogue, found ${equipmentFree.length}`,
  );

  for (const exercise of BODYWEIGHT_EXERCISES) {
    assert.deepEqual([...exercise.equipment], [], `${exercise.slug} must require no equipment`);
    assert.equal(
      exercise.loadingCharacteristic,
      "bodyweight_only",
      `${exercise.slug} loading is bodyweight-only`,
    );
    assert.ok(
      exercise.relations.some((relation) => relation.role === "primary_mover"),
      `${exercise.slug} must declare a primary mover (the planner cannot select it otherwise)`,
    );
    assert.ok(exercise.movementFunctions.length > 0, `${exercise.slug} has movement functions`);
    assert.ok(exercise.movementPattern !== undefined, `${exercise.slug} has a movement pattern`);
  }

  // Pulling honesty: nothing equipment-free may pose as a pull, and nothing
  // equipment-free may claim the lats or biceps as a primary target.
  for (const exercise of equipmentFree) {
    assert.ok(
      exercise.movementPattern !== "horizontal_pull" && exercise.movementPattern !== "vertical_pull",
      `${exercise.slug} is not a pulling pattern`,
    );
    assert.ok(
      !exercise.relations.some(
        (relation) =>
          relation.role === "primary_mover" &&
          (relation.muscle === "latissimus_dorsi" || relation.muscle === "biceps_brachii"),
      ),
      `${exercise.slug} must not claim a pulling primary with no equipment`,
    );
  }
});

test("the no-equipment universe covers the categories a home week needs", () => {
  const equipmentFree = KNOWLEDGE_EXERCISES.filter((item) => item.equipment.length === 0);
  const primaryFor = (muscle: string) =>
    equipmentFree.filter((item) =>
      item.relations.some((relation) => relation.muscle === muscle && relation.role === "primary_mover"),
    );
  const withPattern = (pattern: string) =>
    equipmentFree.filter((item) => item.movementPattern === pattern);

  assert.ok(withPattern("squat").length >= 2, "knee-dominant squat coverage");
  assert.ok(withPattern("lunge").length >= 2, "lunge coverage");
  assert.ok(withPattern("hinge").length >= 2, "hip-dominant hinge coverage");
  assert.ok(primaryFor("quadriceps").length >= 2, "quadriceps");
  assert.ok(primaryFor("gluteus_maximus").length >= 2, "glutes");
  assert.ok(primaryFor("hamstrings").length >= 2, "hamstrings");
  assert.ok(primaryFor("gastrocnemius").length >= 1, "gastrocnemius");
  assert.ok(primaryFor("soleus").length >= 1, "soleus");
  assert.ok(primaryFor("pectoralis_major").length >= 2, "chest");
  assert.ok(primaryFor("deltoid_front").length >= 1, "shoulders");
  assert.ok(primaryFor("triceps_brachii").length >= 1, "triceps");
  assert.ok(primaryFor("erector_spinae").length >= 1, "spinal erectors");
  assert.ok(primaryFor("rectus_abdominis").length >= 1, "rectus abdominis");
  assert.ok(primaryFor("transversus_abdominis").length >= 1, "transversus");
  assert.ok(primaryFor("obliques").length >= 1, "obliques");
});

test("bodyweight progression families share a variation-key prefix", () => {
  const families = new Map<string, string[]>();
  for (const exercise of KNOWLEDGE_EXERCISES) {
    const prefix = exercise.variationKey.split(":")[0]!;
    families.set(prefix, [...(families.get(prefix) ?? []), exercise.slug]);
  }

  for (const family of ["squat", "push_up", "glute_bridge", "calf_raise", "lunge"]) {
    const members = families.get(family) ?? [];
    assert.ok(
      members.length >= 2,
      `${family} must be a progression family (>= 2 variations), found ${members.join(", ") || "none"}`,
    );
  }
});

test("equipment-free substitutions never claim a floor movement replaces loaded pulling", () => {
  const bySlug = new Map(KNOWLEDGE_EXERCISES.map((item) => [item.slug, item]));
  for (const substitution of KNOWLEDGE_SUBSTITUTIONS) {
    const substitute = bySlug.get(substitution.substitute)!;
    if (substitute.equipment.length > 0) continue;
    // An equipment-free substitute for a pulling movement must be worded as
    // partial and must be ranked as the weak option it honestly is.
    const source = bySlug.get(substitution.exercise)!;
    if (source.movementPattern === "horizontal_pull" || source.movementPattern === "vertical_pull") {
      assert.ok(
        (substitution.rankHint ?? 0) === 0,
        `${substitution.exercise} -> ${substitution.substitute} must not be promoted over a real pull`,
      );
      assert.ok(
        /partial|cannot|never/i.test(substitution.reason),
        `${substitution.exercise} -> ${substitution.substitute} must state its limitation`,
      );
    }
  }
});
