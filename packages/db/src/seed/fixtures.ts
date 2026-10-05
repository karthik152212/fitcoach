/**
 * DEVELOPMENT FIXTURES — hand-written first-party content.
 *
 * These rows are NOT imported from any third-party dataset or application:
 * they were authored inside this repository so integration tests and local
 * development have a minimal muscle / exercise / equipment / food vocabulary.
 *
 * Because they are first-party, their rows carry NULL external source fields
 * (docs/DATABASE_DESIGN.md §10: "First-party rows simply have NULL source
 * fields") and no THIRD_PARTY.md entry is required for them.
 *
 * When a licensed catalog import happens (milestone §14), this module is
 * replaced/retired — the seed pipeline takes catalog data from the licensed
 * import path instead. Nothing in the seed is derived from openGym or any
 * unverified dataset.
 */

export const SEED_FIXTURE_LABEL =
  "hand-written development fixture (first-party) — replaced by licensed catalog imports" as const;

/**
 * Fixed UUIDv7-shaped ids for seed rows that have no natural unique key
 * (foods, food sources, the dev user). Deterministic ids make the seed
 * idempotent without inventing non-UUID key types. All are valid UUIDv7
 * (version 7, variant 10xx) with a zero timestamp — reserved for fixtures.
 */
export const SEED_FIXED_IDS = {
  foodSource: "00000000-0000-7000-8000-0000000000a1",
  oats: "00000000-0000-7000-8000-0000000000a2",
  chickenBreast: "00000000-0000-7000-8000-0000000000a3",
  greekYogurt: "00000000-0000-7000-8000-0000000000a4",
  devUser: "00000000-0000-7000-8000-0000000000f1",
} as const;

export interface SeedEquipment {
  slug: string;
  name: string;
  category:
    | "barbell"
    | "dumbbell"
    | "kettlebell"
    | "machine"
    | "cable"
    | "smith_machine"
    | "bench"
    | "rack"
    | "pull_up_bar"
    | "bands"
    | "bodyweight"
    | "cardio_machine"
    | "accessory"
    | "other";
}

export const SEED_EQUIPMENT: readonly SeedEquipment[] = [
  { slug: "bodyweight", name: "Bodyweight", category: "bodyweight" },
  { slug: "barbell", name: "Barbell", category: "barbell" },
  { slug: "dumbbells", name: "Dumbbells", category: "dumbbell" },
  { slug: "kettlebell", name: "Kettlebell", category: "kettlebell" },
  { slug: "adjustable_bench", name: "Adjustable bench", category: "bench" },
  { slug: "squat_rack", name: "Squat rack", category: "rack" },
  { slug: "cable_machine", name: "Cable machine", category: "cable" },
  { slug: "pull_up_bar", name: "Pull-up bar", category: "pull_up_bar" },
  { slug: "resistance_bands", name: "Resistance bands", category: "bands" },
  { slug: "treadmill", name: "Treadmill", category: "cardio_machine" },
];

export interface SeedMuscle {
  slug: string;
  name: string;
  group:
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
  displayName: string;
}

export const SEED_MUSCLES: readonly SeedMuscle[] = [
  { slug: "pectoralis_major", name: "pectoralis_major", group: "chest", displayName: "Chest" },
  { slug: "latissimus_dorsi", name: "latissimus_dorsi", group: "lats", displayName: "Lats" },
  { slug: "trapezius", name: "trapezius", group: "traps", displayName: "Traps" },
  { slug: "deltoid_front", name: "deltoid_front", group: "front_delts", displayName: "Front delts" },
  { slug: "deltoid_side", name: "deltoid_side", group: "side_delts", displayName: "Side delts" },
  { slug: "deltoid_rear", name: "deltoid_rear", group: "rear_delts", displayName: "Rear delts" },
  { slug: "biceps_brachii", name: "biceps_brachii", group: "biceps", displayName: "Biceps" },
  { slug: "triceps_brachii", name: "triceps_brachii", group: "triceps", displayName: "Triceps" },
  { slug: "forearm_flexors", name: "forearm_flexors", group: "forearms", displayName: "Forearms" },
  { slug: "quadriceps", name: "quadriceps_femoris", group: "quadriceps", displayName: "Quadriceps" },
  { slug: "hamstrings", name: "hamstrings", group: "hamstrings", displayName: "Hamstrings" },
  { slug: "gluteus_maximus", name: "gluteus_maximus", group: "glutes", displayName: "Glutes" },
  { slug: "gastrocnemius", name: "gastrocnemius", group: "calves", displayName: "Calves" },
  { slug: "rectus_abdominis", name: "rectus_abdominis", group: "abdominals", displayName: "Abs" },
  { slug: "obliques", name: "obliquus externus", group: "obliques", displayName: "Obliques" },
  { slug: "erector_spinae", name: "erector_spinae", group: "lower_back", displayName: "Lower back" },
];

