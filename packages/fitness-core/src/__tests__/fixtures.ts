/**
 * Hand-authored fixtures for the fitness-core Phase 2 unit tests.
 *
 * These are NOT the seeded catalog (`packages/db/src/seed`). fitness-core is a
 * pure package with no persistence dependency and no test-framework fixtures;
 * the unit tests therefore carry their own small, explicit catalog so that a
 * failure points at a specific modelled fact rather than at whatever the seed
 * happens to contain today.
 *
 * The catalog is deliberately shaped to exercise the axes the engines reason
 * about: biceps and triceps heads, complementary vs duplicating variations,
 * equipment conflicts (cable vs dumbbell vs machine), and movement-pattern
 * differences that make two exercises hitting the same muscle *not*
 * substitutes for each other.
 *
 * Nothing here claims isolation. Every relation is a role plus an advisory
 * weight; heads are described as biased, never isolated.
 */

import type {
  Exercise,
  ExerciseCategory,
  ExerciseMuscleRelation,
  ExerciseMuscleTarget,
  ExerciseRole,
  LoadingCharacteristic,
  MovementFunction,
  MovementPattern,
  MuscleEmphasis,
  MuscleGroup,
  MuscleRole,
  MuscleStructureKind,
  RangeOfMotionCharacteristic,
  StabilityDemand,
} from "@fitcoach/domain";
import type { ExerciseKnowledge, MuscleTaxonomy } from "../knowledgeCatalog";

export const muscleId = (slug: string): string => `mus_${slug}`;
export const structureId = (muscle: string, structure: string): string => `st_${muscle}_${structure}`;
export const exerciseId = (slug: string): string => `ex_${slug}`;

export interface TargetSpec {
  muscle: string;
  display: string;
  group: MuscleGroup;
  role: MuscleRole;
  structure?: { slug: string; display: string; kind: MuscleStructureKind };
  emphasis?: MuscleEmphasis;
  weight?: number;
  confidence?: number;
}

export function target(spec: TargetSpec): ExerciseMuscleTarget {
  return {
    muscleId: muscleId(spec.muscle),
    muscleSlug: spec.muscle,
    muscleDisplayName: spec.display,
    muscleGroup: spec.group,
    role: spec.role,
    ...(spec.structure
      ? {
          structureId: structureId(spec.muscle, spec.structure.slug),
          structureSlug: spec.structure.slug,
          structureDisplayName: spec.structure.display,
          structureKind: spec.structure.kind,
        }
      : {}),
    ...(spec.emphasis !== undefined ? { emphasis: spec.emphasis } : {}),
    contributionWeight: spec.weight ?? 0.6,
    confidence: spec.confidence ?? 0.8,
  };
}

export interface ExerciseSpec {
  slug: string;
  name: string;
  category: ExerciseCategory;
  movementPattern?: MovementPattern;
  primaryMovementFunction: MovementFunction;
  movementFunctions: readonly MovementFunction[];
  roles: readonly ExerciseRole[];
  equipment: readonly string[];
  targets: readonly ExerciseMuscleTarget[];
  stabilityDemand?: StabilityDemand;
  loadingCharacteristic?: LoadingCharacteristic;
  rangeOfMotionCharacteristic?: RangeOfMotionCharacteristic;
  unilateral?: boolean;
  aliases?: readonly string[];
  variationKey?: string;
  variationLabel?: string;
}

export function ex(spec: ExerciseSpec): ExerciseKnowledge {
  return {
    id: exerciseId(spec.slug),
    slug: spec.slug,
    name: spec.name,
    ...(spec.aliases ? { aliases: spec.aliases } : {}),
    category: spec.category,
    ...(spec.movementPattern ? { movementPattern: spec.movementPattern } : {}),
    variationKey: spec.variationKey ?? `${spec.primaryMovementFunction}:${spec.slug}`,
    variationLabel: spec.variationLabel ?? spec.name,
    ...(spec.unilateral !== undefined ? { unilateral: spec.unilateral } : {}),
    requiredEquipmentIds: spec.equipment,
    stabilityDemand: spec.stabilityDemand ?? "moderate",
    loadingCharacteristic: spec.loadingCharacteristic ?? "machine_guided",
    rangeOfMotionCharacteristic: spec.rangeOfMotionCharacteristic ?? "full_stretch_to_squeeze",
    movementFunctions: [spec.primaryMovementFunction, ...spec.movementFunctions.filter((fn) => fn !== spec.primaryMovementFunction)],
    primaryMovementFunction: spec.primaryMovementFunction,
    roles: spec.roles,
    targets: spec.targets,
    knowledgeVersion: 1,
  };
}

