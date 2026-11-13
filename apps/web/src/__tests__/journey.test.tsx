/**
 * FitCoach journey regressions.
 *
 * Every test here locks a behaviour that the browser QA pass found broken
 * against the real backend contracts:
 *
 *  - starting a session and selecting its first exercise in the same tick must
 *    not drop the session (stale-closure state loss);
 *  - workout history arrives as `{ workouts: [{ workout, exercises }] }`;
 *  - the plan overview explains the week's muscle coverage from TargetMap and
 *    the engine's planned volume;
 *  - environment limitations are grouped and rendered in words, never raw slugs.
 */

import { describe, expect, it, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WorkoutProvider, useWorkout } from "../session/WorkoutContext";
import { SessionProvider } from "../session/SessionContext";
import { ProgressScreen } from "../screens/ProgressScreen";
import { PlanScreen } from "../screens/PlanScreen";
import { Limitations } from "../screens/YouScreen";
import { mockApi, TEST_USER } from "./mockApi";

const wait = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  const fetchMock = globalThis.fetch as unknown as { mockReset?: () => void };
  fetchMock.mockReset?.();
});

describe("starting a session", () => {
  it("keeps the session and its first exercise when both happen in one tick", async () => {
    let api: ReturnType<typeof useWorkout> | null = null;
    function Probe() {
      api = useWorkout();
      return <div>{api.active ? `${api.active.workoutId}:${api.active.exercise?.exerciseId ?? "none"}` : "idle"}</div>;
    }
    render(
      <WorkoutProvider>
        <Probe />
      </WorkoutProvider>,
    );

    act(() => {
      api!.begin({
        workoutId: "w-1",
        startedAt: new Date().toISOString(),
        sessionClassification: "planned",
      });
      api!.selectExercise({
        exerciseId: "ex-1",
        workoutExerciseId: "we-1",
        name: "Lat Pulldown",
        loadKind: "external_load",
      });
    });

    expect(screen.getByText("w-1:ex-1")).toBeInTheDocument();
    await waitFor(() => expect(sessionStorage.getItem("fitcoach.activeWorkout")).toContain("ex-1"));
  });
});

describe("training history", () => {
  it("renders sessions from the nested workout-list contract", async () => {
    localStorage.setItem("fitcoach.userId", TEST_USER);
    mockApi([
      {
        method: "GET",
        path: `/v0/users/${TEST_USER}/workouts`,
        body: {
          workouts: [
            {
              workout: {
                id: "w-1",
                status: "completed",
                startedAt: "2026-10-29T17:30:00.000Z",
                sessionClassification: "adapted",
              },
              exercises: [],
            },
          ],
        },
      },
      {
        method: "GET",
        path: `/v0/users/${TEST_USER}/progression/ledger`,
        body: { entries: [], completedProgressions: {}, totalCompletedProgressions: 0 },
      },
      {
        method: "GET",
        path: `/v0/users/${TEST_USER}/training-continuity`,
        body: {
          environment: { kind: "home_no_equipment", constrained: true, limitations: [] },
          periods: [],
          temporaryPlans: [],
          sessions: { total: 1, completed: 0, adapted: 1, home: 1, skipped: 0, open: 0 },
          missedSessions: 2,
          totalCompletedProgressions: 0,
        },
      },
    ]);

    render(
      <MemoryRouter initialEntries={["/progress"]}>
        <SessionProvider>
          <ProgressScreen />
        </SessionProvider>
      </MemoryRouter>,
    );

    await wait(120);
    expect(await screen.findByText("completed")).toBeInTheDocument();
    expect(screen.getByText("adapted")).toBeInTheDocument();
    // Locale order varies by environment; the session date must still be real.
    expect(screen.getByText(/29 Oct|Oct 29/)).toBeInTheDocument();
  });
});

