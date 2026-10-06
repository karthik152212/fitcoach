import type {
  BaseEntity,
  CalendarDate,
  EquipmentId,
  ExerciseFormVersionId,
  ExerciseId,
  ExerciseMediaId,
  ExternalProvenance,
  MuscleId,
  Timestamp,
  UserExercisePreferenceId,
  UserId,
} from "./shared";
import type { MuscleEmphasis } from "./anatomy";
import type { MuscleStructureId } from "./shared";

export type MuscleGroup =
  | "chest"
  | "upper_back"
  | "lats"
  | "traps"
  | "front_delts"
  | "side_delts"
  | "rear_delts"
  | "biceps"
  | "triceps"
  | "forearms"
  | "quadriceps"
  | "hamstrings"
  | "glutes"
  | "adductors"
  | "calves"
  | "abdominals"
  | "obliques"
  | "lower_back"
  | "neck"
  | "other";

/** A skeletal muscle as tracked by the coverage/volume model. */
export interface Muscle extends BaseEntity {
  /** Canonical internal name, e.g. "pectoralis_major_sternal". */
  name: string;
  group: MuscleGroup;
  displayName?: string;
}

/** Every group the taxonomy recognises; mirrors the CHECK in the schema. */
export const MUSCLE_GROUPS: readonly MuscleGroup[] = [
  "chest",
  "upper_back",
  "lats",
  "traps",
  "front_delts",
  "side_delts",
  "rear_delts",
  "biceps",
  "triceps",
  "forearms",
  "quadriceps",
  "hamstrings",
  "glutes",
  "adductors",
  "calves",
  "abdominals",
  "obliques",
  "lower_back",
  "neck",
  "other",
] as const;

/**
 * How strongly an exercise involves a muscle (Phase 2 supersedes the original
 * three-value wording without renaming it, so Phase 1 rows and fixtures keep
 * their meaning):
 *
 *   * `primary_mover`   → PRIMARY target
 *   * `secondary_mover` → SECONDARY contributor
 *   * `supporting`      → SUPPORTING contributor
 *   * `stabilizer`      → STABILIZING
 *
 * These are descriptions of contribution, never claims of isolation. No role
 * means "this exercise works this muscle alone".
 */
export type MuscleRole = "primary_mover" | "secondary_mover" | "supporting" | "stabilizer";

/** Every role the catalog may use; mirrors the CHECK in the schema. */
export const MUSCLE_ROLES: readonly MuscleRole[] = [
  "primary_mover",
  "secondary_mover",
  "supporting",
  "stabilizer",
] as const;

/**
 * Directed relation exercise → muscle.
 *
 * Volume and coverage math must respect roles. contributionWeight is an
 * advisory fraction in [0, 1]; how (and whether) fractional contributions
 * count toward effective sets is decided by fitness-core, not stored data.
 */
export interface ExerciseMuscleRelation {
  exerciseId: ExerciseId;
  muscleId: MuscleId;
  role: MuscleRole;
  contributionWeight?: number;
  /** Optional bias of this whole-muscle relation (e.g. lengthened position). */
  emphasis?: MuscleEmphasis;
  /**
   * Reviewer's confidence in this relation, 0..1. Deliberately separate from
   * `contributionWeight`: "how much" and "how sure are we" are different
   * questions, and conflating them would let a confident guess masquerade as a
   * measured quantity.
   */
  confidence?: number;
  /** Reviewer note; rendered on explainability surfaces. */
  notes?: string;
  provenance?: ExternalProvenance;
}

/**
 * A relation narrowed to one head/region/portion of a muscle.
 *
 * This is a separate shape (and a separate table) rather than an extra column
 * on `ExerciseMuscleRelation` because an exercise frequently has BOTH a
 * whole-muscle relation and one or more structure-level contributions, and a
 * single composite key cannot express "one row per (muscle, role) plus several
 * rows per structure" without nullable-key gymnastics.
 *
 * `emphasis` is where head-specific reasoning lives: an incline dumbbell curl
 * has a biceps_brachii primary relation *and* a long-head structure
 * contribution. That is a bias, not an isolation, and the domain has no
 * vocabulary for isolation at all.
 */
