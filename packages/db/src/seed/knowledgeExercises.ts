import type { FormOverlayKind } from "@fitcoach/domain";
import type { KnowledgeMediaFixture } from "./knowledgeTypes";
import { ARM_EXERCISES } from "./knowledgeExercisesArms";
import { LEG_AND_CORE_EXERCISES } from "./knowledgeExercisesLegsCore";
import { PULL_EXERCISES } from "./knowledgeExercisesPull";
import { PUSH_EXERCISES } from "./knowledgeExercisesPush";
import type { KnowledgeExercise } from "./knowledgeTypes";

/**
 * PHASE 2 KNOWLEDGE FIXTURES — the exercise catalog.
 *
 * Every entry is a variation with its own identity, targeting, roles, form
 * guidance and media metadata. This is deliberately a small, high-quality,
 * first-party set rather than a large imported corpus: nothing here comes from
 * a third-party dataset, and `data/provenance/THIRD_PARTY.md` still lists no
 * verified exercise import.
 *
 * Coverage is chosen so the deterministic engines can be exercised honestly
 * across every group the taxonomy supports — including the cases the product
 * cares about most: complementary biceps variations, complementary triceps
 * variations, and the distinct roles inside "back".
 */
export const KNOWLEDGE_EXERCISES: readonly KnowledgeExercise[] = [
  ...PUSH_EXERCISES,
  ...PULL_EXERCISES,
  ...ARM_EXERCISES,
  ...LEG_AND_CORE_EXERCISES,
];

export interface KnowledgeSubstitution {
  /** Slug of the exercise being replaced. */
  exercise: string;
  /** Slug of the reviewed replacement. */
  substitute: string;
  trigger: "default" | "machine_busy" | "equipment_missing" | "disliked";
  reason: string;
  rankHint?: number;
}

/**
 * Reviewed substitution edges.
 *
 * These are a **hint layer over deterministic derivation**, never a lookup
 * table: `fitness-core` derives ranked substitutes from targeting, movement,
 * equipment and goal, and only consults these rows to surface a reviewer-authored
 * reason or to promote a known-good replacement. Removing every row here leaves
 * the product fully functional.
 */
