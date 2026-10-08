/**
 * Phase 3.1.1 — no-equipment planner behaviour.
 *
 * These tests pin the contract that a `home_no_equipment` week is staffed by
 * real catalogue knowledge, never by a hardcoded home list:
 *
 *   - a session built with an EMPTY equipment set still covers lower body,
 *     pushing, calves and core, because the catalogue now carries genuinely
 *     equipment-free exercises;
 *   - muscles that honestly cannot be trained with no equipment (loaded
 *     pulling) are reported as uncovered/lost — never faked by a floor
 *     movement;
 *   - no substitution is ever labelled "equivalent" when external-load
 *     progression is unavailable;
 *   - duration repair and bodyweight progression levers keep working.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlannedExercise, TrainingEnvironment } from "@fitcoach/domain";
import type { ExerciseKnowledge } from "../knowledgeCatalog";
import type { SessionAssignment } from "../frequency";
import { assessCoverage, coverageFractions } from "../coverage";
import {
  evaluateProgressionFromHistory,
  progressionMechanismsFor,
  toPerformanceObservation,
} from "../performanceLedger";
import {
  estimateSessionDuration,
  repairOverBudgetSession,
  buildSessionFromAssignments,
} from "../sessionConstruction";
import {
  adaptExercisesToEnvironment,
  environmentProgressionMechanisms,
  resolveTrainingEnvironment,
} from "../trainingEnvironment";
import { ex, target, exerciseId, muscleId, TAXONOMY } from "./fixtures";
import type { MuscleTaxonomy } from "../knowledgeCatalog";

// ---------------------------------------------------------------------------
// Test catalog: gym work plus a genuinely equipment-free universe.
// ---------------------------------------------------------------------------

const EQ_BARBELL = "eq_barbell";
const EQ_BENCH = "eq_bench";
const EQ_RACK = "eq_rack";
const EQ_PULLDOWN = "eq_pulldown";
const EQ_LEG_CURL = "eq_leg_curl";
const EQ_CALF_MACHINE = "eq_calf_machine";

const BARBELL_BACK_SQUAT = ex({
  slug: "barbell_back_squat",
  name: "Barbell Back Squat",
  category: "compound",
  movementPattern: "squat",
  primaryMovementFunction: "squat",
  movementFunctions: ["squat", "knee_extension", "hip_extension"],
  roles: ["compound_movement", "primary_strength_movement", "knee_extension_movement"],
  equipment: [EQ_BARBELL, EQ_RACK],
  stabilityDemand: "high",
  loadingCharacteristic: "free_weight_multi_joint",
  targets: [
    target({ muscle: "quadriceps", display: "Quadriceps", group: "quadriceps", role: "primary_mover", weight: 0.85 }),
    target({ muscle: "gluteus_maximus", display: "Glutes", group: "glutes", role: "primary_mover", weight: 0.7 }),
  ],
});

const BARBELL_BENCH_PRESS = ex({
  slug: "barbell_bench_press",
  name: "Barbell Bench Press",
  category: "compound",
  movementPattern: "horizontal_push",
  primaryMovementFunction: "horizontal_press",
  movementFunctions: ["horizontal_press", "elbow_extension"],
  roles: ["compound_movement", "horizontal_push", "primary_strength_movement"],
  equipment: [EQ_BARBELL, EQ_BENCH],
  loadingCharacteristic: "free_weight_multi_joint",
  targets: [
    target({ muscle: "pectoralis_major", display: "Chest", group: "chest", role: "primary_mover", weight: 0.8 }),
    target({ muscle: "triceps_brachii", display: "Triceps", group: "triceps", role: "secondary_mover", weight: 0.45 }),
    target({ muscle: "deltoid_front", display: "Front delts", group: "front_delts", role: "secondary_mover", weight: 0.35 }),
  ],
});

const LAT_PULLDOWN_MACHINE = ex({
  slug: "lat_pulldown_wide_grip",
  name: "Wide-grip lat pulldown",
  category: "compound",
  movementPattern: "vertical_pull",
  primaryMovementFunction: "vertical_pull",
  movementFunctions: ["vertical_pull", "elbow_flexion"],
  roles: ["compound_movement", "vertical_pull", "lat_emphasis_pull"],
  equipment: [EQ_PULLDOWN],
  loadingCharacteristic: "machine_guided",
  targets: [
    target({ muscle: "latissimus_dorsi", display: "Lats", group: "lats", role: "primary_mover", weight: 0.8 }),
    target({ muscle: "biceps_brachii", display: "Biceps", group: "biceps", role: "secondary_mover", weight: 0.45 }),
  ],
});

const ROMANIAN_DEADLIFT = ex({
  slug: "romanian_deadlift",
  name: "Romanian Deadlift",
  category: "compound",
  movementPattern: "hinge",
  primaryMovementFunction: "hinge",
  movementFunctions: ["hinge", "hip_extension", "knee_flexion"],
  roles: ["compound_movement", "hamstring_knee_flexion", "hypertrophy_movement"],
  equipment: [EQ_BARBELL],
  loadingCharacteristic: "free_weight_multi_joint",
  rangeOfMotionCharacteristic: "stretch_emphasised",
  targets: [
    target({ muscle: "hamstrings", display: "Hamstrings", group: "hamstrings", role: "primary_mover", weight: 0.8 }),
    target({ muscle: "gluteus_maximus", display: "Glutes", group: "glutes", role: "primary_mover", weight: 0.65 }),
  ],
});

const LYING_LEG_CURL = ex({
  slug: "lying_leg_curl",
  name: "Lying leg curl",
  category: "isolation",
  movementPattern: "hinge",
  primaryMovementFunction: "knee_flexion",
  movementFunctions: ["knee_flexion"],
  roles: ["isolation_movement", "hamstring_knee_flexion"],
  equipment: [EQ_LEG_CURL],
  loadingCharacteristic: "machine_guided",
  targets: [
    target({ muscle: "hamstrings", display: "Hamstrings", group: "hamstrings", role: "primary_mover", weight: 0.85 }),
  ],
});

const SEATED_CALF_RAISE = ex({
  slug: "seated_calf_raise",
  name: "Seated calf raise",
  category: "isolation",
  movementPattern: "other",
  primaryMovementFunction: "plantarflexion",
  movementFunctions: ["plantarflexion"],
  roles: ["isolation_movement", "calf_raising"],
  equipment: [EQ_CALF_MACHINE],
  loadingCharacteristic: "machine_guided",
  targets: [
    target({ muscle: "soleus", display: "Soleus", group: "calves", role: "primary_mover", weight: 0.85 }),
  ],
});

const BODYWEIGHT_SQUAT = ex({
  slug: "bodyweight_squat",
  name: "Bodyweight squat",
  category: "compound",
  movementPattern: "squat",
  primaryMovementFunction: "squat",
  movementFunctions: ["squat", "knee_extension", "hip_extension"],
  roles: ["compound_movement", "knee_extension_movement", "hypertrophy_movement", "accessory_movement"],
  equipment: [],
  loadingCharacteristic: "bodyweight_only",
  variationKey: "squat:bodyweight",
  targets: [
    target({ muscle: "quadriceps", display: "Quadriceps", group: "quadriceps", role: "primary_mover", weight: 0.7 }),
    target({ muscle: "gluteus_maximus", display: "Glutes", group: "glutes", role: "primary_mover", weight: 0.55 }),
  ],
});

const SPLIT_SQUAT = ex({
  slug: "split_squat",
  name: "Split squat",
  category: "compound",
  movementPattern: "lunge",
  primaryMovementFunction: "squat",
  movementFunctions: ["squat", "knee_extension", "hip_extension"],
  roles: ["compound_movement", "knee_extension_movement", "hypertrophy_movement"],
  equipment: [],
  unilateral: true,
  stabilityDemand: "high",
  loadingCharacteristic: "bodyweight_only",
  variationKey: "split_squat:bodyweight",
  targets: [
    target({ muscle: "quadriceps", display: "Quadriceps", group: "quadriceps", role: "primary_mover", weight: 0.7 }),
    target({ muscle: "gluteus_maximus", display: "Glutes", group: "glutes", role: "primary_mover", weight: 0.55 }),
  ],
});

const GLUTE_BRIDGE = ex({
  slug: "glute_bridge",
  name: "Glute bridge",
  category: "isolation",
  movementPattern: "hinge",
  primaryMovementFunction: "hip_extension",
  movementFunctions: ["hip_extension"],
  roles: ["isolation_movement", "hip_extension_movement", "accessory_movement"],
  equipment: [],
  loadingCharacteristic: "bodyweight_only",
  variationKey: "glute_bridge:floor_bilateral",
  targets: [
    target({ muscle: "gluteus_maximus", display: "Glutes", group: "glutes", role: "primary_mover", weight: 0.75 }),
    target({ muscle: "hamstrings", display: "Hamstrings", group: "hamstrings", role: "secondary_mover", weight: 0.3 }),
  ],
});

const SINGLE_LEG_BODYWEIGHT_RDL = ex({
  slug: "single_leg_bodyweight_rdl",
  name: "Single-leg bodyweight Romanian deadlift",
  category: "compound",
  movementPattern: "hinge",
  primaryMovementFunction: "hinge",
  movementFunctions: ["hinge", "hip_extension"],
  roles: ["compound_movement", "hip_extension_movement", "hypertrophy_movement"],
  equipment: [],
  unilateral: true,
  stabilityDemand: "high",
  loadingCharacteristic: "bodyweight_only",
  variationKey: "romanian_deadlift:single_leg_bodyweight",
  targets: [
    target({ muscle: "hamstrings", display: "Hamstrings", group: "hamstrings", role: "primary_mover", weight: 0.6 }),
    target({ muscle: "gluteus_maximus", display: "Glutes", group: "glutes", role: "primary_mover", weight: 0.5 }),
  ],
});

const HAMSTRING_BRIDGE = ex({
  slug: "hamstring_bridge",
  name: "Hamstring bridge",
  category: "isolation",
  movementPattern: "hinge",
  primaryMovementFunction: "hip_extension",
  movementFunctions: ["hip_extension"],
  roles: ["isolation_movement", "hip_extension_movement", "accessory_movement"],
  equipment: [],
  loadingCharacteristic: "bodyweight_only",
  variationKey: "glute_bridge:hamstring_bias",
  targets: [
    target({ muscle: "hamstrings", display: "Hamstrings", group: "hamstrings", role: "primary_mover", weight: 0.55 }),
    target({ muscle: "gluteus_maximus", display: "Glutes", group: "glutes", role: "primary_mover", weight: 0.55 }),
  ],
});

const STANDING_CALF_RAISE = ex({
  slug: "standing_calf_raise",
  name: "Standing calf raise",
  category: "isolation",
  movementPattern: "other",
  primaryMovementFunction: "plantarflexion",
  movementFunctions: ["plantarflexion"],
  roles: ["isolation_movement", "calf_raising"],
  equipment: [],
  loadingCharacteristic: "bodyweight_only",
  variationKey: "calf_raise:standing",
  targets: [
    target({ muscle: "gastrocnemius", display: "Calves (gastrocnemius)", group: "calves", role: "primary_mover", weight: 0.85 }),
    target({ muscle: "soleus", display: "Soleus", group: "calves", role: "secondary_mover", weight: 0.45 }),
  ],
});

const BENT_KNEE_CALF_RAISE = ex({
  slug: "bent_knee_calf_raise",
  name: "Bent-knee calf raise",
  category: "isolation",
  movementPattern: "other",
  primaryMovementFunction: "plantarflexion",
  movementFunctions: ["plantarflexion"],
  roles: ["isolation_movement", "calf_raising"],
  equipment: [],
  loadingCharacteristic: "bodyweight_only",
  variationKey: "calf_raise:bent_knee_standing",
  targets: [
    target({ muscle: "soleus", display: "Soleus", group: "calves", role: "primary_mover", weight: 0.8 }),
    target({ muscle: "gastrocnemius", display: "Calves (gastrocnemius)", group: "calves", role: "secondary_mover", weight: 0.3 }),
  ],
});

const PUSH_UP = ex({
  slug: "push_up",
  name: "Push-up",
  category: "compound",
  movementPattern: "horizontal_push",
  primaryMovementFunction: "horizontal_press",
  movementFunctions: ["horizontal_press", "elbow_extension", "anti_extension"],
  roles: ["compound_movement", "horizontal_push", "accessory_movement"],
  equipment: [],
  stabilityDemand: "high",
  loadingCharacteristic: "bodyweight_only",
  variationKey: "push_up:full_rom_bodyweight",
  targets: [
    target({ muscle: "pectoralis_major", display: "Chest", group: "chest", role: "primary_mover", weight: 0.6 }),
    target({ muscle: "triceps_brachii", display: "Triceps", group: "triceps", role: "secondary_mover", weight: 0.4 }),
    target({ muscle: "deltoid_front", display: "Front delts", group: "front_delts", role: "secondary_mover", weight: 0.3 }),
  ],
});

const PIKE_PUSH_UP = ex({
  slug: "pike_push_up",
  name: "Pike push-up",
  category: "compound",
  movementPattern: "vertical_push",
  primaryMovementFunction: "vertical_press",
  movementFunctions: ["vertical_press", "elbow_extension", "anti_extension"],
  roles: ["compound_movement", "vertical_push", "front_delt_press", "hypertrophy_movement"],
  equipment: [],
  stabilityDemand: "high",
  loadingCharacteristic: "bodyweight_only",
  variationKey: "pike_push_up:bodyweight",
  targets: [
    target({ muscle: "deltoid_front", display: "Front delts", group: "front_delts", role: "primary_mover", weight: 0.65 }),
    target({ muscle: "triceps_brachii", display: "Triceps", group: "triceps", role: "secondary_mover", weight: 0.45 }),
  ],
});

const DIAMOND_PUSH_UP = ex({
  slug: "diamond_push_up",
  name: "Diamond push-up",
  category: "compound",
  movementPattern: "horizontal_push",
  primaryMovementFunction: "horizontal_press",
  movementFunctions: ["horizontal_press", "elbow_extension", "anti_extension"],
  roles: ["compound_movement", "horizontal_push", "hypertrophy_movement"],
  equipment: [],
  stabilityDemand: "high",
  loadingCharacteristic: "bodyweight_only",
  variationKey: "push_up:diamond_close_grip",
  targets: [
    target({ muscle: "triceps_brachii", display: "Triceps", group: "triceps", role: "primary_mover", weight: 0.6 }),
    target({ muscle: "pectoralis_major", display: "Chest", group: "chest", role: "primary_mover", weight: 0.5 }),
  ],
});

const PLANK = ex({
  slug: "plank",
  name: "Plank",
  category: "isolation",
  movementPattern: "core",
  primaryMovementFunction: "anti_extension",
  movementFunctions: ["anti_extension"],
  roles: ["isolation_movement", "core_anti_extension", "accessory_movement"],
  equipment: [],
  stabilityDemand: "high",
  loadingCharacteristic: "bodyweight_only",
  variationKey: "plank:forearm",
  targets: [
    target({ muscle: "transversus_abdominis", display: "Transverse abdominis", group: "abdominals", role: "primary_mover", weight: 0.7 }),
    target({ muscle: "rectus_abdominis", display: "Rectus abdominis", group: "abdominals", role: "secondary_mover", weight: 0.4 }),
  ],
});

const SIDE_PLANK = ex({
  slug: "side_plank",
  name: "Side plank",
  category: "isolation",
  movementPattern: "core",
  primaryMovementFunction: "lateral_flexion",
  movementFunctions: ["lateral_flexion", "hip_abduction"],
  roles: ["isolation_movement", "accessory_movement"],
  equipment: [],
  unilateral: true,
  loadingCharacteristic: "bodyweight_only",
  variationKey: "side_plank:forearm",
  targets: [
    target({ muscle: "obliques", display: "Obliques (external)", group: "obliques", role: "primary_mover", weight: 0.6 }),
    target({ muscle: "transversus_abdominis", display: "Transverse abdominis", group: "abdominals", role: "secondary_mover", weight: 0.3 }),
  ],
});

const REVERSE_CRUNCH = ex({
  slug: "reverse_crunch",
  name: "Reverse crunch",
  category: "isolation",
  movementPattern: "core",
  primaryMovementFunction: "trunk_flexion",
  movementFunctions: ["trunk_flexion", "hip_flexion"],
  roles: ["isolation_movement", "hypertrophy_movement", "accessory_movement"],
  equipment: [],
  loadingCharacteristic: "bodyweight_only",
  variationKey: "reverse_crunch:supine",
  targets: [
    target({ muscle: "rectus_abdominis", display: "Rectus abdominis", group: "abdominals", role: "primary_mover", weight: 0.6 }),
  ],
});

const PRONE_Y_RAISE = ex({
  slug: "prone_y_raise",
  name: "Prone Y raise",
  category: "isolation",
  movementPattern: "other",
  primaryMovementFunction: "shoulder_flexion",
  movementFunctions: ["shoulder_flexion"],
  roles: ["isolation_movement", "lower_trap_emphasis", "accessory_movement"],
  equipment: [],
  loadingCharacteristic: "bodyweight_only",
  variationKey: "prone_raise:y_formation",
  targets: [
    target({ muscle: "trapezius", display: "Trapezius", group: "traps", role: "primary_mover", weight: 0.5 }),
    target({ muscle: "rhomboid_major", display: "Rhomboids", group: "upper_back", role: "supporting", weight: 0.25 }),
  ],
});

const SUPERMAN_HOLD = ex({
  slug: "superman_hold",
  name: "Superman hold",
  category: "isolation",
  movementPattern: "other",
  primaryMovementFunction: "trunk_extension",
  movementFunctions: ["trunk_extension", "hip_extension"],
  roles: ["isolation_movement", "accessory_movement"],
  equipment: [],
  loadingCharacteristic: "bodyweight_only",
  variationKey: "superman:prone_hold",
  targets: [
    target({ muscle: "erector_spinae", display: "Spinal erectors", group: "lower_back", role: "primary_mover", weight: 0.55 }),
  ],
});

const CATALOG: readonly ExerciseKnowledge[] = [
  BARBELL_BACK_SQUAT,
  BARBELL_BENCH_PRESS,
  LAT_PULLDOWN_MACHINE,
  ROMANIAN_DEADLIFT,
  LYING_LEG_CURL,
  SEATED_CALF_RAISE,
  BODYWEIGHT_SQUAT,
  SPLIT_SQUAT,
  GLUTE_BRIDGE,
  SINGLE_LEG_BODYWEIGHT_RDL,
  HAMSTRING_BRIDGE,
  STANDING_CALF_RAISE,
  BENT_KNEE_CALF_RAISE,
  PUSH_UP,
  PIKE_PUSH_UP,
  DIAMOND_PUSH_UP,
  PLANK,
  SIDE_PLANK,
  REVERSE_CRUNCH,
  PRONE_Y_RAISE,
  SUPERMAN_HOLD,
];

/** Extended taxonomy: the fixture taxonomy plus the muscles this catalog adds. */
const NO_EQUIPMENT_TAXONOMY: MuscleTaxonomy = {
  muscles: [
    ...TAXONOMY.muscles,
    { id: muscleId("gluteus_maximus"), slug: "gluteus_maximus", name: "gluteus_maximus", displayName: "Glutes", group: "glutes" },
    { id: muscleId("gastrocnemius"), slug: "gastrocnemius", name: "gastrocnemius", displayName: "Calves (gastrocnemius)", group: "calves" },
    { id: muscleId("soleus"), slug: "soleus", name: "soleus", displayName: "Soleus", group: "calves" },
    { id: muscleId("pectoralis_major"), slug: "pectoralis_major", name: "pectoralis_major", displayName: "Chest", group: "chest" },
    { id: muscleId("deltoid_front"), slug: "deltoid_front", name: "deltoid_anterior", displayName: "Front delts", group: "front_delts" },
    { id: muscleId("rhomboid_major"), slug: "rhomboid_major", name: "rhomboid_major", displayName: "Rhomboids", group: "upper_back" },
    { id: muscleId("erector_spinae"), slug: "erector_spinae", name: "erector_spinae", displayName: "Spinal erectors", group: "lower_back" },
    { id: muscleId("rectus_abdominis"), slug: "rectus_abdominis", name: "rectus_abdominis", displayName: "Rectus abdominis", group: "abdominals" },
    { id: muscleId("obliques"), slug: "obliques", name: "obliquus_externus", displayName: "Obliques (external)", group: "obliques" },
    { id: muscleId("transversus_abdominis"), slug: "transversus_abdominis", name: "transversus_abdominis", displayName: "Transverse abdominis", group: "abdominals" },
  ],
  structures: TAXONOMY.structures,
};

