import type { Repositories } from "@fitcoach/db";
import type {
  NutritionTargets,
  NutrientAmounts,
} from "@fitcoach/domain";
import { NotFoundError } from "@fitcoach/db";
import { scaleNutrientDensity } from "@fitcoach/nutrition";

/**
 * Open Food Facts API response types
 */
interface OpenFoodFactsProduct {
  code: string;
  product_name?: string;
  product_name_en?: string;
  brands?: string;
  brands_tags?: string[];
  categories?: string;
  categories_tags?: string[];
  ingredients_text?: string;
  ingredients_text_en?: string;
  image_url?: string;
  image_small_url?: string;
  nutriments?: {
    energy_kcal_100g?: number;
    proteins_100g?: number;
    carbohydrates_100g?: number;
    fat_100g?: number;
    fiber_100g?: number;
    sugars_100g?: number;
    "saturated-fat_100g"?: number;
    sodium_100g?: number;
    salt_100g?: number;
    cholesterol_100g?: number;
    calcium_100g?: number;
    iron_100g?: number;
    vitamin_a_100g?: number;
    vitamin_c_100g?: number;
    vitamin_d_100g?: number;
    vitamin_e_100g?: number;
    vitamin_k_100g?: number;
    thiamin_100g?: number;
    riboflavin_100g?: number;
    niacin_100g?: number;
    vitamin_b6_100g?: number;
    vitamin_b12_100g?: number;
    folate_100g?: number;
    magnesium_100g?: number;
    phosphorus_100g?: number;
    zinc_100g?: number;
    potassium_100g?: number;
    caffeine_100g?: number;
    alcohol_100g?: number;
    water_100g?: number;
    trans_fat_100g?: number;
    polyunsaturated_fat_100g?: number;
    monounsaturated_fat_100g?: number;
  };
  serving_size?: string;
  serving_quantity?: number;
  serving_unit?: string;
  nutriscore_grade?: "a" | "b" | "c" | "d" | "e";
  nova_group?: 1 | 2 | 3 | 4;
  labels?: string;
  labels_tags?: string[];
  countries?: string;
  countries_tags?: string[];
  origins?: string;
  origins_tags?: string[];
  manufacturing_places?: string;
  manufacturing_places_tags?: string[];
  packaging?: string;
  packaging_tags?: string[];
  stores?: string;
  stores_tags?: string[];
  url?: string;
  _keywords?: string[];
  lang?: string;
  states?: string[];
  states_tags?: string[];
}

interface OpenFoodFactsResponse {
  status: number;
  status_verbose: string;
  code: string;
  product?: OpenFoodFactsProduct;
}

interface ScannedProductPreview {
  barcode: string;
  name: string;
  brand?: string;
  imageUrl?: string;
  nutrientsPer100g: NutrientAmounts;
  servings: Array<{
    id: string;
    label: string;
    grams?: number;
    milliliters?: number;
    unitQuantity?: number;
    unitName?: string;
  }>;
  defaultServingId?: string;
  nutriscoreGrade?: "a" | "b" | "c" | "d" | "e";
  novaGroup?: 1 | 2 | 3 | 4;
  ingredients?: string;
  allergens?: string[];
  isFromOpenFoodFacts: boolean;
  confidence: "high" | "medium" | "low";
}

interface BarcodeLookupResult {
  product: ScannedProductPreview | null;
  found: boolean;
  source: "openfoodfacts" | "local" | "unknown";
}

interface NutritionAssessmentForProduct {
  product: ScannedProductPreview;
  servingGrams: number;
  assessment: {
    caloriesPercentOfTarget: number | null;
    proteinPercentOfTarget: number | null;
    carbsPercentOfTarget: number | null;
    fatPercentOfTarget: number | null;
    fiberPercentOfTarget: number | null;
    summary: string;
    flags: Array<{
      type: "calories" | "protein" | "carbs" | "fat" | "fiber" | "sodium" | "sugar" | "saturated_fat" | "ultra_processed";
      severity: "info" | "warning" | "alert";
      message: string;
    }>;
    recommendation: "add_to_log" | "consider_alternative" | "skip";
    reasoning: string;
  };
}