export interface ExerciseMuscleStructureRelation {
  exerciseId: ExerciseId;
  muscleId: MuscleId;
  structureId: MuscleStructureId;
  role: MuscleRole;
  emphasis?: MuscleEmphasis;
  contributionWeight?: number;
  confidence?: number;
  notes?: string;
  provenance?: ExternalProvenance;
}

/**
 * A fully resolved targeting entry, as the fitness engines and the visual
 * layer consume it. This is a read model: repositories build it from the two
 * relation shapes above plus the muscle and structure catalogs.
 */
export interface ExerciseMuscleTarget {
  muscleId: MuscleId;
  muscleSlug: string;
  muscleDisplayName: string;
  muscleGroup: MuscleGroup;
  role: MuscleRole;
  /** Present when this entry is narrowed to a head/region/portion. */
  structureId?: MuscleStructureId;
  structureSlug?: string;
  structureDisplayName?: string;
  structureKind?: import("./anatomy").MuscleStructureKind;
  emphasis?: MuscleEmphasis;
  contributionWeight?: number;
  confidence?: number;
  notes?: string;
}

export type ExerciseCategory = "compound" | "isolation" | "conditioning" | "mobility" | "other";

export const EXERCISE_CATEGORIES: readonly ExerciseCategory[] = [
  "compound",
  "isolation",
  "conditioning",
  "mobility",
  "other",
] as const;

export type MovementPattern =
  | "horizontal_push"
  | "vertical_push"
  | "horizontal_pull"
  | "vertical_pull"
  | "squat"
  | "hinge"
  | "lunge"
  | "carry"
  | "core"
  | "rotation"
  | "conditioning"
  | "other";

export const MOVEMENT_PATTERNS: readonly MovementPattern[] = [
  "horizontal_push",
  "vertical_push",
  "horizontal_pull",
  "vertical_pull",
  "squat",
  "hinge",
  "lunge",
  "carry",
  "core",
  "rotation",
  "conditioning",
  "other",
] as const;

/**
 * Fine-grained movement/function classification (Phase 2).
 *
 * `MovementPattern` answers "which family is this in" (one value, enough for
 * coarse balance checks). `MovementFunction` answers "what joint action and at
 * what angle is this" and is multi-valued, because a movement genuinely is
 * several things at once — a wide-grip pulldown is a vertical pull AND a
 * shoulder adduction/extension AND an elbow flexion.
 */
export type MovementFunction =
  | "horizontal_press"
  | "incline_press"
  | "decline_press"
  | "vertical_press"
  | "dips"
  | "vertical_pull"
  | "vertical_push"
  | "horizontal_pull"
  | "straight_arm_pull"
  | "shoulder_abduction"
  | "shoulder_adduction"
  | "shoulder_flexion"
  | "shoulder_extension"
  | "elbow_flexion"
  | "elbow_extension"
  | "forearm_supination"
  | "forearm_pronation"
  | "squat"
  | "hinge"
  | "knee_extension"
  | "knee_flexion"
  | "hip_flexion"
  | "hip_extension"
  | "hip_abduction"
  | "hip_adduction"
  | "plantarflexion"
  | "trunk_flexion"
  | "trunk_extension"
  | "anti_extension"
  | "anti_rotation"
  | "lateral_flexion"
  | "shoulder_shrug"
  | "carry"
  | "locomotion";

export const MOVEMENT_FUNCTIONS: readonly MovementFunction[] = [
  "horizontal_press",
  "incline_press",
  "decline_press",
  "vertical_push",
  "dips",
  "vertical_pull",
  "vertical_push",
  "horizontal_pull",
  "straight_arm_pull",
  "shoulder_abduction",
  "shoulder_adduction",
  "shoulder_flexion",
  "shoulder_extension",
  "elbow_flexion",
  "elbow_extension",
  "forearm_supination",
  "forearm_pronation",
  "squat",
  "hinge",
  "knee_extension",
  "knee_flexion",
  "hip_flexion",
  "hip_extension",
  "hip_abduction",
  "hip_adduction",
  "plantarflexion",
  "trunk_flexion",
  "trunk_extension",
  "anti_extension",
  "anti_rotation",
  "lateral_flexion",
  "shoulder_shrug",
  "carry",
  "locomotion",
] as const;