const catalogByMuscle = (catalog: readonly ExerciseKnowledge[]): Record<string, ExerciseKnowledge[]> => {
  const byMuscle: Record<string, Map<string, ExerciseKnowledge>> = {};
  for (const exercise of catalog) {
    for (const entry of exercise.targets) {
      const bucket = byMuscle[entry.muscleSlug] ?? new Map<string, ExerciseKnowledge>();
      bucket.set(exercise.id, exercise);
      byMuscle[entry.muscleSlug] = bucket;
    }
  }
  return Object.fromEntries([...Object.entries(byMuscle)].map(([slug, bucket]) => [slug, [...bucket.values()]]));
};

function homeNoEquipment(): TrainingEnvironment {
  return resolveTrainingEnvironment({
    asOf: "2026-10-10",
    periods: [
      {
        id: "period_home",
        kind: "home_no_equipment",
        availableEquipmentIds: [],
        unavailableEquipmentIds: [],
        effectiveFrom: "2026-10-10",
        isTemporary: true,
      },
    ],
    ownedEquipment: [],
  });
}

let plannedPosition = 0;
function planned(exercise: ExerciseKnowledge, targetSets: number): PlannedExercise {
  plannedPosition += 1;
  return {
    id: `planned-${plannedPosition}`,
    exerciseId: exercise.id,
    position: plannedPosition,
    name: exercise.name,
    ...(exercise.variationLabel !== undefined ? { variationLabel: exercise.variationLabel } : {}),
    targetSets,
    repMin: 8,
    repMax: 12,
    targetRir: 2,
    restSeconds: 90,
    order: plannedPosition,
    planRole: "primary_strength_movement",
    selectionReason: `Primary exercise for a gym plan.`,
    substitutionExerciseIds: [],
    knowledgeVersion: exercise.knowledgeVersion,
  };
}

