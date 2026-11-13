import type { Page, Route } from "@playwright/test";

/**
 * Playwright API fixtures for FitCoach.
 *
 * The suite runs the real web app against recorded `/v0` responses, so the
 * browser exercises the product's actual data flow — routing, session storage,
 * set persistence and navigation — without needing PostgreSQL or the API
 * process. Writes mutate the same in-memory state the reads return, so a set
 * logged in performance mode is still there on the review screen.
 */

export const USER_ID = "11111111-1111-1111-1111-111111111111";
export const WORKOUT_ID = "22222222-2222-2222-2222-222222222222";
export const EXERCISE_ID = "33333333-3333-3333-3333-333333333333";
export const WORKOUT_EXERCISE_ID = "44444444-4444-4444-4444-444444444444";

const weekday = () => new Date().getDay();

export interface ApiState {
  sets: { id: string; workoutExerciseId: string; kind: string; loadKind?: string; loadKg?: number; reps?: number }[];
  workoutStatus: "none" | "in_progress" | "completed";
  calls: string[];
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

function detail() {
  return {
    exercise: {
      id: EXERCISE_ID,
      slug: "barbell_bench_press",
      name: "Barbell bench press",
      aliases: ["bench press"],
      category: "compound",
      requiredEquipmentIds: ["barbell", "adjustable_bench"],
    },
    media: [],
    targetMap: {
      entries: [
        {
          muscleId: "m-pec",
          muscleSlug: "pectoralis_major",
          displayName: "Pectoralis major",
          group: "chest",
          state: "primary",
          structures: ["sternal_head"],
        },
        {
          muscleId: "m-tri",
          muscleSlug: "triceps_brachii",
          displayName: "Triceps brachii",
          group: "arms",
          state: "secondary",
          structures: ["lateral_head"],
        },
      ],
    },
  };
}

function plan() {
  return {
    id: "plan-1",
    kind: "primary",
    status: "active",
    versions: [
      {
        id: "version-1",
        planId: "plan-1",
        versionNumber: 1,
        lifecycleStatus: "active",
        startsOn: "2026-11-02",
        sessions: [
          {
            id: "session-1",
            name: "Upper A",
            weekdayHint: weekday(),
            slots: [{ id: "slot-1", exerciseId: EXERCISE_ID, targetSets: 3, targetRepRange: { min: 6, max: 10 } }],
          },
          { id: "session-2", name: "Lower A", weekdayHint: (weekday() + 3) % 7, slots: [] },
        ],
      },
    ],
  };
}

function aggregates(state: ApiState) {
  const past = {
    workout: {
      id: "workout-past",
      planId: "plan-1",
      status: "completed",
      startedAt: "2026-11-05T18:10:00.000Z",
      endedAt: "2026-11-05T19:02:00.000Z",
      sessionClassification: "planned",
    },
    exercises: [
      {
        id: "we-past",
        workoutId: "workout-past",
        exerciseId: EXERCISE_ID,
        position: 0,
        sets: [
          {
            id: "set-past",
            workoutExerciseId: "we-past",
            exerciseId: EXERCISE_ID,
            position: 0,
            kind: "working",
            loadKind: "external_load",
            loadKg: 80,
            reps: 8,
          },
        ],
      },
    ],
  };
  const current =
    state.workoutStatus === "none"
      ? []
      : [
          {
            workout: {
              id: WORKOUT_ID,
              planId: "plan-1",
              status: state.workoutStatus,
              startedAt: new Date().toISOString(),
              ...(state.workoutStatus === "completed" ? { endedAt: new Date().toISOString() } : {}),
              sessionClassification: "planned",
            },
            exercises: [
              {
                id: WORKOUT_EXERCISE_ID,
                workoutId: WORKOUT_ID,
                exerciseId: EXERCISE_ID,
                position: 0,
                sets: state.sets,
              },
            ],
          },
        ];
  return [...current, past];
}

/**
 * Install API fixtures and a signed-in session. Call before `page.goto`.
 */
export async function seedApp(page: Page): Promise<ApiState> {
  const state: ApiState = { sets: [], workoutStatus: "none", calls: [] };

  await page.addInitScript((userId) => {
    window.localStorage.setItem("fitcoach.userId", userId);
  }, USER_ID);

  await page.route("**/v0/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname;
    const key = `${method} ${path}`;
    state.calls.push(key);

    // Identity and context ---------------------------------------------------
    if (method === "GET" && path === `/v0/users/${USER_ID}`) {
      return json(route, {
        user: { id: USER_ID, email: "athlete@example.com", displayName: "Sam Rivera", timezone: "Europe/London" },
      });
    }
    if (method === "GET" && path === `/v0/users/${USER_ID}/profile`) {
      return json(route, {
        profile: {
          heightCm: 178,
          trainingExperience: "beginner",
          trainingDaysPerWeek: 3,
          sessionDurationMinutes: 60,
          unitSystem: "metric",
        },
      });
    }
    if (method === "GET" && path === `/v0/users/${USER_ID}/goals/active`) {
      return json(route, { goal: { id: "goal-1", kind: "bodybuilding", status: "active" } });
    }
    if (method === "GET" && path === `/v0/users/${USER_ID}/training-state`) {
      return json(route, {
        trainingState: {
          currentPlanVersionId: "version-1",
          currentPlanStatus: "active",
          trainingGoalKind: "bodybuilding",
          environment: { kind: "gym", constrained: false, limitations: [] },
          plannedWeeklyVolumePerMuscle: { pectoralis_major: 6, triceps_brachii: 3 },
        },
      });
    }
    if (method === "GET" && path === `/v0/users/${USER_ID}/training-continuity`) {
      return json(route, {
        environment: { kind: "gym", constrained: false, limitations: [] },
        periods: [],
        temporaryPlans: [],
        sessions: { total: 6, completed: 1, adapted: 0, home: 0, skipped: 0, open: 5 },
        missedSessions: 0,
        totalCompletedProgressions: 0,
      });
    }
    if (method === "GET" && path === `/v0/users/${USER_ID}/training-environments/active`) {
      return json(route, {
        environment: {
          kind: "gym",
          availableEquipmentIds: [],
          unavailableEquipmentIds: [],
          effectiveFrom: "2026-11-01",
          isTemporary: false,
          constrained: false,
          source: "user",
          limitations: [],
        },
      });
    }
    if (method === "GET" && path === `/v0/users/${USER_ID}/equipment`) {
      return json(route, {
        equipment: [
          {
            id: "user-equipment-1",
            equipment: { id: "eq-barbell", slug: "barbell", name: "Barbell", category: "free_weight" },
            availability: "available",
            validFrom: "2026-11-01",
          },
          {
            id: "user-equipment-2",
            equipment: { id: "eq-bench", slug: "adjustable_bench", name: "Adjustable bench", category: "bench" },
            availability: "available",
            validFrom: "2026-11-01",
          },
        ],
      });
    }
    if (method === "GET" && path === "/v0/equipment") {
      return json(route, {
        equipment: [
          { id: "eq-barbell", slug: "barbell", name: "Barbell" },
          { id: "eq-bench", slug: "adjustable_bench", name: "Adjustable bench" },
        ],
      });
    }

    // Plan ------------------------------------------------------------------
    if (method === "GET" && path === `/v0/users/${USER_ID}/training-plans/active`) {
      return json(route, { plan: plan() });
    }
    if (method === "GET" && /\/training-plans\/[^/]+\/decisions$/.test(path)) {
      return json(route, { decisions: [] });
    }
    if (method === "GET" && /\/training-plans\/[^/]+\/constraints$/.test(path)) {
      return json(route, { constraints: [] });
    }

    // Knowledge --------------------------------------------------------------
    if (method === "GET" && path === "/v0/exercises") {
      return json(route, { exercises: [] });
    }
    if (method === "GET" && path.startsWith("/v0/exercises/")) {
      return json(route, detail());
    }
    if (method === "GET" && path === `/v0/users/${USER_ID}/performance-history`) {
      return json(route, { observations: [] });
    }
    if (method === "GET" && path === `/v0/users/${USER_ID}/progression/ledger`) {
      return json(route, { entries: [], totalCompletedProgressions: 0 });
    }

    // Workouts ---------------------------------------------------------------
    if (method === "GET" && path === `/v0/users/${USER_ID}/workouts`) {
      return json(route, { workouts: aggregates(state) });
    }
    if (method === "POST" && path === `/v0/users/${USER_ID}/workouts`) {
      state.workoutStatus = "in_progress";
      return json(route, {
        workout: {
          id: WORKOUT_ID,
          planId: "plan-1",
          status: "in_progress",
          startedAt: new Date().toISOString(),
          sessionClassification: "planned",
        },
      });
    }
    if (method === "GET" && path === `/v0/users/${USER_ID}/workouts/${WORKOUT_ID}`) {
      const aggregate = aggregates(state).find((entry) => entry.workout.id === WORKOUT_ID);
      return json(route, { workout: aggregate ?? aggregates(state).at(-1) });
    }
    if (method === "POST" && /\/workouts\/[^/]+\/exercises$/.test(path)) {
      return json(route, {
        workoutExercise: {
          id: WORKOUT_EXERCISE_ID,
          workoutId: WORKOUT_ID,
          exerciseId: EXERCISE_ID,
          position: 0,
        },
      });
    }
    if (method === "POST" && /\/workouts\/[^/]+\/sets$/.test(path)) {
      const body = request.postDataJSON() as {
        workoutExerciseId: string;
        kind: string;
        loadKind?: string;
        loadKg?: number;
        reps?: number;
      };
      const set = {
        id: `set-${state.sets.length + 1}`,
        workoutExerciseId: body.workoutExerciseId,
        exerciseId: EXERCISE_ID,
        position: state.sets.length,
        kind: body.kind,
        loadKind: body.loadKind,
        loadKg: body.loadKg,
        reps: body.reps,
      };
      state.sets.push(set);
      return json(route, { set });
    }
    if (method === "POST" && /\/workouts\/[^/]+\/complete$/.test(path)) {
      state.workoutStatus = "completed";
      return json(route, {
        workout: {
          id: WORKOUT_ID,
          planId: "plan-1",
          status: "completed",
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          sessionClassification: "planned",
        },
      });
    }

    // Progression ------------------------------------------------------------
    if (method === "POST" && path === `/v0/users/${USER_ID}/progression/evaluate`) {
      return json(route, {
        evaluation: {
          exerciseId: EXERCISE_ID,
          outcome: "no_change",
          recommendation: { rationale: "Two sets at the same load is not enough evidence to change the target." },
        },
      });
    }

    // Anything unmocked is a fixture gap, surfaced loudly rather than as a
    // mystery empty screen.
    return json(route, { error: "unmocked", message: `${method} ${path} has no fixture` }, 501);
  });

  return state;
}
