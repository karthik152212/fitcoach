import assert from "node:assert/strict";
import { test, describe } from "node:test";
import type { Repositories } from "@fitcoach/db";
import { PersonalContextBuilder } from "../contextBuilder";

// ---------------------------------------------------------------------------
// Mock repository implementations for testing
// ---------------------------------------------------------------------------

function makeMockUser(id: string, timezone = "UTC") {
  return {
    id,
    email: "test@example.com",
    timezone,
    profile: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeMockRepositories(overrides: Partial<Repositories> = {}): Repositories {
  const base: Repositories = {
    users: {
      findById: async (_id: string) => makeMockUser(_id),
      findByEmail: async () => null,
      create: async () => makeMockUser("new"),
      update: async () => makeMockUser("updated"),
      delete: async () => {},
    } as any,
    profiles: {
      get: async () => null,
      upsert: async () => ({} as any),
      revisions: async () => [],
    } as any,
    goals: {
      active: async () => null,
      history: async () => [],
      create: async () => null as any,
      updateStatus: async () => null as any,
      list: async () => [],
    } as any,
    equipment: {
      listCatalog: async () => [],
      getUserInventory: async () => [],
    } as any,
    exercises: {
      findById: async () => null,
      search: async () => ({ foods: [], total: 0 }),
    } as any,
    knowledge: {
      muscleCatalog: async () => [],
      muscleById: async () => null,
      movementFunctions: async () => [],
      searchExercises: async () => ({ exercises: [], total: 0 }),
      exerciseDetail: async () => null,
    } as any,
    exercisePreferences: {
      list: async () => [],
      create: async () => null as any,
      update: async () => null as any,
      delete: async () => {},
    } as any,
    trainingPlans: {
      create: async () => null as any,
      addVersion: async () => null as any,
      findById: async () => null,
      findActive: async () => null,
      listForUser: async () => [],
      listTemporary: async () => [],
      setStatus: async () => null as any,
    } as any,
    trainingEnvironments: {
      create: async () => null as any,
      listForUser: async () => [],
      resolveForDate: async () => null,
    } as any,
    progressionLedger: {
      recordEvaluation: async () => null as any,
      findEvaluation: async () => null,
      listEvaluations: async () => [],
      recordDecisionEvent: async () => null as any,
      listDecisionEvents: async () => [],
    } as any,
    workouts: {
      create: async () => null as any,
      addExercise: async () => null as any,
      addSet: async () => null as any,
      complete: async () => null as any,
      findById: async () => null,
      history: async () => [],
    } as any,
    bodyMeasurements: {
      record: async () => null as any,
      history: async () => [],
      getStateSnapshot: async () => null,
    } as any,
    physiqueGoals: {
      create: async () => null as any,
      getActive: async () => null,
      history: async () => [],
      update: async () => null as any,
      delete: async () => {},
    } as any,
    activity: {
      recordSteps: async () => null as any,
      record: async () => null as any,
      history: async () => [],
      getStateSnapshot: async () => null,
    } as any,
    sleep: {
      record: async () => null as any,
      history: async () => [],
      getStateSnapshot: async () => null,
    } as any,
    recovery: {
      record: async () => null as any,
      history: async () => [],
      getStateSnapshot: async () => null,
    } as any,
    foods: {
      createSource: async () => null as any,
      findSource: async () => null,
      findOrCreateUserSource: async () => null as any,
      createFood: async () => null as any,
      findById: async () => null,
      findByBarcode: async () => null,
      searchFoods: async () => ({ foods: [], total: 0 }),
      updateNutrients: async () => null as any,
      deactivate: async () => {},
    } as any,
    meals: {
      create: async () => null as any,
      addItem: async () => null as any,
      findById: async () => null,
      listByDate: async () => [],
    } as any,
    recipes: {
      create: async () => null as any,
      findById: async () => null,
      listByOwner: async () => [],
      computeNutrition: async () => null as any,
      delete: async () => {},
    } as any,
    nutrition: {
      upsertDaily: async () => null as any,
      getDaily: async () => null,
      getStateSnapshot: async () => null,
    } as any,
    diagnoses: {
      create: async () => null as any,
      attachEvidence: async () => null as any,
      updateStatus: async () => null as any,
      findById: async () => null,
      list: async () => [],
    } as any,
    recommendations: {
      create: async () => null as any,
      updateStatus: async () => null as any,
      findById: async () => null,
      list: async () => [],
    } as any,
    interventions: {
      create: async () => null as any,
      updateStatus: async () => null as any,
      supersede: async () => null as any,
      recordOutcome: async () => null as any,
      findById: async () => null,
      list: async () => [],
      listActive: async () => [],
      outcomes: async () => [],
    } as any,
    decisionSnapshots: {
      create: async () => null as any,
      updateStatus: async () => null as any,
      findById: async () => null,
      findByIdWithRelations: async () => null,
      list: async () => [],
    } as any,
    decisionInterventions: {
      create: async () => null as any,
      listByDecisionSnapshot: async () => [],
    } as any,
    decisionEvidence: {
      create: async () => null as any,
      listByDecisionSnapshot: async () => [],
    } as any,
    decisionAssumptions: {
      create: async () => null as any,
      listByDecisionSnapshot: async () => [],
    } as any,
    decisionOutcomes: {
      create: async () => null as any,
      list: async () => [],
    } as any,
    conversations: {
      create: async () => null as any,
      findById: async () => null,
      list: async () => [],
      updateStatus: async () => null as any,
    } as any,
    conversationMessages: {
      create: async () => null as any,
      findById: async () => null,
      list: async () => [],
      listByUser: async () => [],
    } as any,
    ...overrides,
  };
  return base;
}

describe("PersonalContextBuilder", () => {
  test("builds context with minimal data when no repositories have data", async () => {
    const repos = makeMockRepositories();
    const builder = new PersonalContextBuilder(repos);

    const result = await builder.buildContext("usr_1", {
      userId: "usr_1",
      message: "How am I doing?",
      contextSources: {
        profile: true,
        goal: true,
        training: true,
        nutrition: true,
        activity: true,
        recovery: true,
        body: true,
        projection: true,
        decision: true,
        conversation: true,
      },
    });

    assert.equal(result.userId, "usr_1");
    assert.equal(result.asOf, new Date().toISOString().split("T")[0]);
    assert.ok(result.generatedAt);
    assert.ok(result.quality);
    assert.ok(result.quality.overallScore >= 0);
    assert.ok(result.quality.overallScore <= 100);
    assert.ok(Array.isArray(result.sources));
    assert.ok(Array.isArray(result.quality.missingDataWarnings));
    assert.ok(Array.isArray(result.quality.staleDataWarnings));
    assert.ok(typeof result.quality.sufficientForAdvice === "boolean");
  });

  test("builds context with user profile", async () => {
    const repos = makeMockRepositories({
      users: {
        findById: async (_id: string) => ({
          id: _id,
          email: "test@example.com",
          timezone: "America/New_York",
          profile: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        findByEmail: async () => null,
        create: async () => ({} as any),
        update: async () => ({} as any),
        delete: async () => {},
      } as any,
      profiles: {
        get: async () => ({
          birthDate: "1985-03-15",
          sex: "female",
          heightCm: 165,
          trainingExperience: "intermediate",
          trainingDaysPerWeek: 4,
          sessionDurationMinutes: 60,
          limitations: [],
          unitSystem: "metric",
        }),
        upsert: async () => ({} as any),
        revisions: async () => [],
      } as any,
    });
    const builder = new PersonalContextBuilder(repos);

    const result = await builder.buildContext("usr_1", {
      userId: "usr_1",
      message: "How am I doing?",
      contextSources: {
        profile: true,
        goal: false,
        training: false,
        nutrition: false,
        activity: false,
        recovery: false,
        body: false,
        projection: false,
        decision: false,
        conversation: false,
      },
    });

    assert.ok(result.profile);
    assert.equal(result.profile?.timezone, "America/New_York");
    assert.equal(result.profile?.profile?.sex, "female");
    assert.equal(result.profile?.profile?.heightCm, 165);
  });

  test("builds context with active goal", async () => {
    const repos = makeMockRepositories({
      users: {
        findById: async () => makeMockUser("usr_1"),
        findByEmail: async () => null,
        create: async () => ({} as any),
        update: async () => ({} as any),
        delete: async () => {},
      } as any,
      goals: {
        active: async () => ({
          id: "goal_1",
          userId: "usr_1",
          kind: "aesthetics_v_taper",
          description: "Build shoulder width",
          priorities: ["shoulder_width", "waist_control"],
          physiqueTarget: {
            bodyWeightKg: 75,
            bodyFatPercent: 12,
            waistCm: 80,
            chestCm: 105,
            shoulderCircumferenceCm: 120,
            armCm: 40,
            thighCm: 58,
            calfCm: 40,
            notes: "V-taper physique",
          },
          effectiveFrom: "2026-01-01",
          effectiveUntil: undefined,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        history: async () => [],
        create: async () => null as any,
        updateStatus: async () => null as any,
        list: async () => [],
      } as any,
    });
    const builder = new PersonalContextBuilder(repos);

    const result = await builder.buildContext("usr_1", {
      userId: "usr_1",
      message: "How am I doing?",
      contextSources: {
        profile: false,
        goal: true,
        training: false,
        nutrition: false,
        activity: false,
        recovery: false,
        body: false,
        projection: false,
        decision: false,
        conversation: false,
      },
    });

    assert.ok(result.goal);
    assert.equal(result.goal?.goalId, "goal_1");
    assert.equal(result.goal?.kind, "aesthetics_v_taper");
    assert.ok(result.goal?.priorities?.includes("shoulder_width"));
    assert.ok(result.goal?.physiqueTarget?.bodyWeightKg === 75);
  });

  test("builds context with training plan and workouts", async () => {
    const repos = makeMockRepositories({
      users: {
        findById: async () => makeMockUser("usr_1"),
        findByEmail: async () => null,
        create: async () => ({} as any),
        update: async () => ({} as any),
        delete: async () => {},
      } as any,
      trainingPlans: {
        findActive: async () => ({
          id: "plan_1",
          userId: "usr_1",
          name: "Hypertrophy Phase 1",
          status: "active",
          versions: [
            {
              id: "version_1",
              sessions: [
                { id: "session_1", dayOfWeek: 0, name: "Upper A", slots: [] },
                { id: "session_2", dayOfWeek: 2, name: "Lower A", slots: [] },
              ],
            },
          ],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        listForUser: async () => [],
        listTemporary: async () => [],
        create: async () => null as any,
        addVersion: async () => null as any,
        findById: async () => null,
        setStatus: async () => null as any,
      } as any,
      workouts: {
        history: async () => [
          {
            workout: {
              id: "workout_1",
              userId: "usr_1",
              status: "completed",
              startedAt: "2026-10-05T00:00:00.000Z",
              endedAt: "2026-10-05T01:00:00.000Z",
            },
            exercises: [],
          },
          {
            workout: {
              id: "workout_2",
              userId: "usr_1",
              status: "completed",
              startedAt: "2026-10-03T00:00:00.000Z",
              endedAt: "2026-10-03T01:00:00.000Z",
            },
            exercises: [],
          },
        ],
        create: async () => null as any,
        addExercise: async () => null as any,
        addSet: async () => null as any,
        complete: async () => null as any,
        findById: async () => null,
      } as any,
      progressionLedger: {
        listEvaluations: async () => [],
        recordEvaluation: async () => null as any,
        findEvaluation: async () => null,
        recordDecisionEvent: async () => null as any,
        listDecisionEvents: async () => [],
      } as any,
    });
    const builder = new PersonalContextBuilder(repos);

    const result = await builder.buildContext("usr_1", {
      userId: "usr_1",
      message: "How am I doing?",
      contextSources: {
        profile: false,
        goal: false,
        training: true,
        nutrition: false,
        activity: false,
        recovery: false,
        body: false,
        projection: false,
        decision: false,
        conversation: false,
      },
      asOf: "2026-10-06",
    });

    assert.ok(result.training);
    assert.equal(result.training?.currentPlanStatus, "active");
    assert.equal(result.training?.adherence, 1.0); // 2/2 completed
    assert.ok(result.training?.weeklySessionFrequency === 2);
  });

  test("builds context with nutrition state", async () => {
    const repos = makeMockRepositories({
      users: {
        findById: async () => makeMockUser("usr_1"),
        findByEmail: async () => null,
        create: async () => ({} as any),
        update: async () => ({} as any),
        delete: async () => {},
      } as any,
      nutrition: {
        getStateSnapshot: async () => ({
          recentDailyTotals: [
            {
              id: "daily_1",
              userId: "usr_1",
              localDate: "2026-10-05",
              totals: { caloriesKcal: 2200, proteinGrams: 140, carbohydrateGrams: 240, fatGrams: 65 },
              targetsSnapshot: { caloriesKcal: 2400, proteinGrams: 180 },
              createdAt: "2026-10-05T00:00:00.000Z",
              updatedAt: "2026-10-05T00:00:00.000Z",
            },
          ],
          averageCalories: 2200,
          averageProteinGrams: 140,
          averageCarbsGrams: 240,
          averageFatGrams: 65,
          adherencePercent: 77.8,
          daysWithData: 1,
          windowDays: 28,
        }),
        upsertDaily: async () => null as any,
        getDaily: async () => null,
      } as any,
    });
    const builder = new PersonalContextBuilder(repos);

    const result = await builder.buildContext("usr_1", {
      userId: "usr_1",
      message: "Am I eating enough protein?",
      contextSources: {
        profile: false,
        goal: false,
        training: false,
        nutrition: true,
        activity: false,
        recovery: false,
        body: false,
        projection: false,
        decision: false,
        conversation: false,
      },
      asOf: "2026-10-06",
    });

    assert.ok(result.nutrition);
    assert.equal(result.nutrition?.adherence?.proteinPercent, 77.8);
    assert.equal(result.nutrition?.dailyNutrition?.[0]?.totals.proteinGrams, 140);
  });

  test("builds context with recovery state", async () => {
    const repos = makeMockRepositories({
      users: {
        findById: async () => makeMockUser("usr_1"),
        findByEmail: async () => null,
        create: async () => ({} as any),
        update: async () => ({} as any),
        delete: async () => {},
      } as any,
      recovery: {
        getStateSnapshot: async () => ({
          averageReadinessScore: 65,
          averageHrvMs: 45,
          averageRestingHeartRateBpm: 58,
          averageSleepScore: 75,
          averageMuscleSoreness: 3,
          averageFatigue: 5,
          lowReadinessDays: 2,
          windowDays: 14,
        }),
        record: async () => null as any,
        history: async () => [],
      } as any,
      sleep: {
        getStateSnapshot: async () => ({
          averageSleepMinutes: 420,
          averageEfficiency: 85,
          averageLatencyMinutes: 15,
          sleepDebtMinutes: 0,
          consistencyScore: 80,
          windowDays: 14,
        }),
        record: async () => null as any,
        history: async () => [],
      } as any,
    });
    const builder = new PersonalContextBuilder(repos);

    const result = await builder.buildContext("usr_1", {
      userId: "usr_1",
      message: "Should I train today?",
      contextSources: {
        profile: false,
        goal: false,
        training: false,
        nutrition: false,
        activity: false,
        recovery: true,
        body: false,
        projection: false,
        decision: false,
        conversation: false,
      },
      asOf: "2026-10-06",
    });

    assert.ok(result.recovery);
    assert.equal(result.recovery?.readinessScore, 65);
    assert.ok(result.recovery?.sleepAdequacy);
  });

  test("builds context with body measurements", async () => {
    const repos = makeMockRepositories({
      users: {
        findById: async () => makeMockUser("usr_1"),
        findByEmail: async () => null,
        create: async () => ({} as any),
        update: async () => ({} as any),
        delete: async () => {},
      } as any,
      bodyMeasurements: {
        getStateSnapshot: async () => ({
          latestWeightKg: 80,
          latestBodyFatPercent: 15,
          weightTrend7d: -0.5,
          weightTrend28d: -2.0,
          measurementsCount: 4,
          windowDays: 28,
        }),
        record: async () => null as any,
        history: async () => [],
      } as any,
    });
    const builder = new PersonalContextBuilder(repos);

    const result = await builder.buildContext("usr_1", {
      userId: "usr_1",
      message: "Why is my weight not dropping?",
      contextSources: {
        profile: false,
        goal: false,
        training: false,
        nutrition: false,
        activity: false,
        recovery: false,
        body: true,
        projection: false,
        decision: false,
        conversation: false,
      },
      asOf: "2026-10-06",
    });

    assert.ok(result.body);
    assert.equal(result.body?.latestWeightKg, 80);
    assert.equal(result.body?.weightTrend7d, -0.5);
    assert.equal(result.body?.measurementsCount, 4);
  });

  test("builds context with decision brain data", async () => {
    const repos = makeMockRepositories({
      users: {
        findById: async () => makeMockUser("usr_1"),
        findByEmail: async () => null,
        create: async () => ({} as any),
        update: async () => ({} as any),
        delete: async () => {},
      } as any,
      decisionSnapshots: {
        list: async () => [
          {
            id: "dec_1",
            userId: "usr_1",
            decidedAt: "2026-10-01",
            kind: "intervention_selected",
            status: "current",
            summary: "Training volume adjustment for chest",
            confidence: "measured",
            createdAt: "2026-10-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:00.000Z",
          },
        ],
        findById: async () => null,
        findByIdWithRelations: async () => ({
          id: "dec_1",
          userId: "usr_1",
          decidedAt: "2026-10-01",
          kind: "intervention_selected",
          status: "current",
          summary: "Training volume adjustment for chest",
          confidence: "measured",
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
          interventions: [
            { id: "int_1", decisionSnapshotId: "dec_1", kind: "training_volume_adjustment", rationale: "Increase chest volume", expectedEffect: "More chest growth", addressesDiagnoses: [], reviewOn: undefined, createdAt: "2026-10-01T00:00:00.000Z" },
          ],
          evidence: [
            {
              id: "ev_1",
              decisionSnapshotId: "dec_1",
              sourceEngine: "training_state",
              code: "volume_deficit",
              title: "Chest volume below target",
              metric: "weekly_volume_chest",
              window: "last_14_days",
              observed: "12 sets",
              observedNumeric: 12,
              expected: "16 sets",
              confidence: "measured",
              provenanceClass: "measured",
              severity: "watch",
              sensitive: false,
              createdAt: "2026-10-01T00:00:00.000Z",
            },
          ],
          assumptions: [],
        }),
        create: async () => null as any,
        updateStatus: async () => null as any,
      } as any,
      decisionOutcomes: {
        list: async () => [],
        create: async () => null as any,
      } as any,
    });
    const builder = new PersonalContextBuilder(repos);

    const result = await builder.buildContext("usr_1", {
      userId: "usr_1",
      message: "Why am I not progressing?",
      contextSources: {
        profile: false,
        goal: false,
        training: false,
        nutrition: false,
        activity: false,
        recovery: false,
        body: false,
        projection: false,
        decision: true,
        conversation: false,
      },
      asOf: "2026-10-06",
    });

    assert.ok(result.decision);
    assert.equal(result.decision?.decisionSnapshot?.id, "dec_1");
    assert.equal(result.decision?.decisionSnapshot?.kind, "intervention_selected");
    assert.ok(result.decision?.activeInterventions?.includes("training_volume_adjustment"));
    assert.ok(result.decision?.evidenceRefs.length > 0);
    assert.equal(result.decision?.evidenceRefs[0]?.code, "volume_deficit");
  });

  test("classifies intent as stalled_progress", async () => {
    makeMockRepositories();

    const { classifyIntent } = await import("@fitcoach/ai");
    const intent = classifyIntent("Why am I not progressing on bench press?");
    assert.equal(intent.intent, "stalled_progress");
    assert.ok(intent.confidence > 0);
  });

  test("classifies intent as todays_workout", async () => {
    makeMockRepositories();

    const { classifyIntent } = await import("@fitcoach/ai");
    const intent = classifyIntent("Should I train today?");
    assert.equal(intent.intent, "todays_workout");
    assert.ok(intent.confidence > 0);
  });

  test("builds context with conversation history", async () => {
    const repos = makeMockRepositories({
      users: {
        findById: async () => makeMockUser("usr_1"),
        findByEmail: async () => null,
        create: async () => ({} as any),
        update: async () => ({} as any),
        delete: async () => {},
      } as any,
      conversations: {
        list: async () => [
          {
            id: "conv_1",
            userId: "usr_1",
            title: "Training discussion",
            status: "active",
            createdAt: "2026-10-05T00:00:00.000Z",
            updatedAt: "2026-10-05T00:00:00.000Z",
          },
        ],
        findById: async () => null,
        create: async () => null as any,
        updateStatus: async () => null as any,
      } as any,
      conversationMessages: {
        listByUser: async () => [
          {
            conversationId: "conv_1",
            messages: [
              {
                id: "msg_1",
                conversationId: "conv_1",
                role: "user",
                content: "Why am I not progressing?",
                createdAt: "2026-10-05T10:00:00.000Z",
              },
              {
                id: "msg_2",
                conversationId: "conv_1",
                role: "assistant",
                content: "Based on your training data...",
                createdAt: "2026-10-05T10:05:00.000Z",
              },
            ],
          },
        ],
        create: async () => null as any,
        findById: async () => null,
        list: async () => [],
      } as any,
    });
    const builder = new PersonalContextBuilder(repos);

    const result = await builder.buildContext("usr_1", {
      userId: "usr_1",
      message: "What should I change?",
      contextSources: {
        profile: false,
        goal: false,
        training: false,
        nutrition: false,
        activity: false,
        recovery: false,
        body: false,
        projection: false,
        decision: false,
        conversation: true,
      },
    });

    assert.ok(result.conversation);
    assert.equal(result.conversation?.conversationId, "conv_1");
    assert.equal(result.conversation?.messageCount, 2);
    assert.ok(result.conversation?.messages[0]);
    assert.equal(result.conversation?.messages[0]?.role, "user");
  });
});
