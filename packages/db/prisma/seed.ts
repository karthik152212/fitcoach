import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();

/**
 * UUIDv7 generation (time-ordered UUIDs)
 * Format: 48-bit timestamp (ms since epoch) + 74 random bits + version (7) + variant
 * UUID format: 8-4-4-4-12 (32 hex chars)
 */
function generateUuidv7(): string {
  const timestamp = Date.now();
  const timestampHex = timestamp.toString(16).padStart(12, "0");
  const randomPart = randomUUID().replace(/-/g, "").slice(12);
  const uuid = `${timestampHex}${randomPart}`; // 32 hex chars

  // UUID structure: 8-4-4-4-12
  const g1 = uuid.slice(0, 8);
  const g2 = uuid.slice(8, 12);
  const g3 = `7${uuid.slice(12, 15)}`; // version 7 in first nibble
  const g4 = `${((parseInt(uuid.slice(15, 16), 16) & 0x3) | 0x8).toString(16)}${uuid.slice(16, 19)}`; // variant 10x in first nibble
  const g5 = uuid.slice(19, 31); // 12 chars

  return [g1, g2, g3, g4, g5].join("-");
}

// Fixed UUIDs for food sources (generated once, used consistently)
const FOOD_SOURCE_USDA = "01a1bafa-75eb-749b-f9a5-7b218edf6fc4";
const FOOD_SOURCE_BRANDED = "01a1bafa-75ec-7416-5849-ede5b45ec92f";
const FOOD_SOURCE_COMMON = "01a1bafa-75ed-7451-0909-7c753794f37a";

/**
 * Food sources for seeding
 */
const foodSources = [
  {
    id: FOOD_SOURCE_USDA,
    name: "USDA FoodData Central",
    kind: "curated_database",
    defaultConfidence: "measured",
    externalSourceId: null,
  },
  {
    id: FOOD_SOURCE_BRANDED,
    name: "Branded Products Database",
    kind: "curated_database",
    defaultConfidence: "label_declared",
    externalSourceId: null,
  },
  {
    id: FOOD_SOURCE_COMMON,
    name: "Common Foods Reference",
    kind: "curated_database",
    defaultConfidence: "measured",
    externalSourceId: null,
  },
];

/**
 * Helper to create a food with generated UUIDs for id and servings
 */
function createFood(food: {
  sourceId: string;
  name: string;
  brand: string | null;
  densityBasis: "per_100g" | "per_100ml";
  caloriesKcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
  fiberG?: number | null;
  sugarsG?: number | null;
  saturatedFatG?: number | null;
  alcoholG?: number | null;
  sodiumMg?: number | null;
  barcode: string | null;
  externalId: string | null;
  servings: Array<{ label: string; grams?: number; milliliters?: number }>;
  defaultServingLabel: string;
}): {
  id: string;
  sourceId: string;
  name: string;
  brand: string | null;
  densityBasis: "per_100g" | "per_100ml";
  caloriesKcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
  fiberG: number | null;
  sugarsG: number | null;
  saturatedFatG: number | null;
  alcoholG: number | null;
  sodiumMg: number | null;
  barcode: string | null;
  externalId: string | null;
  servings: Array<{ id: string; label: string; grams?: number; milliliters?: number }>;
  defaultServingId: string;
} {
  const id = generateUuidv7();
  const servingsWithIds = food.servings.map((s) => ({ ...s, id: generateUuidv7() }));
  const defaultServing = servingsWithIds.find((s) => s.label === food.defaultServingLabel);
  return {
    id,
    sourceId: food.sourceId,
    name: food.name,
    brand: food.brand,
    densityBasis: food.densityBasis,
    caloriesKcal: food.caloriesKcal,
    proteinG: food.proteinG,
    carbohydrateG: food.carbohydrateG,
    fatG: food.fatG,
    fiberG: food.fiberG ?? null,
    sugarsG: food.sugarsG ?? null,
    saturatedFatG: food.saturatedFatG ?? null,
    alcoholG: food.alcoholG ?? null,
    sodiumMg: food.sodiumMg ?? null,
    barcode: food.barcode,
    externalId: food.externalId,
    servings: servingsWithIds,
    defaultServingId: defaultServing?.id ?? servingsWithIds[0]?.id ?? "",
  };
}

/**
 * Core foods to seed - representative items across categories
 */
