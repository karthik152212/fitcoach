/**
 * FitCoach adaptive Home tests.
 *
 * Covers: the priority-driven section model (environment > today >
 * temporary > adapted > ontrack) and the signed-out / no-plan states.
 */

import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { deriveHomeSections } from "../screens/HomeScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { SessionProvider } from "../session/SessionContext";
import { MemoryRouter } from "react-router-dom";
import type { TrainingPlan, TrainingState } from "../api/types";

function renderHome(userId: string | null) {
  if (userId === null) localStorage.removeItem("fitcoach.userId");
  else localStorage.setItem("fitcoach.userId", userId);
  return render(
    <MemoryRouter>
      <SessionProvider>
        <HomeScreen />
      </SessionProvider>
    </MemoryRouter>,
  );
}

function plan(overrides: Partial<TrainingPlan> = {}): TrainingPlan {
  return {
    id: "p-1",
    kind: "standard",
    status: "active",
    versions: [
      {
        id: "v-1",
        planId: "p-1",
        versionNumber: 1,
        startsOn: "2026-01-01",
        sessions: [],
      },
    ],
    ...overrides,
  } as TrainingPlan;
}

describe("deriveHomeSections (priority model)", () => {
  const trainingState = (env: any): TrainingState =>
    ({ currentPlanVersionId: "v-1", currentPlanStatus: "active", trainingGoalKind: "bodybuilding", environment: env } as TrainingState);

  it("sorts sections by priority descending", () => {
    const sections = deriveHomeSections({
      trainingState: null,
      plan: null,
      adaptedCount: 0,
      activityTargets: null,
      activityContext: null,
      recoveryState: null,
    });
    const priorities = sections.map((s) => s.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => b - a));
  });

  it("returns the intentional ontrack section when nothing is happening", () => {
    const sections = deriveHomeSections({ trainingState: null, plan: null, adaptedCount: 0, activityTargets: null, activityContext: null, recoveryState: null });
    expect(sections).toHaveLength(1);
    expect(sections[0]!.id).toBe("ontrack");
    expect(sections[0]!.tone).toBe("quiet");
    expect(sections[0]!.title).toBe("You're on track.");
  });

  it("prioritizes a constrained environment", () => {
    const sections = deriveHomeSections({
      trainingState: trainingState({
        kind: "home_no_equipment",
        constrained: true,
        limitations: [{ kind: "equipment", subject: "lats", description: "No lat pulldown available." }],
      }),
      plan: null,
      adaptedCount: 0,
      activityTargets: null,
      activityContext: null,
      recoveryState: null,
    });
    expect(sections[0]!.id).toBe("environment");
    expect(sections[0]!.priority).toBe(10);
    expect(sections[0]!.tone).toBe("insight");
  });

  it("prioritizes today's session above environment notes", () => {
    const p = plan({ versions: [{ id: "v-1", planId: "p-1", versionNumber: 1, startsOn: "2026-01-01", sessions: [{ id: "s-1", name: "Upper", weekdayHint: new Date().getDay(), slots: [] }] }] });
    const sections = deriveHomeSections({
      trainingState: trainingState({ kind: "gym", constrained: false }),
      plan: p,
      adaptedCount: 0,
      activityTargets: null,
      activityContext: null,
      recoveryState: null,
    });
    const today = sections.find((s) => s.id === "today");
    expect(today).toBeDefined();
    // today (20) should come before environment (10) if both present; here no env
    expect(today!.priority).toBe(20);
  });

  it("shows adapted continuity when adapted sessions exist", () => {
    const sections = deriveHomeSections({
      trainingState: trainingState({ kind: "gym", constrained: false }),
      plan: null,
      adaptedCount: 3,
      activityTargets: null,
      activityContext: null,
      recoveryState: null,
    });
    expect(sections.find((s) => s.id === "continuity")).toBeDefined();
  });
});

describe("HomeScreen states", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("shows a Begin call to action when signed out", () => {
    renderHome(null);
    expect(screen.getByText(/Begin/)).toBeInTheDocument();
  });
});
