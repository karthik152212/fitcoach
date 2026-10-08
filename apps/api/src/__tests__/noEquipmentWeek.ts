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
 * Phase 3.1.1 acceptance journey — the full no-equipment week (§23).
 *
 * Driven against the REAL seeded catalogue, real PostgreSQL and the real HTTP
 * surface, exactly as a client would:
 *
 *   gym plan → gym unavailable for 7 days → home_no_equipment →
 *   temporary plan → every session staffed from the equipment-free universe →
 *   pulling limitations stated, never faked → home workout logged as
 *   bodyweight load → progression ledger records it → gym restored →
 *   the original gym plan is untouched.
 *
 * Deliberately file-named `noEquipmentWeek.ts` (not `*.test.ts`) so the
 * unit-test glob never starts a database; run it with
 * `npm run test:no-equipment-week`.
 */

interface HttpResult {
  status: number;
  raw: string;
  data: Record<string, any>;
}

let harness: TestPostgres | undefined;
let prisma: ReturnType<typeof createPrismaClient> | undefined;
let server: ReturnType<typeof createServer> | undefined;
let base = "";
let uid = "";
let catalogEquipmentIds: string[] = [];
let catalogEquipmentBySlug: Record<string, string> = {};
let knowledgeByExerciseId: Record<
  string,
  { slug: string; requiredEquipmentIds: string[]; targets: Array<{ muscleSlug: string; role: string }> }
> = {};

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

    const catalog = await repositories.equipment.listCatalog();
    catalogEquipmentIds = catalog.map((item) => item.id);
    catalogEquipmentBySlug = Object.fromEntries(catalog.map((item) => [item.slug, item.id]));
    const knowledge = await repositories.exercises.listExerciseKnowledge();
    knowledgeByExerciseId = Object.fromEntries(
      knowledge.map((item) => [
        item.id,
        {
          slug: item.slug,
          requiredEquipmentIds: [...item.requiredEquipmentIds],
          targets: item.targets.map((target) => ({ muscleSlug: target.muscleSlug, role: target.role })),
        },
      ]),
    );
  },
  { timeout: 600_000 },
);

after(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  await prisma?.$disconnect();
  await harness?.stop();
});