export const KNOWLEDGE_SUBSTITUTIONS: readonly KnowledgeSubstitution[] = [
  {
    exercise: "cable_lateral_raise",
    substitute: "dumbbell_lateral_raise",
    trigger: "machine_busy",
    reason:
      "Same shoulder-abduction path and the same lateral-deltoid target; the dumbbell version needs only a pair of dumbbells instead of a free cable station.",
    rankHint: 3,
  },
  {
    exercise: "cable_lateral_raise",
    substitute: "machine_lateral_raise",
    trigger: "machine_busy",
    reason: "Guided abduction onto the same target when no cable station is free.",
    rankHint: 2,
  },
  {
    exercise: "cable_curl_underhand",
    substitute: "barbell_curl",
    trigger: "equipment_missing",
    reason:
      "Both are standing elbow-flexion curls with biceps brachii as the primary target; the barbell version keeps a full bottom stretch.",
    rankHint: 3,
  },
  {
    exercise: "barbell_bench_press",
    substitute: "machine_chest_press",
    trigger: "equipment_missing",
    reason:
      "Same horizontal-press path and the same sternal-pectoralis emphasis, with the stabiliser demand removed for a lower training-max injury surface.",
    rankHint: 2,
  },
  {
    exercise: "barbell_bent_over_row",
    substitute: "chest_supported_dumbbell_row",
    trigger: "equipment_missing",
    reason:
      "Both are horizontal pulls dominated by the rhomboids and mid traps; the chest-supported version removes the lower-back requirement.",
    rankHint: 2,
  },
  {
    exercise: "seated_cable_row",
    substitute: "chest_supported_dumbbell_row",
    trigger: "machine_busy",
    reason: "Equivalent horizontal-pull stimulus with the same mid-back bias and fewer stabiliser demands.",
    rankHint: 2,
  },
  {
    exercise: "lat_pulldown_neutral_grip",
    substitute: "lat_pulldown_wide_grip",
    trigger: "machine_busy",
    reason: "Same vertical-pull path and lat emphasis; only the grip differs, so the stimulus is close to interchangeable.",
    rankHint: 1,
  },
  {
    exercise: "cable_pulldown_single_arm",
    substitute: "lat_pulldown_wide_grip",
    trigger: "equipment_missing",
    reason: "Same lat-focused vertical pull, performed bilaterally.",
    rankHint: 1,
  },
  {
    exercise: "overhead_cable_extension",
    substitute: "skull_crusher_ez_bar",
    trigger: "equipment_missing",
    reason:
      "Both are elbow extensions performed with the shoulder in flexion, so both keep the long-head lengthened-position bias; only the supporting position differs.",
    rankHint: 2,
  },
  {
    exercise: "skull_crusher_ez_bar",
    substitute: "cable_triceps_pushdown",
    trigger: "equipment_missing",
    reason:
      "Same triceps target, but the pushdown anchors the work at full contraction instead of a lengthened position — a partial substitute, which the ranking reflects.",
    rankHint: 0,
  },
  {
    exercise: "romanian_deadlift",
    substitute: "hip_thrust",
    trigger: "equipment_missing",
    reason:
      "Both are loaded hip-extension movements with strong gluteus maximus involvement; the hip thrust loses the lengthened hamstring stretch.",
    rankHint: 1,
  },
  {
    exercise: "leg_press",
    substitute: "goblet_front_squat",
    trigger: "equipment_missing",
    reason: "Knee-extension loading for the quadriceps without a machine.",
    rankHint: 1,
  },
  {
    exercise: "lying_leg_curl",
    substitute: "romanian_deadlift",
    trigger: "equipment_missing",
    reason: "Keeps the hamstrings as a primary target with different mechanics and no machine required.",
    rankHint: 1,
  },
  {
    exercise: "machine_chest_press",
    substitute: "push_up",
    trigger: "equipment_missing",
    reason: "Same horizontal-press pattern with bodyweight loading.",
    rankHint: 1,
  },
  {
    exercise: "assisted_pull_up",
    substitute: "lat_pulldown_wide_grip",
    trigger: "equipment_missing",
    reason: "Machine vertical pull onto the same lats when no pull-up bar is available.",
    rankHint: 1,
  },
];

// ---------------------------------------------------------------------------
// Media metadata (Phase 2 §26–§30)
// ---------------------------------------------------------------------------

/**
 * Planned object-storage keys for first-party media.
 *
 * Phase 2 implements the **domain, provenance and versioning boundary only**.
 * Nothing is hosted, generated or transcoded here, and no endpoint serves these
 * keys yet; the keys describe where the asset will live so the metadata,
 * provenance and version history can be designed and reviewed before any bytes
 * exist. First-party rows carry no `external_sources` reference and no licence,
 * which is exactly what distinguishes them from third-party media
 * (data/provenance/THIRD_PARTY.md).
 */
const MEDIA_KEY_PREFIX = "planned/first-party";

export const ANATOMY_OVERLAY: readonly FormOverlayKind[] = ["target_muscle_highlight"];
export const VIDEO_OVERLAYS: readonly FormOverlayKind[] = [
  "movement_arrow",
  "movement_path",
  "rom_indicator",
];

/**
 * Every catalogued exercise gets an anatomical-targeting illustration reference.
 * The overlay is derived from `exercise_muscle_relations` at render time; the
 * asset itself carries no muscle information, so retiring an asset can never
 * leave stale anatomy behind.
 */
export function defaultMediaFor(exercise: KnowledgeExercise): KnowledgeMediaFixture[] {
  return [
    {
      mediaType: "anatomical_illustration",
      angle: "primary",
      storageKey: `${MEDIA_KEY_PREFIX}/anatomy/${exercise.slug}.svg`,
      overlays: ANATOMY_OVERLAY,
    },
  ];
}
