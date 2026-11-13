/**
 * AI Coach screen tests — conversation interaction.
 *
 * Exercises: message submission and display, follow-up continuity, evidence
 * and quality warnings, decision/no_change presentation, mock provider
 * labeling, action preview/confirm/reject/failure, and duplicate-submission
 * prevention.
 *
 * Each test opens a conversation directly at /coach/:conversationId so the
 * conversation view is exercised without navigating through the list.
 * All backend calls are intercepted with mockApi using fixtures shaped to
 * the actual /v0 coaching contracts.
 */

import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CoachScreen } from "../CoachScreen";
import { SessionProvider } from "../../session/SessionContext";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { mockApi, TEST_USER } from "../../__tests__/mockApi";

const BASE = "http://localhost:3000";
const CONV_ID = "c-1";
const MSG_ID = "m-1";
const NEW_MSG_ID = "m-2";
const ACTION_ID = "a-1";

const coachingResponse: any = {
  conversationId: CONV_ID,
  messageId: NEW_MSG_ID,
  answer: "Your bench press is stalled at 60 kg for 3 weeks. The Decision Brain says no_change — keep progressing.",
  intent: { intent: "stalled_progress", confidence: 0.9, entities: {} },
  contextSnapshot: {
    userId: TEST_USER,
    asOf: "2026-11-12",
    generatedAt: "2026-11-12T08:05:00.000Z",
    sources: [],
    quality: {
      overallScore: 72,
      sources: [],
      missingDataWarnings: [],
      staleDataWarnings: [],
      recommendedFollowUpQuestions: [],
      sufficientForAdvice: true,
    },
    decision: {
      decisionSnapshot: {
        id: "d-1",
        kind: "no_change",
        status: "current",
        decidedAt: "2026-11-10",
        summary: "Progressing adequately; no change needed.",
        confidence: "measured",
      },
      activeInterventions: [],
      evidenceRefs: [],
    },
  },
  evidenceReferences: [
    {
      source: "training_state",
      code: "bench_press_plateau",
      title: "Bench press stalled at 60kg",
      value: "60kg x 8 reps for 3 weeks",
      confidence: "measured",
      provenance: "measured",
      generatedAt: "2026-11-12T08:00:00.000Z",
      relatedEntityIds: [],
      basis: "Bench press has been 60kg x 8 reps for 3 weeks.",
    },
  ],
  decisionContext: {
    decisionSnapshot: {
      id: "d-1",
      kind: "no_change",
      status: "current",
      decidedAt: "2026-11-10",
      summary: "Progressing adequately; no change needed.",
      confidence: "measured",
    },
    activeInterventions: [],
    outcomes: [],
    shouldReevaluate: { should: false, reason: "No reevaluation trigger" },
    evidenceRefs: [],
    assumptions: [],
  },
  quality: {
    overallScore: 72,
    sources: [],
    missingDataWarnings: [],
    staleDataWarnings: [],
    recommendedFollowUpQuestions: [],
    sufficientForAdvice: true,
  },
  proposedActions: [
    {
      id: ACTION_ID,
      kind: "log_food",
      title: "Log today's meals",
      description: "Record what you've eaten so I can assess nutrition adherence.",
      domainService: "nutrition.createMeal",
      parameters: { localDate: "2026-11-12" },
      requiresConfirmation: true,
      validated: true,
      evidenceRefs: [],
      status: "pending",
    },
  ],
  warnings: [],
  isMock: true,
};

const initialMessages = [
  {
    id: MSG_ID,
    conversationId: CONV_ID,
    role: "assistant",
    content: coachingResponse.answer,
    isMock: true,
    provider: "mock",
    model: "mock-local",
    createdAt: "2026-11-12T08:05:00.000Z",
    evidenceRefs: coachingResponse.evidenceReferences,
    proposedActions: coachingResponse.proposedActions,
    contextSnapshot: coachingResponse.contextSnapshot,
  },
];

const routes = [
  {
    method: "GET",
    path: `${BASE}/v0/users/${TEST_USER}/conversations/${CONV_ID}/messages`,
    status: 200,
    body: { messages: initialMessages },
  },
  // More specific action routes must come before the generic sendMessage route
  // because mockApi matches prefixes (e.g., /messages matches /messages/m-1/actions/.../preview)
  {
    method: "POST",
    path: `${BASE}/v0/users/${TEST_USER}/conversations/${CONV_ID}/messages/${MSG_ID}/actions/${ACTION_ID}/preview`,
    status: 200,
    body: {
      action: { id: ACTION_ID, kind: "log_food", status: "pending" },
      preview: {
        kind: "log_food",
        title: "Log today's meals",
        requiresConfirmation: true,
        validation: { valid: true, errors: [] },
        preview: "Will log a meal for 2026-11-12.",
      },
    },
  },
  {
    method: "POST",
    path: `${BASE}/v0/users/${TEST_USER}/conversations/${CONV_ID}/messages/${MSG_ID}/actions/${ACTION_ID}/confirm`,
    status: 200,
    body: { status: "executed", result: { meal: { id: "meal-1" } } },
  },
  {
    method: "POST",
    path: `${BASE}/v0/users/${TEST_USER}/conversations/${CONV_ID}/messages/${MSG_ID}/actions/${ACTION_ID}/reject`,
    status: 200,
    body: { status: "rejected" },
  },
  {
    method: "POST",
    path: `${BASE}/v0/users/${TEST_USER}/conversations/${CONV_ID}/messages`,
    status: 200,
    body: coachingResponse,
  },
];

