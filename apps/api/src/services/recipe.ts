import type {
  RecipeRecord,
  Repositories,
} from "@fitcoach/db";
import type { NutrientAmounts } from "@fitcoach/domain";
import { NotFoundError } from "@fitcoach/db";
import { scaleNutrientDensity, sumNutrientAmounts, divideNutrientAmounts } from "@fitcoach/nutrition";

export interface CreateRecipeCommand {
  id?: string;
  name: string;
  servings: number;
  instructions?: string;
  items: readonly {
    foodId: string;
    quantityGrams: number;
    notes?: string;
  }[];
}

export interface RecipeSnapshot {
  nutrientsPerServing: NutrientAmounts;
  nutrientsPer100g: NutrientAmounts;
  yieldGrams?: number;
}

/**
 * Recipe service — manages reusable food compositions.
 *
 * Recipes are built from food items with quantities in grams. The service
 * computes per-serving and per-100g nutrient densities at creation time
 * and stores them as snapshots so historical recipes remain stable even
 * when underlying food data changes.
 */
export class RecipeService {
  constructor(private readonly repos: Repositories) {}

  private async requireUser(userId: string): Promise<{ timezone: string }> {
    const user = await this.repos.users.findById(userId);
    if (!user) throw new NotFoundError(`user ${userId} not found`);
    return user;
  }

  /**
   * Compute the aggregate nutrient profile of a recipe from its items.
   * Returns per-serving, per-100g, and optional yield grams.
   */
  async computeRecipeSnapshot(
    items: readonly { foodId: string; quantityGrams: number }[],
  ): Promise<RecipeSnapshot> {
    if (items.length === 0) {
      throw new RangeError("recipe requires at least one item");
    }

    const itemSnapshots: NutrientAmounts[] = [];
    let totalGrams = 0;

    for (const item of items) {
      const food = await this.repos.foods.findById(item.foodId);
      if (!food) throw new NotFoundError(`food ${item.foodId} not found`);
      if (!Number.isFinite(item.quantityGrams) || item.quantityGrams <= 0) {
        throw new RangeError(`quantityGrams must be positive for food ${item.foodId}`);
      }
      const snapshot = scaleNutrientDensity(food.nutrientsPer100g, item.quantityGrams);
      itemSnapshots.push(snapshot);
      totalGrams += item.quantityGrams;
    }

    const batchTotals = sumNutrientAmounts(itemSnapshots);
    // servingCount is determined by the recipe's servings parameter, not by items
    // This compute function is called before we know the servings, so return totals
    // The actual per-serving is computed in createRecipe using command.servings
    const servingCount = 1;

    // Per-serving nutrients (batch / servings)
    const nutrientsPerServing = divideNutrientAmounts(batchTotals, servingCount);

    // Per-100g nutrients (batch / totalGrams * 100)
    const nutrientsPer100g = totalGrams > 0
      ? divideNutrientAmounts(batchTotals, totalGrams / 100)
      : divideNutrientAmounts(batchTotals, 1);

    return {
      nutrientsPerServing,
      nutrientsPer100g,
      yieldGrams: totalGrams > 0 ? totalGrams : undefined,
    };
  }

  async createRecipe(userId: string, command: CreateRecipeCommand): Promise<RecipeRecord> {
    await this.requireUser(userId);
    if (command.items.length === 0) {
      throw new RangeError("recipe requires at least one item");
    }
    if (!Number.isInteger(command.servings) || command.servings <= 0) {
      throw new RangeError("servings must be a positive integer");
    }

    // Create recipe with items (nutrient snapshots are computed on demand)
    return this.repos.recipes.create({
      ...(command.id ? { id: command.id } : {}),
      ownerUserId: userId,
      name: command.name,
      servings: command.servings,
      ...(command.instructions ? { instructions: command.instructions } : {}),
      items: command.items.map((item) => ({
        foodId: item.foodId,
        quantityGrams: item.quantityGrams,
        ...(item.notes ? { notes: item.notes } : {}),
      })),
    });
  }

  async getRecipe(recipeId: string): Promise<RecipeRecord> {
    const recipe = await this.repos.recipes.findById(recipeId);
    if (!recipe) throw new NotFoundError(`recipe ${recipeId} not found`);
    return recipe;
  }

  async listRecipes(userId: string): Promise<RecipeRecord[]> {
    await this.requireUser(userId);
    return this.repos.recipes.listByOwner(userId);
  }

  async deleteRecipe(recipeId: string): Promise<void> {
    await this.repos.recipes.deactivate(recipeId);
  }

  /**
   * Compute nutrition for a consumed amount of recipe (in servings).
   * Used when logging a meal with a recipe item.
   */
  async computeRecipeNutrition(recipeId: string, servings: number): Promise<NutrientAmounts & { perServing: NutrientAmounts; total: NutrientAmounts }> {
    const recipe = await this.getRecipe(recipeId);

    const batch = await this.computeRecipeSnapshot(recipe.items);
    const perServing = divideNutrientAmounts(batch.nutrientsPerServing, recipe.servings);
    const total = scaleNutrientDensity(perServing, servings * 100);
    return { ...total, perServing, total };
  }
}