// --- muscles used by the fixtures ------------------------------------------

export const TAXONOMY: MuscleTaxonomy = {
  muscles: [
    { id: muscleId("biceps_brachii"), slug: "biceps_brachii", name: "biceps_brachii", displayName: "Biceps", group: "biceps" },
    { id: muscleId("brachialis"), slug: "brachialis", name: "brachialis", displayName: "Brachialis", group: "biceps" },
    { id: muscleId("brachioradialis"), slug: "brachioradialis", name: "brachioradialis", displayName: "Brachioradialis", group: "biceps" },
    { id: muscleId("triceps_brachii"), slug: "triceps_brachii", name: "triceps_brachii", displayName: "Triceps", group: "triceps" },
    { id: muscleId("deltoid_lateral"), slug: "deltoid_lateral", name: "deltoid_lateral", displayName: "Lateral deltoid", group: "side_delts" },
    { id: muscleId("deltoid_posterior"), slug: "deltoid_posterior", name: "deltoid_posterior", displayName: "Rear deltoid", group: "rear_delts" },
    { id: muscleId("trapezius"), slug: "trapezius", name: "trapezius", displayName: "Trapezius", group: "traps" },
    { id: muscleId("rhomboids"), slug: "rhomboids", name: "rhomboids", displayName: "Rhomboids", group: "upper_back" },
    { id: muscleId("latissimus_dorsi"), slug: "latissimus_dorsi", name: "latissimus_dorsi", displayName: "Lats", group: "lats" },
    { id: muscleId("spinal_erectors"), slug: "spinal_erectors", name: "spinal_erectors", displayName: "Spinal erectors", group: "lower_back" },
    { id: muscleId("hamstrings"), slug: "hamstrings", name: "hamstrings", displayName: "Hamstrings", group: "hamstrings" },
    { id: muscleId("quadriceps"), slug: "quadriceps", name: "quadriceps", displayName: "Quadriceps", group: "quadriceps" },
  ],
  structures: [
    { id: structureId("biceps_brachii", "long_head"), muscleId: muscleId("biceps_brachii"), slug: "long_head", name: "long_head", displayName: "Long head", kind: "head" },
    { id: structureId("biceps_brachii", "short_head"), muscleId: muscleId("biceps_brachii"), slug: "short_head", name: "short_head", displayName: "Short head", kind: "head" },
    { id: structureId("triceps_brachii", "long_head"), muscleId: muscleId("triceps_brachii"), slug: "long_head", name: "long_head", displayName: "Long head", kind: "head" },
    { id: structureId("triceps_brachii", "lateral_head"), muscleId: muscleId("triceps_brachii"), slug: "lateral_head", name: "lateral_head", displayName: "Lateral head", kind: "head" },
    { id: structureId("triceps_brachii", "medial_head"), muscleId: muscleId("triceps_brachii"), slug: "medial_head", name: "medial_head", displayName: "Medial head", kind: "head" },
    { id: structureId("trapezius", "upper"), muscleId: muscleId("trapezius"), slug: "upper", name: "upper", displayName: "Upper traps", kind: "region" },
    { id: structureId("trapezius", "lower"), muscleId: muscleId("trapezius"), slug: "lower", name: "lower", displayName: "Lower traps", kind: "region" },
  ],
};

// --- biceps -----------------------------------------------------------------

