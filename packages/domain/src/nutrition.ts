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
  ConfidenceLevel,
  Estimated,
  UncertaintyRange,
} from "./shared";

/**
 * Units a nutrient value can be expressed in. Energy is kcal (or kJ when a
 * source only publishes kJ); masses are g/mg/µg; some micronutrients are only
 * published as IU. The unit is carried WITH the value, never assumed by the
 * consumer (PRODUCT_SPEC V2 §Nutrition).
 */
export type NutrientUnit = "kcal" | "kj" | "g" | "mg" | "mcg" | "iu";

/**
 * Canonical nutrient amounts for a quantity of food. Grams unless the field
 * name says otherwise.
 *
 * V2 notes:
 * - Energy, macros and the flat fat detail below are the "core" set. They are
 *   the values every meal/day total can always rely on.
 * - Everything is optional except the four required fields because real food
 *   data is sparse: a missing nutrient is UNKNOWN, never zero and never
 *   silently invented (PRODUCT_SPEC §Scientific honesty). Absence must survive
 *   scaling, summing and dividing.
 * - Micronutrients and any future minor nutrient go in `additionalNutrients`
 *   keyed by canonical nutrient key ("vitamin_d", "iron", ...). That bag is the
 *   designed extension point: adding a micronutrient must never require
 *   changing the meal, recipe or snapshot model. Phase 4 binds those keys to
 *   the `nutrient_definitions` registry (docs/DATABASE_DESIGN.md §V2 review);
 *   until that registry exists the bag is domain-only (divergence D12).
 */
export interface NutrientAmounts {
  // Energy.
  caloriesKcal: number;
  // Macronutrients.
  proteinGrams: number;
  carbohydrateGrams: number;
  fatGrams: number;
  // Other macronutrient-adjacent values.
  fiberGrams?: number;
  sugarsGrams?: number;
  sodiumMilligrams?: number;
  alcoholGrams?: number;
  cholesterolMilligrams?: number;
  // Fat detail. Only what a source actually publishes; trans fat and the
  // omega fatty acids are frequently absent and must stay undefined then.
  saturatedFatGrams?: number;
  monounsaturatedFatGrams?: number;
  polyunsaturatedFatGrams?: number;
  transFatGrams?: number;
  omega3Grams?: number;
  omega6Grams?: number;
  /**
   * Micronutrients / minor nutrients keyed by canonical nutrient key. Values
   * use the unit named by the nutrient's registry entry (Phase 4).
   */
  additionalNutrients?: Readonly<Record<string, number>>;
}

/**
 * Raw vs prepared state of a food. "100 g chicken curry" is meaningless
 * without it — raw chicken, roasted chicken and a curry cooked from that
 * chicken are three different foods (PRODUCT_SPEC V2 §Food data model).
 */
export type FoodPreparationState =
  | "raw"
  | "cooked"
  | "unprepared"
  | "prepared"
  | "unknown";

/**
 * A single nutrient value together with everything required to judge and
 * reproduce it: source, serving basis, unit, confidence and optional
 * uncertainty. Used where per-value provenance is carried (imported datasets,
 * AI-parsed entries, photo-derived portions).
 */
export interface NutrientValue {
  /** Canonical nutrient key, e.g. "calories_kcal", "vitamin_d". */
  nutrient: string;
  /** Undefined means the source does not publish this nutrient at all. */
  amount?: number;
  unit: NutrientUnit;
  confidence: ConfidenceLevel;
  /** Quantity the amount refers to, e.g. "per_100g" or a serving label. */
  servingBasis: string;
  preparationState?: FoodPreparationState;
  uncertainty?: UncertaintyRange;
  sourceId?: FoodSourceId;
}

/**
 * Provenance tiers for food data. Ordered by decreasing trust: a first-party
 * curated record and a photo-derived estimate are never interchangeable, and
 * the tier travels with the value (PRODUCT_SPEC V2 §Food provenance).
 */
export type FoodProvenanceTier =
  | "first_party"
  | "verified_external"
  | "branded"
  | "restaurant"
  | "user_created"
  | "photo_derived_estimate"
  | "ai_parsed";

export type { ConfidenceLevel };

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
  /** V2: trust tier of every food derived from this source. */
  tier?: FoodProvenanceTier;
  /**
   * V2: SPDX license and/or usage terms of an imported source, recorded before
   * any rows are seeded from it (docs/DATABASE_DESIGN.md §17, §V2 review).
   */
  licenseSpdx?: string;
  termsUrl?: string;
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
  /**
   * V2: raw/prepared state. Two foods with the same name and brand but
   * different preparation states are different foods with different nutrients.
   */
  preparationState?: FoodPreparationState;
  /** V2: cooking/preparation method, e.g. "grilled", "deep_fried", "steamed". */
  preparationMethod?: string;
  /** V2: when the food is defined as a composite dish, the recipe behind it. */
  recipeId?: RecipeId;
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
  /**
   * V2: state the ingredient was added in. A recipe mixing raw and cooked
   * ingredient quantities is normal (chicken raw, onion chopped), so this is
   * per ingredient, not per recipe.
   */
  preparationState?: FoodPreparationState;
  notes?: string;
}

export interface Recipe extends BaseEntity {
  /** Undefined means shared/global recipe. */
  ownerUserId?: UserId;
  name: string;
  /** Number of portions the item quantities produce. */
  servings: number;
  /**
   * V2: weight of the finished dish in grams (the "yield"), when the user
   * knows it. This is what makes "I ate 240 g of this curry" resolvable as
   * 240/yield of the batch instead of an unsupportable guess. Persistence is
   * deferred to Phase 4 (divergence D12).
   */
  yieldGrams?: number;
  items: readonly RecipeItem[];
  instructions?: string;
}

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack" | "other";

/**
 * How an item entered the log (V2 §Food input methods). It travels with the
 * item so an AI-parsed or photo-derived line can always be shown back to the
 * user for confirmation, and so the coaching layer can discount its precision.
 */
export type FoodInputMethod =
  | "search"
  | "natural_language"
  | "exact_entry"
  | "photo_assisted";

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
   * V2: present when the quantity was estimated rather than measured (photo,
   * AI-parsed text). Carries the range and confidence so the system never
   * presents an estimated portion as an exact gram count, and so a later user
   * correction can be recorded without rewriting the estimate's provenance.
   */
  quantityEstimate?: Estimated<number>;
  /** V2: how this line was created; "photo_assisted" implies an estimate. */
  inputMethod?: FoodInputMethod;
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