// ---------------------------------------------------------------------------
// Session construction with an empty equipment set
// ---------------------------------------------------------------------------

test("a no-equipment session is staffed from the catalogue, not left empty", () => {
  const assignments: SessionAssignment[] = [
    { muscleSlug: "quadriceps", sessionIndex: 0, sets: 4 },
    { muscleSlug: "gluteus_maximus", sessionIndex: 0, sets: 3 },
    { muscleSlug: "hamstrings", sessionIndex: 0, sets: 3 },
    { muscleSlug: "gastrocnemius", sessionIndex: 0, sets: 3 },
    { muscleSlug: "soleus", sessionIndex: 0, sets: 2 },
    { muscleSlug: "pectoralis_major", sessionIndex: 0, sets: 4 },
    { muscleSlug: "triceps_brachii", sessionIndex: 0, sets: 3 },
    { muscleSlug: "deltoid_front", sessionIndex: 0, sets: 3 },
    { muscleSlug: "rectus_abdominis", sessionIndex: 0, sets: 3 },
    { muscleSlug: "obliques", sessionIndex: 0, sets: 2 },
    { muscleSlug: "erector_spinae", sessionIndex: 0, sets: 2 },
  ];

  const built = buildSessionFromAssignments(0, assignments, catalogByMuscle(CATALOG), "hypertrophy", "intermediate", {
    availableEquipmentIds: [],
    exercisePreferences: {},
    maxSessionDurationMinutes: 75,
    trainingExperience: "intermediate",
  });

  const selectedIds = new Set(built.sessionExercises.map((item) => item.exerciseId));
  // Lower body, pushing, calves and core all staffed.
  assert.ok(selectedIds.has(exerciseId("bodyweight_squat")) || selectedIds.has(exerciseId("split_squat")), "quadriceps staffed");
  assert.ok(selectedIds.has(exerciseId("glute_bridge")) || selectedIds.has(exerciseId("single_leg_bodyweight_rdl")) || selectedIds.has(exerciseId("hamstring_bridge")), "glutes/posterior chain staffed");
  assert.ok(selectedIds.has(exerciseId("single_leg_bodyweight_rdl")) || selectedIds.has(exerciseId("hamstring_bridge")), "hamstrings staffed");
  assert.ok(selectedIds.has(exerciseId("standing_calf_raise")), "gastrocnemius staffed");
  assert.ok(selectedIds.has(exerciseId("bent_knee_calf_raise")), "soleus staffed");
  assert.ok(selectedIds.has(exerciseId("push_up")) || selectedIds.has(exerciseId("diamond_push_up")), "chest staffed");
  assert.ok(selectedIds.has(exerciseId("diamond_push_up")), "triceps staffed");
  assert.ok(selectedIds.has(exerciseId("pike_push_up")), "shoulders staffed");
  assert.ok(selectedIds.has(exerciseId("reverse_crunch")), "rectus abdominis staffed");
  assert.ok(selectedIds.has(exerciseId("side_plank")), "obliques staffed");
  assert.ok(selectedIds.has(exerciseId("superman_hold")), "spinal erectors staffed");

  // Nothing selected may require equipment — that is the whole contract.
  const byId = new Map(CATALOG.map((item) => [item.id, item]));
  for (const exercise of built.sessionExercises) {
    const knowledge = byId.get(exercise.exerciseId);
    assert.ok(knowledge, `${exercise.name} must resolve in the catalogue`);
    assert.deepEqual([...knowledge.requiredEquipmentIds], [], `${exercise.name} must require no equipment`);
  }
});