describe("plan coverage", () => {
  it("explains the week's muscles from TargetMap and the engine's planned volume", async () => {
    localStorage.setItem("fitcoach.userId", TEST_USER);
    const exerciseId = "ex-bench";
    mockApi([
      {
        method: "GET",
        path: `/v0/users/${TEST_USER}/training-plans/active`,
        body: {
          plan: {
            id: "p-1",
            kind: "primary",
            status: "active",
            versions: [
              {
                id: "v-1",
                planId: "p-1",
                versionNumber: 1,
                lifecycleStatus: "active",
                startsOn: "2026-10-01",
                sessions: [{ id: "s-1", name: "Upper", weekdayHint: 1, slots: [{ id: "sl-1", exerciseId, targetSets: 3 }] }],
              },
            ],
          },
        },
      },
      { method: "GET", path: `/v0/users/${TEST_USER}/goals/active`, body: { goal: { id: "g-1", kind: "lean_recomposition", status: "active" } } },
      { method: "GET", path: `/v0/users/${TEST_USER}/workouts`, body: { workouts: [] } },
      {
        method: "GET",
        path: `/v0/users/${TEST_USER}/training-state`,
        body: {
          trainingState: {
            currentPlanVersionId: "v-1",
            currentPlanStatus: "active",
            trainingGoalKind: "lean_recomposition",
            plannedWeeklyVolumePerMuscle: { pectoralis_major: 6, deltoid_front: 3 },
          },
        },
      },
      {
        method: "GET",
        path: `/v0/exercises/${exerciseId}`,
        body: {
          exercise: { id: exerciseId, slug: "bench", name: "Bench Press", aliases: [], category: "compound", requiredEquipmentIds: [] },
          media: [],
          targetMap: {
            entries: [
              {
                muscleId: "m-pec",
                muscleSlug: "pectoralis_major",
                displayName: "Pectoralis major",
                group: "chest",
                state: "primary",
                structures: [],
              },
            ],
          },
        },
      },
      { method: "GET", path: `/v0/users/${TEST_USER}/training-plans/p-1/decisions`, body: { decisions: [] } },
    ]);

    render(
      <MemoryRouter initialEntries={["/plan"]}>
        <SessionProvider>
          <PlanScreen />
        </SessionProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("What the week trains")).toBeInTheDocument();
    expect(screen.getByText("Pectoralis major")).toBeInTheDocument();
    expect(screen.getByText("6 sets")).toBeInTheDocument();
    // The goal renders as words, not as a slug.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Lean recomposition");
  });
});

describe("plan read failures", () => {
  it("reports the failure instead of claiming there is no plan", async () => {
    localStorage.setItem("fitcoach.userId", TEST_USER);
    mockApi([
      {
        method: "GET",
        path: `/v0/users/${TEST_USER}/training-plans/active`,
        status: 500,
        body: { error: "internal", message: "Something went wrong. Retry in a moment." },
      },
      { method: "GET", path: `/v0/users/${TEST_USER}/goals/active`, body: { goal: null } },
      { method: "GET", path: `/v0/users/${TEST_USER}/workouts`, body: { workouts: [] } },
      { method: "GET", path: `/v0/users/${TEST_USER}/training-state`, body: { trainingState: null } },
    ]);

    render(
      <MemoryRouter initialEntries={["/plan"]}>
        <SessionProvider>
          <PlanScreen />
        </SessionProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Couldn't load your plan")).toBeInTheDocument();
    // A user who already has a plan must never be sent back through onboarding.
    expect(screen.queryByText("Build my plan")).not.toBeInTheDocument();
  });
});

describe("environment limitations", () => {
  it("groups reduced and unavailable stimulus in words, not slugs", () => {
    render(
      <Limitations
        limitations={[
          { kind: "muscle_coverage", subject: "biceps_brachii", description: "biceps_brachii stimulus is materially reduced.", retainedStimulus: 0.5 },
          { kind: "muscle_coverage", subject: "latissimus_dorsi", description: "latissimus_dorsi stimulus is materially reduced.", retainedStimulus: 0.5 },
          { kind: "movement_pattern", subject: "vertical_pull", description: "vertical_pull cannot be trained.", retainedStimulus: 0 },
          { kind: "load_progression", subject: "external_load", description: "External-load progression is unavailable.", retainedStimulus: 0.5 },
        ]}
      />,
    );

    expect(screen.getByText("Reduced stimulus (about half the usual stimulus)")).toBeInTheDocument();
    expect(screen.getByText("biceps brachii · latissimus dorsi")).toBeInTheDocument();
    expect(screen.getByText("Not trainable in this setup")).toBeInTheDocument();
    expect(screen.getByText("vertical pull")).toBeInTheDocument();
    expect(screen.queryByText(/biceps_brachii/)).not.toBeInTheDocument();
  });
});
