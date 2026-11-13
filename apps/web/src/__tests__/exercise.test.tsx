/**
 * FitCoach exercise detail tests.
 *
 * Covers: Anatomy → Name → Target → Focus → Details → Start hierarchy,
 * anatomy-as-guide entry point, and loading/error states.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { ExerciseScreen } from "../screens/ExerciseScreen";
import { WorkoutProvider } from "../session/WorkoutContext";
import { SessionProvider } from "../session/SessionContext";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { mockApi, TEST_USER } from "./mockApi";
import type { ExerciseDetail } from "../api/types";

const EXERCISE_ID = "ex-lat-pulldown";

function detail(): ExerciseDetail {
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
      loadingCharacteristic: "external_load",
      rangeOfMotionCharacteristic: "full",
      unilateral: false,
    },
    formGuidance: {
      exerciseId: EXERCISE_ID,
      version: 1,
      steps: [{ key: "s1", heading: "Grip", body: "Wide grip.", position: 1 }],
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
          structures: [
            { structureId: "s1", structureSlug: "left", displayName: "Latissimus dorsi — left", kind: "primary", state: "primary", emphasis: undefined },
            { structureId: "s2", structureSlug: "right", displayName: "Latissimus dorsi — right", kind: "primary", state: "primary", emphasis: undefined },
          ],
        },
      ],
    },
  } as ExerciseDetail;
}

function renderExercise(exerciseId: string = EXERCISE_ID) {
  localStorage.setItem("fitcoach.userId", TEST_USER);
  mockApi([
    { method: "GET", path: `/v0/exercises/${exerciseId}`, body: detail() },
  ]);
  return render(
    <MemoryRouter initialEntries={["/exercise/ex-lat-pulldown"]}>
      <SessionProvider>
        <WorkoutProvider>
          <Routes>
            <Route path="/exercise/:exerciseId" element={<ExerciseScreen />} />
          </Routes>
        </WorkoutProvider>
      </SessionProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockReset();
  localStorage.clear();
});

describe("ExerciseScreen", () => {
  it("renders Anatomy → Name → Target → Focus → Details → Start", async () => {
    const { container } = renderExercise();
    await new Promise((r) => setTimeout(r, 100));
    const q = within(container);

    expect(q.getByRole("img").getAttribute("aria-label")).toContain("latissimus dorsi");
    expect(q.getByRole("heading", { level: 1 })).toHaveTextContent("Lat Pulldown");

    // Target section
    expect(q.getByText(/Target/)).toBeInTheDocument();
    const targetList = container.querySelector(".fc-targetlist") as HTMLElement;
    expect(within(targetList).getByText("Latissimus dorsi")).toBeInTheDocument();
    expect(within(targetList).getByText("Latissimus dorsi — left · Latissimus dorsi — right")).toBeInTheDocument();

    // Focus (summary)
    expect(q.getByText("Train the lats.")).toBeInTheDocument();

    // Expandable details (collapsed by default)
    expect(q.getByText(/Details/)).toBeInTheDocument();
    const details = container.querySelector("details")!;
    expect(details.hasAttribute("open")).toBe(false);

    // Start
    expect(q.getByRole("button", { name: /Start/ })).toBeInTheDocument();
  });

  it("tapping anatomy opens the guide", async () => {
    const user = userEvent.setup();
    const { container } = renderExercise();
    await new Promise((r) => setTimeout(r, 100));
    const q = within(container);

    // anatomy figure is an interactive button
    const anatomy = q.getByRole("button", { name: /Open guide/ });
    await user.click(anatomy);
    const dialog = q.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("Lat Pulldown")).toBeInTheDocument();
  });

  it("shows an error state when the exercise is unavailable", async () => {
    localStorage.setItem("fitcoach.userId", TEST_USER);
    mockApi([
      { method: "GET", path: `/v0/exercises/${EXERCISE_ID}`, status: 404, body: { error: "not_found" } },
    ]);
    render(
      <MemoryRouter initialEntries={["/exercise/ex-lat-pulldown"]}>
        <SessionProvider>
          <WorkoutProvider>
            <Routes>
              <Route path="/exercise/:exerciseId" element={<ExerciseScreen />} />
            </Routes>
          </WorkoutProvider>
        </SessionProvider>
      </MemoryRouter>,
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.getByText(/Exercise unavailable/)).toBeInTheDocument();
  });
});
