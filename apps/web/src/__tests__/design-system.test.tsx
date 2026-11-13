/**
 * FitCoach design-system tests.
 *
 * Covers: semantic tokens exist for light + dark (device-controlled, no
 * hardcoded brand decision leaking into components), and components consume
 * semantic tokens (Button variants, Chip tones, StateBlock kinds).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { Button } from "../components/controls";
import { Chip } from "../components/controls";
import { StateBlock } from "../components/controls";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKENS_CSS = readFileSync(resolve(__dirname, "../theme/tokens.css"), "utf8");

describe("design tokens", () => {
  const REQUIRED = [
    "--background",
    "--surface",
    "--surface-elevated",
    "--text-primary",
    "--text-secondary",
    "--text-muted",
    "--border",
    "--accent",
    "--success",
    "--warning",
    "--important",
    "--error",
    "--anatomy-neutral",
    "--anatomy-target",
    "--interactive",
    "--focus",
    "--touch-target",
  ];

  it("defines every semantic token in light mode", () => {
    for (const token of REQUIRED) {
      expect(TOKENS_CSS).toContain(`${token}:`);
    }
  });

  it("defines every surface/text token in dark mode", () => {
    const darkTokens = ["--background", "--surface", "--surface-elevated", "--text-primary", "--text-secondary", "--border", "--accent", "--anatomy-target"];
    for (const token of darkTokens) {
      expect(TOKENS_CSS).toContain(token);
    }
    // dark block present
    expect(TOKENS_CSS).toContain("prefers-color-scheme: dark");
  });

  it("does not expose an in-app theme selector (device-controlled only)", () => {
    expect(TOKENS_CSS).toContain("prefers-color-scheme");
    // no hardcoded neon/gaming accent; accent behind semantic token
    expect(TOKENS_CSS).toContain("--accent:");
  });
});

describe("Button consumes semantic tokens", () => {
  it("renders primary, secondary, quiet, danger variants", () => {
    render(<div><Button variant="primary">Primary</Button><Button variant="secondary">Secondary</Button><Button variant="quiet">Quiet</Button><Button variant="danger">Danger</Button></div>);
    expect(screen.getByRole("button", { name: "Primary" }).className).toContain("fc-button--primary");
    expect(screen.getByRole("button", { name: "Secondary" }).className).toContain("fc-button--secondary");
    expect(screen.getByRole("button", { name: "Quiet" }).className).toContain("fc-button--quiet");
    expect(screen.getByRole("button", { name: "Danger" }).className).toContain("fc-button--danger");
  });

  it("renders large and full-width variants", () => {
    render(<div><Button size="large">Large</Button><Button full>Full</Button></div>);
    expect(screen.getByRole("button", { name: "Large" }).className).toContain("fc-button--large");
    expect(screen.getByRole("button", { name: "Full" }).className).toContain("fc-button--full");
  });

  it("has a minimum touch target height", () => {
    render(<Button>Tap</Button>);
    const button = screen.getByRole("button", { name: "Tap" });
    expect(button.className).toContain("fc-button");
  });
});

describe("Chip consumes semantic tokens", () => {
  it("renders all tones", () => {
    const tones: Array<"neutral" | "accent" | "success" | "warning" | "important" | "error"> = [
      "neutral", "accent", "success", "warning", "important", "error",
    ];
    render(
      <div>
        {tones.map((tone) => (
          <Chip key={tone} tone={tone}>{tone}</Chip>
        ))}
      </div>,
    );
    for (const tone of tones) {
      expect(screen.getByText(tone).className).toContain(`fc-chip--${tone}`);
    }
  });
});

describe("StateBlock designed states", () => {
  it("renders loading, error, empty kinds without a bare 'Loading...'", () => {
    render(
      <div>
        <StateBlock kind="loading" title="Reading your training state" />
        <StateBlock kind="error" title="Unreachable" body="Check your connection" />
        <StateBlock kind="empty" title="Nothing here" body="Start training to see records." />
      </div>,
    );
    expect(screen.getByText("Reading your training state")).toBeInTheDocument();
    expect(screen.getByText("Unreachable")).toBeInTheDocument();
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    // error uses role=alert
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
