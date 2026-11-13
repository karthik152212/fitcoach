/**
 * FitCoach guide overlay tests.
 *
 * Covers: anatomy → full-screen guide transition, anatomy target overlay,
 * state preservation (overlay is local state), Escape to close.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { render, within, cleanup, fireEvent } from "@testing-library/react";
import { GuideOverlay } from "../screens/GuideOverlay";
import type { ExerciseDetail, MediaAsset } from "../api/types";

const EXERCISE_ID = "ex-lat-pulldown";

function detail(withVideo: boolean): ExerciseDetail {
  return {
    exercise: {
      id: EXERCISE_ID,
      slug: "lat-pulldown",
      name: "Lat Pulldown",
      aliases: [],
      category: "compound",
      movementPattern: "vertical_pull",
      summary: "Train the lats.",
      requiredEquipmentIds: [],
      movementFunctions: ["shoulder_adduction"],
      roles: [],
      targets: [],
      stabilityDemand: "moderate",
      loadingCharacteristic: "external_load",
      rangeOfMotionCharacteristic: "full",
      unilateral: false,
    },
    formGuidance: {
      exerciseId: EXERCISE_ID,
      version: 1,
      steps: [
        { key: "setup", heading: "Setup", body: "Grab the bar.", position: 1 },
        { key: "pull", heading: "Pull", body: "Pull to your chest.", position: 2 },
      ],
    },
    media: withVideo
      ? [
          {
            id: "m-1",
            mediaType: "video",
            angle: "side",
            storageKey: "/v0/media/guide-lat-pulldown.mp4",
            overlays: ["lats"],
            status: "active",
          } as MediaAsset,
        ]
      : [],
    targetMap: {
      entries: [
        {
          muscleId: "m-lats",
          muscleSlug: "latissimus_dorsi",
          displayName: "Latissimus dorsi",
          group: "back",
          state: "primary",
          emphasis: undefined,
          structures: [],
        },
      ],
    },
  } as ExerciseDetail;
}

afterEach(() => {
  cleanup();
});

describe("GuideOverlay", () => {
  it("renders the guide dialog with the exercise name and anatomy figure", () => {
    const { container } = render(<GuideOverlay detail={detail(false)} onClose={vi.fn()} />);
    const q = within(container);
    expect(q.getByRole("dialog")).toBeInTheDocument();
    expect(q.getByText("Lat Pulldown")).toBeInTheDocument();
    expect(q.getByText(/Guide/)).toBeInTheDocument();
    // pending state: anatomy figure shown, no video
    expect(container.querySelector("video")).not.toBeInTheDocument();
    expect(q.getByRole("img").getAttribute("aria-label")).toContain("latissimus dorsi");
  });

  it("closes on backdrop click and Escape", () => {
    const onClose = vi.fn();
    const { container } = render(<GuideOverlay detail={detail(false)} onClose={onClose} />);
    const q = within(container);
    fireEvent.click(q.getByRole("dialog").firstElementChild as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("plays the video with an anatomy overlay when a guide video exists", () => {
    const { container } = render(<GuideOverlay detail={detail(true)} onClose={vi.fn()} />);
    expect(container.querySelector("video")).toBeInTheDocument();
    // anatomy overlay anchored on the video
    expect(container.querySelector("svg[role='img']")).toBeInTheDocument();
    expect(container.querySelector(".fc-guide__step-heading")?.textContent).toBe("Setup");
  });
});