test("a muscle with no honest no-equipment option is reported, never faked", () => {
  const assignments: SessionAssignment[] = [
    { muscleSlug: "latissimus_dorsi", sessionIndex: 0, sets: 4 },
    { muscleSlug: "quadriceps", sessionIndex: 0, sets: 4 },
  ];

  const built = buildSessionFromAssignments(0, assignments, catalogByMuscle(CATALOG), "hypertrophy", "intermediate", {
    availableEquipmentIds: [],
    exercisePreferences: {},
    maxSessionDurationMinutes: 60,
    trainingExperience: "intermediate",
  });

  assert.ok(
    built.warnings.some((warning) => warning.includes("latissimus_dorsi")),
    "the unfilled lat slot must be stated",
  );
  assert.ok(
    !built.sessionExercises.some((item) => item.exerciseId === exerciseId("prone_y_raise")),
    "a floor movement must never be dressed up as a lat exercise",
  );
  assert.ok(
    built.sessionExercises.some((item) => item.exerciseId === exerciseId("bodyweight_squat")),
    "the rest of the session still trains",
  );
});

test("one variation per muscle per session: the planner does not stack near-duplicates", () => {
  const assignments: SessionAssignment[] = [{ muscleSlug: "quadriceps", sessionIndex: 0, sets: 12 }];
  const built = buildSessionFromAssignments(0, assignments, catalogByMuscle(CATALOG), "hypertrophy", "intermediate", {
    availableEquipmentIds: [],
    exercisePreferences: {},
    maxSessionDurationMinutes: 75,
    trainingExperience: "intermediate",
  });

  const quadExercises = built.sessionExercises.filter((item) => {
    const knowledge = CATALOG.find((entry) => entry.id === item.exerciseId);
    return knowledge?.targets.some((entry) => entry.muscleSlug === "quadriceps" && entry.role === "primary_mover");
  });
  const families = quadExercises.map((item) => item.exerciseId);
  assert.ok(
    quadExercises.length <= 2,
    `at most a primary and one secondary quad exercise, got ${families.join(", ")}`,
  );
  // And the two, when present, are different movement patterns (squat vs lunge), not two squat variations.
  if (quadExercises.length === 2) {
    const patterns = quadExercises.map(
      (item) => CATALOG.find((entry) => entry.id === item.exerciseId)?.movementPattern,
    );
    assert.notEqual(patterns[0], patterns[1], "secondary work adds variety, not a near-copy");
  }
});

