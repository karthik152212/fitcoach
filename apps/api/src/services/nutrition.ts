import type {
  CreateMealItemInput,
  CreateFoodInput,
  FoodRecord,
  MealRecord,
  Repositories,
} from "@fitcoach/db";
import type {
  CalendarDate,
  ConfidenceLevel,
  MealSlot,
  NutrientAmounts,
  Timestamp,
} from "@fitcoach/domain";
import { toUserLocalDate } from "@fitcoach/domain";
import { ConstraintValidationError, NotFoundError } from "@fitcoach/db";
import { scaleNutrientDensity, sumNutrientAmounts } from "@fitcoach/nutrition";

/**
 * Nutrition service — the write-time snapshot path (milestone §7).
 *
 * When a meal is logged the service computes each item's nutrients from the
 * food's current density, freezes them into the meal rows, and refreshes the
 * per-day aggregate + targets snapshot. Later edits to a food change future
 * calculations only: historical meals re-read their own snapshots.
 */

export interface CreateFoodCommand {
  id?: string;
  sourceId?: string;
  name: string;
  brand?: string;
  densityBasis: "per_100g" | "per_100ml";
  nutrientsPer100g: NutrientAmounts;
  servings?: CreateFoodInput["servings"];
  defaultServingLabel?: string;
  barcode?: string;
  externalId?: string;
}

export interface MealItemCommand {
  id?: string;
  foodId: string;
  quantityGrams: number;
  confidence?: ConfidenceLevel;
  notes?: string;
}

export interface CreateMealCommand {
  id?: string;
  localDate?: CalendarDate;
  consumedAt?: Timestamp;
  slot?: MealSlot;
  notes?: string;
  clientRequestId?: string;
  items: readonly MealItemCommand[];
}

interface PreparedItem extends CreateMealItemInput {
  foodId: string;
}

export class NutritionService {
  constructor(private readonly repos: Repositories) {}

  private async requireUser(userId: string): Promise<{ timezone: string }> {
    const user = await this.repos.users.findById(userId);
    if (!user) throw new NotFoundError(`user ${userId} not found`);
    return user;
  }

  async createFood(userId: string, command: CreateFoodCommand): Promise<FoodRecord> {
    await this.requireUser(userId);
    const sourceId =
      command.sourceId ?? (await this.repos.foods.findOrCreateUserSource(userId)).id;
    return this.repos.foods.createFood({
      ...(command.id ? { id: command.id } : {}),
      sourceId,
      name: command.name,
      ...(command.brand !== undefined ? { brand: command.brand } : {}),
      densityBasis: command.densityBasis,
      nutrientsPer100g: command.nutrientsPer100g,
      ...(command.servings ? { servings: command.servings } : {}),
      ...(command.defaultServingLabel ? { defaultServingLabel: command.defaultServingLabel } : {}),
      ...(command.barcode ? { barcode: command.barcode } : {}),
      ...(command.externalId ? { externalId: command.externalId } : {}),
    });
  }

  async getFood(foodId: string): Promise<FoodRecord> {
    const food = await this.repos.foods.findById(foodId);
    if (!food) throw new NotFoundError(`food ${foodId} not found`);
    return food;
  }

  /**
   * Compute the frozen snapshot for one consumed item: density × quantity,
   * with confidence taken from the item or its source's default.
   */
  private async prepareItem(command: MealItemCommand): Promise<PreparedItem> {
    const food = await this.repos.foods.findById(command.foodId);
    if (!food) throw new NotFoundError(`food ${command.foodId} not found`);
    if (!Number.isFinite(command.quantityGrams) || command.quantityGrams <= 0) {
      throw new ConstraintValidationError("quantityGrams must be a positive number");
    }

    const snapshot = scaleNutrientDensity(food.nutrientsPer100g, command.quantityGrams);

    let confidence = command.confidence;
    if (!confidence) {
      const source = await this.repos.foods.findSource(food.sourceId);
      confidence = source?.defaultConfidence ?? "estimated";
    }

    return {
      ...(command.id ? { id: command.id } : {}),
      foodId: command.foodId,
      quantityGrams: command.quantityGrams,
      snapshot,
      confidence,
      ...(command.notes !== undefined ? { notes: command.notes } : {}),
    };
  }

  async createMeal(userId: string, command: CreateMealCommand): Promise<MealRecord> {
    const user = await this.requireUser(userId);
    if (command.items.length === 0) {
      throw new ConstraintValidationError("a meal requires at least one item");
    }

    const reference = command.consumedAt ? new Date(command.consumedAt) : new Date();
    const localDate = command.localDate ?? toUserLocalDate(reference, user.timezone);

    const items: PreparedItem[] = [];
    for (const item of command.items) {
      items.push(await this.prepareItem(item));
    }

    const totals = sumNutrientAmounts(items.map((item) => item.snapshot));
    const meal = await this.repos.meals.create({
      ...(command.id ? { id: command.id } : {}),
      userId,
      localDate,
      ...(command.consumedAt ? { consumedAt: command.consumedAt } : {}),
      ...(command.slot ? { slot: command.slot } : {}),
      ...(command.notes !== undefined ? { notes: command.notes } : {}),
      ...(command.clientRequestId ? { clientRequestId: command.clientRequestId } : {}),
      totals,
      items,
    });

    await this.refreshDaily(userId, localDate);
    return meal;
  }

  async addMealItem(mealId: string, command: MealItemCommand): Promise<MealRecord> {
    const meal = await this.repos.meals.findById(mealId);
    if (!meal) throw new NotFoundError(`meal ${mealId} not found`);
    const item = await this.prepareItem(command);
    const updated = await this.repos.meals.addItem(mealId, item);
    await this.refreshDaily(meal.userId, meal.localDate);
    return updated;
  }

  async listMeals(userId: string, localDate?: CalendarDate): Promise<MealRecord[]> {
    const user = await this.requireUser(userId);
    const day = localDate ?? toUserLocalDate(new Date(), user.timezone);
    return this.repos.meals.listByDate(userId, day);
  }

  async getDaily(userId: string, localDate?: CalendarDate) {
    const user = await this.requireUser(userId);
    const day = localDate ?? toUserLocalDate(new Date(), user.timezone);
    return this.repos.nutrition.getDaily(userId, day);
  }

  /**
   * Recompute the per-user-day aggregate from stored item snapshots (the
   * stored copy exists so reads never depend on recompute-at-read — §4.8).
   * Existing targets snapshots are preserved.
   */
  async refreshDaily(userId: string, localDate: CalendarDate): Promise<void> {
    const meals = await this.repos.meals.listByDate(userId, localDate);
    const totals = sumNutrientAmounts(
      meals.flatMap((meal) => meal.items.map((item) => item.computedNutrients)),
    );
    const existing = await this.repos.nutrition.getDaily(userId, localDate);
    await this.repos.nutrition.upsertDaily({
      userId,
      localDate,
      totals,
      ...(existing?.targetsSnapshot ? { targetsSnapshot: existing.targetsSnapshot } : {}),
    });
  }
}
