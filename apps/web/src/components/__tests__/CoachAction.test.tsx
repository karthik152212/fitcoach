/**
 * CoachAction tests: preview -> confirm/reject lifecycle, duplicate
 * submission prevention, execution failure, and non-executable actions.
 */

import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CoachAction } from "../CoachAction";
import { SessionProvider } from "../../session/SessionContext";
import { MemoryRouter } from "react-router-dom";
import { mockApi, TEST_USER } from "../../__tests__/mockApi";

const BASE = "http://localhost:3000";
const CONV_ID = "c-1";
const MSG_ID = "m-1";

const action = {
  id: "a-1",
  kind: "log_food",
  title: "Log today's meals",
  description: "Record what you've eaten so I can assess nutrition adherence.",
  domainService: "nutrition.createMeal",
  parameters: { localDate: "2026-11-12" },
  requiresConfirmation: true,
  validated: true,
  evidenceRefs: [],
  status: "pending" as const,
};

const routes = [
  {
    method: "POST",
    path: `${BASE}/v0/users/${TEST_USER}/conversations/${CONV_ID}/messages/${MSG_ID}/actions/a-1/preview`,
    status: 200,
    body: {
      action: { id: "a-1", kind: "log_food", status: "pending" },
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
    path: `${BASE}/v0/users/${TEST_USER}/conversations/${CONV_ID}/messages/${MSG_ID}/actions/a-1/confirm`,
    status: 200,
    body: { status: "executed", result: { meal: { id: "meal-1" } } },
  },
  {
    method: "POST",
    path: `${BASE}/v0/users/${TEST_USER}/conversations/${CONV_ID}/messages/${MSG_ID}/actions/a-1/reject`,
    status: 200,
    body: { status: "rejected" },
  },
];

function renderAction(overrides: Partial<Parameters<typeof CoachAction>[0]> = {}) {
  localStorage.setItem("fitcoach.userId", TEST_USER);
  return render(
    <MemoryRouter initialEntries={["/coach"]}>
      <SessionProvider>
        <CoachAction
          conversationId={CONV_ID}
          messageId={MSG_ID}
          action={action}
          {...overrides}
        />
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("CoachAction", () => {
  let api: ReturnType<typeof mockApi>;

  beforeEach(() => {
    api = mockApi(routes);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReset();
  });

  it("shows the action preview with expected change", async () => {
    renderAction();
    expect(screen.getByText("Log today's meals")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Preview/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirm/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Preview/ }));
    await waitFor(() => expect(screen.getByText(/Will log a meal/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Confirm/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reject/ })).toBeInTheDocument();
  });

  it("confirms an action and shows executed state", async () => {
    renderAction();
    fireEvent.click(screen.getByRole("button", { name: /Preview/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Confirm/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    await waitFor(() => expect(screen.getByText(/Done|executed/)).toBeInTheDocument());
    expect(api.calls().some((c) => String(c[0]).includes("/confirm"))).toBe(true);
  });

  it("rejects an action without executing it", async () => {
    renderAction();
    fireEvent.click(screen.getByRole("button", { name: /Preview/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Reject/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Reject/ }));
    await waitFor(() => expect(screen.getByText(/Rejected/)).toBeInTheDocument());
  });

  it("prevents duplicate confirmation after execution", async () => {
    renderAction();
    fireEvent.click(screen.getByRole("button", { name: /Preview/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Confirm/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    await waitFor(() => expect(screen.getByText(/Done|executed/)).toBeInTheDocument());
    // Confirm button should not be offered again for a resolved action.
    expect(screen.queryByRole("button", { name: /Confirm/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reject/ })).not.toBeInTheDocument();
  });

  it("shows an error when execution fails", async () => {
    // Use a failing confirm route by rendering against the 400 route.
    mockApi([
      {
        method: "POST",
        path: `${BASE}/v0/users/${TEST_USER}/conversations/${CONV_ID}/messages/${MSG_ID}/actions/a-1/preview`,
        status: 200,
        body: {
          action: { id: "a-1", kind: "log_food", status: "pending" },
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
        path: `${BASE}/v0/users/${TEST_USER}/conversations/${CONV_ID}/messages/${MSG_ID}/actions/a-1/confirm`,
        status: 400,
        body: { error: "action_execution_failed", message: "meal already logged" },
      },
    ]);
    renderAction();
    fireEvent.click(screen.getByRole("button", { name: /Preview/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Confirm/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    await waitFor(() => expect(screen.getByText(/meal already logged/)).toBeInTheDocument());
  });

  it("presents non-executable actions without a confirm button", async () => {
    renderAction({
      action: {
        ...action,
        domainService: "not directly executable",
        requiresConfirmation: false,
        parameters: { localDate: "2026-11-12" },
      },
    });
    expect(screen.getByText(/Not directly executable/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirm/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Preview/ })).not.toBeInTheDocument();
  });
});