const LONG_HEAD = { slug: "long_head", display: "Long head", kind: "head" as const };
const SHORT_HEAD = { slug: "short_head", display: "Short head", kind: "head" as const };

export const BARBELL_CURL = ex({
  slug: "barbell_curl",
  name: "Barbell Curl",
  aliases: ["Standing Barbell Curl"],
  category: "isolation",
  primaryMovementFunction: "elbow_flexion",
  movementFunctions: ["elbow_flexion", "shoulder_flexion"],
  roles: ["isolation_movement", "hypertrophy_movement", "lengthened_position_emphasis"],
  equipment: ["barbell"],
  stabilityDemand: "moderate",
  loadingCharacteristic: "free_weight_single_joint",
  rangeOfMotionCharacteristic: "full_stretch_to_squeeze",
  targets: [
    target({
      muscle: "biceps_brachii",
      display: "Biceps",
      group: "biceps",
      role: "primary_mover",
      structure: LONG_HEAD,
      emphasis: "lengthened_position",
      weight: 0.85,
      confidence: 0.8,
    }),
    target({ muscle: "biceps_brachii", display: "Biceps", group: "biceps", role: "primary_mover", weight: 0.6, confidence: 0.85 }),
    target({ muscle: "brachialis", display: "Brachialis", group: "biceps", role: "secondary_mover", weight: 0.4, confidence: 0.6 }),
    target({ muscle: "brachioradialis", display: "Brachioradialis", group: "biceps", role: "secondary_mover", weight: 0.3, confidence: 0.55 }),
  ],
});

export const INCLINE_DUMBBELL_CURL = ex({
  slug: "incline_dumbbell_curl",
  name: "Incline Dumbbell Curl",
  category: "isolation",
  primaryMovementFunction: "elbow_flexion",
  movementFunctions: ["elbow_flexion", "shoulder_extension"],
  roles: ["isolation_movement", "lengthened_position_emphasis", "hypertrophy_movement"],
  equipment: ["dumbbells", "adjustable_bench"],
  stabilityDemand: "low",
  loadingCharacteristic: "free_weight_single_joint",
  rangeOfMotionCharacteristic: "stretch_emphasised",
  targets: [
    target({
      muscle: "biceps_brachii",
      display: "Biceps",
      group: "biceps",
      role: "primary_mover",
      structure: LONG_HEAD,
      emphasis: "lengthened_position",
      weight: 0.95,
      confidence: 0.8,
    }),
    target({ muscle: "biceps_brachii", display: "Biceps", group: "biceps", role: "primary_mover", weight: 0.55, confidence: 0.8 }),
    target({ muscle: "brachialis", display: "Brachialis", group: "biceps", role: "secondary_mover", weight: 0.35, confidence: 0.55 }),
  ],
});

export const HAMMER_CURL = ex({
  slug: "hammer_curl",
  name: "Hammer Curl",
  category: "isolation",
  primaryMovementFunction: "elbow_flexion",
  movementFunctions: ["elbow_flexion", "forearm_supination"],
  roles: ["isolation_movement", "hypertrophy_movement"],
  equipment: ["dumbbells"],
  stabilityDemand: "low",
  loadingCharacteristic: "free_weight_single_joint",
  rangeOfMotionCharacteristic: "full_stretch_to_squeeze",
  targets: [
    target({
      muscle: "biceps_brachii",
      display: "Biceps",
      group: "biceps",
      role: "primary_mover",
      structure: SHORT_HEAD,
      emphasis: "structure_biased",
      weight: 0.7,
      confidence: 0.75,
    }),
    target({ muscle: "biceps_brachii", display: "Biceps", group: "biceps", role: "primary_mover", weight: 0.6, confidence: 0.85 }),
    target({ muscle: "brachialis", display: "Brachialis", group: "biceps", role: "secondary_mover", weight: 0.65, confidence: 0.75 }),
    target({ muscle: "brachioradialis", display: "Brachioradialis", group: "biceps", role: "secondary_mover", weight: 0.6, confidence: 0.7 }),
  ],
});