function renderCoach() {
  localStorage.clear();
  localStorage.setItem("fitcoach.userId", TEST_USER);
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/coach/${CONV_ID}` }]}>
      <SessionProvider>
        <Routes>
          <Route path="/coach/:conversationId" element={<CoachScreen />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("CoachScreen — conversation interaction", () => {
  let api: ReturnType<typeof mockApi>;

  beforeEach(() => {
    api = mockApi(routes);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReset();
  });

  it("submits a message and displays the assistant response", async () => {
    renderCoach();
    await waitFor(() =>
      expect(screen.getByText((text) => text.includes("Your bench press is stalled at 60 kg"))).toBeInTheDocument(),
    );
    expect(screen.getByText("Mock AI response")).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/Ask FitCoach/);
    fireEvent.change(input, { target: { value: "What should I change?" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));
    await waitFor(() =>
      expect(screen.getByText("What should I change?")).toBeInTheDocument(),
    );
    expect(api.calls().some((c) => String(c[1]?.body).includes("What should I change?"))).toBe(
      true,
    );
  });

  it("shows evidence references behind the expandable section", async () => {
    renderCoach();
    await waitFor(() =>
      expect(screen.getByText((text) => text.includes("Your bench press is stalled at 60 kg"))).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Show evidence/ }));
    await waitFor(() => expect(screen.getByText("training_state")).toBeInTheDocument());
    expect(screen.getByText("bench_press_plateau")).toBeInTheDocument();
  });

  it("presents the no_change decision and mock labeling", async () => {
    renderCoach();
    await waitFor(() =>
      expect(screen.getByText((text) => text.includes("Your bench press is stalled at 60 kg"))).toBeInTheDocument(),
    );
    expect(screen.getByText("Mock AI response")).toBeInTheDocument();
    expect(
      screen.getByText((text) => text.includes("no change recommended"))
    ).toBeInTheDocument();
  });

  it("previews, confirms, and rejects a proposed action", async () => {
    renderCoach();
    await waitFor(() =>
      expect(screen.getByText((text) => text.includes("Your bench press is stalled at 60 kg"))).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /Preview/ }));
    // Debug: check API calls
    await waitFor(() => {
      console.log("API CALLS:", JSON.stringify(api.calls().map(c => ({ url: c[0], method: c[1]?.method, body: c[1]?.body }))));
      return true;
    });
    await waitFor(() => expect(screen.getByText((text) => text.includes("Will log a meal"))).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Confirm/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reject/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    await waitFor(() =>
      expect(screen.getByText((text) => text.includes("Action applied"))).toBeInTheDocument(),
    );
    expect(api.calls().some((c) => String(c[0]).includes("/confirm"))).toBe(true);
    expect(screen.queryByRole("button", { name: /Confirm/ })).not.toBeInTheDocument();
  });

  it("rejects an action without mutation", async () => {
    renderCoach();
    await waitFor(() =>
      expect(screen.getByText((text) => text.includes("Your bench press is stalled at 60 kg"))).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Preview/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Reject/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Reject/ }));
    await waitFor(() => expect(screen.getByText(/Rejected/)).toBeInTheDocument());
  });

  it("prevents duplicate confirmation after execution", async () => {
    renderCoach();
    await waitFor(() =>
      expect(screen.getByText((text) => text.includes("Your bench press is stalled at 60 kg"))).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Preview/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Confirm/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    await waitFor(() =>
      expect(screen.getByText((text) => text.includes("Action applied"))).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /Confirm/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reject/ })).not.toBeInTheDocument();
  });

  it("shows an error when execution fails", async () => {
    mockApi([
      {
        method: "GET",
        path: `${BASE}/v0/users/${TEST_USER}/conversations/${CONV_ID}/messages`,
        status: 200,
        body: { messages: initialMessages },
      },
      {
        method: "POST",
        path: `${BASE}/v0/users/${TEST_USER}/conversations/${CONV_ID}/messages/${MSG_ID}/actions/${ACTION_ID}/preview`,
        status: 200,
        body: {
          action: { id: ACTION_ID, kind: "log_food", status: "pending" },
          preview: {
            kind: "log_food",
            title: "Log today's meals",
            requiresConfirmation: true,
            validation: { valid: true, errors: [] },
            preview: "Will log a meal.",
          },
        },
      },
      {
        method: "POST",
        path: `${BASE}/v0/users/${TEST_USER}/conversations/${CONV_ID}/messages/${MSG_ID}/actions/${ACTION_ID}/confirm`,
        status: 400,
        body: { error: "action_execution_failed", message: "meal already logged" },
      },
    ]);
    renderCoach();
    await waitFor(() => expect(screen.getByRole("button", { name: /Preview/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Preview/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Confirm/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    await waitFor(() => expect(screen.getByText(/meal already logged/)).toBeInTheDocument());
  });

  it("presents non-executable actions without a confirm button", async () => {
    mockApi([
      {
        method: "GET",
        path: `${BASE}/v0/users/${TEST_USER}/conversations/${CONV_ID}/messages`,
        status: 200,
        body: {
          messages: [
            {
              ...initialMessages[0],
              proposedActions: [
                {
                  ...coachingResponse.proposedActions[0],
                  domainService: "not directly executable",
                  requiresConfirmation: false,
                },
              ],
            },
          ],
        },
      },
    ]);
    renderCoach();
    await waitFor(() => expect(screen.getByText(/Not directly executable/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Confirm/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Preview/ })).not.toBeInTheDocument();
  });
});
