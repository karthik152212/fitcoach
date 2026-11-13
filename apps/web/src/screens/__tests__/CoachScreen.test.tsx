/**
 * AI Coach screen tests — conversation list and error states.
 *
 * Exercises: conversation creation/listing and API error handling.
 * All backend calls are intercepted with mockApi using fixtures shaped to
 * the actual /v0 coaching contracts.
 */

import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { CoachScreen } from "../CoachScreen";
import { SessionProvider } from "../../session/SessionContext";
import { MemoryRouter, Routes, Route, Navigate } from "react-router-dom";
import { mockApi, TEST_USER } from "../../__tests__/mockApi";

const BASE = "http://localhost:3000";
const CONV_ID = "c-1";

const conversation = {
  id: CONV_ID,
  userId: TEST_USER,
  title: "Bench stall",
  status: "active",
  createdAt: "2026-11-12T08:00:00.000Z",
  updatedAt: "2026-11-12T08:00:00.000Z",
};

const routes = [
  { method: "POST", path: `${BASE}/v0/users/${TEST_USER}/conversations`, status: 201, body: { conversation } },
  {
    method: "GET",
    path: `${BASE}/v0/users/${TEST_USER}/conversations`,
    status: 200,
    body: { conversations: [conversation] },
  },
  {
    method: "GET",
    path: `${BASE}/v0/users/${TEST_USER}/conversations/${CONV_ID}/messages`,
    status: 200,
    body: { messages: [] },
  },
];

function renderCoach() {
  localStorage.clear();
  localStorage.setItem("fitcoach.userId", TEST_USER);
  return render(
    <MemoryRouter initialEntries={["/coach"]}>
      <SessionProvider>
        <Routes>
          <Route path="/coach" element={<CoachScreen />} />
          <Route path="/coach/:conversationId" element={<CoachScreen />} />
          <Route path="*" element={<Navigate to="/coach" replace />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("CoachScreen — list and error states", () => {
  let api: ReturnType<typeof mockApi>;

  beforeEach(() => {
    api = mockApi(routes);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReset();
  });

  it("lists existing conversations on the coach screen", async () => {
    renderCoach();
    expect(screen.getByText(/Your coaching conversations/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Bench stall")).toBeInTheDocument());
  });

  it("creates a new conversation", async () => {
    renderCoach();
    await waitFor(() => expect(screen.getByText("Bench stall")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /New conversation/ }));
    await waitFor(() => {
      const calls = api.calls();
      const createCall = calls.find(
        (c) => String(c[0]).includes("/conversations") && String(c[1]?.method) === "POST",
      );
      expect(createCall).toBeDefined();
      expect(JSON.parse(String(createCall?.[1]?.body ?? "{}"))).toEqual({});
    });
    await waitFor(() => expect(screen.getByText("← Conversations")).toBeInTheDocument());
  });

  it("shows an error state when the API fails", async () => {
    mockApi([
      {
        method: "POST",
        path: `${BASE}/v0/users/${TEST_USER}/conversations`,
        status: 500,
        body: { error: "internal_error", message: "boom" },
      },
    ]);
    renderCoach();
    await waitFor(() =>
      expect(screen.getByText(/Could not load conversations/)).toBeInTheDocument(),
    );
  });
});
