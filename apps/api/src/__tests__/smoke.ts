import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import {
  createPrismaClient,
  createRepositories,
  newUuidv7,
  seedDatabase,
  startTestPostgres,
} from "@fitcoach/db";
import type { TestPostgres } from "@fitcoach/db";
import { createServer } from "../server";
import { createServices } from "../services";

/**
 * API smoke test (milestone §12): the real HTTP surface — router, validation,
 * services, repositories, PostgreSQL — driven exactly as a client would.
 *
 * Deliberately file-named `smoke.ts` (not `*.test.ts`) so the unit-test glob
 * never starts a database; run it explicitly with `npm run test:smoke`.
 */

interface HttpResult {
  status: number;
  raw: string;
  data: Record<string, any>;
}

type Prisma = ReturnType<typeof createPrismaClient>;

let harness: TestPostgres | undefined;
let prisma: Prisma | undefined;
let server: ReturnType<typeof createServer> | undefined;
let base = "";
let userId = "";
let exerciseId = "";

async function request(method: string, path: string, body?: unknown): Promise<HttpResult> {
  const response = await fetch(`${base}${path}`, {
    method,
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const raw = await response.text();
  return {
    status: response.status,
    raw,
    data: raw.length > 0 ? (JSON.parse(raw) as Record<string, any>) : {},
  };
}

const get = (path: string): Promise<HttpResult> => request("GET", path);
const post = (path: string, body: unknown): Promise<HttpResult> => request("POST", path, body);
const put = (path: string, body: unknown): Promise<HttpResult> => request("PUT", path, body);

before(
  async () => {
    harness = await startTestPostgres();
    prisma = createPrismaClient({ url: harness.url });
    const repositories = createRepositories(prisma);
    await seedDatabase(prisma);
    const services = createServices(repositories);
    server = createServer({ services });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
    const exercise = (await repositories.exercises.listExercises())[0];
    assert.ok(exercise, "seed must provide an exercise");
    exerciseId = exercise.id;
  },
  { timeout: 600_000 },
);

after(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  await prisma?.$disconnect();
  await harness?.stop();
});

// ---------------------------------------------------------------------------
// Static routing
// ---------------------------------------------------------------------------

test("health, example and error routing work", async () => {
  assert.equal((await get("/healthz")).status, 200);
  assert.equal((await get("/v0/example-profile")).status, 200);
  assert.equal((await get("/nope")).status, 404);
  assert.equal((await request("DELETE", "/healthz")).status, 405);
});

// ---------------------------------------------------------------------------
// Users + validation hygiene
// ---------------------------------------------------------------------------

test("create and fetch a user; validation errors never echo values", async () => {
  // Wrong-typed field: rejected by validation with the field name only.
  const sentinel = `SENTINEL_${newUuidv7().slice(0, 8)}`;
  const invalid = await post("/v0/users", { displayName: { sentinel } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data["error"], "validation_failed");
  assert.equal(invalid.data["path"], "displayName");
  assert.ok(!invalid.raw.includes(sentinel), "error responses must not echo submitted values");

  const created = await post("/v0/users", {
    email: `smoke-${newUuidv7()}@example.com`,
    displayName: "Smoke Tester",
    timezone: "Asia/Kolkata",
  });
  assert.equal(created.status, 201);
  const user = created.data["user"] as { id: string; timezone: string };
  assert.ok(user.id, "POST /v0/users must return the created user (not a pending promise)");
  assert.equal(user.timezone, "Asia/Kolkata");
  userId = user.id;

  const fetched = await get(`/v0/users/${userId}`);
  assert.equal(fetched.status, 200);
  assert.equal((fetched.data["user"] as { id: string }).id, userId);

  const missing = await get(`/v0/users/${newUuidv7()}`);
  assert.equal(missing.status, 404);
  assert.equal(missing.data["error"], "not_found");
});

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

test("profile upserts append revisions for material changes only", async () => {
  // PUT is full-state replacement: each request must carry the whole profile.
  const full = {
    birthDate: "1994-06-30",
    sex: "male",
    heightCm: 178,
    trainingExperience: "intermediate",
    trainingDaysPerWeek: 4,
    sessionDurationMinutes: 60,
    limitations: ["old knee sprain"],
    unitSystem: "metric",
  };
  const first = await put(`/v0/users/${userId}/profile`, { ...full, reason: "onboarding" });
  assert.equal(first.status, 200, first.raw);

  // Cosmetic change: no new revision.
  const cosmetic = await put(`/v0/users/${userId}/profile`, { ...full, unitSystem: "imperial" });
  assert.equal(cosmetic.status, 200, cosmetic.raw);
  const bump = await put(`/v0/users/${userId}/profile`, {
    ...full,
    heightCm: 180,
    reason: "re-measure",
  });
  assert.equal(bump.status, 200, bump.raw);

  const withRevisions = await get(`/v0/users/${userId}/profile?revisions=true`);
  assert.equal(withRevisions.status, 200, withRevisions.raw);
  assert.equal(withRevisions.data["profile"]["heightCm"], 180);
  assert.equal(
    (withRevisions.data["revisions"] as unknown[]).length,
    2,
    JSON.stringify(withRevisions.data),
  );
});

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

test("goals: create, read active, conflict on a same-day pivot", async () => {
  const created = await post(`/v0/users/${userId}/goals`, {
    kind: "lean_recomposition",
    description: "Cut toward 12% body fat",
    priorities: ["waist_control", "shoulder_width"],
  });
  assert.equal(created.status, 201);
  const goalId = created.data["goal"]["id"] as string;
  assert.ok(goalId);

  const active = await get(`/v0/users/${userId}/goals/active`);
  assert.equal(active.status, 200);
  assert.equal(active.data["goal"]["id"], goalId);

  // Same-day pivot conflicts with the active interval.
  const duplicate = await post(`/v0/users/${userId}/goals`, { kind: "max_strength" });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data["error"], "conflict");

  const invalidKind = await post(`/v0/users/${userId}/goals`, { kind: "get_rich_quick" });
  assert.equal(invalidKind.status, 400);

  const history = await get(`/v0/users/${userId}/goals`);
  assert.equal((history.data["goals"] as unknown[]).length, 1);
});

// ---------------------------------------------------------------------------
// Measurements + activity idempotency
// ---------------------------------------------------------------------------

test("measurements replay idempotently per provider import id", async () => {
  const externalId = `scale-${newUuidv7()}`;
  const payload = {
    bodyWeightKg: 80.4,
    bodyFatPercent: 18.2,
    circumferencesCm: { waist: 84.5 },
    condition: "morning_fasted",
    enteredVia: "smart_scale_import",
    confidence: "measured",
    externalId,
  };
  const first = await post(`/v0/users/${userId}/measurements`, payload);
  assert.equal(first.status, 201, first.raw);

  const replay = await post(`/v0/users/${userId}/measurements`, {
    bodyWeightKg: 120,
    enteredVia: "smart_scale_import",
    externalId,
  });
  assert.equal(replay.status, 201, replay.raw);
  assert.equal(replay.data["measurement"]["id"], first.data["measurement"]["id"]);
  assert.equal(replay.data["measurement"]["bodyWeightKg"], 80.4);

  const list = await get(`/v0/users/${userId}/measurements`);
  assert.equal((list.data["measurements"] as unknown[]).length, 1);
});

test("step imports keep the maximum for the day", async () => {
  const day = "2026-02-03";
  const first = await post(`/v0/users/${userId}/activity`, {
    kind: "steps",
    date: day,
    steps: 8000,
    recordedVia: "phone",
  });
  assert.equal(first.status, 201);

  const lower = await post(`/v0/users/${userId}/activity`, {
    kind: "steps",
    date: day,
    steps: 6500,
    recordedVia: "phone",
  });
  assert.equal(lower.status, 201);
  assert.equal(lower.data["activity"]["steps"], 8000);

  const list = await get(`/v0/users/${userId}/activity?kind=steps&from=${day}&to=${day}`);
  assert.equal(list.status, 200, list.raw);
  assert.equal((list.data["activity"] as unknown[]).length, 1, list.raw);
  assert.equal(list.data["activity"][0]["steps"], 8000);
});

// ---------------------------------------------------------------------------
// Workouts
// ---------------------------------------------------------------------------

test("workout journey: idempotent create, sets, frozen after completion", async () => {
  const payload = {
    title: "Smoke push day",
    status: "in_progress",
    startedAt: "2026-02-05T06:00:00.000Z",
    clientRequestId: newUuidv7(),
  };
  const first = await post(`/v0/users/${userId}/workouts`, payload);
  assert.equal(first.status, 201);
  const workoutId = first.data["workout"]["id"] as string;

  const replay = await post(`/v0/users/${userId}/workouts`, payload);
  assert.equal(replay.status, 201);
  assert.equal(replay.data["workout"]["id"], workoutId);

  const group = await post(`/v0/users/${userId}/workouts/${workoutId}/exercises`, {
    exerciseId,
  });
  assert.equal(group.status, 201);
  const groupId = group.data["workoutExercise"]["id"] as string;

  const set = await post(`/v0/users/${userId}/workouts/${workoutId}/sets`, {
    workoutExerciseId: groupId,
    kind: "working",
    loadKg: 60,
    reps: 8,
    rir: 2,
  });
  assert.equal(set.status, 201);

  const done = await post(`/v0/users/${userId}/workouts/${workoutId}/complete`, {});
  assert.equal(done.status, 200);
  assert.equal(done.data["workout"]["status"], "completed");

  // Frozen after completion: 409 immutable_record, no storage details leaked.
  const frozen = await post(`/v0/users/${userId}/workouts/${workoutId}/sets`, {
    workoutExerciseId: groupId,
    kind: "working",
    reps: 5,
  });
  assert.equal(frozen.status, 409);
  assert.equal(frozen.data["error"], "immutable_record");
  assert.ok(!frozen.raw.includes("PostgreSQL"), "responses must not leak storage details");

  const fetched = await get(`/v0/users/${userId}/workouts/${workoutId}`);
  assert.equal(fetched.status, 200);
  const aggregate = fetched.data["workout"];
  assert.equal((aggregate["exercises"] as unknown[]).length, 1);
  assert.equal((aggregate["exercises"][0]["sets"] as unknown[]).length, 1);
});

// ---------------------------------------------------------------------------
// Nutrition
// ---------------------------------------------------------------------------

test("nutrition journey: food, idempotent meals, refreshed daily snapshot", async () => {
  const food = await post(`/v0/users/${userId}/foods`, {
    name: "Smoke granola",
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
  assert.equal(food.status, 201, food.raw);
  const foodId = food.data["food"]["id"] as string;
  assert.ok(foodId);

  const fetchedFood = await get(`/v0/foods/${foodId}`);
  assert.equal(fetchedFood.status, 200);
  assert.equal(fetchedFood.data["food"]["name"], "Smoke granola");

  const mealPayload = {
    localDate: "2026-02-04",
    slot: "breakfast",
    clientRequestId: newUuidv7(),
    items: [{ foodId, quantityGrams: 40, confidence: "measured" }],
  };
  const meal = await post(`/v0/users/${userId}/meals`, mealPayload);
  assert.equal(meal.status, 201, meal.raw);
  const mealId = meal.data["meal"]["id"] as string;
  assert.ok(Math.abs(meal.data["meal"]["totals"]["caloriesKcal"] - 180) < 0.01);

  const replay = await post(`/v0/users/${userId}/meals`, mealPayload);
  assert.equal(replay.status, 201);
  assert.equal(replay.data["meal"]["id"], mealId);
  assert.equal((replay.data["meal"]["items"] as unknown[]).length, 1);

  const extraItem = await post(`/v0/users/${userId}/meals/${mealId}/items`, {
    foodId,
    quantityGrams: 20,
  });
  assert.equal(extraItem.status, 201, extraItem.raw);
  assert.ok(Math.abs(extraItem.data["meal"]["totals"]["caloriesKcal"] - 270) < 0.01);

  const meals = await get(`/v0/users/${userId}/meals?date=2026-02-04`);
  assert.equal((meals.data["meals"] as unknown[]).length, 1);

  const daily = await get(`/v0/users/${userId}/nutrition/daily?date=2026-02-04`);
  assert.equal(daily.status, 200);
  assert.ok(Math.abs(daily.data["daily"]["totals"]["caloriesKcal"] - 270) < 0.01);
});

// ---------------------------------------------------------------------------
// Coaching loop
// ---------------------------------------------------------------------------

test("coaching loop: diagnosis, recommendation, no_change intervention outcome", async () => {
  const diagnosis = await post(`/v0/users/${userId}/diagnoses`, {
    code: "smoke_under_recovered",
    title: "Under-recovered",
    summary: "Sleep and resting heart rate suggest incomplete recovery.",
    severity: "watch",
    analysisWindowDays: 14,
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
  assert.equal(diagnosis.status, 201, diagnosis.raw);
  const diagnosisId = diagnosis.data["diagnosis"]["id"] as string;
  assert.equal((diagnosis.data["diagnosis"]["evidence"] as unknown[]).length, 1);

  const withEvidence = await post(
    `/v0/users/${userId}/diagnoses/${diagnosisId}/evidence`,
    { evidence: [{ metric: "resting_hr_delta", window: "last_14_days", observed: "+6 bpm" }] },
  );
  assert.equal(withEvidence.status, 201, withEvidence.raw);
  assert.equal((withEvidence.data["diagnosis"]["evidence"] as unknown[]).length, 2);

  const recommendation = await post(`/v0/users/${userId}/recommendations`, {
    diagnosisId,
    headline: "Move the last set earlier",
    explanation: "Late sessions are pushing bedtime past your recovery window.",
    evidence: [
      { metric: "sleep_hours_avg", window: "last_14_days", observed: "5.8 h per night" },
    ],
  });
  assert.equal(recommendation.status, 201, recommendation.raw);

  const intervention = await post(`/v0/users/${userId}/interventions`, {
    kind: "no_change",
    diagnosisId,
    rationale: "The current plan is producing the expected trend.",
    expectedEffect: "Maintain the trajectory without modification.",
    reviewOn: "2026-04-01",
  });
  assert.equal(intervention.status, 201, intervention.raw);
  const interventionId = intervention.data["intervention"]["id"] as string;

  const outcomePayload = {
    evaluationWindow: "2026-03-01..2026-03-15",
    verdict: "improved_as_expected",
    explanation: "Targets were correct; keep going.",
  };
  const outcome = await post(
    `/v0/users/${userId}/interventions/${interventionId}/outcomes`,
    outcomePayload,
  );
  assert.equal(outcome.status, 201, outcome.raw);

  // One outcome per evaluation window.
  const duplicate = await post(
    `/v0/users/${userId}/interventions/${interventionId}/outcomes`,
    outcomePayload,
  );
  assert.equal(duplicate.status, 409);

  const outcomes = await get(`/v0/users/${userId}/interventions/${interventionId}/outcomes`);
  assert.equal((outcomes.data["outcomes"] as unknown[]).length, 1);

  const recommendations = await get(`/v0/users/${userId}/recommendations`);
  assert.equal((recommendations.data["recommendations"] as unknown[]).length, 1);

  const diagnoses = await get(`/v0/users/${userId}/diagnoses`);
  assert.equal((diagnoses.data["diagnoses"] as unknown[]).length, 1);
});
