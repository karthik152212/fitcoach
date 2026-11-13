import { describe, it, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { CoachScreen } from "../CoachScreen";
import { SessionProvider } from "../../session/SessionContext";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { mockApi, TEST_USER } from "../../__tests__/mockApi";

const BASE = "http://localhost:3000";
const CONV_ID = "c-1";

const initialMessages = [
  {
    id: "m-1",
    conversationId: CONV_ID,
    role: "assistant",
    content: "Your bench press is stalled at 60 kg for 3 weeks.",
    isMock: true,
    provider: "mock",
    model: "mock-local",
    createdAt: "2026-11-12T08:05:00.000Z",
    evidenceRefs: [],
    proposedActions: [],
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
    },
  },
];

const routes = [
  {
    method: "GET",
    path: `${BASE}/v0/users/${TEST_USER}/conversations/${CONV_ID}/messages`,
    status: 200,
    body: { messages: initialMessages },
  },
];

describe("CoachDiag2", () => {
  beforeEach(() => {
    mockApi(routes);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReset();
  });

  it("shows body html after render + tick", async () => {
    localStorage.clear();
    localStorage.setItem("fitcoach.userId", TEST_USER);
    const { container } = render(
      <MemoryRouter initialEntries={[{ pathname: `/coach/${CONV_ID}` }]}>
        <SessionProvider>
          <Routes>
            <Route path="/coach/:conversationId" element={<CoachScreen />} />
          </Routes>
        </SessionProvider>
      </MemoryRouter>,
    );
    console.log("INITIAL BODY:", document.body.innerHTML.slice(0, 400));
    await new Promise((r) => setTimeout(r, 50));
    console.log("AFTER TICK BODY:", document.body.innerHTML.slice(0, 600));
    console.log("CONTAINER:", container.innerHTML.slice(0, 600));
  });
});
