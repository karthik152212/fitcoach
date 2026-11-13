/**
 * FitCoach anatomy system tests.
 *
 * Covers: TargetMap → atlas region resolution → AnatomyFigure rendering,
 * target-only highlighting (only trained structures lit), and
 * muscle-head specificity.
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { AnatomyFigure, highlightsFromTargetMap, bestViewFor, type AnatomyHighlight } from "../anatomy/AnatomyFigure";
import { resolveAnatomyRegions, viewsForTarget } from "../anatomy/atlas";
import type { TargetMap, TargetMapEntry, TargetMapStructure, TargetState } from "../api/types";

function entry(muscleSlug: string, state: TargetState, structures: TargetMapStructure[] = []): TargetMapEntry {
  return {
    muscleId: `muscle-${muscleSlug}`,
    muscleSlug,
    displayName: muscleSlug.replaceAll("_", " "),
    group: "upper_body",
    state,
    emphasis: undefined,
    structures,
  };
}

function targetMap(entries: TargetMapEntry[]): TargetMap {
  return { entries };
}

describe("atlas region resolution", () => {
  it("resolves latissimus dorsi to back regions only", () => {
    const resolved = resolveAnatomyRegions({ muscleSlug: "latissimus_dorsi" }, "back");
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved.every((key) => key.startsWith("back:latissimus_dorsi"))).toBe(true);
  });

  it("resolves biceps long head to front head-specific regions", () => {
    const regions = resolveAnatomyRegions(
      { muscleSlug: "biceps_brachii", structureSlug: "long_head" },
      "front",
    );
    expect(regions.length).toBe(2); // left + right
    expect(regions.every((key) => key.includes("long_head"))).toBe(true);
  });

  it("returns empty when nothing maps for a view", () => {
    const regions = resolveAnatomyRegions({ muscleSlug: "pectorales_major" }, "back");
    expect(regions).toEqual([]);
  });

  it("picks the view showing the most target structure", () => {
    expect(viewsForTarget({ muscleSlug: "latissimus_dorsi", state: "primary" } as any)).toContain("back");
    expect(viewsForTarget({ muscleSlug: "pectoralis_major", state: "primary" } as any)).toContain("front");
    expect(bestViewFor([])).toBe("front");
  });
});

describe("highlightsFromTargetMap", () => {
  it("flattens structures into highlights preserving state", () => {
    const map = targetMap([
      entry("latissimus_dorsi", "primary", [
        { structureId: "s1", structureSlug: "left", displayName: "Latissimus dorsi — left", kind: "primary", state: "primary" },
        { structureId: "s2", structureSlug: "right", displayName: "Latissimus dorsi — right", kind: "primary", state: "primary" },
      ]),
    ]);
    const highlights = highlightsFromTargetMap(map);
    expect(highlights.length).toBe(2);
    expect(highlights.every((h) => h.state === "primary")).toBe(true);
    expect(highlights.every((h) => h.muscleSlug === "latissimus_dorsi")).toBe(true);
  });

  it("keeps whole-muscle highlight when no structure carries the same state", () => {
    const map = targetMap([
      entry("biceps_brachii", "secondary", [
        { structureId: "s1", structureSlug: "long_head", displayName: "Long head", kind: "primary", state: "primary" },
      ]),
    ]);
    const highlights = highlightsFromTargetMap(map);
    expect(highlights.length).toBe(2);
    const structure = highlights.find((h) => h.structureSlug === "long_head");
    const whole = highlights.find((h) => !h.structureSlug);
    expect(structure?.state).toBe("primary");
    expect(whole?.state).toBe("secondary");
  });
});

describe("AnatomyFigure target-only highlighting", () => {
  const latPrimary: readonly AnatomyHighlight[] = [{ muscleSlug: "latissimus_dorsi", state: "primary" }];

  it("renders only the target region highlighted, everything else neutral", () => {
    const { container } = render(<AnatomyFigure view="back" highlights={latPrimary} size={160} labelled />);
    const svg = container.querySelector('svg[role="img"]')!;
    expect(svg).toBeInTheDocument();

    const primaryRegions = svg.querySelectorAll('[data-state="primary"]');
    const neutralRegions = svg.querySelectorAll('[data-state="neutral"]');

    expect(primaryRegions.length).toBe(2); // left + right lat
    expect(neutralRegions.length).toBeGreaterThan(0);
  });

  it("does not highlight untrained muscles", () => {
    const { container } = render(<AnatomyFigure view="front" highlights={[]} size={160} labelled />);
    const svg = container.querySelector('svg[role="img"]')!;
    expect(svg.querySelectorAll('[data-state="primary"]').length).toBe(0);
    expect(svg.querySelectorAll('[data-state="neutral"]').length).toBeGreaterThan(0);
  });

  it("exposes an accessible label naming the highlighted muscle", () => {
    const { container } = render(<AnatomyFigure view="back" highlights={latPrimary} size={160} labelled />);
    const svg = container.querySelector('svg[role="img"]')!;
    const label = svg.getAttribute("aria-label") ?? "";
    expect(label).toContain("latissimus dorsi");
    expect(label).toContain("back view");
  });
});
