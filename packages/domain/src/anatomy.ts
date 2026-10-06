import type { BaseEntity, MuscleId } from "./shared";

/**
 * Muscle taxonomy (Phase 2).
 *
 * FitCoach does not model fake anatomical precision. It models what a training
 * system actually needs in order to answer: "which part of this muscle is this
 * movement biased toward, and is that bias an emphasis or only a
 * contribution?".
 *
 * Two levels are deliberately kept apart:
 *
 *   * `Muscle` (see ./exercise.ts) — the whole muscle, the unit that volume,
 *     coverage and redundancy math addresses.
 *   * `MuscleStructure` — a named sub-structure of a muscle: a head, a region
 *     or a functionally distinct portion. Sub-structures never replace the
 *     muscle; they qualify it, and every structure rolls up to exactly one
 *     muscle so coverage math always has a parent to accumulate into.
 *
 * The taxonomy is extensible on purpose: a new structure is a new row, not a
 * schema change. It is also honest — nothing here asserts that an exercise
 * *isolates* a structure; see `MuscleEmphasis` and `ExerciseMuscleTarget`.
 */

/**
 * What kind of anatomical sub-structure this is. The kind is documentation
 * plus a validation aid, never an analytic input: coverage math treats every
 * structure the same way and always carries its parent muscle along.
 */
export type MuscleStructureKind =
  /** A distinct muscle head (biceps long head, triceps lateral head). */
  | "head"
  /** A named region (upper/middle/lower trapezius, clavicular pectoralis). */
  | "region"
  /** A functionally distinct portion that is not a head or a region. */
  | "portion";

/** Stable, human-readable classification of how an exercise biases a muscle. */
export type MuscleEmphasis =
  /** Work is performed with the muscle long — modern lengthened-position bias. */
  | "lengthened_position"
  /** Work is performed with the muscle short — classic shortened-position bias. */
  | "shortened_position"
  /** One head/region of a multi-headed muscle carries more of the work. */
  | "structure_biased"
  /** The upper end of the usable range is the focus. */
  | "upper_range_bias"
  /** The lower end of the usable range is the focus. */
  | "lower_range_bias"
  /** The lowering phase is the trained portion. */
  | "eccentric_emphasis";

/**
 * A sub-structure of one muscle. `slug` is unique within the parent muscle, so
 * "biceps_brachii / long_head" is addressable and a stable visual-overlay key
 * (see the visual muscle-targeting pipeline).
 */
export interface MuscleStructure extends BaseEntity {
  muscleId: MuscleId;
  slug: string;
  name: string;
  kind: MuscleStructureKind;
  displayName?: string;
  /** Free-form note about what the structure is, for reviewer-facing surfaces. */
  notes?: string;
  isActive: boolean;
}

/**
 * Every structure kind currently modelled, for CHECK constraints, validation
 * and documentation. Adding a kind is a deliberate, reviewed decision.
 */
export const MUSCLE_STRUCTURE_KINDS: readonly MuscleStructureKind[] = [
  "head",
  "region",
  "portion",
] as const;

/** Every emphasis code the catalog may use. */
export const MUSCLE_EMPHASES: readonly MuscleEmphasis[] = [
  "lengthened_position",
  "shortened_position",
  "structure_biased",
  "upper_range_bias",
  "lower_range_bias",
  "eccentric_emphasis",
] as const;