export const PREACHER_CURL = ex({
  slug: "preacher_curl",
  name: "Preacher Curl",
  category: "isolation",
  primaryMovementFunction: "elbow_flexion",
  movementFunctions: ["elbow_flexion"],
  roles: ["isolation_movement", "shortened_position_emphasis"],
  equipment: ["barbell", "bench"],
  stabilityDemand: "low",
  loadingCharacteristic: "free_weight_single_joint",
  rangeOfMotionCharacteristic: "shortened_emphasised",
  targets: [
    target({
      muscle: "biceps_brachii",
      display: "Biceps",
      group: "biceps",
      role: "primary_mover",
      structure: SHORT_HEAD,
      emphasis: "shortened_position",
      weight: 0.75,
      confidence: 0.7,
    }),
    target({ muscle: "biceps_brachii", display: "Biceps", group: "biceps", role: "primary_mover", weight: 0.6, confidence: 0.85 }),
  ],
});

export const CABLE_CURL = ex({
  slug: "cable_curl",
  name: "Cable Curl",
  category: "isolation",
  primaryMovementFunction: "elbow_flexion",
  movementFunctions: ["elbow_flexion"],
  roles: ["isolation_movement", "hypertrophy_movement"],
  equipment: ["cable_machine"],
  stabilityDemand: "low",
  loadingCharacteristic: "cable_variable",
  rangeOfMotionCharacteristic: "full_stretch_to_squeeze",
  targets: [
    target({ muscle: "biceps_brachii", display: "Biceps", group: "biceps", role: "primary_mover", weight: 0.85, confidence: 0.85 }),
    target({ muscle: "brachialis", display: "Brachialis", group: "biceps", role: "secondary_mover", weight: 0.45, confidence: 0.6 }),
  ],
});

// --- triceps ----------------------------------------------------------------

const T_LONG_HEAD = { slug: "long_head", display: "Long head", kind: "head" as const };
const T_LATERAL_HEAD = { slug: "lateral_head", display: "Lateral head", kind: "head" as const };
const T_MEDIAL_HEAD = { slug: "medial_head", display: "Medial head", kind: "head" as const };

export const OVERHEAD_CABLE_EXTENSION = ex({
  slug: "overhead_cable_extension",
  name: "Overhead Cable Extension",
  category: "isolation",
  primaryMovementFunction: "elbow_extension",
  movementFunctions: ["elbow_extension", "shoulder_flexion"],
  roles: ["isolation_movement", "lengthened_position_emphasis", "hypertrophy_movement"],
  equipment: ["cable_machine"],
  stabilityDemand: "moderate",
  loadingCharacteristic: "cable_variable",
  rangeOfMotionCharacteristic: "stretch_emphasised",
  targets: [
    target({
      muscle: "triceps_brachii",
      display: "Triceps",
      group: "triceps",
      role: "primary_mover",
      structure: T_LONG_HEAD,
      emphasis: "lengthened_position",
      weight: 0.9,
      confidence: 0.8,
    }),
    target({ muscle: "triceps_brachii", display: "Triceps", group: "triceps", role: "primary_mover", weight: 0.6, confidence: 0.85 }),
  ],
});

export const SKULL_CRUSHER = ex({
  slug: "skull_crusher",
  name: "Lying EZ-Bar Triceps Extension",
  category: "isolation",
  primaryMovementFunction: "elbow_extension",
  movementFunctions: ["elbow_extension"],
  roles: ["isolation_movement", "lengthened_position_emphasis"],
  equipment: ["ez_bar", "adjustable_bench"],
  stabilityDemand: "low",
  loadingCharacteristic: "free_weight_single_joint",
  rangeOfMotionCharacteristic: "stretch_emphasised",
  targets: [
    target({
      muscle: "triceps_brachii",
      display: "Triceps",
      group: "triceps",
      role: "primary_mover",
      structure: T_LONG_HEAD,
      emphasis: "lengthened_position",
      weight: 0.85,
      confidence: 0.75,
    }),
    target({ muscle: "triceps_brachii", display: "Triceps", group: "triceps", role: "primary_mover", weight: 0.6, confidence: 0.85 }),
  ],
});

