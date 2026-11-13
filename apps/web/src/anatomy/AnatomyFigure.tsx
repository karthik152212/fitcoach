import { useMemo } from "react";
import type { TargetMap, TargetState } from "../api/types";
import {
  ANATOMY_REGIONS,
  ANATOMY_VIEWBOX,
  resolveAnatomyRegions,
  type AnatomyView,
} from "./atlas";

/**
 * FitCoach anatomy renderer.
 *
 * Exercise knowledge → TargetMap → this renderer → UI. The figure never
 * decides what to highlight: it receives TargetMap entries and lights exactly
 * those regions — primary strong, secondary softer, supporting faint — with
 * everything else neutral. One component reused across Home, workout,
 * exercise detail, logging, guide overlay and review.
 */

export interface AnatomyHighlight {
  muscleSlug: string;
  structureSlug?: string;
  state: TargetState;
}

export function highlightsFromTargetMap(targetMap: TargetMap | undefined): readonly AnatomyHighlight[] {
  if (!targetMap) return [];
  const highlights: AnatomyHighlight[] = [];
  for (const entry of targetMap.entries) {
    if (entry.structures.length > 0) {
      for (const structure of entry.structures) {
        highlights.push({ muscleSlug: entry.muscleSlug, structureSlug: structure.structureSlug, state: structure.state });
      }
      // Whole-muscle relation accompanies structures: keep it only when it
      // carries a distinct, stronger state than every structure.
      const strongest = entry.structures.some((s) => s.state === entry.state);
      if (!strongest) highlights.push({ muscleSlug: entry.muscleSlug, state: entry.state });
    } else {
      highlights.push({ muscleSlug: entry.muscleSlug, state: entry.state });
    }
  }
  return highlights;
}

/** Body silhouette shared by all views (quiet base under the musculature). */
function Silhouette({ view }: { view: AnatomyView }) {
  if (view === "side") {
    return (
      <g className="fc-anatomy__silhouette" aria-hidden="true">
        <ellipse cx="104" cy="46" rx="16" ry="20" />
        <path d="M84 66 C74 84 70 108 72 134 C74 160 72 190 70 216 C68 240 72 248 76 252 C70 286 70 322 74 352 C77 380 80 408 84 436 L96 436 C98 408 100 380 100 352 C100 322 100 292 104 262 C108 292 110 322 112 352 C114 380 116 408 118 436 L130 436 C132 408 134 380 134 350 C134 320 132 288 128 254 C134 248 138 240 138 220 C138 190 136 160 134 132 C132 106 128 84 120 68 C112 62 92 62 84 66 Z" />
      </g>
    );
  }
  return (
    <g className="fc-anatomy__silhouette" aria-hidden="true">
      <ellipse cx="100" cy="46" rx="17" ry="21" />
      <path d="M78 66 C60 76 44 86 38 100 C34 128 40 162 46 190 C44 220 46 248 54 262 C58 268 66 266 72 260 C70 278 66 300 62 322 C58 356 60 396 66 436 L86 436 C90 404 94 372 96 340 L104 340 C106 372 110 404 114 436 L134 436 C140 396 142 356 138 322 C134 300 130 278 128 260 C134 266 142 268 146 262 C154 248 156 220 154 190 C160 162 166 128 162 100 C156 86 140 76 122 66 C112 61 88 61 78 66 Z" />
    </g>
  );
}

export function AnatomyFigure({
  view,
  highlights,
  size = 180,
  labelled = true,
  interactive = false,
  onActivate,
}: {
  view: AnatomyView;
  highlights: readonly AnatomyHighlight[];
  size?: number;
  /** Adds figure caption text for assistive tech. */
  labelled?: boolean;
  /** When true, the figure is a button (guide entry point). */
  interactive?: boolean;
  onActivate?: () => void;
}) {
  const regions = useMemo(() => ANATOMY_REGIONS.filter((region) => region.view === view), [view]);
  const stateByRegion = useMemo(() => {
    const map = new Map<string, TargetState>();
    for (const highlight of highlights) {
      for (const key of resolveAnatomyRegions(highlight, view)) {
        const existing = map.get(key);
        if (!existing || STATE_RANK[highlight.state] > STATE_RANK[existing]) {
          map.set(key, highlight.state);
        }
      }
    }
    return map;
  }, [highlights, view]);

  const labelText = useMemo(() => {
    if (!labelled) return undefined;
    const names = highlights
      .filter((h) => resolveAnatomyRegions(h, view).length > 0)
      .map((h) => h.muscleSlug.replaceAll("_", " ") + (h.structureSlug ? ` (${h.structureSlug.replaceAll("_", " ")})` : ""));
    if (names.length === 0) return `Anatomical figure, ${view} view`;
    return `Anatomical figure, ${view} view, highlighting ${[...new Set(names)].join(", ")}`;
  }, [highlights, view, labelled]);

  const figure = (
    <svg
      viewBox={ANATOMY_VIEWBOX}
      width={size}
      height={(size * 460) / 200}
      role="img"
      aria-label={labelText}
      className="fc-anatomy__svg"
    >
      <Silhouette view={view} />
      <g>
        {regions.map((region) => {
          const state = stateByRegion.get(region.key);
          return (
            <path
              key={region.key}
              d={region.d}
              className="fc-anatomy__region"
              data-state={state ?? "neutral"}
              fillRule="evenodd"
            >
              <title>{region.label}</title>
            </path>
          );
        })}
      </g>
    </svg>
  );

  if (interactive) {
    return (
      <button
        type="button"
        className="fc-anatomy fc-anatomy--interactive"
        onClick={onActivate}
        aria-label={labelText ? `${labelText}. Open guide.` : "Open guide"}
      >
        {figure}
        <span className="fc-anatomy__guide-hint" aria-hidden="true">
          Guide
        </span>
      </button>
    );
  }
  return <div className="fc-anatomy">{figure}</div>;
}

const STATE_RANK: Record<TargetState, number> = {
  primary: 4,
  secondary: 3,
  supporting: 2,
  stabilizer: 1,
};

/** Pick the view that shows the most target structure (front/back/side). */
export function bestViewFor(highlights: readonly AnatomyHighlight[]): AnatomyView {
  const counts: Record<AnatomyView, number> = { front: 0, back: 0, side: 0 };
  for (const highlight of highlights) {
    for (const view of ["front", "back", "side"] as const) {
      counts[view] += resolveAnatomyRegions(highlight, view).length;
    }
  }
  const ordered = (Object.entries(counts) as [AnatomyView, number][]).sort((a, b) => b[1] - a[1]);
  const best = ordered[0];
  return best && best[1] > 0 ? best[0] : "front";
}
