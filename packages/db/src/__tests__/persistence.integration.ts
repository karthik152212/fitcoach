import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { NutrientAmounts, Profile, ProgressionAction } from "@fitcoach/domain";
import type { Repositories, TestPostgres } from "..";
import {
  ConflictError,
  ConstraintValidationError,
  ImmutableRecordError,
  NotFoundError,
  SEED_FIXTURE_LABEL,
  createPrismaClient,
  createRepositories,
  newUuidv7,
  seedDatabase,
  startTestPostgres,
} from "..";

/**
 * Integration tests: a real PostgreSQL (embedded or FITCOACH_TEST_DATABASE_URL)
 * with the real migrations applied, exercised through the repository bundle.
 *
 * Two kinds of assertion:
 *   1. behaviour — versioning, idempotency, cascades, snapshots;
 *   2. database-level guarantees — append-only triggers, lifecycle guards and
 *      unique indexes are verified by issuing raw Prisma writes that bypass
 *      the repository layer, proving the schema itself enforces the rule.
 *
 * Historical integrity (the milestone's three scenarios) is covered
 * explicitly: food edits never rewrite logged meals, goal supersession never
 * rewrites coaching output, and workouts stay traceable to the plan version
 * they were written against.
 */

let harness: TestPostgres | undefined;
let prisma: PrismaClient | undefined;
let repos: Repositories;

before(
  async () => {
    harness = await startTestPostgres();
    prisma = createPrismaClient({ url: harness.url });
    repos = createRepositories(prisma);
    await seedDatabase(prisma);
  },
  { timeout: 600_000 },
);

after(async () => {
  await prisma?.$disconnect();
  await harness?.stop();
});

let userCounter = 0;

async function newUser(label: string): Promise<{ id: string; email: string; timezone: string }> {
  userCounter += 1;
  const email = `${label}-${userCounter}-${newUuidv7().slice(0, 8)}@example.com`;
  const user = await repos.users.create({ email, displayName: label, timezone: "Asia/Kolkata" });
  return { id: user.id, email: user.email ?? email, timezone: user.timezone };
}

async function exerciseIds(): Promise<string[]> {
  const list = await repos.exercises.listExercises();
  assert.ok(list.length >= 2, "seed must provide at least two exercises");
  return [list[0]!.id, list[1]!.id];
}

const ISO = (day: string, time = "06:00:00.000Z"): string => `2026-${day}T${time}`;

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

test("seed applies labeled first-party fixtures idempotently", async () => {
  const result = await seedDatabase(prisma!);
  assert.equal(result.label, SEED_FIXTURE_LABEL);
  assert.ok(result.equipment >= 10);
  assert.ok(result.exercises >= 10);
  assert.equal(result.foods, 3);

  // Re-running changes no counts (natural-key upserts).
  const again = await seedDatabase(prisma!);
  assert.deepEqual(
    { equipment: again.equipment, muscles: again.muscles, exercises: again.exercises, foods: again.foods },
    { equipment: result.equipment, muscles: result.muscles, exercises: result.exercises, foods: result.foods },
  );

  const exercises = await repos.exercises.listExercises();
  assert.equal(exercises.length, result.exercises);

  const devUser = await repos.users.findByEmail("dev@fitcoach.local");
  assert.ok(devUser);
  assert.equal(devUser.timezone, "Asia/Kolkata");
  assert.equal(devUser.profile.heightCm, 178);
});

test("seed persists the equipment-free catalogue with full targeting (Phase 3.1.1)", async () => {
  const knowledge = await repos.exercises.listExerciseKnowledge();
  const noEquipment = knowledge.filter((item) => item.requiredEquipmentIds.length === 0);
  assert.ok(
    noEquipment.length >= 25,
    `expected a materially expanded no-equipment catalogue, found ${noEquipment.length}`,
  );

  for (const item of noEquipment) {
    assert.ok(item.movementFunctions.length > 0, `${item.slug} has movement functions`);
    assert.ok(
      item.targets.some((target) => target.role === "primary_mover"),
      `${item.slug} declares a primary mover`,
    );
    assert.ok(
      item.movementPattern !== "horizontal_pull" && item.movementPattern !== "vertical_pull",
      `${item.slug} never poses as a pull with no equipment`,
    );
    assert.ok(
      !item.targets.some(
        (target) =>
          target.role === "primary_mover" &&
          (target.muscleSlug === "latissimus_dorsi" || target.muscleSlug === "biceps_brachii"),
      ),
      `${item.slug} never claims a pulling primary with no equipment`,
    );
  }

  const slugs = new Set(noEquipment.map((item) => item.slug));
  for (const expected of [
    "bodyweight_squat",
    "split_squat",
    "reverse_lunge",
    "skater_squat",
    "glute_bridge",
    "single_leg_glute_bridge",
    "bodyweight_good_morning",
    "single_leg_bodyweight_rdl",
    "hamstring_bridge",
    "standing_calf_raise",
    "single_leg_calf_raise",
    "bent_knee_calf_raise",
    "push_up",
    "knee_push_up",
    "diamond_push_up",
    "archer_push_up",
    "pike_push_up",
    "prone_y_raise",
    "reverse_snow_angel",
    "superman_hold",
    "plank",
    "side_plank",
    "reverse_crunch",
    "hollow_body_hold",
    "dead_bug",
  ]) {
    assert.ok(slugs.has(expected), `equipment-free exercise ${expected} is seeded`);
  }

  // Canonical identity: the glute bridge is its own exercise now, and the
  // loaded hip thrust no longer borrows the name.
  const gluteBridge = knowledge.find((item) => item.slug === "glute_bridge");
  assert.ok(gluteBridge);
  assert.ok(gluteBridge.aliases.includes("hip bridge"));
  const hipThrust = knowledge.find((item) => item.slug === "hip_thrust");
  assert.ok(hipThrust);
  assert.ok(!hipThrust.aliases.includes("glute bridge"));

  // Variation families survive persistence.
  const byPrefix = new Map<string, number>();
  for (const item of noEquipment) {
    const prefix = (item.variationKey ?? "").split(":")[0]!;
    byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
  }
  for (const family of ["squat", "push_up", "glute_bridge", "calf_raise", "lunge"]) {
    assert.ok((byPrefix.get(family) ?? 0) >= 2, `${family} progression family persisted`);
  }
});

// ---------------------------------------------------------------------------
// Identity: user, timezone, profile revisions
// ---------------------------------------------------------------------------

test("users persist with IANA timezone validation and case-insensitive email", async () => {
  const email = `Case-${newUuidv7().slice(0, 8)}@Example.COM`;
  const user = await repos.users.create({ email, displayName: "Casey", timezone: "Asia/Kolkata" });
  assert.equal(user.timezone, "Asia/Kolkata");

  // Lookups normalize case in both directions.
  assert.equal((await repos.users.findByEmail(email.toLowerCase()))?.id, user.id);
  assert.equal((await repos.users.findByEmail(email.toUpperCase()))?.id, user.id);

  // Duplicate email (different case) violates users_email_lower_unique.
  await assert.rejects(
    () => repos.users.create({ email: email.toLowerCase() }),
    ConflictError,
  );

  // Invalid timezones are rejected at the repository boundary.
  await assert.rejects(
    () => repos.users.create({ timezone: "Mars/Olympus_Mons" }),
    ConstraintValidationError,
  );
  await assert.rejects(
    () => repos.users.update(user.id, { timezone: "Not/AZone" }),
    ConstraintValidationError,
  );

  const updated = await repos.users.update(user.id, { timezone: "Europe/Berlin", displayName: "Renamed" });
  assert.equal(updated.timezone, "Europe/Berlin");
  assert.equal(updated.displayName, "Renamed");

  const loaded = await repos.users.findById(user.id);
  assert.equal(loaded?.timezone, "Europe/Berlin");
});