export interface SeedExercise {
  slug: string;
  name: string;
  category: "compound" | "isolation" | "conditioning" | "mobility" | "other";
  movementPattern?:
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
  requiredEquipment: readonly string[];
  relations: readonly {
    muscle: string;
    role: "primary_mover" | "secondary_mover" | "stabilizer";
    weight: number;
  }[];
}

export const SEED_EXERCISES: readonly SeedExercise[] = [
  {
    slug: "barbell_bench_press",
    name: "Barbell bench press",
    category: "compound",
    movementPattern: "horizontal_push",
    requiredEquipment: ["barbell", "adjustable_bench"],
    relations: [
      { muscle: "pectoralis_major", role: "primary_mover", weight: 0.8 },
      { muscle: "deltoid_front", role: "secondary_mover", weight: 0.4 },
      { muscle: "triceps_brachii", role: "secondary_mover", weight: 0.4 },
    ],
  },
  {
    slug: "barbell_back_squat",
    name: "Barbell back squat",
    category: "compound",
    movementPattern: "squat",
    requiredEquipment: ["barbell", "squat_rack"],
    relations: [
      { muscle: "quadriceps", role: "primary_mover", weight: 0.8 },
      { muscle: "gluteus_maximus", role: "secondary_mover", weight: 0.6 },
      { muscle: "hamstrings", role: "secondary_mover", weight: 0.3 },
      { muscle: "erector_spinae", role: "stabilizer", weight: 0.2 },
    ],
  },
  {
    slug: "romanian_deadlift",
    name: "Romanian deadlift",
    category: "compound",
    movementPattern: "hinge",
    requiredEquipment: ["barbell"],
    relations: [
      { muscle: "hamstrings", role: "primary_mover", weight: 0.8 },
      { muscle: "gluteus_maximus", role: "secondary_mover", weight: 0.6 },
      { muscle: "erector_spinae", role: "stabilizer", weight: 0.4 },
      { muscle: "forearm_flexors", role: "stabilizer", weight: 0.3 },
    ],
  },
  {
    slug: "pull_up",
    name: "Pull-up",
    category: "compound",
    movementPattern: "vertical_pull",
    requiredEquipment: ["pull_up_bar"],
    relations: [
      { muscle: "latissimus_dorsi", role: "primary_mover", weight: 0.8 },
      { muscle: "biceps_brachii", role: "secondary_mover", weight: 0.5 },
      { muscle: "deltoid_rear", role: "stabilizer", weight: 0.2 },
    ],
  },
  {
    slug: "seated_cable_row",
    name: "Seated cable row",
    category: "compound",
    movementPattern: "horizontal_pull",
    requiredEquipment: ["cable_machine"],
    relations: [
      { muscle: "latissimus_dorsi", role: "primary_mover", weight: 0.6 },
      { muscle: "trapezius", role: "secondary_mover", weight: 0.5 },
      { muscle: "biceps_brachii", role: "secondary_mover", weight: 0.4 },
    ],
  },
  {
    slug: "barbell_overhead_press",
    name: "Barbell overhead press",
    category: "compound",
    movementPattern: "vertical_push",
    requiredEquipment: ["barbell"],
    relations: [
      { muscle: "deltoid_front", role: "primary_mover", weight: 0.8 },
      { muscle: "triceps_brachii", role: "secondary_mover", weight: 0.5 },
      { muscle: "deltoid_side", role: "secondary_mover", weight: 0.3 },
    ],
  },
  {
    slug: "dumbbell_lateral_raise",
    name: "Dumbbell lateral raise",
    category: "isolation",
    requiredEquipment: ["dumbbells"],
    relations: [{ muscle: "deltoid_side", role: "primary_mover", weight: 0.9 }],
  },
  {
    slug: "dumbbell_biceps_curl",
    name: "Dumbbell biceps curl",
    category: "isolation",
    requiredEquipment: ["dumbbells"],
    relations: [{ muscle: "biceps_brachii", role: "primary_mover", weight: 0.9 }],
  },
  {
    slug: "cable_triceps_pushdown",
    name: "Cable triceps pushdown",
    category: "isolation",
    requiredEquipment: ["cable_machine"],
    relations: [{ muscle: "triceps_brachii", role: "primary_mover", weight: 0.9 }],
  },
  {
    slug: "kettlebell_goblet_squat",
    name: "Kettlebell goblet squat",
    category: "compound",
    movementPattern: "squat",
    requiredEquipment: ["kettlebell"],
    relations: [
      { muscle: "quadriceps", role: "primary_mover", weight: 0.7 },
      { muscle: "gluteus_maximus", role: "secondary_mover", weight: 0.5 },
    ],
  },
  {
    slug: "plank",
    name: "Plank",
    category: "isolation",
    movementPattern: "core",
    requiredEquipment: ["bodyweight"],
    relations: [
      { muscle: "rectus_abdominis", role: "primary_mover", weight: 0.8 },
      { muscle: "obliques", role: "secondary_mover", weight: 0.4 },
    ],
  },
  {
    slug: "treadmill_incline_walk",
    name: "Treadmill incline walk",
    category: "conditioning",
    movementPattern: "conditioning",
    requiredEquipment: ["treadmill"],
    relations: [
      { muscle: "gluteus_maximus", role: "secondary_mover", weight: 0.3 },
      { muscle: "gastrocnemius", role: "secondary_mover", weight: 0.3 },
    ],
  },
];

