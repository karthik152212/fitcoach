import { expect, it, vi, afterEach } from "vitest";
import { render, within, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { PerformScreen } from "../screens/PerformScreen";
import { WorkoutProvider } from "../session/WorkoutContext";
import { SessionProvider } from "../session/SessionContext";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { mockApi, TEST_USER } from "./mockApi";
import type { ExerciseDetail, PerformanceObservation } from "../api/types";

const wait = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
const EXERCISE_ID = "ex-lat-pulldown";
const WORKOUT_ID = "w-1";
const WORKOUT_EXERCISE_ID = "we-1";

function detail(loadingCharacteristic: ExerciseDetail["exercise"]["loadingCharacteristic"] = "external_load") {
  return {
    exercise: {
      id: EXERCISE_ID,
      slug: "lat-pulldown",
      name: "Lat Pulldown",
      aliases: [],
      category: "compound",
      movementPattern: "vertical_pull",
      instructions: "Train the lats.",
      requiredEquipmentIds: [],
      movementFunctions: ["shoulder_adduction"],
      roles: [],
      targets: [],
      stabilityDemand: "moderate",
      loadingCharacteristic,
      rangeOfMotionCharacteristic: "full",
      unilateral: false,
    },
    media: [],
    targetMap: {
      entries: [
        {
          muscleId: "m-lats",
          muscleSlug: "latissimus_dorsi",
          displayName: "Latissimus dorsi",
          group: "back",
          state: "primary",
          emphasis: undefined,
          structures: [],
        },
      ],
    },
  } as ExerciseDetail;
}

function renderPerform({
  detail: detailOverride,
  history,
  loadKind = "external_load",
}: {
  detail?: ExerciseDetail;
  history?: PerformanceObservation[];
  loadKind?: "external_load" | "bodyweight";
}) {
  const exerciseDetail = detailOverride ?? detail(loadKind === "external_load" ? "external_load" : "bodyweight_only");

  sessionStorage.setItem(
    "fitcoach.activeWorkout",
    JSON.stringify({
      workoutId: WORKOUT_ID,
      environmentKind: "gym",
      sessionClassification: "planned",
      startedAt: new Date().toISOString(),
      exercise: {
        exerciseId: EXERCISE_ID,
        workoutExerciseId: WORKOUT_EXERCISE_ID,
        name: exerciseDetail.exercise.name,
        loadKind,
      },
      setsByExercise: {},
    })
  );

  let persistedSets = 0;

  mockApi([
    { method: "GET", path: `/v0/exercises/${EXERCISE_ID}`, body: detail },
    {
      method: "GET",
      path: `/v0/users/${TEST_USER}/performance-history`,
      body: { observations: history ?? [] },
    },
    {
      method: "POST",
      path: `/v0/users/${TEST_USER}/workouts/${WORKOUT_ID}/sets`,
      handler: (init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        persistedSets += 1;
        return { set: { id: `set-${persistedSets}`, position: persistedSets, workoutExerciseId: WORKOUT_EXERCISE_ID, ...body } };
      },
    },
    {
      method: "POST",
      path: `/v0/users/${TEST_USER}/progression/evaluate`,
      body: { persisted: true, evaluation: { exerciseId: EXERCISE_ID, outcome: "no_change", recommendation: { outcome: "no_change", rationale: "Keep the load.", mechanisms: [], evidence: [], confidence: 1 }, performance: { sessionsObserved: 1, trend: "stable" } } },
    },
  ]);

  localStorage.setItem("fitcoach.userId", TEST_USER);
  const { container } = render(
    <MemoryRouter initialEntries={["/exercise/ex-lat-pulldown/perform"]}>
      <SessionProvider>
        <WorkoutProvider>
          <Routes>
            <Route path="/exercise/:exerciseId/perform" element={<PerformScreen />} />
          </Routes>
        </WorkoutProvider>
      </SessionProvider>
    </MemoryRouter>
  );
  return { detail, container };
}

afterEach(() => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockReset();
  localStorage.clear();
  sessionStorage.clear();
});