const foods = [
  // Proteins
  createFood({
    sourceId: FOOD_SOURCE_USDA,
    name: "Chicken Breast, Raw",
    brand: null,
    densityBasis: "per_100g",
    caloriesKcal: 165,
    proteinG: 31.0,
    carbohydrateG: 0,
    fatG: 3.6,
    fiberG: 0,
    sugarsG: 0,
    saturatedFatG: 1.0,
    alcoholG: 0,
    sodiumMg: 74,
    barcode: null,
    externalId: "090252",
    servings: [
      { label: "100g", grams: 100 },
      { label: "4 oz", grams: 113 },
      { label: "6 oz", grams: 170 },
    ],
    defaultServingLabel: "100g",
  }),
  createFood({
    sourceId: FOOD_SOURCE_USDA,
    name: "Atlantic Salmon, Raw",
    brand: null,
    densityBasis: "per_100g",
    caloriesKcal: 208,
    proteinG: 20.4,
    carbohydrateG: 0,
    fatG: 13.4,
    fiberG: 0,
    sugarsG: 0,
    saturatedFatG: 3.1,
    alcoholG: 0,
    sodiumMg: 59,
    barcode: null,
    externalId: "150762",
    servings: [
      { label: "100g", grams: 100 },
      { label: "4 oz", grams: 113 },
      { label: "6 oz", grams: 170 },
    ],
    defaultServingLabel: "100g",
  }),
  createFood({
    sourceId: FOOD_SOURCE_USDA,
    name: "Egg, Whole, Raw",
    brand: null,
    densityBasis: "per_100g",
    caloriesKcal: 143,
    proteinG: 12.6,
    carbohydrateG: 0.7,
    fatG: 9.5,
    fiberG: 0,
    sugarsG: 0.4,
    saturatedFatG: 3.1,
    alcoholG: 0,
    sodiumMg: 142,
    barcode: null,
    externalId: "010231",
    servings: [
      { label: "1 large egg", grams: 50 },
      { label: "1 medium egg", grams: 44 },
      { label: "100g", grams: 100 },
    ],
    defaultServingLabel: "1 large egg",
  }),
  createFood({
    sourceId: FOOD_SOURCE_USDA,
    name: "Greek Yogurt, Plain, Nonfat",
    brand: null,
    densityBasis: "per_100g",
    caloriesKcal: 59,
    proteinG: 10.2,
    carbohydrateG: 3.6,
    fatG: 0.4,
    fiberG: 0,
    sugarsG: 3.2,
    saturatedFatG: 0.1,
    alcoholG: 0,
    sodiumMg: 36,
    barcode: null,
    externalId: "010511",
    servings: [
      { label: "100g", grams: 100 },
      { label: "1 cup (170g)", grams: 170 },
      { label: "8 oz container", grams: 227 },
    ],
    defaultServingLabel: "1 cup (170g)",
  }),
  createFood({
    sourceId: FOOD_SOURCE_BRANDED,
    name: "Whey Protein Isolate",
    brand: "Optimum Nutrition",
    densityBasis: "per_100g",
    caloriesKcal: 370,
    proteinG: 88.0,
    carbohydrateG: 3.0,
    fatG: 1.0,
    fiberG: 0,
    sugarsG: 1.0,
    saturatedFatG: 0.5,
    alcoholG: 0,
    sodiumMg: 200,
    barcode: "074892702853",
    externalId: "opt-whey-iso-5lb",
    servings: [
      { label: "1 scoop (30g)", grams: 30 },
      { label: "100g", grams: 100 },
    ],
    defaultServingLabel: "1 scoop (30g)",
  }),

  // Carbohydrates
  createFood({
    sourceId: FOOD_SOURCE_USDA,
    name: "White Rice, Cooked",
    brand: null,
    densityBasis: "per_100g",
    caloriesKcal: 130,
    proteinG: 2.7,
    carbohydrateG: 28.2,
    fatG: 0.3,
    fiberG: 0.4,
    sugarsG: 0.1,
    saturatedFatG: 0.1,
    alcoholG: 0,
    sodiumMg: 1,
    barcode: null,
    externalId: "020005",
    servings: [
      { label: "100g", grams: 100 },
      { label: "1 cup cooked", grams: 158 },
      { label: "200g", grams: 200 },
    ],
    defaultServingLabel: "1 cup cooked",
  }),
  createFood({
    sourceId: FOOD_SOURCE_USDA,
    name: "Brown Rice, Cooked",
    brand: null,
    densityBasis: "per_100g",
    caloriesKcal: 112,
    proteinG: 2.6,
    carbohydrateG: 23.5,
    fatG: 0.9,
    fiberG: 1.8,
    sugarsG: 0.2,
    saturatedFatG: 0.2,
    alcoholG: 0,
    sodiumMg: 5,
    barcode: null,
    externalId: "020014",
    servings: [
      { label: "100g", grams: 100 },
      { label: "1 cup cooked", grams: 195 },
      { label: "200g", grams: 200 },
    ],
    defaultServingLabel: "1 cup cooked",
  }),
  createFood({
    sourceId: FOOD_SOURCE_USDA,
    name: "Rolled Oats, Dry",
    brand: null,
    densityBasis: "per_100g",
    caloriesKcal: 389,
    proteinG: 16.9,
    carbohydrateG: 66.3,
    fatG: 6.9,
    fiberG: 10.6,
    sugarsG: 1.0,
    saturatedFatG: 1.2,
    alcoholG: 0,
    sodiumMg: 2,
    barcode: null,
    externalId: "08120",
    servings: [
      { label: "100g", grams: 100 },
      { label: "40g (1/2 cup dry)", grams: 40 },
      { label: "1 cup dry", grams: 81 },
    ],
    defaultServingLabel: "40g (1/2 cup dry)",
  }),
  createFood({
    sourceId: FOOD_SOURCE_USDA,
    name: "Sweet Potato, Raw",
    brand: null,
    densityBasis: "per_100g",
    caloriesKcal: 86,
    proteinG: 1.6,
    carbohydrateG: 20.1,
    fatG: 0.1,
    fiberG: 3.0,
    sugarsG: 4.2,
    saturatedFatG: 0,
    alcoholG: 0,
    sodiumMg: 55,
    barcode: null,
    externalId: "11508",
    servings: [
      { label: "100g", grams: 100 },
      { label: "1 medium (130g)", grams: 130 },
      { label: "200g", grams: 200 },
    ],
    defaultServingLabel: "1 medium (130g)",
  }),
  createFood({
    sourceId: FOOD_SOURCE_USDA,
    name: "Banana, Raw",
    brand: null,
    densityBasis: "per_100g",
    caloriesKcal: 89,
    proteinG: 1.1,
    carbohydrateG: 22.8,
    fatG: 0.3,
    fiberG: 2.6,
    sugarsG: 12.2,
    saturatedFatG: 0.1,
    alcoholG: 0,
    sodiumMg: 1,
    barcode: null,
    externalId: "09040",
    servings: [
      { label: "100g", grams: 100 },
      { label: "1 small (101g)", grams: 101 },
      { label: "1 medium (118g)", grams: 118 },
      { label: "1 large (136g)", grams: 136 },
    ],
    defaultServingLabel: "1 medium (118g)",
  }),
  createFood({
    sourceId: FOOD_SOURCE_USDA,
    name: "Quinoa, Cooked",
    brand: null,
    densityBasis: "per_100g",
    caloriesKcal: 120,
    proteinG: 4.4,
    carbohydrateG: 21.3,
    fatG: 1.9,
    fiberG: 2.8,
    sugarsG: 0.9,
    saturatedFatG: 0.2,
    alcoholG: 0,
    sodiumMg: 7,
    barcode: null,
    externalId: "20035",
    servings: [
      { label: "100g", grams: 100 },
      { label: "1 cup cooked", grams: 185 },
    ],
    defaultServingLabel: "1 cup cooked",
  }),

  // Fats
  createFood({
    sourceId: FOOD_SOURCE_USDA,
    name: "Avocado, Raw",
    brand: null,
    densityBasis: "per_100g",
    caloriesKcal: 160,
    proteinG: 2.0,
    carbohydrateG: 8.5,
    fatG: 14.7,
    fiberG: 6.7,
    sugarsG: 0.7,
    saturatedFatG: 2.1,
    alcoholG: 0,
    sodiumMg: 7,
    barcode: null,
    externalId: "09037",
    servings: [
      { label: "100g", grams: 100 },
      { label: "1/2 medium", grams: 68 },
      { label: "1 whole medium", grams: 136 },
    ],
    defaultServingLabel: "1/2 medium",
  }),
  createFood({
    sourceId: FOOD_SOURCE_USDA,
    name: "Almonds, Dry Roasted, Unsalted",
    brand: null,
    densityBasis: "per_100g",
    caloriesKcal: 579,
    proteinG: 21.2,
    carbohydrateG: 21.6,
    fatG: 49.9,
    fiberG: 12.5,
    sugarsG: 4.4,
    saturatedFatG: 3.8,
    alcoholG: 0,
    sodiumMg: 1,
    barcode: null,
    externalId: "12061",
    servings: [
      { label: "100g", grams: 100 },
      { label: "1 oz (28g)", grams: 28 },
      { label: "1/2 oz (14g)", grams: 14 },
    ],
    defaultServingLabel: "1 oz (28g)",
  }),
  createFood({
    sourceId: FOOD_SOURCE_USDA,
    name: "Olive Oil",
    brand: null,
    densityBasis: "per_100g",
    caloriesKcal: 884,
    proteinG: 0,
    carbohydrateG: 0,
    fatG: 100,
    fiberG: 0,
    sugarsG: 0,
    saturatedFatG: 13.8,
    alcoholG: 0,
    sodiumMg: 2,
    barcode: null,
    externalId: "04053",
    servings: [
      { label: "100g", grams: 100 },
      { label: "1 tbsp (13.5g)", grams: 13.5 },
      { label: "1 tsp (4.5g)", grams: 4.5 },
    ],
    defaultServingLabel: "1 tbsp (13.5g)",
  }),
  createFood({
    sourceId: FOOD_SOURCE_BRANDED,
    name: "Peanut Butter, Natural",
    brand: "Jif Natural",
    densityBasis: "per_100g",
    caloriesKcal: 588,
    proteinG: 22.2,
    carbohydrateG: 22.3,
    fatG: 50.4,
    fiberG: 6.0,
    sugarsG: 9.2,
    saturatedFatG: 10.5,
    alcoholG: 0,
    sodiumMg: 459,
    barcode: "051500241587",
    externalId: "jif-natural-pb-16oz",
    servings: [
      { label: "100g", grams: 100 },
      { label: "1 tbsp (16g)", grams: 16 },
      { label: "2 tbsp (32g)", grams: 32 },
    ],
    defaultServingLabel: "2 tbsp (32g)",
  }),

  // Vegetables
  createFood({
    sourceId: FOOD_SOURCE_USDA,
    name: "Broccoli, Raw",
    brand: null,
    densityBasis: "per_100g",
    caloriesKcal: 34,
    proteinG: 2.8,
    carbohydrateG: 6.6,
    fatG: 0.4,
    fiberG: 2.6,
    sugarsG: 1.7,
    saturatedFatG: 0,
    alcoholG: 0,
    sodiumMg: 33,
    barcode: null,
    externalId: "11090",
    servings: [
      { label: "100g", grams: 100 },
      { label: "1 cup chopped (91g)", grams: 91 },
      { label: "1 spear (37g)", grams: 37 },
    ],
    defaultServingLabel: "1 cup chopped (91g)",
  }),
  createFood({
    sourceId: FOOD_SOURCE_USDA,
    name: "Spinach, Raw",
    brand: null,
    densityBasis: "per_100g",
    caloriesKcal: 23,
    proteinG: 2.9,
    carbohydrateG: 3.6,
    fatG: 0.4,
    fiberG: 2.2,
    sugarsG: 0.4,
    saturatedFatG: 0,
    alcoholG: 0,
    sodiumMg: 79,
    barcode: null,
    externalId: "11457",
    servings: [
      { label: "100g", grams: 100 },
      { label: "1 cup (30g)", grams: 30 },
      { label: "1 bag (142g)", grams: 142 },
    ],
    defaultServingLabel: "1 cup (30g)",
  }),

  // Fruits
  createFood({
    sourceId: FOOD_SOURCE_USDA,
    name: "Apple, Raw, With Skin",
    brand: null,
    densityBasis: "per_100g",
    caloriesKcal: 52,
    proteinG: 0.3,
    carbohydrateG: 13.8,
    fatG: 0.2,
    fiberG: 2.4,
    sugarsG: 10.4,
    saturatedFatG: 0,
    alcoholG: 0,
    sodiumMg: 1,
    barcode: null,
    externalId: "09003",
    servings: [
      { label: "100g", grams: 100 },
      { label: "1 small (149g)", grams: 149 },
      { label: "1 medium (182g)", grams: 182 },
      { label: "1 large (223g)", grams: 223 },
    ],
    defaultServingLabel: "1 medium (182g)",
  }),
  createFood({
    sourceId: FOOD_SOURCE_USDA,
    name: "Blueberries, Raw",
    brand: null,
    densityBasis: "per_100g",
    caloriesKcal: 57,
    proteinG: 0.7,
    carbohydrateG: 14.5,
    fatG: 0.3,
    fiberG: 2.4,
    sugarsG: 10.0,
    saturatedFatG: 0,
    alcoholG: 0,
    sodiumMg: 1,
    barcode: null,
    externalId: "09050",
    servings: [
      { label: "100g", grams: 100 },
      { label: "1 cup (148g)", grams: 148 },
      { label: "1/2 cup (50g)", grams: 50 },
    ],
    defaultServingLabel: "1 cup (148g)",
  }),

  // Dairy
  createFood({
    sourceId: FOOD_SOURCE_USDA,
    name: "Whole Milk, 3.25% Fat",
    brand: null,
    densityBasis: "per_100ml",
    caloriesKcal: 61,
    proteinG: 3.2,
    carbohydrateG: 4.8,
    fatG: 3.3,
    fiberG: 0,
    sugarsG: 5.1,
    saturatedFatG: 1.9,
    alcoholG: 0,
    sodiumMg: 43,
    barcode: null,
    externalId: "01077",
    servings: [
      { label: "100ml", milliliters: 100 },
      { label: "1 cup (244ml)", milliliters: 244 },
      { label: "8 fl oz (237ml)", milliliters: 237 },
    ],
    defaultServingLabel: "1 cup (244ml)",
  }),
  createFood({
    sourceId: FOOD_SOURCE_USDA,
    name: "Cheddar Cheese",
    brand: null,
    densityBasis: "per_100g",
    caloriesKcal: 402,
    proteinG: 24.9,
    carbohydrateG: 1.3,
    fatG: 33.1,
    fiberG: 0,
    sugarsG: 0.5,
    saturatedFatG: 21.1,
    alcoholG: 0,
    sodiumMg: 621,
    barcode: null,
    externalId: "01009",
    servings: [
      { label: "100g", grams: 100 },
      { label: "1 oz (28g)", grams: 28 },
      { label: "1 slice (17g)", grams: 17 },
    ],
    defaultServingLabel: "1 oz (28g)",
  }),

  // Breads & Grains
  createFood({
    sourceId: FOOD_SOURCE_USDA,
    name: "Whole Wheat Bread",
    brand: null,
    densityBasis: "per_100g",
    caloriesKcal: 247,
    proteinG: 13.2,
    carbohydrateG: 41.3,
    fatG: 3.4,
    fiberG: 6.7,
    sugarsG: 5.6,
    saturatedFatG: 0.7,
    alcoholG: 0,
    sodiumMg: 400,
    barcode: null,
    externalId: "18069",
    servings: [
      { label: "100g", grams: 100 },
      { label: "1 slice (28g)", grams: 28 },
      { label: "2 slices (56g)", grams: 56 },
    ],
    defaultServingLabel: "1 slice (28g)",
  }),

  // Legumes
  createFood({
    sourceId: FOOD_SOURCE_USDA,
    name: "Black Beans, Cooked",
    brand: null,
    densityBasis: "per_100g",
    caloriesKcal: 132,
    proteinG: 8.9,
    carbohydrateG: 23.7,
    fatG: 0.5,
    fiberG: 8.7,
    sugarsG: 0.3,
    saturatedFatG: 0.1,
    alcoholG: 0,
    sodiumMg: 237,
    barcode: null,
    externalId: "16015",
    servings: [
      { label: "100g", grams: 100 },
      { label: "1 cup (172g)", grams: 172 },
      { label: "1/2 cup (86g)", grams: 86 },
    ],
    defaultServingLabel: "1 cup (172g)",
  }),

  // Beverages
  createFood({
    sourceId: FOOD_SOURCE_USDA,
    name: "Coffee, Black, Brewed",
    brand: null,
    densityBasis: "per_100ml",
    caloriesKcal: 1,
    proteinG: 0.1,
    carbohydrateG: 0,
    fatG: 0,
    fiberG: 0,
    sugarsG: 0,
    saturatedFatG: 0,
    alcoholG: 0,
    sodiumMg: 2,
    barcode: null,
    externalId: "14209",
    servings: [
      { label: "100ml", milliliters: 100 },
      { label: "1 cup (237ml)", milliliters: 237 },
      { label: "12 fl oz (355ml)", milliliters: 355 },
    ],
    defaultServingLabel: "1 cup (237ml)",
  }),
];

