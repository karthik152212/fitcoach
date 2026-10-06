import type { MuscleEmphasis, MuscleGroup } from "@fitcoach/domain";
import type { ExerciseKnowledge } from "./knowledgeCatalog";

/**
 * Visual muscle targeting (Phase 2, §21).
 *
 * The pipeline is one-directional and one-way:
 *
 *     Exercise → ExerciseMuscleRelations → TargetMap → Visual Muscle Overlay
 *
 * The deterministic engine is the only thing that decides which muscles are
 * highlighted. The renderer consumes this map and never decides anatomy itself;
 * retiring an illustration therefore cannot leave stale muscle data behind,
 * because the muscle data never lived in the illustration.
 *
 * Muscle identity is a stable id/slug, so the same overlay assets work for any
 * catalog carrying the same taxonomy.
 */

export type TargetVisualState = "primary" | "secondary" | "supporting" | "stabilizer";

export interface TargetStructureEntry {
  structureId: string;
  structureSlug: string;
  displayName: string;
  kind: string;
  state: TargetVisualState;
  emphasis?: MuscleEmphasis;
}

export interface TargetMapEntry {
  muscleId: string;
  muscleSlug: string;
  displayName: string;
  group: MuscleGroup;
  /** Highest visual state across every relation for this muscle. */
  state: TargetVisualState;
  emphasis?: MuscleEmphasis;
  structures: TargetStructureEntry[];
}

export interface TargetMap {
  exerciseId: string;
  slug: string;
  name: string;
  entries: TargetMapEntry[];
  /** States present in this map, for a renderer that styles per state. */
  states: TargetVisualState[];
  /**
   * Wording the UI may show verbatim. Built from role + emphasis only, so it
   * cannot say "isolates".
   */
  legend: ReadonlyArray<{ state: TargetVisualState; meaning: string }>;
}

const STATE_ORDER: Record<TargetVisualState, number> = {
  primary: 0,
  secondary: 1,
  supporting: 2,
  stabilizer: 3,
};

const STATE_MEANINGS: Readonly<Record<TargetVisualState, string>> = {
  primary: "Primary target",
  secondary: "Secondary contributor",
  supporting: "Supporting contributor",
  stabilizer: "Stabilizing",
};

function stateForRole(role: string): TargetVisualState {
  switch (role) {
    case "primary_mover":
      return "primary";
    case "secondary_mover":
      return "secondary";
    case "supporting":
      return "supporting";
    default:
      return "stabilizer";
  }
}

/**
 * Build the render-ready target map for one exercise.
 *
 * Whole-muscle and structure-level relations merge into one entry per muscle,
 * taking the most prominent state; structure entries keep their own state so a
 * renderer can highlight "long head, secondary" differently from "long head,
 * primary".
 */
export function buildTargetMap(exercise: ExerciseKnowledge): TargetMap {
  const byMuscle = new Map<string, TargetMapEntry>();

  for (const target of exercise.targets) {
    const state = stateForRole(target.role);
    const existing = byMuscle.get(target.muscleId);
    if (!existing) {
      const entry: TargetMapEntry = {
        muscleId: target.muscleId,
        muscleSlug: target.muscleSlug,
        displayName: target.muscleDisplayName,
        group: target.muscleGroup,
        state,
        ...(target.emphasis !== undefined ? { emphasis: target.emphasis } : {}),
        structures: [],
      };
      if (target.structureId && target.structureSlug && target.structureDisplayName) {
        entry.structures.push({
          structureId: target.structureId,
          structureSlug: target.structureSlug,
          displayName: target.structureDisplayName,
          kind: target.structureKind ?? "region",
          state,
          ...(target.emphasis !== undefined ? { emphasis: target.emphasis } : {}),
        });
      }
      byMuscle.set(target.muscleId, entry);
      continue;
    }
    if (STATE_ORDER[state] < STATE_ORDER[existing.state]) existing.state = state;
    if (existing.emphasis === undefined && target.emphasis !== undefined) {
      existing.emphasis = target.emphasis;
    }
    if (target.structureId && target.structureSlug && target.structureDisplayName) {
      existing.structures.push({
        structureId: target.structureId,
        structureSlug: target.structureSlug,
        displayName: target.structureDisplayName,
        kind: target.structureKind ?? "region",
        state,
        ...(target.emphasis !== undefined ? { emphasis: target.emphasis } : {}),
      });
    }
  }

  const entries = [...byMuscle.values()].sort((a, b) => {
    if (STATE_ORDER[a.state] !== STATE_ORDER[b.state]) return STATE_ORDER[a.state] - STATE_ORDER[b.state];
    return a.muscleSlug.localeCompare(b.muscleSlug);
  });
  for (const entry of entries) {
    entry.structures.sort((a, b) => a.structureSlug.localeCompare(b.structureSlug));
  }

  const states = [...new Set(entries.map((entry) => entry.state))].sort(
    (a, b) => STATE_ORDER[a] - STATE_ORDER[b],
  );

  return {
    exerciseId: exercise.id,
    slug: exercise.slug,
    name: exercise.name,
    entries,
    states,
    legend: states.map((state) => ({ state, meaning: STATE_MEANINGS[state] })),
  };
}
