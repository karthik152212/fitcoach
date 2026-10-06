import type {
  ExerciseCategory,
  ExerciseMediaAngle,
  ExerciseMediaType,
  ExerciseRole,
  FormGuidanceStepKey,
  FormOverlayKind,
  LoadingCharacteristic,
  MovementFunction,
  MovementPattern,
  MuscleEmphasis,
  MuscleRole,
  RangeOfMotionCharacteristic,
  StabilityDemand,
} from "@fitcoach/domain";

/**
 * PHASE 2 KNOWLEDGE FIXTURES — shared authoring types.
 *
 * The catalog is authored as data so it can be reviewed like data. Nothing in
 * this file is imported from a third-party dataset; see
 * data/provenance/THIRD_PARTY.md.
 */

export interface KnowledgeTargetRelation {
  /** Muscle slug, e.g. "biceps_brachii". */
  muscle: string;
  role: MuscleRole;
  /** Advisory contribution in [0, 1]; interpretation lives in fitness-core. */
  weight?: number;
  emphasis?: MuscleEmphasis;
  /** Reviewer confidence in THIS relation, [0, 1]. */
  confidence?: number;
  notes?: string;
}

/** A contribution narrowed to one head/region/portion of a muscle. */
export interface KnowledgeStructureRelation extends Omit<KnowledgeTargetRelation, "muscle"> {
  muscle: string;
  /** Structure slug, unique within the muscle. */
  structure: string;
}

export interface KnowledgeMediaFixture {
  mediaType: ExerciseMediaType;
  angle: ExerciseMediaAngle;
  /** Planned object-storage key. Phase 2 stores metadata only. */
  storageKey: string;
  durationSeconds?: number;
  overlays?: readonly FormOverlayKind[];
  status?: "active" | "retired";
}

export interface KnowledgeExercise {
  slug: string;
  name: string;
  aliases?: readonly string[];
  /** Stable variation identity: "<movement-slug>:<variation-slug>". */
  variationKey: string;
  variationLabel: string;
  category: ExerciseCategory;
  movementPattern?: MovementPattern;
  /** The function that best characterises the exercise (must be in the set). */
  primaryMovementFunction: MovementFunction;
  movementFunctions: readonly MovementFunction[];
  roles: readonly ExerciseRole[];
  unilateral?: boolean;
  /** Equipment slugs, all required simultaneously. */
  equipment: readonly string[];
  stabilityDemand: StabilityDemand;
  loadingCharacteristic: LoadingCharacteristic;
  rangeOfMotionCharacteristic: RangeOfMotionCharacteristic;
  /** One-line summary shown in search results. */
  summary: string;
  relations: readonly KnowledgeTargetRelation[];
  structureRelations?: readonly KnowledgeStructureRelation[];
  /**
   * Structured, variation-specific form guidance keyed by slot. A slot holds
   * either one instruction or a list of short cues (used by `coaching_cues`).
   */
  form: Readonly<Record<string, string | readonly string[]>>;
  media?: readonly KnowledgeMediaFixture[];
}

/** Render headings for each structured guidance slot. */
export const FORM_HEADINGS: Readonly<Record<FormGuidanceStepKey, string>> = {
  setup: "Setup",
  body_position: "Body position",
  grip: "Grip and hand placement",
  start_position: "Starting position",
  movement_path: "Movement path",
  joint_path: "Joint path",
  range_of_motion: "Range of motion",
  tempo_and_control: "Tempo and control",
  breathing: "Breathing",
  bracing: "Bracing",
  end_position: "End position",
  common_mistakes: "Common mistakes",
  coaching_cues: "Coaching cues",
  intended_target: "Intended target",
  safety_notes: "Safety and limitations",
};

/**
 * Convert the authored `{key: body}` map into ordered guidance entries.
 *
 * Bodies are authored as plain strings so the fixture file stays readable; the
 * canonical slot order is applied here rather than by the caller, so two
 * authors cannot produce two different orderings of the same content.
 */
export function formSteps(
  entries: Readonly<Record<string, string | readonly string[]>>,
): Array<{ key: FormGuidanceStepKey; heading: string; body: string; position: number }> {
  const order = Object.keys(FORM_HEADINGS) as FormGuidanceStepKey[];
  return order
    .filter((key) => entries[key] !== undefined)
    .map((key, position) => {
      const raw = entries[key] as string | readonly string[];
      // Cue lists are joined here so the stored body stays a single searchable
      // string; the structured key is what a UI renders from.
      const body = Array.isArray(raw) ? raw.join(" · ") : (raw as string);
      return { key, heading: FORM_HEADINGS[key], body, position };
    });
}