const OPENFOODFACTS_API = "https://world.openfoodfacts.org/api/v0/product";

function newUuidv7(): string {
  // Simple UUID v7-like generation for server-side use
  const timestamp = Date.now().toString(16).padStart(12, "0");
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-${random.slice(0, 4)}-${random.slice(4, 8)}-${random.slice(8)}`;
}

/**
 * Interface for nutrition targets service (to avoid circular deps)
 */
interface NutritionTargetService {
  getTargets(userId: string): Promise<NutritionTargets | null>;
}

/**
 * Barcode Scanner Service
 *
 * Integrates with Open Food Facts for product lookup and provides
 * personalized nutrition assessment using the user's nutrition targets.
 */
export class BarcodeScannerService {
  constructor(
    private readonly repos: Repositories,
    private readonly nutritionTargets: NutritionTargetService,
  ) {}

  /**
   * Look up a barcode - first checks local database, then Open Food Facts
   */
  async lookupBarcode(barcode: string): Promise<BarcodeLookupResult> {
    // First check local database
    const localFood = await this.repos.foods.findByBarcode(barcode);
    if (localFood) {
      return {
        product: this.mapFoodToPreview(localFood),
        found: true,
        source: "local",
      };
    }

    // Fallback to Open Food Facts
    const offProduct = await this.fetchFromOpenFoodFacts(barcode);
    if (offProduct) {
      return {
        product: this.mapOpenFoodFactsToPreview(offProduct),
        found: true,
        source: "openfoodfacts",
      };
    }

    return { product: null, found: false, source: "unknown" };
  }

  /**
   * Get product preview with personalized nutrition assessment
   */
  async getProductPreview(barcode: string, servingGrams: number, userId: string): Promise<NutritionAssessmentForProduct> {
    // Get user's nutrition targets
    const targets = await this.nutritionTargets.getTargets(userId);
    if (!targets) {
      throw new NotFoundError(`nutrition targets not found for user ${userId}`);
    }

    // Look up the product
    const lookup = await this.lookupBarcode(barcode);
    if (!lookup.product) {
      throw new NotFoundError(`product not found for barcode ${barcode}`);
    }

    const product = lookup.product;

    // Calculate nutrients for the serving size
    const servingNutrients = scaleNutrientDensity(product.nutrientsPer100g, servingGrams);

    // Generate personalized assessment
    const assessment = this.generateAssessment(product, servingNutrients, targets);

    return { product, servingGrams, assessment };
  }

  /**
   * Fetch product from Open Food Facts API
   */
  private async fetchFromOpenFoodFacts(barcode: string): Promise<OpenFoodFactsProduct | null> {
    try {
      const response = await fetch(`${OPENFOODFACTS_API}/${barcode}.json`, {
        headers: {
          "User-Agent": "FitCoach/1.0 (https://fitcoach.app; contact@fitcoach.app)",
        },
        // 5 second timeout
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as OpenFoodFactsResponse;
      if (data.status !== 1 || !data.product) {
        return null;
      }

      return data.product;
    } catch {
      // Network error, timeout, or parse error - return null
      return null;
    }
  }

  /**
   * Map Open Food Facts product to our preview format
   */
  private mapOpenFoodFactsToPreview(product: OpenFoodFactsProduct): ScannedProductPreview {
    const nutriments = product.nutriments ?? {};

    // Extract allergens from labels/tags
    const allergens: string[] = [];
    if (product.labels_tags) {
      for (const tag of product.labels_tags) {
        if (tag.startsWith("en:") && tag.includes("allergen")) {
          const allergen = tag.replace("en:", "").replace("-", " ");
          allergens.push(allergen);
        }
      }
    }

    // Build servings from serving_size info
    const servings: ScannedProductPreview["servings"] = [];
    if (product.serving_quantity && product.serving_unit) {
      servings.push({
        id: newUuidv7(),
        label: `${product.serving_quantity} ${product.serving_unit}`,
        grams: product.serving_unit === "g" ? product.serving_quantity : undefined,
        milliliters: product.serving_unit === "ml" ? product.serving_quantity : undefined,
      });
    } else if (product.serving_size) {
      // Try to parse serving_size like "30g" or "100ml"
      const match = product.serving_size.match(/^([\d.]+)\s*(g|ml|kg|l|oz|fl\s*oz|cup|tbsp|tsp)?$/i);
      if (match) {
        const qty = parseFloat(match[1] as string);
        const unitRaw = match[2] as string | undefined;
        const unit = (unitRaw ?? "g").toLowerCase();
        servings.push({
          id: newUuidv7(),
          label: product.serving_size,
          grams: unit === "g" ? qty : unit === "kg" ? qty * 1000 : unit === "ml" ? undefined : qty,
          milliliters: unit === "ml" ? qty : unit === "l" ? qty * 1000 : undefined,
          unitName: unit === "g" || unit === "kg" || unit === "ml" || unit === "l" ? undefined : unit,
        });
      }
    }

    // Always add a 100g serving as fallback
    servings.push({
      id: newUuidv7(),
      label: "100 g",
      grams: 100,
    });

    const defaultServingId = servings[0]?.id;

    // Map micronutrients to additionalNutrients
    const additionalNutrients: Record<string, number> = {};
    const micronutrientMap: Record<string, string> = {
      calcium_100g: "calcium",
      iron_100g: "iron",
      vitamin_a_100g: "vitamin_a",
      vitamin_c_100g: "vitamin_c",
      vitamin_d_100g: "vitamin_d",
      vitamin_e_100g: "vitamin_e",
      vitamin_k_100g: "vitamin_k",
      thiamin_100g: "thiamin",
      riboflavin_100g: "riboflavin",
      niacin_100g: "niacin",
      vitamin_b6_100g: "vitamin_b6",
      vitamin_b12_100g: "vitamin_b12",
      folate_100g: "folate",
      magnesium_100g: "magnesium",
      phosphorus_100g: "phosphorus",
      zinc_100g: "zinc",
      potassium_100g: "potassium",
      caffeine_100g: "caffeine",
      water_100g: "water",
    };
    for (const [key, nutrientKey] of Object.entries(micronutrientMap)) {
      const value = (nutriments as Record<string, number | undefined>)[key];
      if (value !== undefined) {
        additionalNutrients[nutrientKey] = value;
      }
    }

    return {
      barcode: product.code,
      name: product.product_name_en ?? product.product_name ?? "Unknown Product",
      brand: product.brands,
      imageUrl: product.image_url,
      nutrientsPer100g: {
        caloriesKcal: nutriments.energy_kcal_100g ?? 0,
        proteinGrams: nutriments.proteins_100g ?? 0,
        carbohydrateGrams: nutriments.carbohydrates_100g ?? 0,
        fatGrams: nutriments.fat_100g ?? 0,
        fiberGrams: nutriments.fiber_100g,
        sugarsGrams: nutriments.sugars_100g,
        saturatedFatGrams: nutriments["saturated-fat_100g"],
        sodiumMilligrams: nutriments.sodium_100g ?? (nutriments.salt_100g ? nutriments.salt_100g * 1000 : undefined),
        cholesterolMilligrams: nutriments.cholesterol_100g,
        alcoholGrams: nutriments.alcohol_100g,
        transFatGrams: nutriments.trans_fat_100g,
        polyunsaturatedFatGrams: nutriments.polyunsaturated_fat_100g,
        monounsaturatedFatGrams: nutriments.monounsaturated_fat_100g,
        additionalNutrients: Object.keys(additionalNutrients).length > 0 ? additionalNutrients : undefined,
      },
      servings,
      defaultServingId,
      nutriscoreGrade: product.nutriscore_grade,
      novaGroup: product.nova_group,
      ingredients: product.ingredients_text_en ?? product.ingredients_text,
      allergens: allergens.length > 0 ? allergens : undefined,
      isFromOpenFoodFacts: true,
      confidence: this.calculateConfidence(product),
    };
  }

  /**
   * Map local food record to preview format
   */
  private mapFoodToPreview(food: {
    id: string;
    name: string;
    brand?: string;
    nutrientsPer100g: NutrientAmounts;
    servings: Array<{ id: string; label: string; grams?: number; milliliters?: number; unitQuantity?: number; unitName?: string }>;
    defaultServingId?: string;
    barcode?: string;
    novaGroup?: 1 | 2 | 3 | 4;
    nutriscoreGrade?: "a" | "b" | "c" | "d" | "e";
  }): ScannedProductPreview {
    return {
      barcode: food.barcode ?? "",
      name: food.name,
      brand: food.brand,
      nutrientsPer100g: food.nutrientsPer100g,
      servings: food.servings.map(s => ({ ...s })),
      defaultServingId: food.defaultServingId,
      novaGroup: food.novaGroup,
      nutriscoreGrade: food.nutriscoreGrade,
      isFromOpenFoodFacts: false,
      confidence: "high",
    };
  }

  /**
   * Calculate confidence level based on Open Food Facts data completeness
   */
  private calculateConfidence(product: OpenFoodFactsProduct): "high" | "medium" | "low" {
    let score = 0;
    const nutriments = product.nutriments ?? {};

    if (product.product_name || product.product_name_en) score += 2;
    if (product.brands) score += 1;
    if (nutriments.energy_kcal_100g !== undefined) score += 3;
    if (nutriments.proteins_100g !== undefined) score += 2;
    if (nutriments.carbohydrates_100g !== undefined) score += 1;
    if (nutriments.fat_100g !== undefined) score += 1;
    if (nutriments.fiber_100g !== undefined) score += 1;
    if (product.serving_quantity && product.serving_unit) score += 1;
    if (product.nutriscore_grade) score += 1;
    if (product.nova_group) score += 1;

    if (score >= 8) return "high";
    if (score >= 5) return "medium";
    return "low";
  }

  /**
   * Generate personalized nutrition assessment for a product serving
   */
  private generateAssessment(
    product: ScannedProductPreview,
    servingNutrients: NutrientAmounts,
    targets: NutritionTargets,
  ): NutritionAssessmentForProduct["assessment"] {
    const flags: NutritionAssessmentForProduct["assessment"]["flags"] = [];

    // Calculate percentages of daily targets
    const caloriesPercent = targets.caloriesKcal > 0
      ? Math.round((servingNutrients.caloriesKcal / targets.caloriesKcal) * 100)
      : null;
    const proteinPercent = targets.proteinGrams > 0
      ? Math.round((servingNutrients.proteinGrams / targets.proteinGrams) * 100)
      : null;
    const carbsPercent = targets.carbohydrateGrams !== undefined && targets.carbohydrateGrams > 0
      ? Math.round((servingNutrients.carbohydrateGrams / targets.carbohydrateGrams) * 100)
      : null;
    const fatPercent = targets.fatGrams !== undefined && targets.fatGrams > 0
      ? Math.round((servingNutrients.fatGrams / targets.fatGrams) * 100)
      : null;
    const fiberPercent = targets.fiberGrams !== undefined && targets.fiberGrams > 0 && servingNutrients.fiberGrams !== undefined
      ? Math.round((servingNutrients.fiberGrams / targets.fiberGrams) * 100)
      : null;

    // Sodium check (WHO recommends < 2000mg/day)
    if (servingNutrients.sodiumMilligrams !== undefined) {
      const sodiumPercent = Math.round((servingNutrients.sodiumMilligrams / 2000) * 100);
      if (sodiumPercent > 30) {
        flags.push({
          type: "sodium",
          severity: sodiumPercent > 50 ? "alert" : "warning",
          message: `High sodium: ${servingNutrients.sodiumMilligrams}mg (${sodiumPercent}% of WHO daily limit)`,
        });
      }
    }

    // Sugar check (WHO recommends < 50g/day added sugar)
    if (servingNutrients.sugarsGrams !== undefined) {
      const sugarPercent = Math.round((servingNutrients.sugarsGrams / 50) * 100);
      if (sugarPercent > 30) {
        flags.push({
          type: "sugar",
          severity: sugarPercent > 50 ? "alert" : "warning",
          message: `High sugar: ${servingNutrients.sugarsGrams}g (${sugarPercent}% of WHO daily limit)`,
        });
      }
    }

    // Saturated fat check (WHO recommends < 20g/day)
    if (servingNutrients.saturatedFatGrams !== undefined) {
      const satFatPercent = Math.round((servingNutrients.saturatedFatGrams / 20) * 100);
      if (satFatPercent > 30) {
        flags.push({
          type: "saturated_fat",
          severity: satFatPercent > 50 ? "alert" : "warning",
          message: `High saturated fat: ${servingNutrients.saturatedFatGrams}g (${satFatPercent}% of WHO daily limit)`,
        });
      }
    }

    // Ultra-processed check (NOVA group 4)
    if (product.novaGroup === 4) {
      flags.push({
        type: "ultra_processed",
        severity: "warning",
        message: "Ultra-processed food (NOVA group 4). Consider whole food alternatives.",
      });
    } else if (product.novaGroup === 3) {
      flags.push({
        type: "ultra_processed",
        severity: "info",
        message: "Processed food (NOVA group 3). Minimally processed options are preferable.",
      });
    }

    // Nutri-Score check
    if (product.nutriscoreGrade) {
      if (product.nutriscoreGrade === "d" || product.nutriscoreGrade === "e") {
        flags.push({
          type: "ultra_processed",
          severity: product.nutriscoreGrade === "e" ? "alert" : "warning",
          message: `Poor Nutri-Score (${product.nutriscoreGrade.toUpperCase()}). Nutritional quality is low.`,
        });
      }
    }

    // Determine recommendation
    let recommendation: "add_to_log" | "consider_alternative" | "skip" = "add_to_log";
    let reasoning = "Fits within daily nutrition targets.";

    const alertFlags = flags.filter(f => f.severity === "alert").length;
    const warningFlags = flags.filter(f => f.severity === "warning").length;

    if (alertFlags > 0) {
      recommendation = "skip";
      reasoning = "Multiple nutritional concerns detected. Consider a healthier alternative.";
    } else if (warningFlags > 1 || (warningFlags === 1 && product.novaGroup === 4)) {
      recommendation = "consider_alternative";
      reasoning = "Some nutritional concerns. A whole food alternative would be better.";
    } else if (caloriesPercent !== null && caloriesPercent > 40) {
      recommendation = "consider_alternative";
      reasoning = `High calorie density (${caloriesPercent}% of daily target). Consider a smaller portion or lower-calorie option.`;
    } else if (proteinPercent !== null && proteinPercent > 50) {
      // High protein is usually good
      recommendation = "add_to_log";
      reasoning = `Excellent protein source (${proteinPercent}% of daily target). Great for muscle recovery.`;
    }

    // Build summary
    const summaryParts: string[] = [];
    if (caloriesPercent !== null) summaryParts.push(`${caloriesPercent}% calories`);
    if (proteinPercent !== null) summaryParts.push(`${proteinPercent}% protein`);
    if (carbsPercent !== null) summaryParts.push(`${carbsPercent}% carbs`);
    if (fatPercent !== null) summaryParts.push(`${fatPercent}% fat`);
    if (fiberPercent !== null) summaryParts.push(`${fiberPercent}% fiber`);
    const summary = summaryParts.join(", ");

    return {
      caloriesPercentOfTarget: caloriesPercent,
      proteinPercentOfTarget: proteinPercent,
      carbsPercentOfTarget: carbsPercent,
      fatPercentOfTarget: fatPercent,
      fiberPercentOfTarget: fiberPercent,
      summary,
      flags,
      recommendation,
      reasoning,
    };
  }
}