export const ROPE_PUSHDOWN = ex({
  slug: "rope_pushdown",
  name: "Rope Triceps Pushdown",
  category: "isolation",
  primaryMovementFunction: "elbow_extension",
  movementFunctions: ["elbow_extension"],
  roles: ["isolation_movement", "shortened_position_emphasis", "hypertrophy_movement"],
  equipment: ["cable_machine"],
  stabilityDemand: "low",
  loadingCharacteristic: "cable_fixed",
  rangeOfMotionCharacteristic: "shortened_emphasised",
  targets: [
    target({
      muscle: "triceps_brachii",
      display: "Triceps",
      group: "triceps",
      role: "primary_mover",
      structure: T_LATERAL_HEAD,
      emphasis: "shortened_position",
      weight: 0.7,
      confidence: 0.7,
    }),
    target({
      muscle: "triceps_brachii",
      display: "Triceps",
      group: "triceps",
      role: "primary_mover",
      structure: T_MEDIAL_HEAD,
      emphasis: "shortened_position",
      weight: 0.55,
      confidence: 0.6,
    }),
    target({ muscle: "triceps_brachii", display: "Triceps", group: "triceps", role: "primary_mover", weight: 0.8, confidence: 0.85 }),
  ],
});

export const CLOSE_GRIP_BENCH_PRESS = ex({
  slug: "close_grip_bench_press",
  name: "Close-Grip Bench Press",
  category: "compound",
  movementPattern: "horizontal_push",
  primaryMovementFunction: "horizontal_press",
  movementFunctions: ["horizontal_press", "elbow_extension"],
  roles: ["compound_movement", "hypertrophy_movement", "lower_chest_press"],
  equipment: ["barbell", "adjustable_bench"],
  stabilityDemand: "moderate",
  loadingCharacteristic: "free_weight_multi_joint",
  rangeOfMotionCharacteristic: "full_stretch_to_squeeze",
  targets: [
    target({ muscle: "triceps_brachii", display: "Triceps", group: "triceps", role: "secondary_mover", structure: T_LATERAL_HEAD, emphasis: "structure_biased", weight: 0.5, confidence: 0.6 }),
    target({ muscle: "triceps_brachii", display: "Triceps", group: "triceps", role: "secondary_mover", weight: 0.65, confidence: 0.7 }),
  ],
});

// --- shoulders --------------------------------------------------------------

export const CABLE_LATERAL_RAISE = ex({
  slug: "cable_lateral_raise",
  name: "Cable Lateral Raise",
  category: "isolation",
  primaryMovementFunction: "shoulder_abduction",
  movementFunctions: ["shoulder_abduction"],
  roles: ["lateral_delt_isolation", "isolation_movement", "hypertrophy_movement"],
  equipment: ["cable_machine"],
  stabilityDemand: "low",
  loadingCharacteristic: "cable_variable",
  rangeOfMotionCharacteristic: "full_stretch_to_squeeze",
  targets: [
    target({ muscle: "deltoid_lateral", display: "Lateral deltoid", group: "side_delts", role: "primary_mover", weight: 0.95, confidence: 0.9 }),
    target({ muscle: "trapezius", display: "Trapezius", group: "traps", role: "supporting", structure: { slug: "upper", display: "Upper traps", kind: "region" }, weight: 0.25, confidence: 0.6 }),
  ],
});

export const DUMBBELL_LATERAL_RAISE = ex({
  slug: "dumbbell_lateral_raise",
  name: "Dumbbell Lateral Raise",
  aliases: ["Lateral Raise"],
  category: "isolation",
  primaryMovementFunction: "shoulder_abduction",
  movementFunctions: ["shoulder_abduction"],
  roles: ["lateral_delt_isolation", "isolation_movement", "hypertrophy_movement"],
  equipment: ["dumbbells"],
  stabilityDemand: "low",
  loadingCharacteristic: "free_weight_single_joint",
  rangeOfMotionCharacteristic: "full_stretch_to_squeeze",
  targets: [
    target({ muscle: "deltoid_lateral", display: "Lateral deltoid", group: "side_delts", role: "primary_mover", weight: 0.9, confidence: 0.85 }),
    target({ muscle: "trapezius", display: "Trapezius", group: "traps", role: "supporting", structure: { slug: "upper", display: "Upper traps", kind: "region" }, weight: 0.3, confidence: 0.6 }),
  ],
});

