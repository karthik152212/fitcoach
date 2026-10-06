import type {
  ExerciseCategory,
  ExerciseMuscleTarget,
  ExerciseRole,
  LoadingCharacteristic,
  MovementFunction,
  MovementPattern,
  MuscleGroup,
  MuscleStructureKind,
  RangeOfMotionCharacteristic,
  StabilityDemand,
} from "@fitcoach/domain";

/**
 * The read model the fitness-core engines consume (Phase 2).
 *
 * This shape is defined here, in the deterministic package, and not imported
 * from `packages/db`: the engines must stay pure and testable without a
 * database. The repository's `ExerciseKnowledgeRecord` is structurally
 * compatible with it, so no adapter or mapping is needed at the boundary.
 */
export interface ExerciseKnowledge {
  id: string;
  slug: string;
  name: string;
  aliases?: readonly string[];
  /** Short human description shown in search results and explanations. */
  summary?: string;
  category: ExerciseCategory;
  movementPattern?: MovementPattern;
  variationKey?: string;
  variationLabel?: string;
  unilateral?: boolean;
  /** All listed equipment is required simultaneously. */
  requiredEquipmentIds: readonly string[];
  stabilityDemand?: StabilityDemand;
  loadingCharacteristic?: LoadingCharacteristic;
  rangeOfMotionCharacteristic?: RangeOfMotionCharacteristic;
  movementFunctions: readonly MovementFunction[];
  primaryMovementFunction?: MovementFunction;
  roles: readonly ExerciseRole[];
  /**
   * Resolved targeting: whole-muscle entries and head/region entries, already
   * merged by the persistence layer. Structure entries always carry their
   * parent muscle.
   */
  targets: readonly ExerciseMuscleTarget[];
  /** Version of the attached knowledge; bumped by catalog imports. */
  knowledgeVersion: number;
}

export interface MuscleKnowledge {
  id: string;
  slug: string;
  name: string;
  displayName: string;
  group: MuscleGroup;
  isActive?: boolean;
}

export interface MuscleStructureKnowledge {
  id: string;
  muscleId: string;
  slug: string;
  name: string;
  displayName: string;
  kind: MuscleStructureKind;
  isActive?: boolean;
}

/** Everything the engines need to reason about the taxonomy. */
export interface MuscleTaxonomy {
  muscles: readonly MuscleKnowledge[];
  structures: readonly MuscleStructureKnowledge[];
}

/**
 * Human-readable role wording reused by every explanation surface. Keeping it
 * in one place is what stops a rationale from quietly saying "isolates".
 */
export const MUSCLE_ROLE_LABELS: Readonly<Record<string, string>> = {
  primary_mover: "primary target",
  secondary_mover: "secondary contributor",
  supporting: "supporting contributor",
  stabilizer: "stabilizing",
};

export const EMPHASIS_LABELS: Readonly<Record<string, string>> = {
  lengthened_position: "lengthened-position emphasis",
  shortened_position: "shortened-position emphasis",
  structure_biased: "region-biased contribution",
  upper_range_bias: "upper-range bias",
  lower_range_bias: "lower-range bias",
  eccentric_emphasis: "eccentric emphasis",
};

/**
 * The vocabulary deliberately contains no word for isolation. Rendering is
 * built from role + emphasis only, so no code path can produce a false claim.
 */
export function describeTargeting(
  target: Pick<ExerciseMuscleTarget, "muscleDisplayName" | "role" | "structureDisplayName" | "emphasis">,
): string {
  const role = MUSCLE_ROLE_LABELS[target.role] ?? target.role;
  const region = target.structureDisplayName ? ` (${target.structureDisplayName})` : "";
  const emphasis = target.emphasis ? ` — ${EMPHASIS_LABELS[target.emphasis] ?? target.emphasis}` : "";
  return `${target.muscleDisplayName}${region}: ${role}${emphasis}`;
}