it("shows anatomy, exercise name, logged sets, and add-set button — no calorie/duration headline", async () => {
  const { container } = renderPerform({ detail: detail() });
  const button = (name: string | RegExp) => within(container).getByRole("button", { name });
  await waitFor(() => expect(within(container).getByRole("img")).toBeInTheDocument(), { timeout: 8000 });
  expect(within(container).getByText("Lat Pulldown")).toBeInTheDocument();
  expect(within(container).queryByText(/calorie/i)).not.toBeInTheDocument();
  expect(within(container).queryByText(/\b\d+\s*min\b/i)).not.toBeInTheDocument();
  expect(button(/add set/i)).toBeInTheDocument();
});

it("logs a working set and shows it compactly", async () => {
  const user = userEvent.setup();
  const { container } = renderPerform({ detail: detail() });
  await wait(100);
  const button = (name: string | RegExp) => within(container).getByRole("button", { name });
  await user.click(button(/add set/i));
  await user.click(button(/increase weight/i)); // 60 → 62.5
  await user.click(button(/increase reps/i));   // 10 → 11
  await user.click(button(/failure/i));
  await user.click(button(/save set/i));
  await wait(100);
  expect(within(container).getByText(/62\.5 kg × 11 · Failure/)).toBeInTheDocument();
  expect(button(/add set/i)).toBeInTheDocument();
});

it("bodyweight exercises have no weight field", async () => {
  const user = userEvent.setup();
  const { container } = renderPerform({ detail: detail("bodyweight_only"), loadKind: "bodyweight" });
  await wait(100);
  const button = (name: string | RegExp) => within(container).getByRole("button", { name });
  await user.click(button(/add set/i));
  expect(within(container).queryByText(/weight/i)).not.toBeInTheDocument();
  expect(within(container).getByText(/reps/i)).toBeInTheDocument();
  expect(button(/failure/i)).toBeInTheDocument();
});

it("shows progression feedback without forcing it", async () => {
  const user = userEvent.setup();
  const { container } = renderPerform({ detail: detail() });
  await wait(100);
  const button = (name: string | RegExp) => within(container).getByRole("button", { name });
  await user.click(button(/add set/i));
  await user.click(button(/save set/i));
  await wait(100);
  expect(within(container).getByText(/No change recommended/)).toBeInTheDocument();
});

it("logs two working sets with distinct IDs and no React key warnings", async () => {
  // Capture React console warnings about keys
  const reactWarnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const msg = String(args[0]);
    // Match React duplicate/missing key warnings
    if (/^Warning.*useReact.*?key.*?duplicate|^Warning.*each child in a list should have a unique.*?key|^Warning.*props react-reconciler.*?key/.test(msg) || msg.includes("react")) {
      reactWarnings.push(msg);
    }
    originalWarn?.(...args);
  };

  const user = userEvent.setup();

  // Render screen and log first set
  const { container: container1 } = renderPerform({ detail: detail() });
  await wait(100);

  const button = (name: string | RegExp) => within(container1).getByRole("button", { name });
  await user.click(button(/add set/i));
  await user.click(button(/increase weight/i)); // 60 → 62.5
  await user.click(button(/increase reps/i));   // 10 → 11
  await user.click(button(/failure/i));
  await user.click(button(/save set/i));
  await wait(100);

  // Verify first set is displayed
  expect(within(container1).getByText(/62\.5 kg × 11 · Failure/)).toBeInTheDocument();

  // Log second set (without clearing, just add another working set)
  await user.click(button(/add set/i));
  await user.click(button(/increase weight/i)); // 62.5 → 65
  await user.click(button(/increase reps/i));   // 11 → 12
  await user.click(button(/save set/i));
  await wait(100);

  // Verify both sets appear in the logged-set list
  const setItems = container1.querySelectorAll?.("ol.fc-setlist li") ?? [];
  const setTexts = Array.from(setItems).map((li) => li.textContent ?? "");
  expect(setTexts.filter((t) => t.includes("65 kg")).length).toBe(1);
  expect(setTexts.filter((t) => t.includes("62.5 kg")).length).toBe(1);

  // Verify the two rendered sets carry the persisted IDs they were keyed on.
  // (`key` is a React field, not a DOM attribute — read the id the screen
  // exposes for exactly this regression.)
  const setIds = Array.from(setItems).map((li) => li.getAttribute("data-set-id") ?? "");
  expect(new Set(setIds).size).toBe(2); // distinct IDs
  expect(setIds).toContain("set-1");
  expect(setIds).toContain("set-2");

  // Confirm no React missing/duplicate-key warning occurred
  expect(reactWarnings.length).toBe(0);
  console.warn = originalWarn;
});