test("profile material changes append revisions; cosmetic changes do not", async () => {
  const user = await newUser("profile");
  const base: Profile = {
    birthDate: "1995-04-12",
    sex: "male",
    heightCm: 178,
    trainingExperience: "intermediate",
    trainingDaysPerWeek: 4,
    sessionDurationMinutes: 60,
    limitations: ["old knee sprain"],
    unitSystem: "metric",
  };

  await repos.profiles.upsert(user.id, base, "initial onboarding");
  // unit_system is a presentation preference: never produces a revision.
  await repos.profiles.upsert(user.id, { ...base, unitSystem: "imperial" });
  const reMeasured = await repos.profiles.upsert(
    user.id,
    { ...base, heightCm: 180 },
    "stadiometer re-measure",
  );

  assert.equal(reMeasured.heightCm, 180);
  assert.deepEqual(reMeasured.limitations, ["old knee sprain"]);

  const revisions = await repos.profiles.revisions(user.id);
  assert.equal(revisions.length, 2);

  const initial = revisions.find((r) => r.reason === "initial onboarding");
  const remeasure = revisions.find((r) => r.reason === "stadiometer re-measure");
  assert.ok(initial);
  assert.ok(remeasure);
  assert.ok(initial.changedFields.includes("heightCm"));
  assert.deepEqual(remeasure.changedFields, ["heightCm"]);
  assert.equal(remeasure.birthDate, "1995-04-12");
});

// ---------------------------------------------------------------------------
// Goals: interval versioning
// ---------------------------------------------------------------------------

test("goals are interval-versioned with exactly one active row", async () => {
  const user = await newUser("goals");
  const goalA = await repos.goals.create({
    userId: user.id,
    kind: "lean_recomposition",
    description: "Cut to 12% body fat",
    effectiveFrom: "2026-01-01",
    priorities: ["waist_control", "shoulder_width"],
    physiqueTarget: { bodyFatPercent: 12 },
  });
  assert.equal((await repos.goals.active(user.id))?.id, goalA.id);

  // A goal may not start before the currently active one.
  await assert.rejects(
    () => repos.goals.create({ userId: user.id, kind: "max_strength", effectiveFrom: "2025-12-01" }),
    ConflictError,
  );

  const goalB = await repos.goals.create({
    userId: user.id,
    kind: "max_strength",
    effectiveFrom: "2026-03-01",
  });

  // Goal A is closed and linked forward; its content is untouched.
  const closedA = await repos.goals.findById(goalA.id);
  assert.ok(closedA);
  assert.equal(closedA.effectiveUntil, "2026-03-01");
  assert.equal(closedA.supersededByGoalId, goalB.id);
  assert.equal(closedA.description, "Cut to 12% body fat");
  assert.deepEqual(closedA.priorities, ["waist_control", "shoulder_width"]);

  const active = await repos.goals.active(user.id);
  assert.equal(active?.id, goalB.id);

  const history = await repos.goals.history(user.id);
  assert.deepEqual(history.map((g) => g.id), [goalB.id, goalA.id]);
  assert.equal(history[1]?.physiqueTarget?.bodyFatPercent, 12);

  // Database-level: goals are lifecycle-only (effective_until/superseded_by).
  await assert.rejects(() =>
    prisma!.goal.update({ where: { id: goalB.id }, data: { kind: "custom" } }),
  );
  const untouched = await repos.goals.findById(goalB.id);
  assert.equal(untouched?.kind, "max_strength");
});

// ---------------------------------------------------------------------------
// Training plans: versioning
// ---------------------------------------------------------------------------