// ---------------------------------------------------------------------------
// Environment adaptation of a gym plan
// ---------------------------------------------------------------------------

function gymWeek(): PlannedExercise[] {
  plannedPosition = 0;
  return [
    planned(BARBELL_BACK_SQUAT, 4),
    planned(BARBELL_BENCH_PRESS, 4),
    planned(LAT_PULLDOWN_MACHINE, 4),
    planned(ROMANIAN_DEADLIFT, 3),
    planned(LYING_LEG_CURL, 3),
    planned(SEATED_CALF_RAISE, 3),
  ];
}

test("a gym week adapts to home_no_equipment with honest, equipment-free substitutions", () => {
  const environment = homeNoEquipment();
  const result = adaptExercisesToEnvironment({
    exercises: gymWeek(),
    catalog: CATALOG,
    environment,
  });

  const byOriginal = new Map(result.substitutions.map((sub) => [sub.originalExerciseId, sub]));
  const byId = new Map(CATALOG.map((item) => [item.id, item]));

  // Squat → bodyweight squat family, pattern preserved, load honestly gone.
  const squat = byOriginal.get(exerciseId("barbell_back_squat"));
  assert.ok(squat, "the squat must be substituted, not dropped");
  assert.equal(squat.equivalence, "partial", "no-equipment substitutions are never 'equivalent'");
  assert.equal(byId.get(squat.replacementExerciseId)?.movementPattern, "squat");
  assert.deepEqual(squat.musclesLost, []);

  // Bench → push-up family.
  const bench = byOriginal.get(exerciseId("barbell_bench_press"));
  assert.ok(bench, "the bench press must be substituted");
  assert.equal(bench.equivalence, "partial");
  assert.equal(byId.get(bench.replacementExerciseId)?.movementPattern, "horizontal_push");
  assert.deepEqual(bench.musclesLost, []);

  // RDL → a bodyweight hinge that keeps hamstrings as a primary.
  const rdl = byOriginal.get(exerciseId("romanian_deadlift"));
  assert.ok(rdl, "the RDL must be substituted");
  assert.ok(rdl.musclesPreserved.includes("hamstrings"));

  // Leg curl → hamstring bridge (hip-extension stimulus, honestly not knee flexion).
  const curl = byOriginal.get(exerciseId("lying_leg_curl"));
  assert.ok(curl, "the leg curl must be substituted");
  assert.ok(curl.musclesPreserved.includes("hamstrings"));
  assert.notEqual(curl.equivalence, "equivalent");

  // Seated calf raise → bent-knee calf raise: soleus preserved exactly.
  const calf = byOriginal.get(exerciseId("seated_calf_raise"));
  assert.ok(calf, "the calf raise must be substituted");
  assert.equal(calf.replacementExerciseId, exerciseId("bent_knee_calf_raise"));
  assert.deepEqual(calf.musclesLost, []);

  // Every resulting exercise is performable with nothing.
  for (const exercise of result.exercises) {
    const knowledge = byId.get(exercise.exerciseId);
    assert.ok(knowledge);
    assert.deepEqual([...knowledge.requiredEquipmentIds], [], `${exercise.name} requires no equipment`);
  }

  // External-load progression is honestly unavailable.
  assert.equal(result.loadProgressionAvailable, false);
  assert.ok(result.honestyNote.length > 0);
  assert.ok(!environmentProgressionMechanisms(environment).includes("load"));
  assert.deepEqual([...environmentProgressionMechanisms(environment)], ["reps", "rir", "variation", "rom", "tempo", "sets"]);
});