export const MACHINE_LATERAL_RAISE = ex({
  slug: "machine_lateral_raise",
  name: "Machine Lateral Raise",
  category: "isolation",
  primaryMovementFunction: "shoulder_abduction",
  movementFunctions: ["shoulder_abduction"],
  roles: ["lateral_delt_isolation", "isolation_movement"],
  equipment: ["lateral_raise_machine"],
  stabilityDemand: "low",
  loadingCharacteristic: "machine_guided",
  rangeOfMotionCharacteristic: "partial_rom",
  targets: [
    target({ muscle: "deltoid_lateral", display: "Lateral deltoid", group: "side_delts", role: "primary_mover", weight: 0.7, confidence: 0.65 }),
  ],
});

export const FACE_PULL = ex({
  slug: "face_pull",
  name: "Face Pull",
  category: "isolation",
  primaryMovementFunction: "shoulder_extension",
  movementFunctions: ["shoulder_extension", "horizontal_pull"],
  roles: ["upper_back_retraction", "isolation_movement"],
  equipment: ["cable_machine"],
  stabilityDemand: "low",
  loadingCharacteristic: "cable_variable",
  rangeOfMotionCharacteristic: "full_stretch_to_squeeze",
  targets: [
    target({ muscle: "deltoid_posterior", display: "Rear deltoid", group: "rear_delts", role: "primary_mover", weight: 0.85, confidence: 0.8 }),
    target({ muscle: "trapezius", display: "Trapezius", group: "traps", role: "secondary_mover", structure: { slug: "lower", display: "Lower traps", kind: "region" }, weight: 0.5, confidence: 0.7 }),
    target({ muscle: "trapezius", display: "Trapezius", group: "traps", role: "secondary_mover", structure: { slug: "upper", display: "Upper traps", kind: "region" }, weight: 0.45, confidence: 0.7 }),
    target({ muscle: "rhomboids", display: "Rhomboids", group: "upper_back", role: "secondary_mover", weight: 0.55, confidence: 0.7 }),
  ],
});

// --- back -------------------------------------------------------------------

export const LAT_PULLDOWN = ex({
  slug: "lat_pulldown",
  name: "Lat Pulldown",
  category: "compound",
  movementPattern: "vertical_pull",
  primaryMovementFunction: "vertical_pull",
  movementFunctions: ["vertical_pull", "elbow_flexion"],
  roles: ["vertical_pull", "lat_emphasis_pull", "compound_movement", "hypertrophy_movement"],
  equipment: ["lat_pulldown_machine"],
  stabilityDemand: "low",
  loadingCharacteristic: "machine_guided",
  rangeOfMotionCharacteristic: "full_stretch_to_squeeze",
  targets: [
    target({ muscle: "latissimus_dorsi", display: "Lats", group: "lats", role: "primary_mover", weight: 0.9, confidence: 0.9 }),
    target({ muscle: "biceps_brachii", display: "Biceps", group: "biceps", role: "secondary_mover", weight: 0.4, confidence: 0.75 }),
  ],
});

export const PULL_UP = ex({
  slug: "pull_up",
  name: "Pull-Up",
  category: "compound",
  movementPattern: "vertical_pull",
  primaryMovementFunction: "vertical_pull",
  movementFunctions: ["vertical_pull", "elbow_flexion"],
  roles: ["vertical_pull", "lat_emphasis_pull", "compound_movement", "primary_strength_movement"],
  equipment: ["pull_up_bar"],
  stabilityDemand: "high",
  loadingCharacteristic: "bodyweight_external_load",
  rangeOfMotionCharacteristic: "stretch_emphasised",
  targets: [
    target({ muscle: "latissimus_dorsi", display: "Lats", group: "lats", role: "primary_mover", weight: 0.95, confidence: 0.9 }),
    target({ muscle: "biceps_brachii", display: "Biceps", group: "biceps", role: "secondary_mover", weight: 0.45, confidence: 0.8 }),
  ],
});

