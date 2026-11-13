import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

function Hello() {
  return <div data-testid="box">hello</div>;
}

describe("jsx sanity", () => {
  it("renders jsx", () => {
    render(<Hello />);
    expect(screen.getByTestId("box")).toBeInTheDocument();
  });
});