test("loaded pulling is honestly lost: the lat slot is dropped with a stated limitation", () => {
  const environment = homeNoEquipment();
  const result = adaptExercisesToEnvironment({
    exercises: [planned(LAT_PULLDOWN_MACHINE, 4)],
    catalog: CATALOG,
    environment,
  });

  assert.equal(result.exercises.length, 0, "no fake replacement for a pulldown");
  assert.ok(
    result.warnings.some((warning) => warning.includes("Wide-grip lat pulldown")),
    "the dropped slot is named",
  );
  assert.ok(
    result.muscleCoverageLost.includes("latissimus_dorsi"),
    "the lost muscle coverage is reported",
  );
  assert.ok(
    result.limitations.some(
      (limitation) => limitation.kind === "muscle_coverage" && limitation.subject === "latissimus_dorsi",
    ),
    "the environment limitation names the lats",
  );
  assert.ok(
    result.limitations.some((limitation) => limitation.kind === "load_progression"),
    "the loss of external-load progression is stated",
  );
});

test("prone floor work is never offered as a pulling substitution", () => {
  const environment = homeNoEquipment();
  const result = adaptExercisesToEnvironment({
    exercises: [planned(LAT_PULLDOWN_MACHINE, 4), planned(BARBELL_BENCH_PRESS, 4)],
    catalog: CATALOG,
    environment,
  });

  const replacements = new Set(result.substitutions.map((sub) => sub.replacementExerciseId));
  assert.ok(!replacements.has(exerciseId("prone_y_raise")), "prone Y raise is not a pull");
  assert.ok(!replacements.has(exerciseId("superman_hold")), "superman hold is not a pull");
});