export const BARBELL_ROW = ex({
  slug: "barbell_row",
  name: "Barbell Row",
  category: "compound",
  movementPattern: "horizontal_pull",
  primaryMovementFunction: "horizontal_pull",
  movementFunctions: ["horizontal_pull", "shoulder_extension", "elbow_flexion"],
  roles: ["horizontal_pull", "upper_back_retraction", "compound_movement"],
  equipment: ["barbell"],
  stabilityDemand: "high",
  loadingCharacteristic: "free_weight_multi_joint",
  rangeOfMotionCharacteristic: "full_stretch_to_squeeze",
  targets: [
    target({ muscle: "latissimus_dorsi", display: "Lats", group: "lats", role: "secondary_mover", weight: 0.5, confidence: 0.7 }),
    target({ muscle: "rhomboids", display: "Rhomboids", group: "upper_back", role: "primary_mover", weight: 0.8, confidence: 0.8 }),
    target({ muscle: "trapezius", display: "Trapezius", group: "traps", role: "secondary_mover", structure: { slug: "upper", display: "Upper traps", kind: "region" }, weight: 0.5, confidence: 0.75 }),
    target({ muscle: "deltoid_posterior", display: "Rear deltoid", group: "rear_delts", role: "secondary_mover", weight: 0.4, confidence: 0.65 }),
    target({ muscle: "biceps_brachii", display: "Biceps", group: "biceps", role: "supporting", weight: 0.3, confidence: 0.6 }),
  ],
});

export const BARBELL_DEADLIFT = ex({
  slug: "barbell_deadlift",
  name: "Conventional Deadlift",
  category: "compound",
  movementPattern: "hinge",
  primaryMovementFunction: "hinge",
  movementFunctions: ["hinge", "hip_extension", "knee_flexion"],
  roles: ["compound_movement", "primary_strength_movement", "hip_extension_movement"],
  equipment: ["barbell"],
  stabilityDemand: "high",
  loadingCharacteristic: "free_weight_multi_joint",
  rangeOfMotionCharacteristic: "full_stretch_to_squeeze",
  targets: [
    target({ muscle: "hamstrings", display: "Hamstrings", group: "hamstrings", role: "primary_mover", weight: 0.85, confidence: 0.85 }),
    target({ muscle: "spinal_erectors", display: "Spinal erectors", group: "lower_back", role: "secondary_mover", weight: 0.65, confidence: 0.8 }),
    target({ muscle: "latissimus_dorsi", display: "Lats", group: "lats", role: "supporting", weight: 0.3, confidence: 0.55 }),
  ],
});

// --- legs -------------------------------------------------------------------

export const BARBELL_BACK_SQUAT = ex({
  slug: "barbell_back_squat",
  name: "Barbell Back Squat",
  category: "compound",
  movementPattern: "squat",
  primaryMovementFunction: "squat",
  movementFunctions: ["squat", "knee_extension", "hip_extension"],
  roles: ["compound_movement", "primary_strength_movement", "knee_extension_movement", "hypertrophy_movement"],
  equipment: ["barbell", "squat_rack"],
  stabilityDemand: "high",
  loadingCharacteristic: "free_weight_multi_joint",
  rangeOfMotionCharacteristic: "full_stretch_to_squeeze",
  targets: [
    target({ muscle: "quadriceps", display: "Quadriceps", group: "quadriceps", role: "primary_mover", weight: 0.85, confidence: 0.85 }),
    target({ muscle: "hamstrings", display: "Hamstrings", group: "hamstrings", role: "secondary_mover", weight: 0.35, confidence: 0.7 }),
    target({ muscle: "spinal_erectors", display: "Spinal erectors", group: "lower_back", role: "stabilizer", weight: 0.35, confidence: 0.75 }),
  ],
});

