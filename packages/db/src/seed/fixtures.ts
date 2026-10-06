/**
 * DEVELOPMENT FIXTURES — hand-written first-party content.
 *
 * The exercise/muscle/equipment knowledge catalog lives in ./knowledgeTaxonomy
 * and ./knowledgeExercises*, which supersede the minimal Phase 1 lists that
 * used to live here.
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