test("training plans append frozen versions and enforce one active plan", async () => {
  const user = await newUser("plan");
  const [exA, exB] = await exerciseIds();

  const planJson = JSON.stringify({
    sessions: [
      {
        name: "Push",
        dayOfWeek: 1,
        slots: [{ exerciseId: exA!, targetSets: 4, targetReps: "6-10", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }],
      },
      {
        name: "Pull",
        dayOfWeek: 3,
        slots: [{ exerciseId: exB!, targetSets: 3, targetReps: "8-12", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }],
      },
    ],
  });

  const plan = await repos.trainingPlans.create({
    userId: user.id,
    name: "Block A",
    status: "active",
    version: {
      planJson,
      configVersion: "fitcoach.training.v1",
      effectiveFrom: "2026-01-05",
      sessions: [
        {
          name: "Push",
          dayOfWeek: 1,
          slots: [{ exerciseId: exA!, targetSets: 4, targetReps: "6-10", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }],
        },
        {
          name: "Pull",
          dayOfWeek: 3,
          slots: [{ exerciseId: exB!, targetSets: 3, targetReps: "8-12", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }],
        },
      ],
    },
  });
  assert.equal(plan.versions.length, 1);

  // Second active plan for the same user violates the partial unique index.
  const planJson2 = JSON.stringify({
    sessions: [{ name: "Day 1", dayOfWeek: 0, slots: [{ exerciseId: exA!, targetSets: 3, targetReps: "8-12", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] }],
  });

  await assert.rejects(
    () =>
      repos.trainingPlans.create({
        userId: user.id,
        name: "Block B",
        status: "active",
        version: { planJson: planJson2, configVersion: "fitcoach.training.v1", effectiveFrom: "2026-02-02", sessions: [{ name: "Day 1", dayOfWeek: 0, slots: [{ exerciseId: exA!, targetSets: 3, targetReps: "8-12", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] }] },
      }),
    ConflictError,
  );
  assert.equal((await repos.trainingPlans.findActive(user.id))?.id, plan.id);

  const planJson3 = JSON.stringify({
    sessions: [{ name: "Push", dayOfWeek: 1, slots: [{ exerciseId: exA!, targetSets: 5, targetReps: "5-8", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] }],
  });

  const v2 = await repos.trainingPlans.addVersion(plan.id, {
    planJson: planJson3,
    configVersion: "fitcoach.training.v1",
    effectiveFrom: "2026-01-19",
    sessions: [{ name: "Push", dayOfWeek: 1, slots: [{ exerciseId: exA!, targetSets: 5, targetReps: "5-8", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] }],
  });
  assert.equal(v2.id !== plan.versions[0]?.id, true);

  const loaded = await repos.trainingPlans.findById(plan.id);
  assert.ok(loaded);
  assert.equal(loaded.versions.length, 2);
  const v1After = loaded.versions.find((v) => v.id === plan.versions[0]?.id);
  assert.ok(v1After);
  // Version 1 content stayed exactly as written.
  assert.equal(v1After.sessions.find((s) => s.name === "Push")?.slots[0]?.targetSets, 4);
  assert.equal(v1After.sessions.find((s) => s.name === "Pull")?.slots[0]?.targetSets, 3);

  // Database-level: plan versions are append-only (only lifecycle columns may move).
  await assert.rejects(() =>
    prisma!.trainingPlanVersion.update({
      where: { id: v1After.id },
      data: { configVersion: "rewritten history" },
    }),
  );

  // Retiring frees the single-active slot.
  await repos.trainingPlans.setStatus(plan.id, "retired");
  assert.equal(await repos.trainingPlans.findActive(user.id), null);
  const planB = await repos.trainingPlans.create({
    userId: user.id,
    name: "Block B",
    status: "active",
    version: { planJson: planJson2, configVersion: "fitcoach.training.v1", effectiveFrom: "2026-02-02", sessions: [{ name: "Day 1", dayOfWeek: 0, slots: [{ exerciseId: exA!, targetSets: 3, targetReps: "8-12", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] }] },
  });
  assert.equal((await repos.trainingPlans.findActive(user.id))?.id, planB.id);
});

// ---------------------------------------------------------------------------
// Phase 3: version lifecycle, decisions, constraints, progression rules
// ---------------------------------------------------------------------------

test("phase 3 plan versions carry lifecycle + generation metadata and supersede on append", async () => {
  const user = await newUser("phase3lifecycle");
  const [exA, exB] = await exerciseIds();

  const planJson1 = JSON.stringify({
    sessions: [
      { name: "Full body A", dayOfWeek: 0, slots: [{ exerciseId: exA!, targetSets: 3, targetReps: "6-10", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] },
      { name: "Full body B", dayOfWeek: 2, slots: [{ exerciseId: exB!, targetSets: 3, targetReps: "8-12", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] },
    ],
  });

  const plan = await repos.trainingPlans.create({
    userId: user.id,
    name: "Phase 3 block",
    status: "active",
    version: {
      planJson: planJson1,
      configVersion: "fitcoach.training.v1",
      effectiveFrom: "2026-03-02",
      sessions: [
        { name: "Full body A", dayOfWeek: 0, slots: [{ exerciseId: exA!, targetSets: 3, targetReps: "6-10", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] },
        { name: "Full body B", dayOfWeek: 2, slots: [{ exerciseId: exB!, targetSets: 3, targetReps: "8-12", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] },
      ],
    },
  });
  const v1 = plan.versions[0]!;
  assert.equal(v1.status, "active");
  assert.equal(v1.configVersion, "fitcoach.training.v1");
  assert.equal(v1.supersedesId, undefined);
  assert.equal(v1.effectiveUntil, undefined);

  const planJson2 = JSON.stringify({
    sessions: [{ name: "Full body A", dayOfWeek: 0, slots: [{ exerciseId: exA!, targetSets: 4, targetReps: "6-10", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] }],
  });

  const v2 = await repos.trainingPlans.addVersion(plan.id, {
    planJson: planJson2,
    configVersion: "fitcoach.training.v1",
    supersedesId: v1.id,
    effectiveFrom: "2026-03-09",
    sessions: [{ name: "Full body A", dayOfWeek: 0, slots: [{ exerciseId: exA!, targetSets: 4, targetReps: "6-10", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] }],
  });
  assert.equal(v2.id !== v1.id, true);
  assert.equal(v2.status, "active");
  assert.equal(v2.supersedesId, v1.id);

  const loaded = await repos.trainingPlans.findById(plan.id);
  assert.ok(loaded);
  const superseded = loaded.versions.find((version) => version.id === v1.id);
  assert.ok(superseded);
  assert.equal(superseded.status, "superseded", "appending a version supersedes the previous one");
  assert.ok(superseded.effectiveUntil, "supersession is timestamped");
  // The superseded version's content is untouched — only its lifecycle moved.
  assert.equal(superseded.sessions.find((s) => s.name === "Full body A")?.slots[0]?.targetSets, 3);
  assert.deepEqual(
    loaded.versions.map((version) => version.status),
    ["superseded", "active"],
  );

  // Database-level: only lifecycle columns may move on a version row.
  await assert.rejects(() =>
    prisma!.trainingPlanVersion.update({
      where: { id: v2.id },
      data: { configVersion: "rewritten history" },
    }),
  );

  // Database-level: the partial unique index allows exactly one active version.
  await assert.rejects(() =>
    prisma!.trainingPlanVersion.create({
      data: {
        id: newUuidv7(),
        planId: plan.id,
        status: "active",
        planJson: "{}",
        effectiveFrom: new Date("2026-04-01T00:00:00.000Z"),
      },
    }),
  );

  // Database-level: an unknown lifecycle state is rejected by the CHECK domain.
  await assert.rejects(() =>
    prisma!.trainingPlanVersion.update({
      where: { id: v2.id },
      data: { status: "paused" },
    }),
  );

  // Database-level: self-parentage is impossible.
  await assert.rejects(() =>
    prisma!.trainingPlanVersion.update({
      where: { id: v2.id },
      data: { supersedesId: v2.id },
    }),
  );
});

test("phase 3 decisions and progression rules round-trip and stay frozen", async () => {
  const user = await newUser("phase3records");
  const [exA, exB] = await exerciseIds();

  const planJson = JSON.stringify({
    sessions: [
      { name: "Day 1", dayOfWeek: 0, slots: [{ exerciseId: exA!, targetSets: 3, targetReps: "6-10", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }, { exerciseId: exB!, targetSets: 3, targetReps: "8-12", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] },
    ],
  });

  const plan = await repos.trainingPlans.create({
    userId: user.id,
    name: "Phase 3 records",
    status: "active",
    version: {
      planJson,
      configVersion: "fitcoach.training.v1",
      effectiveFrom: "2026-03-02",
      sessions: [
        { name: "Day 1", dayOfWeek: 0, slots: [{ exerciseId: exA!, targetSets: 3, targetReps: "6-10", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }, { exerciseId: exB!, targetSets: 3, targetReps: "8-12", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] },
      ],
    },
  });
  const version = plan.versions[0]!;

  // Progression rules: one per slot, frozen once written.
  const slots = version.sessions[0]!.slots;
  const rule = await repos.trainingPlans.setProgressionRule(slots[0]!.id, {
    trigger: "All working sets completed at the top of the rep range",
    condition: "bestReps >= repMax on every working set",
    action: "progress_load",
    bounds: "+2.5kg for upper-body lifts, max +5kg per week",
    resetBehavior: "Hold the load for two sessions after a missed rep",
    rationale: "Double progression: reps first, then load.",
    configVersion: "fitcoach.training.v1",
  });
  assert.equal(rule.slotId, slots[0]!.id);
  const rules = await repos.trainingPlans.listProgressionRules(version.id);
  assert.equal(rules.length, 1);
  assert.equal(rules[0]?.action, "progress_load");
  await assert.rejects(() =>
    prisma!.trainingPlanProgressionRule.update({ where: { id: rule.id }, data: { action: "regress" } }),
  );
  // Uncertainty cannot be modelled by an empty rule.
  await assert.rejects(() =>
    prisma!.trainingPlanProgressionRule.create({
      data: {
        id: newUuidv7(),
        slotId: slots[1]!.id,
        trigger: "",
        condition: "x",
        action: "progress_load",
        bounds: "y",
        rationale: "z",
      },
    }),
  );

  // Deleting the plan cascades its versions, sessions, slots, and progression rules.
  await repos.trainingPlans.setStatus(plan.id, "retired");
  await prisma!.trainingPlan.delete({ where: { id: plan.id } });
  assert.equal(
    await prisma!.trainingPlanProgressionRule.count({ where: { slotId: slots[0]!.id } }),
    0,
  );
});

// ---------------------------------------------------------------------------
// Workouts: idempotency + freezing
// ---------------------------------------------------------------------------

test("workouts are idempotent on clientRequestId and freeze once finished", async () => {
  const user = await newUser("workout");
  const [exA] = await exerciseIds();
  const clientRequestId = newUuidv7();

  const first = await repos.workouts.create({
    userId: user.id,
    title: "Push day",
    status: "in_progress",
    startedAt: ISO("02-02"),
    clientRequestId,
  });
  const replay = await repos.workouts.create({
    userId: user.id,
    title: "Push day (retried)",
    status: "in_progress",
    startedAt: ISO("02-02"),
    clientRequestId,
  });
  assert.equal(replay.id, first.id);

  const group = await repos.workouts.addExercise(first.id, exA!);
  const set1 = await repos.workouts.addSet({
    workoutExerciseId: group.id,
    kind: "working",
    loadKg: 60,
    reps: 8,
    rir: 2,
  });
  const set2 = await repos.workouts.addSet({
    workoutExerciseId: group.id,
    kind: "working",
    loadKg: 62.5,
    reps: 6,
  });
  assert.ok(set2.position > set1.position);

  // While the workout is open, sets are editable.
  await prisma!.exerciseSet.update({ where: { id: set1.id }, data: { reps: 9 } });

  const finished = await repos.workouts.complete(first.id, "completed");
  assert.equal(finished.status, "completed");
  assert.ok(finished.endedAt);

  // Frozen afterwards — at the repository boundary and in the database.
  await assert.rejects(
    () => repos.workouts.addSet({ workoutExerciseId: group.id, kind: "working", reps: 5 }),
    ImmutableRecordError,
  );
  await assert.rejects(
    () => repos.workouts.addExercise(first.id, exA!),
    ImmutableRecordError,
  );
  await assert.rejects(() => repos.workouts.complete(first.id), ConflictError);
  await assert.rejects(() =>
    prisma!.exerciseSet.update({ where: { id: set1.id }, data: { reps: 1 } }),
  );

  const aggregate = await repos.workouts.findById(first.id);
  assert.ok(aggregate);
  assert.equal(aggregate.exercises.length, 1);
  assert.equal(aggregate.exercises[0]?.sets.length, 2);
  assert.deepEqual(
    aggregate.exercises[0]?.sets.map((s) => s.reps),
    [9, 6],
  );
  assert.equal((await repos.workouts.history(user.id)).length, 1);
});

// ---------------------------------------------------------------------------
// Body measurements: append-only + import idempotency
// ---------------------------------------------------------------------------

test("body measurements are append-only and idempotent per import id", async () => {
  const user = await newUser("measure");
  const externalId = `scale-${newUuidv7().slice(0, 8)}`;

  const original = await repos.bodyMeasurements.record({
    userId: user.id,
    recordedAt: ISO("02-01", "07:00:00.000Z"),
    condition: "morning_fasted",
    bodyWeightKg: 80.4,
    bodyFatPercent: 18.2,
    circumferencesCm: { waist: 84.5 },
    enteredVia: "smart_scale_import",
    confidence: "measured",
    sourceName: "scale",
    externalId,
  });
  assert.equal(original.bodyWeightKg, 80.4);
  assert.equal(original.circumferencesCm.waist, 84.5);

  // Re-importing the same provider event returns the stored row untouched.
  const replay = await repos.bodyMeasurements.record({
    userId: user.id,
    bodyWeightKg: 999,
    enteredVia: "smart_scale_import",
    externalId,
  });
  assert.equal(replay.id, original.id);
  assert.equal(replay.bodyWeightKg, 80.4);

  await repos.bodyMeasurements.record({
    userId: user.id,
    recordedAt: ISO("02-08", "07:00:00.000Z"),
    bodyWeightKg: 80.1,
    condition: "morning_fasted",
  });

  const history = await repos.bodyMeasurements.history(user.id);
  assert.equal(history.length, 2);
  assert.equal(history[0]?.bodyWeightKg, 80.1); // newest first
  assert.equal(history[1]?.id, original.id);

  // Database-level: append-only.
  await assert.rejects(() =>
    prisma!.bodyMeasurement.update({ where: { id: original.id }, data: { bodyWeightKg: 70 } }),
  );

  // A measurement must carry at least one datum.
  await assert.rejects(
    () => repos.bodyMeasurements.record({ userId: user.id, notes: "nothing measurable" }),
    ConstraintValidationError,
  );
});

// ---------------------------------------------------------------------------
// Activity: sanctioned steps upsert (max wins) + cardio dedupe
// ---------------------------------------------------------------------------

test("step imports upsert per source and day with max-wins semantics", async () => {
  const user = await newUser("steps");
  const date = "2026-02-03";

  const first = await repos.activity.recordSteps({ userId: user.id, date, steps: 8000, recordedVia: "phone" });
  const higher = await repos.activity.recordSteps({ userId: user.id, date, steps: 9500, recordedVia: "phone" });
  assert.equal(higher.id, first.id); // same row, cumulative value updated
  assert.equal(higher.steps, 9500);

  const stale = await repos.activity.recordSteps({ userId: user.id, date, steps: 7000, recordedVia: "phone" });
  assert.equal(stale.id, first.id);
  assert.equal(stale.steps, 9500); // a stale import never decreases the day

  const watch = await repos.activity.recordSteps({ userId: user.id, date, steps: 6000, recordedVia: "watch" });
  assert.notEqual(watch.id, first.id); // separate source → separate row

  await assert.rejects(
    () => repos.activity.recordSteps({ userId: user.id, date, steps: -1 }),
    ConstraintValidationError,
  );

  // Discrete sessions dedupe on externalId without overwriting.
  const ride = await repos.activity.record({
    userId: user.id,
    date,
    kind: "cycle",
    durationMinutes: 45,
    distanceKm: 22.5,
    effort: "high",
    externalId: "ride-1",
  });
  const rideReplay = await repos.activity.record({
    userId: user.id,
    date,
    kind: "cycle",
    durationMinutes: 99,
    externalId: "ride-1",
  });
  assert.equal(rideReplay.id, ride.id);
  assert.equal(rideReplay.durationMinutes, 45);

  const all = await repos.activity.history(user.id);
  assert.equal(all.length, 3);
});

// ---------------------------------------------------------------------------
// Nutrition: snapshot isolation (historical integrity scenario 1)
// ---------------------------------------------------------------------------

test("editing a food never rewrites logged meal history", async () => {
  const user = await newUser("nutrition");
  const source = await repos.foods.findOrCreateUserSource(user.id);
  const food = await repos.foods.createFood({
    sourceId: source.id,
    name: "House granola",
    densityBasis: "per_100g",
    nutrientsPer100g: {
      caloriesKcal: 450,
      proteinGrams: 10,
      carbohydrateGrams: 60,
      fatGrams: 18,
      fiberGrams: 8,
    },
    servings: [{ label: "bowl (40 g)", grams: 40 }],
    defaultServingLabel: "bowl (40 g)",
  });
  assert.equal(food.servings.length, 1);

  const itemSnapshot: NutrientAmounts = {
    caloriesKcal: 180,
    proteinGrams: 4,
    carbohydrateGrams: 24,
    fatGrams: 7.2,
    fiberGrams: 3.2,
  };
  const clientRequestId = newUuidv7();
  const meal = await repos.meals.create({
    userId: user.id,
    localDate: "2026-02-04",
    slot: "breakfast",
    clientRequestId,
    totals: itemSnapshot,
    items: [{ foodId: food.id, quantityGrams: 40, snapshot: itemSnapshot, confidence: "measured" }],
  });
  assert.equal(meal.items.length, 1);
  assert.equal(meal.totals.caloriesKcal, 180);

  // Replay returns the same meal without duplicating items.
  const replay = await repos.meals.create({
    userId: user.id,
    localDate: "2026-02-04",
    clientRequestId,
    totals: { caloriesKcal: 9999, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0 },
    items: [{ foodId: food.id, quantityGrams: 40, snapshot: itemSnapshot, confidence: "measured" }],
  });
  assert.equal(replay.id, meal.id);
  assert.equal(replay.items.length, 1);
  assert.equal(replay.totals.caloriesKcal, 180);

  // The food row is current-state and does change...
  const edited = await repos.foods.updateNutrients(food.id, {
    caloriesKcal: 520,
    proteinGrams: 9,
    carbohydrateGrams: 64,
    fatGrams: 24,
    fiberGrams: 7,
  });
  assert.equal(edited.nutrientsPer100g.caloriesKcal, 520);

  // ...but the logged meal keeps the snapshot taken when it was written.
  const afterEdit = await repos.meals.findById(meal.id);
  assert.ok(afterEdit);
  assert.equal(afterEdit.items[0]?.computedNutrients.caloriesKcal, 180);
  assert.equal(afterEdit.totals.caloriesKcal, 180);

  // Appending an item refreshes totals from frozen item snapshots.
  const nextSnapshot: NutrientAmounts = {
    caloriesKcal: 120,
    proteinGrams: 6,
    carbohydrateGrams: 18,
    fatGrams: 2,
    fiberGrams: 1,
  };
  const withSecondItem = await repos.meals.addItem(meal.id, {
    foodId: food.id,
    quantityGrams: 30,
    snapshot: nextSnapshot,
    confidence: "estimated",
  });
  assert.equal(withSecondItem.items.length, 2);
  assert.equal(withSecondItem.totals.caloriesKcal, 300);
  assert.equal(withSecondItem.totals.proteinGrams, 10);

  // Daily aggregate: one row per (user, day), upserted.
  const daily = await repos.nutrition.upsertDaily({
    userId: user.id,
    localDate: "2026-02-04",
    totals: withSecondItem.totals,
    targetsSnapshot: { caloriesKcal: 2400 },
  });
  const dailyAgain = await repos.nutrition.upsertDaily({
    userId: user.id,
    localDate: "2026-02-04",
    totals: { caloriesKcal: 1, proteinGrams: 1, carbohydrateGrams: 1, fatGrams: 1 },
  });
  assert.equal(dailyAgain.id, daily.id);
  assert.equal(dailyAgain.totals.caloriesKcal, 1);

  const readBack = await repos.nutrition.getDaily(user.id, "2026-02-04");
  assert.equal(readBack?.totals.caloriesKcal, 1);
  assert.equal(await prisma!.dailyNutrition.count({ where: { userId: user.id } }), 1);

  // Meals of that day are listed for the user.
  const meals = await repos.meals.listByDate(user.id, "2026-02-04");
  assert.equal(meals.length, 1);
});

// ---------------------------------------------------------------------------
// Coaching: evidence immutability + lifecycle-only status
// ---------------------------------------------------------------------------

test("diagnoses carry append-only evidence and lifecycle-only status", async () => {
  const user = await newUser("diagnosis");
  const diagnosis = await repos.diagnoses.create({
    userId: user.id,
    code: "under_recovered",
    title: "Under-recovered",
    summary: "Sleep and resting heart rate suggest incomplete recovery.",
    severity: "watch",
    analysisWindowDays: 14,
    contributingFactors: ["late evening sessions"],
    ruledOut: ["caloric deficit"],
    evidence: [
      {
        metric: "sleep_hours_avg",
        window: "last_14_days",
        observed: "5.8 h per night",
        observedNumeric: 5.8,
        expected: "7.5+ h",
      },
    ],
  });
  assert.equal(diagnosis.evidence.length, 1);
  assert.equal(diagnosis.evidence[0]?.position, 0);

  const withMore = await repos.diagnoses.attachEvidence(diagnosis.id, [
    { metric: "resting_hr_delta", window: "last_14_days", observed: "+6 bpm", observedNumeric: 6 },
  ]);
  assert.equal(withMore.evidence.length, 2);
  assert.equal(withMore.evidence[1]?.position, 1);

  // Lifecycle transition is the one sanctioned mutation.
  const resolved = await repos.diagnoses.updateStatus(
    diagnosis.id,
    "resolved",
    new Date("2026-02-20T00:00:00.000Z").toISOString(),
  );
  assert.equal(resolved.status, "resolved");
  assert.ok(resolved.resolvedAt);
  assert.equal(resolved.summary, diagnosis.summary);

  // Database-level: content is frozen; evidence rows are append-only.
  await assert.rejects(() =>
    prisma!.diagnosis.update({ where: { id: diagnosis.id }, data: { summary: "rewritten" } }),
  );
  await assert.rejects(() =>
    prisma!.diagnosisEvidence.update({
      where: { id: diagnosis.evidence[0]!.id },
      data: { observed: "changed after the fact" },
    }),
  );
  const untouched = await repos.diagnoses.findById(diagnosis.id);
  assert.equal(untouched?.evidence[0]?.observed, "5.8 h per night");
});

// ---------------------------------------------------------------------------
// Historical integrity scenario 2: goal A → B keeps old coaching output
// ---------------------------------------------------------------------------

test("a recommendation keeps citing the goal that was active when it was made", async () => {
  const user = await newUser("recommendation");
  const goalA = await repos.goals.create({
    userId: user.id,
    kind: "lean_recomposition",
    effectiveFrom: "2026-01-01",
  });

  const diagnosis = await repos.diagnoses.create({
    userId: user.id,
    activeGoalId: goalA.id,
    code: "chest_volume_low",
    title: "Chest volume below target range",
    summary: "Weekly direct sets sit well below the hypertrophy range.",
    severity: "act",
    evidence: [
      {
        metric: "weekly_sets_chest",
        window: "last_28_days",
        observed: "8 sets per week",
        observedNumeric: 8,
        expected: "16+ sets",
      },
    ],
  });

  const recommendation = await repos.recommendations.create({
    userId: user.id,
    diagnosisId: diagnosis.id,
    headline: "Add a second chest session",
    explanation: "Direct volume is half the effective range for your goal.",
    evidence: [
      { metric: "active_goal", window: "at_presentation", observed: goalA.id },
      {
        metric: "weekly_sets_chest",
        window: "last_28_days",
        observed: "8 sets per week",
        observedNumeric: 8,
        expected: "16+ sets",
      },
    ],
  });
  assert.equal(recommendation.evidence.length, 2);

  // The user pivots: goal A is superseded by goal B.
  const goalB = await repos.goals.create({
    userId: user.id,
    kind: "max_strength",
    effectiveFrom: "2026-02-15",
  });
  assert.notEqual(goalB.id, goalA.id);

  // Everything already produced still references goal A — history is stable.
  const recAfter = await repos.recommendations.findById(recommendation.id);
  assert.ok(recAfter);
  assert.equal(
    recAfter.evidence.find((e) => e.metric === "active_goal")?.observed,
    goalA.id,
  );
  assert.equal(recAfter.headline, recommendation.headline);

  const diagnosisAfter = await repos.diagnoses.findById(diagnosis.id);
  assert.equal(diagnosisAfter?.activeGoalId, goalA.id);

  const goalAAfter = await repos.goals.findById(goalA.id);
  assert.equal(goalAAfter?.supersededByGoalId, goalB.id);
  assert.equal((await repos.goals.active(user.id))?.id, goalB.id);

  // Database-level: the diagnosis context column is frozen content.
  await assert.rejects(() =>
    prisma!.diagnosis.update({ where: { id: diagnosis.id }, data: { activeGoalId: goalB.id } }),
  );

  // Lifecycle status changes on the recommendation remain possible.
  const acknowledged = await repos.recommendations.updateStatus(
    recommendation.id,
    "acknowledged",
    { acknowledgedAt: new Date("2026-02-16T10:00:00.000Z").toISOString() },
  );
  assert.equal(acknowledged.status, "acknowledged");
  assert.ok(acknowledged.acknowledgedAt);

  await assert.rejects(() =>
    prisma!.recommendation.update({ where: { id: recommendation.id }, data: { headline: "new take" } }),
  );
});

// ---------------------------------------------------------------------------
// Historical integrity scenario 3: workouts stay traceable to plan version
// ---------------------------------------------------------------------------

test("workouts keep pointing at the plan version they were written against", async () => {
  const user = await newUser("traceability");
  const [exA] = await exerciseIds();

  const plan = await repos.trainingPlans.create({
    userId: user.id,
    name: "Trace block",
    version: {
      planJson: JSON.stringify({
        sessions: [{ name: "Day 1", dayOfWeek: 0, slots: [{ exerciseId: exA!, targetSets: 3, targetReps: "8-12", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] }],
      }),
      configVersion: "fitcoach.training.v1",
      effectiveFrom: "2026-03-02",
      sessions: [{ name: "Day 1", dayOfWeek: 0, slots: [{ exerciseId: exA!, targetSets: 3, targetReps: "8-12", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] }],
    },
  });
  const v1 = plan.versions[0]!;

  const workout = await repos.workouts.create({
    userId: user.id,
    planId: plan.id,
    planVersionId: v1.id,
    status: "completed",
    startedAt: ISO("03-02", "06:30:00.000Z"),
    endedAt: ISO("03-02", "07:30:00.000Z"),
    clientRequestId: newUuidv7(),
  });

  // The plan evolves while the workout remains historical.
  const v2 = await repos.trainingPlans.addVersion(plan.id, {
    planJson: JSON.stringify({
      sessions: [{ name: "Day 1", dayOfWeek: 0, slots: [{ exerciseId: exA!, targetSets: 5, targetReps: "5-8", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] }],
    }),
    configVersion: "fitcoach.training.v1",
    effectiveFrom: "2026-03-16",
    sessions: [{ name: "Day 1", dayOfWeek: 0, slots: [{ exerciseId: exA!, targetSets: 5, targetReps: "5-8", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] }],
  });
  assert.equal(v2.versionNumber, 2);

  const loaded = await repos.workouts.findById(workout.id);
  assert.ok(loaded);
  assert.equal(loaded.workout.planVersionId, v1.id);
  assert.notEqual(loaded.workout.planVersionId, v2.id);
  assert.equal(loaded.workout.planId, plan.id);

  // Raw column, not just the mapping.
  const raw = await prisma!.workout.findUnique({
    where: { id: workout.id },
    select: { planVersionId: true },
  });
  assert.equal(raw?.planVersionId, v1.id);

  // Version 1 still exists with its original content.
  const planAfter = await repos.trainingPlans.findById(plan.id);
  const v1After = planAfter?.versions.find((v) => v.id === v1.id);
  assert.ok(v1After);
  assert.equal(v1After.sessions[0]?.slots[0]?.targetSets, 3);
});

// ---------------------------------------------------------------------------
// Interventions: no_change + one outcome per evaluation window
// ---------------------------------------------------------------------------

test("no_change interventions record one outcome per evaluation window", async () => {
  const user = await newUser("intervention");
  const goal = await repos.goals.create({
    userId: user.id,
    kind: "general_fitness",
    effectiveFrom: "2026-01-10",
  });
  const diagnosis = await repos.diagnoses.create({
    userId: user.id,
    activeGoalId: goal.id,
    code: "adherence_solid",
    title: "Plan adherence is solid",
    summary: "Trend matches expectations; no adjustment required.",
    severity: "informational",
  });

  const intervention = await repos.interventions.create({
    userId: user.id,
    diagnosisId: diagnosis.id,
    activeGoalId: goal.id,
    kind: "no_change",
    rationale: "The current plan is producing the expected trend.",
    expectedEffect: "Maintain the trajectory without modification.",
    reviewOn: "2026-04-01",
  });
  assert.equal(intervention.status, "proposed");
  assert.equal(intervention.kind, "no_change");

  const outcome = await repos.interventions.recordOutcome({
    interventionId: intervention.id,
    evaluationWindow: "2026-03-01..2026-03-15",
    verdict: "improved_as_expected",
    observations: ["Body weight trend −0.3 kg per week"],
    explanation: "Targets were correct; the right action is to keep going.",
  });
  assert.equal(outcome.verdict, "improved_as_expected");

  // Re-evaluating the same window is a conflict by design.
  await assert.rejects(
    () =>
      repos.interventions.recordOutcome({
        interventionId: intervention.id,
        evaluationWindow: "2026-03-01..2026-03-15",
        verdict: "no_effect",
        explanation: "duplicate window",
      }),
    ConflictError,
  );

  // A later window is a new observation.
  await repos.interventions.recordOutcome({
    interventionId: intervention.id,
    evaluationWindow: "2026-03-16..2026-03-31",
    verdict: "too_early",
    explanation: "Continue to the next window.",
  });
  assert.equal((await repos.interventions.outcomes(intervention.id)).length, 2);

  const active = await repos.interventions.updateStatus(intervention.id, "active");
  assert.equal(active.status, "active");

  // Replacement chains stay explicit.
  const replacement = await repos.interventions.create({
    userId: user.id,
    kind: "training_volume_adjustment",
    parameters: { weeklySetsDelta: 4 },
    rationale: "Volume drifted below the target band.",
    expectedEffect: "Restore the target stimulus.",
  });
  const superseded = await repos.interventions.supersede(intervention.id, replacement.id);
  assert.equal(superseded.status, "superseded");
  assert.equal(superseded.supersededByInterventionId, replacement.id);
  assert.equal(
    (await repos.interventions.findById(replacement.id))?.supersededByInterventionId,
    undefined,
  );

  // Database-level: outcome rows append-only; interventions lifecycle-only.
  await assert.rejects(() =>
    prisma!.interventionOutcome.update({ where: { id: outcome.id }, data: { verdict: "worsened" } }),
  );
  await assert.rejects(() =>
    prisma!.intervention.update({ where: { id: replacement.id }, data: { rationale: "rewritten" } }),
  );

  const open = await repos.interventions.list(user.id);
  assert.ok(open.length >= 2);
});

// ---------------------------------------------------------------------------
// Phase 3.1 — training environments: interval versioning (never re-written)
// ---------------------------------------------------------------------------

test("phase 3.1 training environment periods are interval-versioned and close, never edit", async () => {
  const user = await newUser("environment");

  const gym = await repos.trainingEnvironments.createPeriod({
    userId: user.id,
    kind: "gym",
    effectiveFrom: "2026-01-01",
  });
  assert.equal(gym.kind, "gym");
  assert.equal(gym.effectiveTo, undefined, "an open period has no end yet");
  assert.equal((await repos.trainingEnvironments.findActive(user.id, "2026-02-01"))?.id, gym.id);

  // Declaring a home period closes the gym row at its start — it never edits it.
  const home = await repos.trainingEnvironments.createPeriod({
    userId: user.id,
    kind: "home_no_equipment",
    effectiveFrom: "2026-03-01",
    isTemporary: true,
    reason: "gym closed for maintenance",
  });
  const gymAfter = (await repos.trainingEnvironments.listPeriods(user.id)).find(
    (period) => period.id === gym.id,
  );
  assert.ok(gymAfter);
  assert.equal(gymAfter.effectiveTo, "2026-03-01");
  assert.equal(gymAfter.kind, "gym", "history keeps what the day meant");
  assert.equal(gymAfter.reason, undefined);

  // The day boundary is exact and inclusive at the start.
  assert.equal((await repos.trainingEnvironments.findActive(user.id, "2026-02-28"))?.id, gym.id);
  assert.equal((await repos.trainingEnvironments.findActive(user.id, "2026-03-01"))?.id, home.id);
  assert.equal((await repos.trainingEnvironments.findActive(user.id, "2026-03-05"))?.id, home.id);

  // A new period may not start before the currently open one.
  await assert.rejects(
    () =>
      repos.trainingEnvironments.createPeriod({
        userId: user.id,
        kind: "gym",
        effectiveFrom: "2026-02-15",
      }),
    ConstraintValidationError,
  );

  // Closing restores the default environment without erasing the interval.
  const closed = await repos.trainingEnvironments.closeOpenPeriod(user.id, "2026-03-10");
  assert.ok(closed);
  assert.equal(closed.id, home.id);
  assert.equal(closed.effectiveTo, "2026-03-10");
  assert.equal(await repos.trainingEnvironments.findActive(user.id, "2026-03-11"), null);
  assert.equal((await repos.trainingEnvironments.listPeriods(user.id)).length, 2);

  // An end that is not after the start is rejected rather than silently applied.
  await assert.rejects(
    () => repos.trainingEnvironments.closePeriod(gym.id, "2026-01-01"),
    ConstraintValidationError,
  );
  // Unknown kinds never reach the database.
  await assert.rejects(
    () =>
      repos.trainingEnvironments.createPeriod({
        userId: user.id,
        kind: "spaceship" as never,
        effectiveFrom: "2026-04-01",
      }),
    ConstraintValidationError,
  );
  // A period must belong to a real user.
  await assert.rejects(
    () =>
      repos.trainingEnvironments.createPeriod({
        userId: newUuidv7(),
        kind: "home",
        effectiveFrom: "2026-04-01",
      }),
    NotFoundError,
  );

  // Database-level: only effective_to may move on a period row.
  await assert.rejects(() =>
    prisma!.trainingEnvironmentPeriod.update({
      where: { id: gym.id },
      data: { kind: "home" },
    }),
  );

  // Erasing the account cascades the periods.
  await repos.users.delete(user.id);
  assert.equal(await prisma!.trainingEnvironmentPeriod.count({ where: { userId: user.id } }), 0);
});

// ---------------------------------------------------------------------------
// Phase 3.1 — progression ledger: append-only, fingerprint + key idempotency
// ---------------------------------------------------------------------------

test("phase 3.1 progression evaluations are append-only and idempotent on idempotency key", async () => {
  const user = await newUser("ledger");
  const [exA] = await exerciseIds();

  // First create a plan with a slot to evaluate against
  const plan = await repos.trainingPlans.create({
    userId: user.id,
    name: "Test plan",
    status: "active",
    version: {
      planJson: JSON.stringify({
        sessions: [{ name: "Day 1", dayOfWeek: 0, slots: [{ exerciseId: exA!, targetSets: 3, targetReps: "6-10", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] }],
      }),
      configVersion: "fitcoach.training.v1",
      effectiveFrom: "2026-03-01",
      sessions: [{ name: "Day 1", dayOfWeek: 0, slots: [{ exerciseId: exA!, targetSets: 3, targetReps: "6-10", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] }],
    },
  });
  const version = plan.versions[0]!;
  const session = version.sessions[0]!;
  const slot = session.slots[0]!;

  // Get exercise name for the evaluation
  const exercise = await repos.exercises.findExerciseKnowledge(exA!);
  const exerciseName = exercise?.name ?? "Unknown Exercise";

  const baseInput = {
    userId: user.id,
    exerciseId: exA!,
    exerciseName,
    planVersionId: version.id,
    slotId: slot.id,
    currentObservation: {
      loadKind: "external_load" as const,
      loadKg: 100,
      reps: 5,
      rir: 2,
      localDate: "2026-03-02",
    },
    performance: {
      exerciseId: exA!,
      completedSets: 3,
      incompleteSessions: 0,
      sessionsObserved: 1,
      bestReps: 5,
      bestLoadKg: 100,
      latestLoadKind: "external_load" as const,
      latestRir: 2,
      latestLocalDate: "2026-03-02",
      trend: "improving",
      mechanisms: ["load"],
    },
    outcome: "increase_load" as const,
    recommendation: {
      outcome: "increase_load" as const,
      action: "progress_load" as ProgressionAction,
      targetLoadKg: 102.5,
      targetRepMin: 6,
      targetRepMax: 10,
      targetRir: 2,
      mechanisms: ["load"],
      rationale: "All working sets reached the top of the rep range at target RIR.",
      evidence: ["All working sets reached the top of the rep range at target RIR."],
      confidence: 0.9,
      configVersion: "fitcoach.training.v1",
    },
    fingerprint: "fp-bench-2026-03-02",
    configVersion: "fitcoach.training.v1",
  };

  const first = await repos.progressionLedger.recordEvaluation(baseInput);
  assert.equal(first.outcome, "increase_load");
  assert.equal(first.planVersionId, version.id);
  assert.equal(first.slotId, slot.id);

  // Replaying the same evidence (same fingerprint) returns the row.
  const replay = await repos.progressionLedger.recordEvaluation({ ...baseInput, id: newUuidv7() });
  assert.equal(replay.id, first.id);
  assert.equal(
    (await repos.progressionLedger.listEvaluations(user.id)).length,
    1,
    "identical evidence is evaluated once",
  );

  // Database-level: an evaluation is written once and never rewritten.
  await assert.rejects(() =>
    prisma!.progressionEvaluation.update({
      where: { id: first.id },
      data: { outcome: "maintain" },
    }),
  );
  // An unknown outcome is rejected by the CHECK domain.
  await assert.rejects(() =>
    prisma!.progressionEvaluation.create({
      data: {
        id: newUuidv7(),
        userId: user.id,
        exerciseId: exA!,
        exerciseName,
        planVersionId: version.id,
        slotId: slot.id,
        current: {} as any,
        previous: undefined,
        performance: {} as any,
        outcome: "vibes",
        recommendation: {} as any,
        evidence: [],
        fingerprint: "fp-unknown",
        configVersion: "fitcoach.training.v1",
      },
    }),
  );

  // A different day is different evidence: a new row.
  await repos.progressionLedger.recordEvaluation({ ...baseInput, fingerprint: "fp-bench-2026-03-09" });
  assert.equal((await repos.progressionLedger.listEvaluations(user.id)).length, 2);
  assert.equal(
    (await repos.progressionLedger.listEvaluations(user.id, { planVersionId: version.id })).length,
    2,
  );

  // Cross-user reads see nothing (ownership is part of the read model).
  const other = await newUser("ledger-other");
  assert.equal(await repos.progressionLedger.findEvaluation(other.id, first.id), null);
  assert.deepEqual(await repos.progressionLedger.listEvaluations(other.id), []);

  // Cascade on account erasure.
  await repos.users.delete(user.id);
  assert.equal(await prisma!.progressionEvaluation.count({ where: { userId: user.id } }), 0);
});

test("phase 3.1 decision events are append-only and idempotent per submission key", async () => {
  const user = await newUser("events");
  const [exA] = await exerciseIds();

  // First create a plan with a slot to evaluate against
  const plan = await repos.trainingPlans.create({
    userId: user.id,
    name: "Test plan",
    status: "active",
    version: {
      planJson: JSON.stringify({
        sessions: [{ name: "Day 1", dayOfWeek: 0, slots: [{ exerciseId: exA!, targetSets: 3, targetReps: "6-10", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] }],
      }),
      configVersion: "fitcoach.training.v1",
      effectiveFrom: "2026-03-01",
      sessions: [{ name: "Day 1", dayOfWeek: 0, slots: [{ exerciseId: exA!, targetSets: 3, targetReps: "6-10", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] }],
    },
  });
  const version = plan.versions[0]!;
  const session = version.sessions[0]!;
  const slot = session.slots[0]!;

  // Get exercise name for the evaluation
  const exercise = await repos.exercises.findExerciseKnowledge(exA!);
  const exerciseName = exercise?.name ?? "Unknown Exercise";

  const evaluation = await repos.progressionLedger.recordEvaluation({
    userId: user.id,
    exerciseId: exA!,
    exerciseName,
    planVersionId: version.id,
    slotId: slot.id,
    currentObservation: {
      loadKind: "external_load" as const,
      loadKg: 80,
      reps: 8,
      rir: 2,
      localDate: "2026-03-02",
    },
    performance: {
      exerciseId: exA!,
      completedSets: 3,
      incompleteSessions: 0,
      sessionsObserved: 1,
      bestReps: 8,
      bestLoadKg: 80,
      latestLoadKind: "external_load" as const,
      latestRir: 2,
      latestLocalDate: "2026-03-02",
      trend: "stable",
      mechanisms: ["reps"],
    },
    outcome: "increase_reps" as const,
    recommendation: {
      outcome: "increase_reps" as const,
      action: "progress_reps" as ProgressionAction,
      targetRepMin: 6,
      targetRepMax: 10,
      targetRir: 2,
      mechanisms: ["reps"],
      rationale: "Load is stable; add a rep before adding weight.",
      evidence: ["Load is stable; add a rep before adding weight."],
      confidence: 0.9,
      configVersion: "fitcoach.training.v1",
    },
    fingerprint: "fp-row-2026-03-02",
    configVersion: "fitcoach.training.v1",
  });

  const recommended = await repos.progressionLedger.recordDecisionEvent({
    evaluationId: evaluation.id,
    decision: "recommended",
    evidence: ["shown to the user"],
  });
  const accepted = await repos.progressionLedger.recordDecisionEvent({
    evaluationId: evaluation.id,
    decision: "accepted",
    idempotencyKey: "submit-1",
    actualChange: { kind: "reps", repsDelta: 1 },
    resultingPerformance: { loadKind: "external_load", loadKg: 80, reps: 9, localDate: "2026-03-09" },
  });

  // A retried submission with the same key is the same event, not a second one.
  const retried = await repos.progressionLedger.recordDecisionEvent({
    evaluationId: evaluation.id,
    decision: "accepted",
    idempotencyKey: "submit-1",
  });
  assert.equal(retried.id, accepted.id);
  assert.equal(retried.actualChange?.kind, "reps");

  const events = await repos.progressionLedger.listEvents(evaluation.id);
  assert.equal(events.length, 2);
  assert.equal(events[0]?.decision, "recommended");
  assert.equal(events[1]?.decision, "accepted");
  assert.equal(events[1]?.resultingPerformance?.reps, 9);
  assert.equal((await repos.progressionLedger.findLastEvent(evaluation.id))?.id, accepted.id);

  // A changed mind is a new event, not an edit of the old one.
  await repos.progressionLedger.recordDecisionEvent({
    evaluationId: evaluation.id,
    decision: "deferred",
    evidence: ["travel week"],
  });
  assert.equal((await repos.progressionLedger.listEvents(evaluation.id)).length, 3);

  // Database-level: events are append-only; unknown decisions are rejected.
  await assert.rejects(() =>
    prisma!.progressionDecisionEvent.update({
      where: { id: recommended.id },
      data: { decision: "rejected" },
    }),
  );
  await assert.rejects(() =>
    prisma!.progressionDecisionEvent.create({
      data: { id: newUuidv7(), evaluationId: evaluation.id, decision: "ignored", idempotencyKey: "x" },
    }),
  );
  // A decision cannot be attached to an evaluation that does not exist.
  await assert.rejects(
    () =>
      repos.progressionLedger.recordDecisionEvent({
        evaluationId: newUuidv7(),
        decision: "accepted",
      }),
    NotFoundError,
  );

  // listLedger returns the evaluation with its events, newest first.
  const ledger = await repos.progressionLedger.listLedger(user.id);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0]?.evaluation.id, evaluation.id);
  assert.equal(ledger[0]?.events.length, 3);

  // Deleting the user cascades the evaluation and its events.
  await repos.users.delete(user.id);
  assert.equal(await prisma!.progressionDecisionEvent.count({ where: { evaluationId: evaluation.id } }), 0);
});

// ---------------------------------------------------------------------------
// Phase 3.1 — a temporary plan coexists with the primary plan it came from
// ---------------------------------------------------------------------------

test("phase 3.1 a temporary environment plan coexists with the primary plan", async () => {
  const user = await newUser("tempplan");
  const [exA] = await exerciseIds();

  const primary = await repos.trainingPlans.create({
    userId: user.id,
    name: "Gym block",
    status: "active",
    version: {
      planJson: JSON.stringify({
        sessions: [{ name: "Day 1", dayOfWeek: 0, slots: [{ exerciseId: exA!, targetSets: 3, targetReps: "6-10", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] }],
      }),
      configVersion: "fitcoach.training.v1",
      effectiveFrom: "2026-03-02",
      sessions: [{ name: "Day 1", dayOfWeek: 0, slots: [{ exerciseId: exA!, targetSets: 3, targetReps: "6-10", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] }],
    },
  });
  const primaryVersion = primary.versions[0]!;
  assert.equal(primary.status, "active");

  const temporary = await repos.trainingPlans.create({
    userId: user.id,
    name: "Home week",
    status: "active",
    kind: "temporary_environment",
    environmentKind: "home_no_equipment",
    effectiveUntil: "2026-03-08",
    temporaryForVersionId: primaryVersion.id,
    version: {
      planJson: JSON.stringify({
        sessions: [{ name: "Day 1", dayOfWeek: 0, slots: [{ exerciseId: exA!, targetSets: 3, targetReps: "6-10", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] }],
      }),
      configVersion: "fitcoach.training.v1",
      effectiveFrom: "2026-03-02",
      supersedesId: primaryVersion.id,
      sessions: [{ name: "Day 1", dayOfWeek: 0, slots: [{ exerciseId: exA!, targetSets: 3, targetReps: "6-10", targetRir: 2, loadPrescription: "rpe", loadValue: 8 }] }],
    },
  });
  // The temporary plan is a separate plan that supersedes the primary version
  assert.equal(temporary.status, "active");
  assert.equal(temporary.versions[0]?.supersedesId, primaryVersion.id);

  // Two active plans coexist because they are separate plans.
  assert.equal((await repos.trainingPlans.findActive(user.id))?.id, primary.id);
  assert.deepEqual(
    (await repos.trainingPlans.listByUser(user.id)).map((plan) => plan.id).sort(),
    [primary.id, temporary.id].sort(),
  );
  // Both are readable and the primary's content is untouched.
  const primaryAfter = await repos.trainingPlans.findById(primary.id);
  assert.equal(primaryAfter?.status, "active");
  assert.equal(primaryAfter?.versions.length, 1);
  assert.equal(primaryAfter?.versions[0]?.id, primaryVersion.id);

  // Retiring the temporary plan leaves the primary active.
  await repos.trainingPlans.setStatus(temporary.id, "retired");
  assert.equal((await repos.trainingPlans.findActive(user.id))?.id, primary.id);
  assert.equal((await repos.trainingPlans.findById(temporary.id))?.status, "retired");

  // Database-level: a temporary plan must have a valid supersedesId.
  await assert.rejects(() =>
    prisma!.trainingPlanVersion.create({
      data: {
        id: newUuidv7(),
        planId: primary.id,
        planJson: "{}",
        status: "active",
        effectiveFrom: new Date("2026-03-09T00:00:00.000Z"),
        supersedesId: newUuidv7(), // non-existent
      },
    }),
  );
  // Database-level: unknown plan status is rejected by the CHECK domain.
  await assert.rejects(() =>
    prisma!.trainingPlan.update({ where: { id: primary.id }, data: { status: "seasonal" } }),
  );
});

// ---------------------------------------------------------------------------
// Phase 3.1 — workouts carry the environment + planned/adapted classification
// ---------------------------------------------------------------------------

test("phase 3.1 workouts and sets record environment, classification and load kind", async () => {
  const user = await newUser("envworkout");
  const [exA] = await exerciseIds();

  const workout = await repos.workouts.create({
    userId: user.id,
    title: "Home session",
    status: "in_progress",
    startedAt: ISO("03-11", "18:00:00.000Z"),
    clientRequestId: newUuidv7(),
    environmentKind: "home_no_equipment",
    sessionClassification: "adapted",
  });
  assert.equal(workout.environmentKind, "home_no_equipment");
  assert.equal(workout.sessionClassification, "adapted");

  // Substitution provenance is recorded on the exercise group.
  const group = await repos.workouts.addExercise(workout.id, exA!, undefined, undefined, {
    substitutedFromExerciseId: exA!,
    performanceSource: "manual",
    substitutionReason: "no barbell at home",
  });
  assert.equal(group.substitutedFromExerciseId, exA!);
  assert.equal(group.performanceSource, "manual");
  assert.equal(group.substitutionReason, "no barbell at home");

  // A bodyweight set is recorded without an external load, idempotently per key.
  const clientRequestId = newUuidv7();
  const set = await repos.workouts.addSet({
    workoutExerciseId: group.id,
    kind: "working",
    loadKind: "bodyweight",
    reps: 15,
    rir: 2,
    clientRequestId,
  });
  const replay = await repos.workouts.addSet({
    workoutExerciseId: group.id,
    kind: "working",
    loadKind: "bodyweight",
    reps: 15,
    clientRequestId,
  });
  assert.equal(replay.id, set.id);
  assert.equal(set.loadKind, "bodyweight");
  assert.equal(set.loadKg, undefined);

  // Database-level: a declared bodyweight set may not also carry an external load.
  await assert.rejects(() =>
    prisma!.exerciseSet.create({
      data: {
        id: newUuidv7(),
        workoutExerciseId: group.id,
        position: 99,
        kind: "working",
        loadKind: "bodyweight",
        loadKg: 60,
        reps: 10,
      },
    }),
  );
  // Database-level: a declared external-load set must say what the load was.
  await assert.rejects(() =>
    prisma!.exerciseSet.create({
      data: {
        id: newUuidv7(),
        workoutExerciseId: group.id,
        position: 100,
        kind: "working",
        loadKind: "external_load",
        reps: 10,
      },
    }),
  );
  // Database-level: an unknown classification is rejected by the CHECK domain.
  await assert.rejects(() =>
    prisma!.workout.update({
      where: { id: workout.id },
      data: { sessionClassification: "freestyle" },
    }),
  );
});

// ---------------------------------------------------------------------------
// Account erasure: cascade completeness
// ---------------------------------------------------------------------------

test("erasing an account cascades every user-owned row", async () => {
  const user = await newUser("erase");
  const [exA] = await exerciseIds();

  const goal = await repos.goals.create({
    userId: user.id,
    kind: "general_fitness",
    effectiveFrom: "2026-01-01",
  });
  await repos.profiles.upsert(user.id, { heightCm: 175, trainingDaysPerWeek: 3 });
  await repos.bodyMeasurements.record({ userId: user.id, bodyWeightKg: 82 });
  await repos.activity.recordSteps({ userId: user.id, date: "2026-02-05", steps: 5000 });
  const workout = await repos.workouts.create({
    userId: user.id,
    startedAt: ISO("02-05"),
    clientRequestId: newUuidv7(),
  });
  await repos.workouts.addExercise(workout.id, exA!);
  const meal = await repos.meals.create({
    userId: user.id,
    localDate: "2026-02-05",
    totals: { caloriesKcal: 500, proteinGrams: 30, carbohydrateGrams: 50, fatGrams: 15 },
    items: [],
  });
  await repos.nutrition.upsertDaily({
    userId: user.id,
    localDate: "2026-02-05",
    totals: { caloriesKcal: 500, proteinGrams: 30, carbohydrateGrams: 50, fatGrams: 15 },
  });

  await repos.users.delete(user.id);

  assert.equal(await repos.users.findById(user.id), null);
  assert.equal(await repos.goals.findById(goal.id), null);
  assert.deepEqual(await repos.goals.history(user.id), []);
  assert.equal(await repos.profiles.get(user.id), null);
  assert.deepEqual(await repos.bodyMeasurements.history(user.id), []);
  assert.deepEqual(await repos.activity.history(user.id), []);
  assert.equal(await repos.workouts.findById(workout.id), null);
  assert.equal(await repos.meals.findById(meal.id), null);
  assert.deepEqual(await repos.meals.listByDate(user.id, "2026-02-05"), []);
  assert.equal(await repos.nutrition.getDaily(user.id, "2026-02-05"), null);

  // Erasure is itself idempotent-by-error: second delete is not found.
  await assert.rejects(() => repos.users.delete(user.id), NotFoundError);
});