/**
 * Nutrient definitions for V2 registry
 */
const nutrientDefinitions = [
  // Core energy & macros
  { key: "calories_kcal", displayName: "Calories", unit: "kcal", category: "energy", precision: 0, rdiValue: 2000, rdiUnit: "kcal", sortOrder: 1, isCore: true },
  { key: "protein", displayName: "Protein", unit: "g", category: "macronutrient", precision: 1, rdiValue: 50, rdiUnit: "g", sortOrder: 2, isCore: true },
  { key: "carbohydrate", displayName: "Carbohydrate", unit: "g", category: "macronutrient", precision: 1, rdiValue: 275, rdiUnit: "g", sortOrder: 3, isCore: true },
  { key: "fat", displayName: "Fat", unit: "g", category: "macronutrient", precision: 1, rdiValue: 78, rdiUnit: "g", sortOrder: 4, isCore: true },
  { key: "fiber", displayName: "Fiber", unit: "g", category: "fiber", precision: 1, rdiValue: 28, rdiUnit: "g", sortOrder: 5, isCore: true },
  { key: "sugars", displayName: "Sugars", unit: "g", category: "sugar", precision: 1, sortOrder: 6, isCore: true },
  { key: "saturated_fat", displayName: "Saturated Fat", unit: "g", category: "fat_detail", precision: 1, rdiValue: 20, rdiUnit: "g", sortOrder: 7, isCore: true },
  { key: "alcohol", displayName: "Alcohol", unit: "g", category: "energy", precision: 1, sortOrder: 8, isCore: true },
  { key: "sodium", displayName: "Sodium", unit: "mg", category: "mineral", precision: 0, rdiValue: 2300, rdiUnit: "mg", sortOrder: 9, isCore: true },

  // Fat detail
  { key: "monounsaturated_fat", displayName: "Monounsaturated Fat", unit: "g", category: "fat_detail", precision: 1, sortOrder: 10, isCore: false },
  { key: "polyunsaturated_fat", displayName: "Polyunsaturated Fat", unit: "g", category: "fat_detail", precision: 1, sortOrder: 11, isCore: false },
  { key: "omega_3", displayName: "Omega-3 Fatty Acids", unit: "g", category: "fat_detail", precision: 2, rdiValue: 1.6, rdiUnit: "g", sortOrder: 12, isCore: false },
  { key: "omega_6", displayName: "Omega-6 Fatty Acids", unit: "g", category: "fat_detail", precision: 2, rdiValue: 17, rdiUnit: "g", sortOrder: 13, isCore: false },
  { key: "cholesterol", displayName: "Cholesterol", unit: "mg", category: "fat_detail", precision: 0, rdiValue: 300, rdiUnit: "mg", sortOrder: 14, isCore: false },
  { key: "trans_fat", displayName: "Trans Fat", unit: "g", category: "fat_detail", precision: 2, sortOrder: 15, isCore: false },

  // Minerals
  { key: "potassium", displayName: "Potassium", unit: "mg", category: "mineral", precision: 0, rdiValue: 4700, rdiUnit: "mg", sortOrder: 20, isCore: false },
  { key: "calcium", displayName: "Calcium", unit: "mg", category: "mineral", precision: 0, rdiValue: 1300, rdiUnit: "mg", sortOrder: 21, isCore: false },
  { key: "iron", displayName: "Iron", unit: "mg", category: "mineral", precision: 1, rdiValue: 18, rdiUnit: "mg", sortOrder: 22, isCore: false },
  { key: "magnesium", displayName: "Magnesium", unit: "mg", category: "mineral", precision: 0, rdiValue: 420, rdiUnit: "mg", sortOrder: 23, isCore: false },
  { key: "zinc", displayName: "Zinc", unit: "mg", category: "mineral", precision: 1, rdiValue: 11, rdiUnit: "mg", sortOrder: 24, isCore: false },
  { key: "copper", displayName: "Copper", unit: "mg", category: "mineral", precision: 2, rdiValue: 0.9, rdiUnit: "mg", sortOrder: 25, isCore: false },
  { key: "manganese", displayName: "Manganese", unit: "mg", category: "mineral", precision: 1, rdiValue: 2.3, rdiUnit: "mg", sortOrder: 26, isCore: false },
  { key: "selenium", displayName: "Selenium", unit: "mcg", category: "mineral", precision: 0, rdiValue: 55, rdiUnit: "mcg", sortOrder: 27, isCore: false },
  { key: "phosphorus", displayName: "Phosphorus", unit: "mg", category: "mineral", precision: 0, rdiValue: 1250, rdiUnit: "mg", sortOrder: 28, isCore: false },

  // Vitamins
  { key: "vitamin_a", displayName: "Vitamin A", unit: "mcg", category: "vitamin", precision: 0, rdiValue: 900, rdiUnit: "mcg", sortOrder: 30, isCore: false },
  { key: "vitamin_c", displayName: "Vitamin C", unit: "mg", category: "vitamin", precision: 0, rdiValue: 90, rdiUnit: "mg", sortOrder: 31, isCore: false },
  { key: "vitamin_d", displayName: "Vitamin D", unit: "mcg", category: "vitamin", precision: 1, rdiValue: 20, rdiUnit: "mcg", sortOrder: 32, isCore: false },
  { key: "vitamin_e", displayName: "Vitamin E", unit: "mg", category: "vitamin", precision: 1, rdiValue: 15, rdiUnit: "mg", sortOrder: 33, isCore: false },
  { key: "vitamin_k", displayName: "Vitamin K", unit: "mcg", category: "vitamin", precision: 0, rdiValue: 120, rdiUnit: "mcg", sortOrder: 34, isCore: false },
  { key: "thiamin", displayName: "Thiamin (B1)", unit: "mg", category: "vitamin", precision: 2, rdiValue: 1.2, rdiUnit: "mg", sortOrder: 35, isCore: false },
  { key: "riboflavin", displayName: "Riboflavin (B2)", unit: "mg", category: "vitamin", precision: 2, rdiValue: 1.3, rdiUnit: "mg", sortOrder: 36, isCore: false },
  { key: "niacin", displayName: "Niacin (B3)", unit: "mg", category: "vitamin", precision: 1, rdiValue: 16, rdiUnit: "mg", sortOrder: 37, isCore: false },
  { key: "vitamin_b6", displayName: "Vitamin B6", unit: "mg", category: "vitamin", precision: 2, rdiValue: 1.7, rdiUnit: "mg", sortOrder: 38, isCore: false },
  { key: "folate", displayName: "Folate (B9)", unit: "mcg", category: "vitamin", precision: 0, rdiValue: 400, rdiUnit: "mcg", sortOrder: 39, isCore: false },
  { key: "vitamin_b12", displayName: "Vitamin B12", unit: "mcg", category: "vitamin", precision: 1, rdiValue: 2.4, rdiUnit: "mcg", sortOrder: 40, isCore: false },
];