test("full no-equipment week: gym plan → 7-day home_no_equipment → bodyweight week → restore", async () => {
  // 0. A realistic user with a full gym.
  const createdUser = await post("/v0/users", {
    email: `noeq-${newUuidv7()}@example.com`,
    displayName: "No-Equipment Week",
    timezone: "Asia/Kolkata",
  });
  assert.equal(createdUser.status, 201, createdUser.raw);
  uid = createdUser.data["user"]["id"] as string;

  const goal = await post(`/v0/users/${uid}/goals`, {
    kind: "bodybuilding",
    description: "Hypertrophy focus",
    effectiveFrom: "2026-01-01",
  });
  assert.equal(goal.status, 201, goal.raw);
  for (const equipmentId of catalogEquipmentIds) {
    const added = await post(`/v0/users/${uid}/equipment`, {
      equipmentId,
      validFrom: "2026-01-01",
    });
    assert.ok(added.status === 201 || added.status === 200, added.raw);
  }

  // 1. The user has a gym-based plan.
  const gym = await post(`/v0/users/${uid}/training-plans/generate`, {
    asOf: "2026-10-05",
    goalKind: "bodybuilding",
    availableTrainingDays: 4,
    maxSessionDurationMinutes: 60,
    experience: "intermediate",
  });
  assert.equal(gym.status, 201, gym.raw);
  const gymPlanId = gym.data["plan"]["id"] as string;
  const gymVersionId = gym.data["version"]["id"] as string;
  const gymSessions = gym.data["sessions"] as Array<{ exercises: Array<{ exerciseId: string }> }>;
  assert.ok(gymSessions.length > 0);

  // 2. The gym is unavailable for 7 days — declared, never guessed.
  const environment = await post(`/v0/users/${uid}/training-environments`, {
    kind: "home_no_equipment",
    effectiveFrom: "2026-10-10",
    reason: "gym closed for renovation",
    isTemporary: true,
  });
  assert.equal(environment.status, 201, environment.raw);

  const active = await get(`/v0/users/${uid}/training-environments/active?asOf=2026-10-11`);
  assert.equal(active.status, 200, active.raw);
  assert.equal(active.data["environment"]["kind"], "home_no_equipment");
  assert.equal(active.data["environment"]["constrained"], true);
  // The environment permits nothing beyond the user's own body.
  const availableIds = active.data["environment"]["availableEquipmentIds"] as string[];
  for (const id of availableIds) {
    assert.equal(id, catalogEquipmentBySlug["bodyweight"], "only the body itself may be available");
  }
  const envLimitations = active.data["environment"]["limitations"] as Array<{
    kind: string;
    subject: string;
  }>;
  assert.ok(
    envLimitations.some(
      (item) => item.kind === "muscle_coverage" && item.subject === "latissimus_dorsi",
    ),
    "the environment names the lats as constrained",
  );
  assert.ok(
    envLimitations.some((item) => item.kind === "movement_pattern" && item.subject === "vertical_pull"),
    "vertical pulling is named unsupported",
  );
  assert.ok(
    envLimitations.some((item) => item.kind === "load_progression"),
    "the loss of external-load progression is stated",
  );

  // 3. A temporary plan is generated for the no-equipment week.
  const temporary = await post(`/v0/users/${uid}/training-plans/generate-temporary`, {
    asOf: "2026-10-11",
    availableTrainingDays: 4,
    maxSessionDurationMinutes: 60,
    experience: "intermediate",
  });
  assert.equal(temporary.status, 201, temporary.raw);
  assert.equal(temporary.data["needed"], true, temporary.raw);
  assert.equal(temporary.data["sourcePlanId"], gymPlanId);
  assert.equal(temporary.data["sourceVersionId"], gymVersionId);

  const tempResult = temporary.data["result"];
  assert.equal(tempResult["plan"]["kind"], "temporary_environment");
  assert.equal(tempResult["plan"]["environmentKind"], "home_no_equipment");
  assert.notEqual(
    tempResult["feasibility"],
    "infeasible",
    `a no-equipment week must be generable; reasons: ${JSON.stringify(tempResult["infeasibilityReasons"])}`,
  );
  assert.equal(
    tempResult["feasibility"],
    "feasible_with_tradeoffs",
    "the plan states its tradeoffs instead of pretending to be the gym plan",
  );
  assert.ok(
    !(tempResult["progressionMechanisms"] as string[]).includes("load"),
    "no external-load lever is promised",
  );
  assert.ok((tempResult["progressionMechanisms"] as string[]).includes("variation"));

  // 4. Every session is staffed, within budget, and requires nothing.
  const tempSessions = tempResult["sessions"] as Array<{
    name: string;
    estimatedMinutes: number;
    exercises: Array<{ exerciseId: string; name: string }>;
  }>;
  assert.ok(tempSessions.length >= 3, `expected a real training week, got ${tempSessions.length} session(s)`);
  for (const session of tempSessions) {
    assert.ok(session.exercises.length > 0, `session "${session.name}" must never be empty`);
    assert.ok(
      session.estimatedMinutes <= 60,
      `session "${session.name}" at ${session.estimatedMinutes}min exceeds the 60min budget`,
    );
    for (const exercise of session.exercises) {
      const knowledge = knowledgeByExerciseId[exercise.exerciseId];
      assert.ok(knowledge, `${exercise.name} must resolve in the seeded catalogue`);
      assert.deepEqual(
        knowledge.requiredEquipmentIds,
        [],
        `${knowledge.slug} must require no equipment in a home_no_equipment week`,
      );
    }
  }

  // 5. Coverage: lower body, push, core and calves are staffed; pulling is not faked.
  const plannedIds = new Set(
    tempSessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseId)),
  );
  const primaryFor = (muscle: string) =>
    [...plannedIds].filter((id) =>
      knowledgeByExerciseId[id]!.targets.some(
        (target) => target.muscleSlug === muscle && target.role === "primary_mover",
      ),
    );
  assert.ok(primaryFor("quadriceps").length > 0, "lower body (quads) staffed");
  assert.ok(primaryFor("gluteus_maximus").length > 0, "glutes staffed");
  assert.ok(primaryFor("hamstrings").length > 0, "posterior chain staffed");
  assert.ok(
    primaryFor("gastrocnemius").length + primaryFor("soleus").length > 0,
    "calves staffed",
  );
  assert.ok(primaryFor("pectoralis_major").length > 0, "push staffed");
  assert.ok(primaryFor("triceps_brachii").length > 0, "triceps staffed");
  assert.ok(
    primaryFor("rectus_abdominis").length +
      primaryFor("transversus_abdominis").length +
      primaryFor("obliques").length >
      0,
    "core staffed",
  );
  assert.equal(
    primaryFor("latissimus_dorsi").length,
    0,
    "no exercise claims to train the lats as a primary with no equipment",
  );

  // 6. Substitutions are honesty-labelled; nothing claims full equivalence.
  const substitutions = (tempResult["substitutions"] ?? []) as Array<{ equivalence: string }>;
  for (const substitution of substitutions) {
    assert.notEqual(
      substitution.equivalence,
      "equivalent",
      "a no-equipment substitution is never 'equivalent'",
    );
  }
  const planLimitations = (tempResult["limitations"] ?? []) as Array<{ kind: string; subject: string }>;
  assert.ok(
    planLimitations.some((item) => item.kind === "muscle_coverage"),
    "the plan carries its muscle-coverage limitations",
  );

  // 7. Determinism: the same request produces the same temporary plan.
  const again = await post(`/v0/users/${uid}/training-plans/generate-temporary`, {
    asOf: "2026-10-11",
    availableTrainingDays: 4,
    maxSessionDurationMinutes: 60,
    experience: "intermediate",
  });
  assert.equal(again.status, 201, again.raw);
  assert.equal(again.data["result"]["plan"]["id"], tempResult["plan"]["id"]);
  assert.deepEqual(
    (again.data["result"]["sessions"] as typeof tempSessions).map((session) =>
      session.exercises.map((exercise) => exercise.exerciseId),
    ),
    tempSessions.map((session) => session.exercises.map((exercise) => exercise.exerciseId)),
    "identical input produces identical sessions",
  );

  // 8. The gym plan is untouched and still the active plan.
  const activePlan = await get(`/v0/users/${uid}/training-plans/active`);
  assert.equal(activePlan.status, 200, activePlan.raw);
  assert.equal(activePlan.data["plan"]["id"], gymPlanId);
  assert.equal(activePlan.data["plan"]["versions"].length, 1);

  // 9. The user completes at least one home workout — logged as bodyweight load.
  const firstSession = tempSessions[0]!;
  const firstExerciseId = firstSession.exercises[0]!.exerciseId;
  const tempPlanId = tempResult["plan"]["id"] as string;
  const workout = await post(`/v0/users/${uid}/workouts`, {
    planId: tempPlanId,
    startedAt: "2026-10-11T18:00:00.000Z",
    status: "in_progress",
    clientRequestId: newUuidv7(),
    environmentKind: "home_no_equipment",
    sessionClassification: "adapted",
  });
  assert.equal(workout.status, 201, workout.raw);
  const workoutId = workout.data["workout"]["id"] as string;
  const group = await post(`/v0/users/${uid}/workouts/${workoutId}/exercises`, {
    exerciseId: firstExerciseId,
  });
  assert.equal(group.status, 201, group.raw);
  const set = await post(`/v0/users/${uid}/workouts/${workoutId}/sets`, {
    workoutExerciseId: group.data["workoutExercise"]["id"] as string,
    kind: "working",
    loadKind: "bodyweight",
    reps: 15,
    rir: 2,
    clientRequestId: newUuidv7(),
  });
  assert.equal(set.status, 201, set.raw);
  const completed = await post(`/v0/users/${uid}/workouts/${workoutId}/complete`, {
    status: "completed",
    endedAt: "2026-10-11T18:45:00.000Z",
  });
  assert.equal(completed.status, 200, completed.raw);

  // 10. The progression ledger records the bodyweight performance.
  const evaluation = await post(`/v0/users/${uid}/progression/evaluate`, {
    exerciseId: firstExerciseId,
    asOf: "2026-10-11",
  });
  assert.equal(evaluation.status, 200, evaluation.raw);
  const history = await get(`/v0/users/${uid}/performance-history?exerciseId=${firstExerciseId}`);
  assert.equal(history.status, 200, history.raw);
  const observations = history.data["observations"] as Array<{ loadKind: string; reps: number }>;
  assert.ok(observations.length >= 1, "the performed set is observable");
  assert.ok(
    observations.some((observation) => observation.loadKind === "bodyweight"),
    "the home set is recorded as bodyweight load, not missing data",
  );
  const ledger = await get(`/v0/users/${uid}/progression/ledger`);
  assert.equal(ledger.status, 200, ledger.raw);
  assert.ok(Array.isArray(ledger.data["entries"]));

  // 11. Continuity counts the week as training, not as a gap.
  const continuity = await get(`/v0/users/${uid}/training-continuity?asOf=2026-10-11`);
  assert.equal(continuity.status, 200, continuity.raw);
  assert.equal(continuity.data["sessions"]["adapted"], 1);
  assert.equal(continuity.data["sessions"]["home"], 1);
  assert.equal(continuity.data["temporaryPlans"].length, 1);

  // 12. Gym access returns after 7 days → the temporary plan retires, the gym plan survives.
  const restored = await post(`/v0/users/${uid}/training-environments/restore`, {
    asOf: "2026-10-17",
  });
  assert.equal(restored.status, 200, restored.raw);
  assert.equal(restored.data["restored"], true);
  assert.equal(restored.data["environment"]["kind"], "gym");
  assert.deepEqual(restored.data["retiredPlanIds"], [tempPlanId]);

  const planAfter = await get(`/v0/users/${uid}/training-plans/active`);
  assert.equal(planAfter.status, 200, planAfter.raw);
  assert.equal(planAfter.data["plan"]["id"], gymPlanId);
  assert.equal(planAfter.data["plan"]["versions"].length, 1, "the gym plan is never rewritten");

  const after = await get(`/v0/users/${uid}/training-continuity?asOf=2026-10-18`);
  assert.equal(after.data["sessions"]["adapted"], 1, "home training history is never erased");
  assert.equal(after.data["temporaryPlans"][0]["status"], "retired");
});