export interface SeedFood {
  id: string;
  name: string;
  brand?: string;
  densityBasis: "per_100g" | "per_100ml";
  nutrients: {
    caloriesKcal: number;
    proteinGrams: number;
    carbohydrateGrams: number;
    fatGrams: number;
    fiberGrams?: number;
  };
  serving: { label: string; grams: number };
}

/** Approximate hand-written values — development fixtures only. */
export const SEED_FOODS: readonly SeedFood[] = [
  {
    id: SEED_FIXED_IDS.oats,
    name: "Rolled oats (dev fixture)",
    densityBasis: "per_100g",
    nutrients: {
      caloriesKcal: 379,
      proteinGrams: 13.2,
      carbohydrateGrams: 67.7,
      fatGrams: 6.5,
      fiberGrams: 10.1,
    },
    serving: { label: "40 g", grams: 40 },
  },
  {
    id: SEED_FIXED_IDS.chickenBreast,
    name: "Chicken breast, cooked (dev fixture)",
    densityBasis: "per_100g",
    nutrients: { caloriesKcal: 165, proteinGrams: 31, carbohydrateGrams: 0, fatGrams: 3.6 },
    serving: { label: "100 g", grams: 100 },
  },
  {
    id: SEED_FIXED_IDS.greekYogurt,
    name: "Greek yogurt (dev fixture)",
    densityBasis: "per_100g",
    nutrients: { caloriesKcal: 59, proteinGrams: 10, carbohydrateGrams: 3.6, fatGrams: 0.4 },
    serving: { label: "170 g cup", grams: 170 },
  },
];

export interface SeedDevUser {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
  profile: {
    sex: "male" | "female" | "intersex" | "undisclosed";
    heightCm: number;
    trainingExperience: "untrained" | "beginner" | "intermediate" | "advanced";
    trainingDaysPerWeek: number;
    sessionDurationMinutes: number;
    unitSystem: "metric" | "imperial";
  };
}

/** Labeled test user for local development only — never production data. */
export const SEED_DEV_USER: SeedDevUser = {
  id: SEED_FIXED_IDS.devUser,
  email: "dev@fitcoach.local",
  displayName: "Dev Fixture User",
  timezone: "Asia/Kolkata",
  profile: {
    sex: "male",
    heightCm: 178,
    trainingExperience: "intermediate",
    trainingDaysPerWeek: 4,
    sessionDurationMinutes: 60,
    unitSystem: "metric",
  },
};