/**
 * Sample recipes
 */
const recipes = [
  {
    id: generateUuidv7(),
    name: "Chicken & Rice Bowl",
    servings: 2,
    instructions: "1. Cook rice according to package directions\n2. Season chicken with salt, pepper, garlic powder\n3. Pan-sear chicken 6-7 min per side until 165°F internal\n4. Steam broccoli until tender-crisp\n5. Assemble bowls: rice base, sliced chicken, broccoli\n6. Drizzle with olive oil and optional soy sauce",
    items: [
      // These will be resolved by food name lookup
      { foodName: "Chicken Breast, Raw", quantityGrams: 300 },
      { foodName: "White Rice, Cooked", quantityGrams: 300 },
      { foodName: "Broccoli, Raw", quantityGrams: 200 },
      { foodName: "Olive Oil", quantityGrams: 15 },
    ],
  },
  {
    id: generateUuidv7(),
    name: "Greek Yogurt Parfait",
    servings: 1,
    instructions: "1. Layer half the yogurt in a bowl\n2. Add half the blueberries and almonds\n3. Repeat layers\n4. Drizzle with honey if desired",
    items: [
      { foodName: "Greek Yogurt, Plain, Nonfat", quantityGrams: 170 },
      { foodName: "Blueberries, Raw", quantityGrams: 100 },
      { foodName: "Almonds, Dry Roasted, Unsalted", quantityGrams: 14 },
    ],
  },
  {
    id: generateUuidv7(),
    name: "Protein Oatmeal",
    servings: 1,
    instructions: "1. Cook oats with water or milk\n2. Stir in whey protein after cooking (off heat)\n3. Top with banana slices and peanut butter\n4. Add cinnamon to taste",
    items: [
      { foodName: "Rolled Oats, Dry", quantityGrams: 40 },
      { foodName: "Whole Milk, 3.25% Fat", quantityGrams: 244 },
      { foodName: "Whey Protein Isolate", quantityGrams: 30 },
      { foodName: "Banana, Raw", quantityGrams: 118 },
      { foodName: "Peanut Butter, Natural", quantityGrams: 16 },
    ],
  },
  {
    id: generateUuidv7(),
    name: "Salmon with Sweet Potato & Spinach",
    servings: 2,
    instructions: "1. Preheat oven to 400°F\n2. Cube sweet potato, toss with 1 tbsp olive oil, roast 25 min\n3. Season salmon, bake on same pan last 12 min\n4. Sauté spinach in remaining olive oil until wilted\n5. Serve salmon with sweet potato and spinach",
    items: [
      { foodName: "Atlantic Salmon, Raw", quantityGrams: 226 },
      { foodName: "Sweet Potato, Raw", quantityGrams: 300 },
      { foodName: "Spinach, Raw", quantityGrams: 100 },
      { foodName: "Olive Oil", quantityGrams: 20 },
    ],
  },
  {
    id: generateUuidv7(),
    name: "Egg & Avocado Toast",
    servings: 1,
    instructions: "1. Toast bread\n2. Mash avocado with salt, pepper, lemon juice\n3. Fry or poach eggs\n4. Spread avocado on toast, top with eggs\n5. Sprinkle with red pepper flakes",
    items: [
      { foodName: "Whole Wheat Bread", quantityGrams: 56 },
      { foodName: "Avocado, Raw", quantityGrams: 68 },
      { foodName: "Egg, Whole, Raw", quantityGrams: 100 },
      { foodName: "Olive Oil", quantityGrams: 5 },
    ],
  },
];

