/**
 * FitCoach onboarding acceptance tests.
 *
 * Onboarding is a progressive interview, not a form. This suite walks the whole
 * interview the way a person does — welcome, body, training, goal, environment,
 * equipment, build — and asserts the requests that actually leave the app:
 *
 *  - the device user is created once, with the name that was typed;
 *  - every answer reaches the backend (profile, measurement, goal,
 *    environment, equipment) before the engine is asked for a plan;
 *  - a feasible plan signs the person in and hands them the real Home screen;
 *  - an infeasible plan is a modelled engine outcome, not a crash: the answers
 *    are kept, the engine's own sentence is shown, a smaller week can be tried
 *    without creating a second user, and "change my answers" returns to the
 *    interview with nothing lost.
 */

import { describe, expect, it, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { OnboardingScreen } from "../screens/OnboardingScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { SessionProvider } from "../session/SessionContext";
import { mockApi, TEST_USER } from "./mockApi";
import type { GoalKind } from "../api/types";

/**
 * Builds the onboarding API mock. `goal` is echoed by the goal and training
 * state reads; `feasible` switches plan generation between a built plan and the
 * engine's infeasibility report, and the active-plan read follows it.
 */
function mockOnboardingApi(
  goal: GoalKind = "general_fitness",
  feasible = true,
) {
  return mockApi([
    {
      method: "GET",
      path: "/v0/equipment",
      body: {
        equipment: [
          { id: "eq-dumbbells", slug: "dumbbells", name: "Dumbbells" },
          { id: "eq-barbell", slug: "barbell", name: "Barbell" },
          { id: "eq-pull-up-bar", slug: "pull_up_bar", name: "Pull-up bar" },
          { id: "eq-cable", slug: "cable_machine", name: "Cable machine" },
        ],
      },
    },
    {
      method: "PUT",
      path: `/v0/users/${TEST_USER}/profile`,
      body: { profile: {} },
    },
    {
      method: "POST",
      path: `/v0/users/${TEST_USER}/measurements`,
      body: {},
    },
    {
      method: "POST",
      path: `/v0/users/${TEST_USER}/goals`,
      body: {
        goal: {
          id: "g-1",
          kind: goal,
          status: "active",
          description: undefined,
          priorities: undefined,
          effectiveFrom: "2026-01-01",
        },
      },
    },
    {
      method: "POST",
      path: `/v0/users/${TEST_USER}/training-plans/generate`,
      body: {
        feasibility: feasible ? "feasible" : "infeasible",
        ...(feasible
          ? {
              plan: {
                id: "p-1",
                kind: "standard",
                versions: [],
              },
            }
          : {
              infeasibilityReasons: [
                "exercise_availability: This goal cannot be achieved with the selected number of training days and available equipment. Please reduce your training days or add equipment.",
              ],
            }),
      },
    },
    {
      method: "GET",
      path: `/v0/users/${TEST_USER}/training-plans/active`,
      body: feasible
        ? {
            plan: {
              id: "p-1",
              kind: "standard",
              status: "active",
              versions: [
                {
                  id: "v-1",
                  planId: "p-1",
                  versionNumber: 1,
                  status: "active",
                  startsOn: "2026-01-01",
                  sessions: [],
                },
              ],
            },
          }
        : { plan: null },
    },
    {
      method: "GET",
      path: `/v0/users/${TEST_USER}/training-state`,
      body: {
        trainingState: {
          currentPlanVersionId: feasible ? "v-1" : undefined,
          currentPlanStatus: feasible ? "active" : undefined,
          trainingGoalKind: goal,
        },
      },
    },
    {
      method: "GET",
      path: `/v0/users/${TEST_USER}/training-continuity`,
      body: {
        sessions: { completed: 0, adapted: 0, missed: 0, home: 0 },
        temporaryPlans: [],
      },
    },
    {
      method: "POST",
      path: `/v0/users/${TEST_USER}/equipment`,
      body: { equipment: {} },
    },
    {
      method: "POST",
      path: `/v0/users/${TEST_USER}/training-environments`,
      body: { period: { id: "env-1" }, replayed: false },
    },
    // Last: the mock matches by prefix, so `/v0/users` must not shadow the
    // deeper user routes above.
    {
      method: "POST",
      path: "/v0/users",
      body: {
        user: { id: TEST_USER, displayName: "Ada", timezone: "UTC" },
      },
    },
  ]);
}

type ApiMock = ReturnType<typeof mockOnboardingApi>;

/** Requests sent with this method to exactly this path, with parsed bodies. */
function callsTo(mock: ApiMock, method: string, path: string) {
  const calls = mock.calls() as unknown as [string, RequestInit | undefined][];
  return calls
    .filter(
      ([url, init]) =>
        String(url).split("?")[0] === path &&
        (init?.method ?? "GET").toUpperCase() === method,
    )
    .map(([, init]) => (init?.body ? JSON.parse(String(init.body)) : null));
}

function renderOnboarding() {
  return render(
    <MemoryRouter initialEntries={["/onboarding"]}>
      <SessionProvider>
        <Routes>
          <Route path="/onboarding" element={<OnboardingScreen />} />
          <Route path="/" element={<HomeScreen />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  const fetchMock = globalThis.fetch as unknown as { mockReset?: () => void };
  fetchMock.mockReset?.();
});

describe("OnboardingScreen acceptance", () => {
  it("turns a completed interview into a signed-in first plan", async () => {
    const user = userEvent.setup();
    const mock = mockOnboardingApi("bodybuilding");
    renderOnboarding();

    // Welcome
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Training that understands your body.",
    );
    await user.type(screen.getByPlaceholderText("Your name"), "Ada");
    await user.type(screen.getByPlaceholderText("you@example.com"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Body
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your body");
    await user.type(screen.getByPlaceholderText("—"), "72");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Training
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your training");
    await user.click(screen.getByRole("radio", { name: "Intermediate" }));
    const [days, minutes] = screen.getAllByRole("spinbutton");
    // Days are clamped while typing, so set whole values rather than clearing.
    fireEvent.change(days!, { target: { value: "4" } });
    fireEvent.change(minutes!, { target: { value: "75" } });
    expect(days).toHaveValue(4);
    expect(minutes).toHaveValue(75);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Goal
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "What are you training for?",
    );
    await user.click(screen.getByRole("radio", { name: /^Build muscle/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Environment
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Where do you train?");
    await user.click(screen.getByRole("radio", { name: /^Home Whatever/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Equipment: four progressive stages. Selecting the gym default pre-loads
    // the catalog, so at home the person narrows it to what they actually have.
    const setEquipment = async (name: string, selected: boolean) => {
      const button = screen.getByRole("button", { name });
      if ((button.getAttribute("aria-pressed") === "true") !== selected) {
        await user.click(button);
      }
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "aria-pressed",
        String(selected),
      );
    };

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Free weights");
    await setEquipment("Dumbbells", true);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Barbell, bench and rack");
    await setEquipment("Barbell", false);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Bodyweight anchors");
    await setEquipment("Pull-up bar", false);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Machines and cables");
    await setEquipment("Cable machine", false);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Build
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "FitCoach is ready to build your week.",
    );
    await user.click(screen.getByRole("button", { name: "Build my plan" }));

    // The plan exists, so onboarding hands over to the real Home screen. The
    // mocked plan has no session today, so Home honestly says it is a rest day.
    expect(await screen.findByRole("heading", { name: "Rest day" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View full plan" })).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem("fitcoach.userId")).toBe(TEST_USER));

    // Identity was created exactly once, with the name that was typed.
    const users = callsTo(mock, "POST", "/v0/users");
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ displayName: "Ada", email: "ada@example.com" });

    // Every answer is recorded before the engine is asked to plan.
    const [profile] = callsTo(mock, "PUT", `/v0/users/${TEST_USER}/profile`);
    expect(profile).toMatchObject({
      heightCm: 178,
      trainingExperience: "intermediate",
      trainingDaysPerWeek: 4,
      sessionDurationMinutes: 75,
    });
    // The measurements endpoint stores values, not a kind/value/unit triple.
    const [measurement] = callsTo(mock, "POST", `/v0/users/${TEST_USER}/measurements`);
    expect(measurement).toMatchObject({ bodyWeightKg: 72, enteredVia: "manual" });
    expect(measurement).not.toHaveProperty("kind");
    expect(measurement).not.toHaveProperty("value");
    expect(measurement).not.toHaveProperty("unit");
    const [goal] = callsTo(mock, "POST", `/v0/users/${TEST_USER}/goals`);
    expect(goal).toMatchObject({ kind: "bodybuilding" });
    const [environment] = callsTo(
      mock,
      "POST",
      `/v0/users/${TEST_USER}/training-environments`,
    );
    expect(environment).toMatchObject({ kind: "home" });
    const equipment = callsTo(mock, "POST", `/v0/users/${TEST_USER}/equipment`);
    expect(equipment.map((row) => row.equipmentId)).toEqual(["eq-dumbbells"]);

    const generated = callsTo(mock, "POST", `/v0/users/${TEST_USER}/training-plans/generate`);
    expect(generated).toHaveLength(1);
    expect(generated[0]).toMatchObject({
      goalKind: "bodybuilding",
      availableTrainingDays: 4,
      maxSessionDurationMinutes: 75,
      experience: "intermediate",
    });
  });

  it("keeps the answers and offers a smaller week when the engine says infeasible", async () => {
    const user = userEvent.setup();
    const mock = mockOnboardingApi("general_fitness", false);
    renderOnboarding();

    await user.type(screen.getByPlaceholderText("Your name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("radio", { name: /no equipment/i }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "FitCoach is ready to build your week.",
    );
    await user.click(screen.getByRole("button", { name: "Build my plan" }));

    // A modelled engine outcome: the interview stays put, the engine's sentence
    // is shown in product words (internal reason code removed), answers kept.
    expect(
      await screen.findByRole("heading", { name: "This week doesn't fit yet" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This goal cannot be achieved with the selected number of training days and available equipment.",
    );
    expect(screen.getByText(/Your answers are kept/)).toBeInTheDocument();

    // No plan means no Home: the app must not pretend setup succeeded.
    expect(screen.queryByRole("heading", { name: "Rest day" })).not.toBeInTheDocument();
    expect(screen.queryByText("No training plan yet")).not.toBeInTheDocument();
    expect(localStorage.getItem("fitcoach.userId")).toBeNull();

    // Trying a smaller week re-asks the engine without re-creating the person.
    await user.click(screen.getByRole("button", { name: "Try 2 days" }));
    await waitFor(() =>
      expect(
        callsTo(mock, "POST", `/v0/users/${TEST_USER}/training-plans/generate`),
      ).toHaveLength(2),
    );
    const generated = callsTo(mock, "POST", `/v0/users/${TEST_USER}/training-plans/generate`);
    expect(generated[1]).toMatchObject({ availableTrainingDays: 2 });
    expect(callsTo(mock, "POST", "/v0/users")).toHaveLength(1);
    expect(callsTo(mock, "POST", `/v0/users/${TEST_USER}/goals`)).toHaveLength(1);
    expect(localStorage.getItem("fitcoach.userId")).toBeNull();

    // "Change my answers" returns to the interview with the answers intact.
    await user.click(screen.getByRole("button", { name: "Change my answers" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your training");
    const [days, minutes] = screen.getAllByRole("spinbutton");
    expect(days).toHaveValue(2);
    expect(minutes).toHaveValue(60);
  });
});