test("coverage separates what the week still trains from what it honestly loses", () => {
  const environment = homeNoEquipment();
  const result = adaptExercisesToEnvironment({
    exercises: gymWeek(),
    catalog: CATALOG,
    environment,
  });

  const trainedIds = new Set(result.exercises.map((item) => item.exerciseId));
  const trained = CATALOG.filter((item) => trainedIds.has(item.id));
  const focus = [
    "quadriceps",
    "gluteus_maximus",
    "hamstrings",
    "soleus",
    "pectoralis_major",
    "latissimus_dorsi",
  ].map(muscleId);

  const report = assessCoverage({ exercises: trained, taxonomy: NO_EQUIPMENT_TAXONOMY, focusMuscleIds: focus });
  const fractions = Object.fromEntries(coverageFractions(report).map((entry) => [entry.muscleSlug, entry.status]));

  assert.notEqual(fractions["quadriceps"], "uncovered", "quads remain trained");
  assert.notEqual(fractions["gluteus_maximus"], "uncovered", "glutes remain trained");
  assert.notEqual(fractions["soleus"], "uncovered", "calves remain trained");
  assert.notEqual(fractions["pectoralis_major"], "uncovered", "chest remains trained");
  assert.equal(fractions["latissimus_dorsi"], "uncovered", "lats are honestly uncovered");
  assert.ok(report.uncoveredMuscleIds.includes(muscleId("latissimus_dorsi")));
});