async function seedExternalSources() {
  console.log("Seeding external sources...");
  const sources = [
    { slug: "usda_fdc", name: "USDA FoodData Central", originUrl: "https://fdc.nal.usda.gov", licenseSpdx: "CC0-1.0", licenseVerified: true },
    { slug: "openfoodfacts", name: "Open Food Facts", originUrl: "https://world.openfoodfacts.org", licenseSpdx: "ODbL-1.0", licenseVerified: true },
  ];
  for (const source of sources) {
    await prisma.externalSource.upsert({
      where: { slug: source.slug },
      update: source,
      create: { ...source, id: generateUuidv7() },
    });
  }
  console.log(`  ✓ ${sources.length} external sources`);
}

async function seedFoodSources() {
  console.log("Seeding food sources...");
  for (const source of foodSources) {
    await prisma.foodSource.upsert({
      where: { id: source.id },
      update: {
        name: source.name,
        kind: source.kind,
        defaultConfidence: source.defaultConfidence,
        externalSourceId: source.externalSourceId,
      },
      create: {
        id: source.id,
        name: source.name,
        kind: source.kind,
        defaultConfidence: source.defaultConfidence,
        externalSourceId: source.externalSourceId,
      },
    });
  }
  console.log(`  ✓ ${foodSources.length} food sources`);
}

