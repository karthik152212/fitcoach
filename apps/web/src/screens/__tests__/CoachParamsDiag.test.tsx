import { describe, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { useParams } from "react-router-dom";

function ParamsLogger() {
  const params = useParams<{ conversationId?: string }>();
  return <div data-testid="params">{JSON.stringify(params)}</div>;
}

describe("useParams diag with Routes", () => {
  it("shows conversationId from initialEntries", () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/coach/c-1" }]}>
        <Routes>
          <Route path="/coach/:conversationId" element={<ParamsLogger />} />
        </Routes>
      </MemoryRouter>,
    );
    // eslint-disable-next-line no-console
    console.log("PARAMS RENDERED:", document.getElementById("params")?.textContent);
  });
});
