import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { NutrientAmounts, Profile } from "@fitcoach/domain";
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

  const plan = await repos.trainingPlans.create({
    userId: user.id,
    name: "Block A",
    status: "active",
    version: {
      startsOn: "2026-01-05",
      sessions: [
        {
          name: "Push",
          weekdayHint: 1,
          slots: [{ exerciseId: exA!, targetSets: 4, repMin: 6, repMax: 10, restSeconds: 150 }],
        },
        {
          name: "Pull",
          slots: [{ exerciseId: exB!, targetSets: 3, repMin: 8, repMax: 12 }],
        },
      ],
    },
  });
  assert.equal(plan.versions.length, 1);
  assert.equal(plan.versions[0]?.versionNumber, 1);

  // Second active plan for the same user violates the partial unique index.
  await assert.rejects(
    () =>
      repos.trainingPlans.create({
        userId: user.id,
        name: "Block B",
        status: "active",
        version: { startsOn: "2026-02-02", sessions: [{ name: "Day 1", slots: [{ exerciseId: exA! }] }] },
      }),
    ConflictError,
  );
  assert.equal((await repos.trainingPlans.findActive(user.id))?.id, plan.id);

  const v2 = await repos.trainingPlans.addVersion(plan.id, {
    startsOn: "2026-01-19",
    rationaleNotes: "Progressive overload",
    sessions: [{ name: "Push", slots: [{ exerciseId: exA!, targetSets: 5, repMin: 5, repMax: 8 }] }],
  });
  assert.equal(v2.versionNumber, 2);
  assert.ok(v2.id !== plan.versions[0]?.id);

  const loaded = await repos.trainingPlans.findById(plan.id);
  assert.ok(loaded);
  assert.equal(loaded.versions.length, 2);
  const v1After = loaded.versions.find((v) => v.id === plan.versions[0]?.id);
  assert.ok(v1After);
  // Version 1 content stayed exactly as written.
  assert.equal(v1After.sessions.find((s) => s.name === "Push")?.slots[0]?.targetSets, 4);
  assert.equal(v1After.sessions.find((s) => s.name === "Pull")?.slots[0]?.targetSets, 3);

  // Database-level: plan versions are append-only.
  await assert.rejects(() =>
    prisma!.trainingPlanVersion.update({
      where: { id: v1After.id },
      data: { rationaleNotes: "rewritten history" },
    }),
  );

  // Retiring frees the single-active slot.
  await repos.trainingPlans.setStatus(plan.id, "retired");
  assert.equal(await repos.trainingPlans.findActive(user.id), null);
  const planB = await repos.trainingPlans.create({
    userId: user.id,
    name: "Block B",
    status: "active",
    version: { startsOn: "2026-02-02", sessions: [{ name: "Day 1", slots: [{ exerciseId: exA! }] }] },
  });
  assert.equal((await repos.trainingPlans.findActive(user.id))?.id, planB.id);
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
      startsOn: "2026-03-02",
      sessions: [{ name: "Day 1", slots: [{ exerciseId: exA!, targetSets: 3, repMin: 8, repMax: 12 }] }],
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
    startsOn: "2026-03-16",
    sessions: [{ name: "Day 1", slots: [{ exerciseId: exA!, targetSets: 5, repMin: 5, repMax: 8 }] }],
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