export const ROMANIAN_DEADLIFT = ex({
  slug: "romanian_deadlift",
  name: "Romanian Deadlift",
  category: "compound",
  movementPattern: "hinge",
  primaryMovementFunction: "hinge",
  movementFunctions: ["hinge", "hip_extension", "knee_flexion"],
  roles: ["compound_movement", "hip_extension_movement", "hypertrophy_movement"],
  equipment: ["barbell"],
  stabilityDemand: "moderate",
  loadingCharacteristic: "free_weight_multi_joint",
  rangeOfMotionCharacteristic: "stretch_emphasised",
  targets: [
    target({ muscle: "hamstrings", display: "Hamstrings", group: "hamstrings", role: "primary_mover", weight: 0.9, confidence: 0.85 }),
    target({ muscle: "spinal_erectors", display: "Spinal erectors", group: "lower_back", role: "stabilizer", weight: 0.4, confidence: 0.7 }),
  ],
});

export const CATALOG: readonly ExerciseKnowledge[] = [
  BARBELL_CURL,
  INCLINE_DUMBBELL_CURL,
  HAMMER_CURL,
  PREACHER_CURL,
  CABLE_CURL,
  OVERHEAD_CABLE_EXTENSION,
  SKULL_CRUSHER,
  ROPE_PUSHDOWN,
  CLOSE_GRIP_BENCH_PRESS,
  CABLE_LATERAL_RAISE,
  DUMBBELL_LATERAL_RAISE,
  MACHINE_LATERAL_RAISE,
  FACE_PULL,
  LAT_PULLDOWN,
  PULL_UP,
  BARBELL_ROW,
  BARBELL_DEADLIFT,
  BARBELL_BACK_SQUAT,
  ROMANIAN_DEADLIFT,
];

export const bySlug = (slug: string): ExerciseKnowledge => {
  const found = CATALOG.find((item) => item.slug === slug);
  if (!found) throw new Error(`fixture ${slug} is missing`);
  return found;
};

const FIXTURE_CREATED_AT = "2026-01-01T00:00:00Z";

/**
 * The Phase 1 domain shape, derived from the fixture catalog so the two read
 * models always agree on identity. The Phase 1 facades take this shape and the
 * Phase 2 knowledge shape simultaneously, which is exactly the boundary the
 * Phase 1 design intended.
 */
export const DOMAIN_EXERCISES: readonly Exercise[] = CATALOG.map((item) => ({
  id: item.id,
  createdAt: FIXTURE_CREATED_AT,
  updatedAt: FIXTURE_CREATED_AT,
  name: item.name,
  ...(item.aliases ? { aliases: item.aliases } : {}),
  category: item.category,
  ...(item.movementPattern ? { movementPattern: item.movementPattern } : {}),
  requiredEquipment: item.requiredEquipmentIds,
  ...(item.unilateral !== undefined ? { unilateral: item.unilateral } : {}),
  ...(item.variationKey ? { variationKey: item.variationKey } : {}),
  ...(item.variationLabel ? { variationLabel: item.variationLabel } : {}),
  movementFunctions: item.movementFunctions,
  roles: item.roles,
  stabilityDemand: item.stabilityDemand,
  loadingCharacteristic: item.loadingCharacteristic,
  rangeOfMotionCharacteristic: item.rangeOfMotionCharacteristic,
  knowledgeVersion: item.knowledgeVersion,
}));

/** Flat `ExerciseMuscleRelation` rows, for the Phase 1 relation-shaped APIs. */
export const RELATIONS: readonly ExerciseMuscleRelation[] = CATALOG.flatMap((exercise) =>
  exercise.targets.map((target) => ({
    exerciseId: exercise.id,
    muscleId: target.muscleId,
    role: target.role,
    contributionWeight: target.contributionWeight,
    confidence: target.confidence,
  })),
);