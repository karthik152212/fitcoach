import type {
  BaseEntity,
  CalendarDate,
  EntityId,
  ExternalProvenance,
  FoodId,
  FoodSourceId,
  MealId,
  RecipeId,
  Timestamp,
  UserId,
} from "./shared";

/** Canonical macro/micronutrient amounts. Grams unless stated otherwise. */
export interface NutrientAmounts {
  caloriesKcal: number;
  proteinGrams: number;
  carbohydrateGrams: number;
  fatGrams: number;
  fiberGrams?: number;
  sugarsGrams?: number;
  saturatedFatGrams?: number;
  sodiumMilligrams?: number;
  alcoholGrams?: number;
}

export type ConfidenceLevel = "measured" | "label_declared" | "estimated" | "unknown";

export type FoodSourceKind =
  | "curated_database"
  | "user_created"
  | "imported"
  | "estimate";

/**
 * Where food data came from and how much it is trusted by default.
 * Estimates (manual or AI-assisted) must stay distinguishable from verified
 * data forever.
 */
export interface FoodSource extends BaseEntity {
  name: string;
  kind: FoodSourceKind;
  defaultConfidence: ConfidenceLevel;
  provenance?: ExternalProvenance;
}

/**
 * A named serving definition. Exactly one size basis should be present.
 * Conversions between servings and gram quantities belong to the nutrition
 * package, which derives everything from nutrientsPer100g/ml below.
 */
export interface ServingDefinition {
  id: EntityId;
  label: string;
  grams?: number;
  milliliters?: number;
  /** Count-based serving, e.g. { unitQuantity: 1, unitName: "large egg" }. */
  unitQuantity?: number;
  unitName?: string;
}

export interface Food extends BaseEntity {
  name: string;
  brand?: string;
  sourceId: FoodSourceId;
  /**
   * Canonical nutrient density. All serving math derives from this; competing
   * per-serving nutrient values are never stored as independent truths.
   */
  densityBasis: "per_100g" | "per_100ml";
  nutrientsPer100g: NutrientAmounts;
  servings: readonly ServingDefinition[];
  defaultServingId?: EntityId;
  provenance?: ExternalProvenance;
}

export interface RecipeItem {
  id: EntityId;
  foodId: FoodId;
  /** Raw quantity of the food used, in grams (or ml-gram-equivalents for liquids). */
  quantityGrams: number;
  notes?: string;
}

export interface Recipe extends BaseEntity {
  /** Undefined means shared/global recipe. */
  ownerUserId?: UserId;
  name: string;
  /** Number of portions the item quantities produce. */
  servings: number;
  items: readonly RecipeItem[];
  instructions?: string;
}

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack" | "other";

export type MealItemRef =
  | { kind: "food"; foodId: FoodId }
  | { kind: "recipe"; recipeId: RecipeId };

export interface MealItem {
  id: EntityId;
  ref: MealItemRef;
  /** Consumed quantity in grams/ml of the referenced food. */
  quantityGrams?: number;
  /** For recipes: consumed multiples of one recipe serving. */
  recipeServings?: number;
  /**
   * Nutrients snapshotted at logging time so history survives later edits to
   * the underlying food/recipe data.
   */
  computedNutrients: NutrientAmounts;
  confidence: ConfidenceLevel;
  notes?: string;
}

export interface Meal extends BaseEntity {
  userId: UserId;
  /** User-local day the meal belongs to. */
  date: CalendarDate;
  consumedAt?: Timestamp;
  slot?: MealSlot;
  items: readonly MealItem[];
  /** Snapshot of summed item nutrients at logging time. */
  totals: NutrientAmounts;
  notes?: string;
}

/**
 * Explicit nutrition targets the coach reasons against. Targets are always
 * contextual to the person, their goal and their activity — there are no
 * universal targets.
 */
export interface NutritionTargets {
  caloriesKcal: number;
  proteinGrams: number;
  carbohydrateGrams?: number;
  fatGrams?: number;
  fiberGrams?: number;
  /** How these numbers were derived; required for explainability. */
  basisNote?: string;
  effectiveFrom: CalendarDate;
}

/**
 * Aggregated nutrition knowledge for one user-day. Totals are snapshots;
 * recomputability comes from the retained meals referenced by mealIds.
 */
export interface DailyNutrition extends BaseEntity {
  userId: UserId;
  date: CalendarDate;
  mealIds: readonly MealId[];
  totals: NutrientAmounts;
  /** Targets known/applied that day, for historical comparison. */
  targetsSnapshot?: NutritionTargets;
}