/**
 * What an exercise is FOR inside a program (Phase 2, §9).
 *
 * Roles exist so a future planner can select exercises that serve distinct
 * purposes instead of "three back exercises". They are a labelling of intent,
 * not a ranking: an exercise may carry several roles (a Romanian deadlift is a
 * hinge, a hamstring knee-flexion movement and a lengthened-position emphasis).
 */
export type ExerciseRole =
  | "compound_movement"
  | "isolation_movement"
  | "primary_strength_movement"
  | "hypertrophy_movement"
  | "lengthened_position_emphasis"
  | "shortened_position_emphasis"
  | "horizontal_push"
  | "horizontal_pull"
  | "vertical_push"
  | "vertical_pull"
  | "upper_chest_press"
  | "lower_chest_press"
  | "lateral_delt_isolation"
  | "front_delt_press"
  | "upper_back_retraction"
  | "lower_trap_emphasis"
  | "upper_trap_emphasis"
  | "lat_emphasis_pull"
  | "hamstring_knee_flexion"
  | "knee_extension_movement"
  | "hip_extension_movement"
  | "hip_abduction_movement"
  | "calf_raising"
  | "core_anti_extension"
  | "core_rotation"
  | "accessory_movement";

export const EXERCISE_ROLES: readonly ExerciseRole[] = [
  "compound_movement",
  "isolation_movement",
  "primary_strength_movement",
  "hypertrophy_movement",
  "lengthened_position_emphasis",
  "shortened_position_emphasis",
  "horizontal_push",
  "horizontal_pull",
  "vertical_push",
  "vertical_pull",
  "upper_chest_press",
  "lower_chest_press",
  "lateral_delt_isolation",
  "front_delt_press",
  "upper_back_retraction",
  "lower_trap_emphasis",
  "upper_trap_emphasis",
  "lat_emphasis_pull",
  "hamstring_knee_flexion",
  "knee_extension_movement",
  "hip_extension_movement",
  "hip_abduction_movement",
  "calf_raising",
  "core_anti_extension",
  "core_rotation",
  "accessory_movement",
] as const;

/** How much whole-body control the movement demands. */
export type StabilityDemand = "high" | "moderate" | "low";

export const STABILITY_DEMANDS: readonly StabilityDemand[] = ["high", "moderate", "low"] as const;

/** The resistance characteristic of the exercise's loading path. */
export type LoadingCharacteristic =
  | "free_weight_multi_joint"
  | "free_weight_single_joint"
  | "machine_guided"
  | "cable_variable"
  | "cable_fixed"
  | "bodyweight_external_load"
  | "bodyweight_only"
  | "elastic_tension";

export const LOADING_CHARACTERISTICS: readonly LoadingCharacteristic[] = [
  "free_weight_multi_joint",
  "free_weight_single_joint",
  "machine_guided",
  "cable_variable",
  "cable_fixed",
  "bodyweight_external_load",
  "bodyweight_only",
  "elastic_tension",
] as const;

/**
 * Which end of the muscle's working range the exercise actually trains through.
 * This is the field that lets the engine reason about stretch emphasis without
 * ever claiming that a movement "isolates" a lengthened position.
 */
export type RangeOfMotionCharacteristic =
  | "full_stretch_to_squeeze"
  | "stretch_emphasised"
  | "shortened_emphasised"
  | "partial_rom";

export const RANGE_OF_MOTION_CHARACTERISTICS: readonly RangeOfMotionCharacteristic[] = [
  "full_stretch_to_squeeze",
  "stretch_emphasised",
  "shortened_emphasised",
  "partial_rom",
] as const;

/**
 * A template-level exercise definition. It is user-independent; filtering by
 * the equipment a specific user actually has happens in fitness-core.
 */
export interface Exercise extends BaseEntity {
  name: string;
  aliases?: readonly string[];
  category: ExerciseCategory;
  movementPattern?: MovementPattern;
  /**
   * Equipment pieces required to perform this exercise at all (all listed
   * items are required simultaneously).
   */
  requiredEquipment: readonly EquipmentId[];
  unilateral?: boolean;
  instructions?: string;
  /**
   * Provenance for third-party definitions/media. Never assume a license;
   * see docs/OPEN_SOURCE_AUDIT.md and data/provenance/THIRD_PARTY.md.
   */
  provenance?: ExternalProvenance;

  // ---------------------------------------------------------------------
  // Phase 2 — exercise variation identity and intelligence
  // ---------------------------------------------------------------------

  /**
   * Stable identity of the *variation*, not of the name. Two variations that
   * differ in grip width, stance or equipment are different exercises with
   * different form guidance, so they need different ids; a rename must not
   * change this value, because form guidance and media attach to it.
   *
   * Convention: `<movement-slug>:<variation-slug>`, e.g.
   * `lat_pulldown:wide_grip_pronated`.
   */
  variationKey?: string;
  /** Human label of the variation, e.g. "Wide-grip, pronated". */
  variationLabel?: string;
  /** Fine-grained joint actions; multi-valued by nature. */
  movementFunctions?: readonly MovementFunction[];
  /** What the exercise is for in a program. */
  roles?: readonly ExerciseRole[];
  stabilityDemand?: StabilityDemand;
  loadingCharacteristic?: LoadingCharacteristic;
  rangeOfMotionCharacteristic?: RangeOfMotionCharacteristic;
  /**
   * Stable version of the *knowledge* attached to this exercise. Bumped by the
   * catalog import when targeting/form data is revised, so a recorded
   * selection can state which knowledge version produced it. Exercise identity
   * itself never changes.
   */
  knowledgeVersion?: number;
}

// ---------------------------------------------------------------------------
// Form guidance (Phase 2, §24–§25)
// ---------------------------------------------------------------------------

/**
 * The structured slots every exercise variation must eventually carry. Ordered
 * as a person performs and reviews the movement. Guidance is stored per key
 * (not as one paragraph) so a future UI can render quick instructions, numbered
 * steps, video captions, cues or a searchable section independently.
 */
export type FormGuidanceStepKey =
  | "setup"
  | "body_position"
  | "grip"
  | "start_position"
  | "movement_path"
  | "joint_path"
  | "range_of_motion"
  | "tempo_and_control"
  | "breathing"
  | "bracing"
  | "end_position"
  | "common_mistakes"
  | "coaching_cues"
  | "intended_target"
  | "safety_notes";

export const FORM_GUIDANCE_STEP_KEYS: readonly FormGuidanceStepKey[] = [
  "setup",
  "body_position",
  "grip",
  "start_position",
  "movement_path",
  "joint_path",
  "range_of_motion",
  "tempo_and_control",
  "breathing",
  "bracing",
  "end_position",
  "common_mistakes",
  "coaching_cues",
  "intended_target",
  "safety_notes",
] as const;

/**
 * Keys without which a form version is not publishable. `bracing` is excluded
 * because it is genuinely not applicable to every variation (a curl has
 * nothing to brace); the rest describe the movement itself.
 */
export const REQUIRED_FORM_GUIDANCE_KEYS: readonly FormGuidanceStepKey[] = [
  "setup",
  "body_position",
  "grip",
  "start_position",
  "movement_path",
  "range_of_motion",
  "tempo_and_control",
  "common_mistakes",
  "coaching_cues",
  "intended_target",
] as const;

export interface FormGuidanceStep {
  key: FormGuidanceStepKey;
  heading: string;
  /** The instruction itself; concise enough to render inline. */
  body: string;
  /** Render order within the version. */
  position: number;
}

export type FormGuidanceStatus = "draft" | "active" | "retired";

export const FORM_GUIDANCE_STATUSES: readonly FormGuidanceStatus[] = [
  "draft",
  "active",
  "retired",
] as const;

/**
 * One version of the form guidance for one exercise variation.
 *
 * Versioning is the mechanism that lets instructional content improve without
 * corrupting history: a new version is a new row, exercise identity is stable,
 * and anything that recorded a selection keeps the version it was explained
 * from (see `docs/EXERCISE_INTELLIGENCE.md` §media versioning).
 */
export interface ExerciseFormVersion extends BaseEntity {
  id: ExerciseFormVersionId;
  exerciseId: ExerciseId;
  version: number;
  status: FormGuidanceStatus;
  /** User-local day from which this version is the published guidance. */
  effectiveFrom: CalendarDate;
  /** Set when superseded; the row itself is never rewritten. */
  retiredOn?: CalendarDate;
  /** Reviewer note explaining what changed and why. */
  reviewNotes?: string;
  provenance?: ExternalProvenance;
  steps: readonly FormGuidanceStep[];
}

// ---------------------------------------------------------------------------
// Instructional media (Phase 2, §26–§30)
// ---------------------------------------------------------------------------

export type ExerciseMediaType =
  | "instructional_video"
  | "still_image"
  | "animation"
  | "anatomical_illustration"
  | "form_overlay";

export const EXERCISE_MEDIA_TYPES: readonly ExerciseMediaType[] = [
  "instructional_video",
  "still_image",
  "animation",
  "anatomical_illustration",
  "form_overlay",
] as const;

/** Optional extra angles; never every angle is required for every exercise. */
export type ExerciseMediaAngle =
  | "primary"
  | "front"
  | "side"
  | "rear"
  | "grip_close_up"
  | "movement_path";

export const EXERCISE_MEDIA_ANGLES: readonly ExerciseMediaAngle[] = [
  "primary",
  "front",
  "side",
  "rear",
  "grip_close_up",
  "movement_path",
] as const;

/**
 * Structured overlays drawn on top of instructional media. They are derived
 * from exercise metadata by the renderer, never baked into the file, so the
 * knowledge stays queryable when the asset is gone.
 */
export type FormOverlayKind =
  | "target_muscle_highlight"
  | "movement_arrow"
  | "movement_path"
  | "joint_path"
  | "grip_marker"
  | "setup_marker"
  | "rom_indicator";

export const FORM_OVERLAY_KINDS: readonly FormOverlayKind[] = [
  "target_muscle_highlight",
  "movement_arrow",
  "movement_path",
  "joint_path",
  "grip_marker",
  "setup_marker",
  "rom_indicator",
] as const;

/**
 * Metadata for one instructional media asset. Storage holds an object-storage
 * key only: no binary ever enters the relational database
 * (docs/ARCHITECTURE.md §13). Phase 2 stores and serves metadata only — no
 * hosting, generation or transcoding happens here.
 */
export interface ExerciseMediaReference extends BaseEntity {
  id: ExerciseMediaId;
  exerciseId: ExerciseId;
  mediaType: ExerciseMediaType;
  angle: ExerciseMediaAngle;
  /** Object-storage key. */
  storageKey: string;
  /** Instructional core demonstration target is ~10–30 s; longer assets are allowed. */
  durationSeconds?: number;
  contentVersion: number;
  status: "active" | "retired";
  overlays: readonly FormOverlayKind[];
  /** NULL for first-party FitCoach-created content. */
  provenance?: ExternalProvenance;
  /** True when the licence/terms demand visible attribution. */
  attributionRequired: boolean;
  attributionText?: string;
  /** Version of the imported asset, when the source publishes versions. */
  importedVersion?: string;
  effectiveFrom: CalendarDate;
}

// ---------------------------------------------------------------------------
// User exercise preferences (Phase 2, §17/§37)
// ---------------------------------------------------------------------------

/**
 * How the user feels about an exercise. `excluded` is stronger than
 * `disliked`: it removes the exercise from selection unless the user asks for
 * it, while `disliked` penalises it and is overridable by a strong reason.
 */
export type ExercisePreferenceKind = "preferred" | "neutral" | "disliked" | "excluded";

export const EXERCISE_PREFERENCE_KINDS: readonly ExercisePreferenceKind[] = [
  "preferred",
  "neutral",
  "disliked",
  "excluded",
] as const;

/**
 * A user→exercise preference with a validity interval, so changing a
 * preference today cannot rewrite what an old workout meant.
 */
export interface UserExercisePreference extends BaseEntity {
  id: UserExercisePreferenceId;
  userId: UserId;
  exerciseId: ExerciseId;
  preference: ExercisePreferenceKind;
  reason?: string;
  validFrom: CalendarDate;
  validTo?: CalendarDate;
  recordedAt: Timestamp;
}