// ---------------------------------------------------------------------------
// Duration repair + bodyweight progression
// ---------------------------------------------------------------------------

test("duration repair still fits a no-equipment session into the budget", () => {
  const big: PlannedExercise[] = [
    planned(BODYWEIGHT_SQUAT, 8),
    planned(PUSH_UP, 8),
    planned(SINGLE_LEG_BODYWEIGHT_RDL, 8),
    planned(PIKE_PUSH_UP, 8),
    planned(GLUTE_BRIDGE, 8),
    planned(STANDING_CALF_RAISE, 8),
  ];
  const context = { maxSessionDurationMinutes: 45, trainingExperience: "intermediate" as const };

  let exercises: readonly PlannedExercise[] = big;
  let duration = estimateSessionDuration(exercises, "full_body", context, "hypertrophy");
  assert.ok(duration.exceedsBudget, "the oversized session must start over budget");

  for (let pass = 0; pass < 8 && duration.exceedsBudget && exercises.length > 0; pass++) {
    const repair = repairOverBudgetSession(exercises, duration.estimatedMinutes, 45, [], "hypertrophy");
    if (repair.changes.length === 0) break;
    exercises = repair.repairedExercises;
    duration = estimateSessionDuration(exercises, "full_body", context, "hypertrophy");
  }

  assert.ok(duration.estimatedMinutes <= 45, `repaired to ${duration.estimatedMinutes} <= 45`);
  assert.ok(exercises.length > 0, "repair trims work, it never empties the session");
  for (const exercise of exercises) {
    const knowledge = CATALOG.find((item) => item.id === exercise.exerciseId);
    assert.ok(knowledge);
    assert.deepEqual([...knowledge.requiredEquipmentIds], []);
  }
});

test("bodyweight performance progresses through reps, then variation — never load", () => {
  assert.deepEqual([...progressionMechanismsFor("bodyweight")], ["reps", "rir", "variation", "rom", "tempo", "sets"]);

  const atTop = [1, 2].flatMap((day) => [
    toPerformanceObservation({
      id: `set_top_${day}`,
      exerciseId: exerciseId("push_up"),
      workoutId: `wo_${day}`,
      setKind: "working",
      reps: 12,
      rir: 2,
      createdAt: `2026-10-0${day}T18:00:00.000Z`,
      workoutStatus: "completed",
    }),
  ]);
  const topResult = evaluateProgressionFromHistory({
    exerciseId: exerciseId("push_up"),
    exerciseName: "Push-up",
    goalProfile: "hypertrophy",
    observations: atTop,
    target: { repMin: 8, repMax: 12, targetRir: 2 },
  });
  assert.equal(topResult.outcome, "increase_reps");
  assert.ok(!topResult.recommendation.mechanisms.includes("load"));
  assert.equal(topResult.recommendation.targetRepMin, 14);

  const wellAbove = [1, 2].flatMap((day) => [
    toPerformanceObservation({
      id: `set_above_${day}`,
      exerciseId: exerciseId("push_up"),
      workoutId: `wo_above_${day}`,
      setKind: "working",
      reps: 20,
      rir: 2,
      createdAt: `2026-10-0${day}T18:00:00.000Z`,
      workoutStatus: "completed",
    }),
  ]);
  const aboveResult = evaluateProgressionFromHistory({
    exerciseId: exerciseId("push_up"),
    exerciseName: "Push-up",
    goalProfile: "hypertrophy",
    observations: wellAbove,
    target: { repMin: 8, repMax: 12, targetRir: 2 },
  });
  assert.equal(aboveResult.outcome, "change_exercise", "20 push-ups at target effort earns a harder variation, not endless reps");
  assert.ok(aboveResult.recommendation.mechanisms.includes("variation"));
  assert.ok(aboveResult.recommendation.mechanisms.includes("tempo"));
  assert.ok(aboveResult.recommendation.mechanisms.includes("rom"));
});
