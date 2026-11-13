/**
 * Exercise media tests.
 *
 * Registered photography is public domain (free-exercise-db), and the rest of
 * the catalogue deliberately falls back to anatomy. These tests keep the slot
 * honest: fall back when nothing is registered, never render a broken image,
 * and never register an asset without descriptive text and provenance.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ExerciseMedia } from "../components/ExerciseMedia";
import { EXERCISE_MEDIA, mediaFor, type ExerciseMediaAsset } from "../exercise/media";

afterEach(cleanup);

const ANATOMY = <div data-testid="anatomy">anatomy figure</div>;

const asset: ExerciseMediaAsset = {
  src: "/exercise-media/test.webp",
  width: 1200,
  height: 900,
  alt: "Athlete at the bottom of a lat pulldown",
  source: "Test fixture",
  licence: "Test fixture — not shipped",
};

describe("ExerciseMedia", () => {
  it("renders the anatomy figure when no asset is registered", () => {
    render(<ExerciseMedia asset={undefined} fallback={ANATOMY} />);
    expect(screen.getByTestId("anatomy")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("resolves an exercise with no registered media to the fallback", () => {
    // A tempo variation has no photograph: a still cannot show the tempo, so
    // the accurate anatomy figure is the right answer rather than a proxy.
    render(<ExerciseMedia asset={mediaFor("tempo_push_up")} fallback={ANATOMY} />);
    expect(screen.getByTestId("anatomy")).toBeInTheDocument();
  });

  it("resolves a registered exercise to its photograph", () => {
    render(<ExerciseMedia asset={mediaFor("lat_pulldown_wide_grip")} fallback={ANATOMY} />);
    expect(screen.getByRole("img", { name: /wide bar pulled to the upper chest/i })).toBeInTheDocument();
    expect(screen.queryByTestId("anatomy")).not.toBeInTheDocument();
  });

  it("renders a registered photograph with its accessible description", () => {
    render(<ExerciseMedia asset={asset} fallback={ANATOMY} />);
    const image = screen.getByRole("img", { name: /bottom of a lat pulldown/i });
    expect(image).toHaveAttribute("src", "/exercise-media/test.webp");
    expect(image).toHaveAttribute("width", "1200");
    expect(image).toHaveAttribute("height", "900");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(screen.queryByTestId("anatomy")).not.toBeInTheDocument();
  });

  it("falls back to anatomy when the file fails to load", () => {
    render(<ExerciseMedia asset={asset} fallback={ANATOMY} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByTestId("anatomy")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("exercise media registry", () => {
  it("registers no asset without alt text and provenance", () => {
    for (const [exerciseId, entry] of Object.entries(EXERCISE_MEDIA)) {
      expect(entry.alt.trim(), `${exerciseId} alt`).not.toBe("");
      expect(entry.source.trim(), `${exerciseId} source`).not.toBe("");
      expect(entry.licence.trim(), `${exerciseId} licence`).not.toBe("");
      expect(entry.src, `${exerciseId} src`).not.toBe("");
    }
  });
});