async function seedNutrientDefinitions() {
  console.log("Seeding nutrient definitions...");
  for (const nutrient of nutrientDefinitions) {
    await prisma.nutrientDefinition.upsert({
      where: { key: nutrient.key },
      update: {
        displayName: nutrient.displayName,
        unit: nutrient.unit,
        category: nutrient.category,
        precision: nutrient.precision,
        rdiValue: nutrient.rdiValue,
        rdiUnit: nutrient.rdiUnit,
        sortOrder: nutrient.sortOrder,
        isCore: nutrient.isCore,
        isActive: true,
      },
      create: {
        id: generateUuidv7(),
        ...nutrient,
        isActive: true,
      },
    });
  }
  console.log(`  ✓ ${nutrientDefinitions.length} nutrient definitions`);
}

async function seedFoods() {
  console.log("Seeding foods...");
  for (const food of foods) {
    const { servings, defaultServingId, ...foodData } = food;

    // First, upsert the food WITHOUT defaultServingId
    await prisma.food.upsert({
      where: { id: food.id },
      update: foodData,
      create: foodData,
    });

    // Then, upsert all servings
    for (const serving of servings) {
      await prisma.foodServing.upsert({
        where: { foodId_label: { foodId: food.id, label: serving.label } },
        update: { ...serving, foodId: food.id },
        create: { ...serving, foodId: food.id },
      });
    }

    // Finally, update the food with defaultServingId now that servings exist
    await prisma.food.update({
      where: { id: food.id },
      data: { defaultServingId },
    });
  }
  console.log(`  ✓ ${foods.length} foods with servings`);
}

async function seedRecipes() {
  console.log("Seeding recipes...");

  // Build a map of food name to food ID
  const foodMap = new Map<string, string>();
  for (const food of foods) {
    foodMap.set(food.name, food.id);
  }

  for (const recipe of recipes) {
    const { items, ...recipeData } = recipe;
    await prisma.recipe.upsert({
      where: { id: recipe.id },
      update: recipeData,
      create: recipeData,
    });

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const foodId = foodMap.get(item.foodName);
      if (!foodId) {
        console.warn(`  ⚠ Food not found for recipe item: ${item.foodName}`);
        continue;
      }
      await prisma.recipeItem.upsert({
        where: { recipeId_position: { recipeId: recipe.id, position: i } },
        update: { foodId, quantityGrams: item.quantityGrams, position: i },
        create: { id: generateUuidv7(), recipeId: recipe.id, foodId, quantityGrams: item.quantityGrams, position: i },
      });
    }
  }
  console.log(`  ✓ ${recipes.length} recipes with items`);
}

async function main() {
  console.log("🌱 Starting database seed...\n");

  await seedExternalSources();
  await seedFoodSources();
  await seedNutrientDefinitions();
  await seedFoods();
  await seedRecipes();

  console.log("\n✅ Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });