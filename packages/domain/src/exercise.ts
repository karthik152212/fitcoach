import type {
  BaseEntity,
  EquipmentId,
  ExerciseId,
  ExternalProvenance,
  MuscleId,
} from "./shared";

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

/** How strongly an exercise involves a muscle. */
export type MuscleRole = "primary_mover" | "secondary_mover" | "stabilizer";

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
}

export type ExerciseCategory = "compound" | "isolation" | "conditioning" | "mobility" | "other";

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
}
