import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  CalendarDate,
  ConfidenceLevel,
  EntityId,
  FoodId,
  FoodSourceKind,
  MealId,
  MealSlot,
  NutrientAmounts,
  RecipeId,
  Timestamp,
} from "@fitcoach/domain";
import { ConstraintValidationError, NotFoundError } from "../errors";
import { newUuidv7 } from "../ids";
import {
  decimalToNumberOr0,
  foodNutrientsFromRow,
  foodNutrientsToColumns,
  itemSnapshotColumns,
  itemSnapshotFromRow,
  toCalendarDate,
  toTimestamp,
  totalsSnapshotColumns,
  totalsSnapshotFromRow,
} from "../mapping";
import { runDb } from "./util";

// ---------------------------------------------------------------------------
// Food sources + foods (reference data; retired, never silently rewritten)
// ---------------------------------------------------------------------------

interface FoodSourceRow {
  id: string;
  ownerUserId: string | null;
  externalSourceId: string | null;
  name: string;
  kind: string;
  defaultConfidence: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FoodSourceRecord {
  id: string;
  ownerUserId?: string;
  externalSourceId?: string;
  name: string;
  kind: FoodSourceKind;
  defaultConfidence: ConfidenceLevel;
  createdAt: string;
  updatedAt: string;
}

interface ServingRow {
  id: string;
  foodId: string;
  label: string;
  grams: unknown;
  milliliters: unknown;
  unitQuantity: unknown;
  unitName: string | null;
}

export interface FoodServingRecord {
  id: string;
  foodId: string;
  label: string;
  grams?: number;
  milliliters?: number;
  unitQuantity?: number;
  unitName?: string;
}

interface FoodRow {
  id: string;
  sourceId: string;
  defaultServingId: string | null;
  name: string;
  brand: string | null;
  densityBasis: string;
  caloriesKcal: unknown;
  proteinG: unknown;
  carbohydrateG: unknown;
  fatG: unknown;
  fiberG: unknown;
  sugarsG: unknown;
  saturatedFatG: unknown;
  alcoholG: unknown;
  sodiumMg: unknown;
  barcode: string | null;
  externalId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FoodRecord {
  id: FoodId;
  sourceId: string;
  name: string;
  brand?: string;
  densityBasis: "per_100g" | "per_100ml";
  nutrientsPer100g: NutrientAmounts;
  servings: FoodServingRecord[];
  defaultServingId?: string;
  barcode?: string;
  externalId?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function foodSourceRowToRecord(row: FoodSourceRow): FoodSourceRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId ?? undefined,
    externalSourceId: row.externalSourceId ?? undefined,
    name: row.name,
    kind: row.kind as FoodSourceKind,
    defaultConfidence: row.defaultConfidence as ConfidenceLevel,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

function servingRowToRecord(row: ServingRow): FoodServingRecord {
  return {
    id: row.id,
    foodId: row.foodId,
    label: row.label,
    grams: row.grams === null ? undefined : Number(row.grams),
    milliliters: row.milliliters === null ? undefined : Number(row.milliliters),
    unitQuantity: row.unitQuantity === null ? undefined : Number(row.unitQuantity),
    unitName: row.unitName ?? undefined,
  };
}

interface FoodWithServings extends FoodRow {
  servings: ServingRow[];
}

function foodRowToRecord(row: FoodWithServings): FoodRecord {
  return {
    id: row.id,
    sourceId: row.sourceId,
    name: row.name,
    brand: row.brand ?? undefined,
    densityBasis: row.densityBasis as "per_100g" | "per_100ml",
    nutrientsPer100g: foodNutrientsFromRow(row),
    servings: row.servings.map(servingRowToRecord),
    defaultServingId: row.defaultServingId ?? undefined,
    barcode: row.barcode ?? undefined,
    externalId: row.externalId ?? undefined,
    isActive: row.isActive,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

const FOOD_INCLUDE = { servings: true } as const;

export interface CreateFoodSourceInput {
  id?: string;
  ownerUserId?: string;
  externalSourceId?: string;
  name: string;
  kind: FoodSourceKind;
  defaultConfidence: ConfidenceLevel;
}

export interface CreateServingInput {
  id?: string;
  label: string;
  grams?: number;
  milliliters?: number;
  unitQuantity?: number;
  unitName?: string;
}

export interface CreateFoodInput {
  id?: string;
  sourceId: string;
  name: string;
  brand?: string;
  densityBasis: "per_100g" | "per_100ml";
  nutrientsPer100g: NutrientAmounts;
  servings?: readonly CreateServingInput[];
  defaultServingLabel?: string;
  barcode?: string;
  externalId?: string;
}

export interface FoodRepository {
  createSource(input: CreateFoodSourceInput): Promise<FoodSourceRecord>;
  findSource(id: string): Promise<FoodSourceRecord | null>;
  /** The owner's user-created source, created on first use (API convenience). */
  findOrCreateUserSource(ownerUserId: string): Promise<FoodSourceRecord>;
  createFood(input: CreateFoodInput): Promise<FoodRecord>;
  findById(id: FoodId): Promise<FoodRecord | null>;
  /** Find a food by barcode (EAN/UPC) */
  findByBarcode(barcode: string): Promise<FoodRecord | null>;
  /**
   * Search foods by name, brand, or external ID with pagination.
   * Results ranked: exact name match > partial name match > brand match > external ID match.
   */
  searchFoods(
    query: string,
    options?: { limit?: number; offset?: number; sourceId?: string }
  ): Promise<{ foods: FoodRecord[]; total: number }>;
  /**
   * Update nutrient density (design S1: food rows are current-state; logged
   * history is protected by write-time snapshots and never changes).
   */
  updateNutrients(id: FoodId, nutrients: NutrientAmounts): Promise<FoodRecord>;
  deactivate(id: FoodId): Promise<void>;
}

/** Rank function for food search: lower = better match. */
function computeFoodSearchRank(name: string, brand: string | null, query: string): number {
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  const b = brand?.toLowerCase() ?? "";

  // Exact name match (case-insensitive)
  if (n === q) return 0;
  // Name starts with query
  if (n.startsWith(q)) return 1;
  // Name contains query
  if (n.includes(q)) return 2;
  // Brand exact match
  if (b && b === q) return 3;
  // Brand starts with query
  if (b && b.startsWith(q)) return 4;
  // Brand contains query
  if (b && b.includes(q)) return 5;
  // External ID match (handled by Prisma OR clause, but rank lower)
  return 6;
}

export class PrismaFoodRepository implements FoodRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createSource(input: CreateFoodSourceInput): Promise<FoodSourceRecord> {
    return runDb(async () => {
      const row = await this.prisma.foodSource.create({
        data: {
          id: input.id ?? newUuidv7(),
          ownerUserId: input.ownerUserId ?? null,
          externalSourceId: input.externalSourceId ?? null,
          name: input.name,
          kind: input.kind,
          defaultConfidence: input.defaultConfidence,
        },
      });
      return foodSourceRowToRecord(row);
    });
  }

  async findSource(id: string): Promise<FoodSourceRecord | null> {
    return runDb(async () => {
      const row = await this.prisma.foodSource.findUnique({ where: { id } });
      return row ? foodSourceRowToRecord(row) : null;
    });
  }

  async findOrCreateUserSource(ownerUserId: string): Promise<FoodSourceRecord> {
    return runDb(async () => {
      const existing = await this.prisma.foodSource.findFirst({
        where: { ownerUserId, kind: "user_created" },
        orderBy: { createdAt: "asc" },
      });
      if (existing) return foodSourceRowToRecord(existing);
      const created = await this.prisma.foodSource.create({
        data: {
          id: newUuidv7(),
          ownerUserId,
          name: "My foods",
          kind: "user_created",
          defaultConfidence: "estimated",
        },
      });
      return foodSourceRowToRecord(created);
    });
  }

  async createFood(input: CreateFoodInput): Promise<FoodRecord> {
    const id = input.id ?? newUuidv7();
    return runDb(async () => {
      return this.prisma.$transaction(async (tx) => {
        const source = await tx.foodSource.findUnique({ where: { id: input.sourceId } });
        if (!source) throw new NotFoundError(`food source ${input.sourceId} not found`);

        const row = await tx.food.create({
          data: {
            id,
            sourceId: input.sourceId,
            name: input.name,
            brand: input.brand ?? null,
            densityBasis: input.densityBasis,
            ...foodNutrientsToColumns(input.nutrientsPer100g),
            barcode: input.barcode ?? null,
            externalId: input.externalId ?? null,
            ...(input.servings && input.servings.length > 0
              ? {
                  servings: {
                    create: input.servings.map((serving) => ({
                      id: serving.id ?? newUuidv7(),
                      label: serving.label,
                      grams: serving.grams ?? null,
                      milliliters: serving.milliliters ?? null,
                      unitQuantity: serving.unitQuantity ?? null,
                      unitName: serving.unitName ?? null,
                    })),
                  },
                }
              : {}),
          },
          include: FOOD_INCLUDE,
        });

        if (input.defaultServingLabel) {
          const target = row.servings.find((serving) => serving.label === input.defaultServingLabel);
          if (!target) {
            throw new ConstraintValidationError(
              `default serving label "${input.defaultServingLabel}" not among servings`,
            );
          }
          await tx.food.update({
            where: { id: row.id },
            data: { defaultServingId: target.id },
          });
        }

        const full = await tx.food.findUnique({ where: { id: row.id }, include: FOOD_INCLUDE });
        if (!full) throw new NotFoundError("food disappeared after create");
        return foodRowToRecord(full);
      });
    });
  }

  async findById(id: FoodId): Promise<FoodRecord | null> {
    return runDb(async () => {
      const row = await this.prisma.food.findUnique({ where: { id }, include: FOOD_INCLUDE });
      return row ? foodRowToRecord(row) : null;
    });
  }

  async updateNutrients(id: FoodId, nutrients: NutrientAmounts): Promise<FoodRecord> {
    return runDb(async () => {
      const updated = await this.prisma.food.update({
        where: { id },
        data: foodNutrientsToColumns(nutrients),
        include: FOOD_INCLUDE,
      });
      return foodRowToRecord(updated);
    });
  }

  async deactivate(id: FoodId): Promise<void> {
    await runDb(async () => {
      await this.prisma.food.update({ where: { id }, data: { isActive: false } });
    });
  }

  async findByBarcode(barcode: string): Promise<FoodRecord | null> {
    return runDb(async () => {
      const row = await this.prisma.food.findFirst({
        where: { barcode, isActive: true },
        include: FOOD_INCLUDE,
      });
      return row ? foodRowToRecord(row as FoodWithServings) : null;
    });
  }

  async searchFoods(
    query: string,
    options?: { limit?: number; offset?: number; sourceId?: string }
  ): Promise<{ foods: FoodRecord[]; total: number }> {
    const trimmed = query.trim();
    if (!trimmed) {
      return { foods: [], total: 0 };
    }

    const limit = Math.min(options?.limit ?? 20, 100);
    const offset = options?.offset ?? 0;
    const sourceId = options?.sourceId;

    return runDb(async () => {
      // Build where clause for case-insensitive partial matching on name, brand, externalId
      const where: Prisma.FoodWhereInput = {
        isActive: true,
        ...(sourceId ? { sourceId } : {}),
        OR: [
          { name: { contains: trimmed, mode: "insensitive" } },
          { brand: { contains: trimmed, mode: "insensitive" } },
          { externalId: { contains: trimmed, mode: "insensitive" } },
        ],
      };

      // Get total count for pagination
      const total = await this.prisma.food.count({ where });

      // Fetch foods with servings
      const rows = await this.prisma.food.findMany({
        where,
        include: FOOD_INCLUDE,
        orderBy: { name: "asc" },
        take: limit,
        skip: offset,
      });

      // Rank results in application layer: exact name match > starts with > contains
      const ranked = rows.map((row) => ({
        record: foodRowToRecord(row as FoodWithServings),
        rank: computeFoodSearchRank(row.name, row.brand, trimmed),
      }));

      ranked.sort((a, b) => a.rank - b.rank);

      return {
        foods: ranked.map((r) => r.record),
        total,
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Meals (write-time snapshots; §8)
// ---------------------------------------------------------------------------

export interface CreateMealItemInput {
  id?: string;
  foodId?: FoodId;
  recipeId?: RecipeId;
  quantityGrams?: number;
  recipeServings?: number;
  /** Nutrients computed at logging time — frozen forever. */
  snapshot: NutrientAmounts;
  confidence: ConfidenceLevel;
  notes?: string;
}

export interface CreateMealInput {
  id?: string;
  userId: string;
  /** User-local day; required so daily aggregation is timezone-correct. */
  localDate: CalendarDate;
  consumedAt?: Timestamp;
  slot?: MealSlot;
  notes?: string;
  /** Idempotency key (§15): replay returns the same meal. */
  clientRequestId?: string;
  /** Snapshot totals = sum of item snapshots (computed by the service). */
  totals: NutrientAmounts;
  items: readonly CreateMealItemInput[];
}

interface MealItemRow {
  id: string;
  mealId: string;
  foodId: string | null;
  recipeId: string | null;
  quantityGrams: unknown;
  recipeServings: unknown;
  caloriesKcal: unknown;
  proteinG: unknown;
  carbohydrateG: unknown;
  fatG: unknown;
  fiberG: unknown;
  confidence: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MealItemRecord {
  id: string;
  mealId: string;
  foodId?: FoodId;
  recipeId?: RecipeId;
  quantityGrams?: number;
  recipeServings?: number;
  computedNutrients: NutrientAmounts;
  confidence: ConfidenceLevel;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface MealRow {
  id: string;
  userId: string;
  localDate: Date;
  consumedAt: Date | null;
  slot: string | null;
  totalCaloriesKcal: unknown;
  totalProteinG: unknown;
  totalCarbohydrateG: unknown;
  totalFatG: unknown;
  totalFiberG: unknown;
  notes: string | null;
  clientRequestId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MealRecord {
  id: MealId;
  userId: string;
  localDate: CalendarDate;
  consumedAt?: Timestamp;
  slot?: MealSlot;
  totals: NutrientAmounts;
  notes?: string;
  clientRequestId?: string;
  items: MealItemRecord[];
  createdAt: string;
  updatedAt: string;
}

function mealItemRowToRecord(row: MealItemRow): MealItemRecord {
  return {
    id: row.id,
    mealId: row.mealId,
    foodId: row.foodId ?? undefined,
    recipeId: row.recipeId ?? undefined,
    quantityGrams: row.quantityGrams === null ? undefined : Number(row.quantityGrams),
    recipeServings: row.recipeServings === null ? undefined : Number(row.recipeServings),
    computedNutrients: itemSnapshotFromRow(row),
    confidence: row.confidence as ConfidenceLevel,
    notes: row.notes ?? undefined,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

interface MealWithItems extends MealRow {
  items: MealItemRow[];
}

function mealRowToRecord(row: MealWithItems): MealRecord {
  return {
    id: row.id,
    userId: row.userId,
    localDate: toCalendarDate(row.localDate),
    consumedAt: row.consumedAt ? toTimestamp(row.consumedAt) : undefined,
    slot: (row.slot ?? undefined) as MealSlot | undefined,
    totals: totalsSnapshotFromRow(row),
    notes: row.notes ?? undefined,
    clientRequestId: row.clientRequestId ?? undefined,
    items: row.items.map(mealItemRowToRecord),
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

const MEAL_INCLUDE = { items: { orderBy: { createdAt: "asc" as const } } } as const;

export interface MealRepository {
  /** Idempotent on (userId, clientRequestId); snapshots are written once. */
  create(input: CreateMealInput): Promise<MealRecord>;
  /** Appends an item and refreshes the meal's totals snapshot. */
  addItem(mealId: string, item: CreateMealItemInput): Promise<MealRecord>;
  findById(mealId: MealId): Promise<MealRecord | null>;
  listByDate(userId: string, localDate: CalendarDate): Promise<MealRecord[]>;
}

function parseDay(value: CalendarDate, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ConstraintValidationError(`${field} must be YYYY-MM-DD`);
  }
  return new Date(`${value}T00:00:00.000Z`);
}

export class PrismaMealRepository implements MealRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async load(
    mealId: string,
    client: Pick<PrismaClient, "meal"> = this.prisma,
  ): Promise<MealRecord | null> {
    const row = await client.meal.findUnique({
      where: { id: mealId },
      include: MEAL_INCLUDE,
    });
    return row ? mealRowToRecord(row) : null;
  }

  private async validateRefs(
    client: Pick<PrismaClient, "food" | "recipe">,
    item: CreateMealItemInput,
  ): Promise<void> {
    if ((item.foodId ? 1 : 0) + (item.recipeId ? 1 : 0) !== 1) {
      throw new ConstraintValidationError("meal item must reference exactly one food or recipe");
    }
    if (item.foodId) {
      const food = await client.food.findUnique({ where: { id: item.foodId } });
      if (!food) throw new NotFoundError(`food ${item.foodId} not found`);
      if (item.quantityGrams === undefined || item.quantityGrams <= 0) {
        throw new ConstraintValidationError("food items require quantityGrams > 0");
      }
    }
    if (item.recipeId) {
      const recipe = await client.recipe.findUnique({ where: { id: item.recipeId } });
      if (!recipe) throw new NotFoundError(`recipe ${item.recipeId} not found`);
      if (item.recipeServings === undefined || item.recipeServings <= 0) {
        throw new ConstraintValidationError("recipe items require recipeServings > 0");
      }
    }
  }

  async create(input: CreateMealInput): Promise<MealRecord> {
    const mealId = input.id ?? newUuidv7();
    const localDate = parseDay(input.localDate, "localDate");
    return runDb(async () => {
      if (input.clientRequestId) {
        const existing = await this.prisma.meal.findFirst({
          where: { userId: input.userId, clientRequestId: input.clientRequestId },
          include: MEAL_INCLUDE,
        });
        if (existing) return mealRowToRecord(existing);
      }

      try {
        return await this.prisma.$transaction(async (tx) => {
          for (const item of input.items) {
            await this.validateRefs(tx, item);
          }
          await tx.meal.create({
            data: {
              id: mealId,
              userId: input.userId,
              localDate,
              consumedAt: input.consumedAt ? new Date(input.consumedAt) : null,
              slot: input.slot ?? null,
              notes: input.notes ?? null,
              clientRequestId: input.clientRequestId ?? null,
              ...totalsSnapshotColumns(input.totals),
              items: {
                create: input.items.map((item) => ({
                  id: item.id ?? newUuidv7(),
                  foodId: item.foodId ?? null,
                  recipeId: item.recipeId ?? null,
                  quantityGrams: item.quantityGrams ?? null,
                  recipeServings: item.recipeServings ?? null,
                  ...itemSnapshotColumns(item.snapshot),
                  confidence: item.confidence,
                  notes: item.notes ?? null,
                })),
              },
            },
          });
          // Read back through the transaction (the outer pool cannot see
          // uncommitted rows).
          const created = await this.load(mealId, tx);
          if (!created) throw new NotFoundError("meal disappeared after create");
          return created;
        });
      } catch (error) {
        if (
          input.clientRequestId &&
          typeof error === "object" &&
          error !== null &&
          (error as { code?: string }).code === "P2002"
        ) {
          const existing = await this.prisma.meal.findFirst({
            where: { userId: input.userId, clientRequestId: input.clientRequestId },
            include: MEAL_INCLUDE,
          });
          if (existing) return mealRowToRecord(existing);
        }
        throw error;
      }
    });
  }

  async addItem(mealId: string, item: CreateMealItemInput): Promise<MealRecord> {
    return runDb(async () => {
      return this.prisma.$transaction(async (tx) => {
        const meal = await tx.meal.findUnique({ where: { id: mealId } });
        if (!meal) throw new NotFoundError(`meal ${mealId} not found`);
        await this.validateRefs(tx, item);

        await tx.mealItem.create({
          data: {
            id: item.id ?? newUuidv7(),
            mealId,
            foodId: item.foodId ?? null,
            recipeId: item.recipeId ?? null,
            quantityGrams: item.quantityGrams ?? null,
            recipeServings: item.recipeServings ?? null,
            ...itemSnapshotColumns(item.snapshot),
            confidence: item.confidence,
            notes: item.notes ?? null,
          },
        });

        // Refresh the meal totals snapshot from the item snapshots (§8).
        const items = await tx.mealItem.findMany({ where: { mealId } });
        const totals = items.reduce<NutrientAmounts>(
          (acc, row) => {
            const snapshot = itemSnapshotFromRow(row);
            return {
              caloriesKcal: acc.caloriesKcal + snapshot.caloriesKcal,
              proteinGrams: acc.proteinGrams + snapshot.proteinGrams,
              carbohydrateGrams: acc.carbohydrateGrams + snapshot.carbohydrateGrams,
              fatGrams: acc.fatGrams + snapshot.fatGrams,
              fiberGrams:
                (acc.fiberGrams ?? 0) + (snapshot.fiberGrams ?? 0) || undefined,
            };
          },
          { caloriesKcal: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0 },
        );
        await tx.meal.update({ where: { id: mealId }, data: totalsSnapshotColumns(totals) });

        const updated = await this.load(mealId, tx);
        if (!updated) throw new NotFoundError(`meal ${mealId} not found`);
        return updated;
      });
    });
  }

  async findById(mealId: MealId): Promise<MealRecord | null> {
    return runDb(() => this.load(mealId));
  }

  async listByDate(userId: string, localDate: CalendarDate): Promise<MealRecord[]> {
    const day = parseDay(localDate, "localDate");
    return runDb(async () => {
      const rows = await this.prisma.meal.findMany({
        where: { userId, localDate: day },
        include: MEAL_INCLUDE,
        orderBy: { createdAt: "asc" },
      });
      return rows.map(mealRowToRecord);
    });
  }
}

// ---------------------------------------------------------------------------
// Daily nutrition (recomputable aggregate + frozen targets snapshot)
// ---------------------------------------------------------------------------

export interface DailyNutritionRecord {
  id: string;
  userId: string;
  localDate: CalendarDate;
  totals: NutrientAmounts;
  targetsSnapshot?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface DailyNutritionRow {
  id: string;
  userId: string;
  localDate: Date;
  totalCaloriesKcal: unknown;
  totalProteinG: unknown;
  totalCarbohydrateG: unknown;
  totalFatG: unknown;
  totalFiberG: unknown;
  targetsSnapshot: unknown;
  createdAt: Date;
  updatedAt: Date;
}

function dailyRowToRecord(row: DailyNutritionRow): DailyNutritionRecord {
  return {
    id: row.id,
    userId: row.userId,
    localDate: toCalendarDate(row.localDate),
    totals: totalsSnapshotFromRow(row),
    targetsSnapshot:
      row.targetsSnapshot && typeof row.targetsSnapshot === "object"
        ? (row.targetsSnapshot as Record<string, unknown>)
        : undefined,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

export interface UpsertDailyNutritionInput {
  id?: string;
  userId: string;
  localDate: CalendarDate;
  totals: NutrientAmounts;
  targetsSnapshot?: Record<string, unknown>;
}

export interface NutritionStateSnapshot {
  recentDailyTotals: DailyNutritionRecord[];
  averageCalories: number;
  averageProteinGrams: number;
  averageCarbsGrams: number;
  averageFatGrams: number;
  adherencePercent: number;
  daysWithData: number;
  windowDays: number;
}

export interface NutritionRepository {
  /** Upsert the per-user-day aggregate (UNIQUE user_id + local_date). */
  upsertDaily(input: UpsertDailyNutritionInput): Promise<DailyNutritionRecord>;
  getDaily(userId: string, localDate: CalendarDate): Promise<DailyNutritionRecord | null>;
  /** Get a state snapshot for unified decision brain (recent window aggregate). */
  getStateSnapshot(userId: string, asOf: CalendarDate, windowDays?: number): Promise<NutritionStateSnapshot | null>;
}

export class PrismaNutritionRepository implements NutritionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertDaily(input: UpsertDailyNutritionInput): Promise<DailyNutritionRecord> {
    const localDate = parseDay(input.localDate, "localDate");
    return runDb(async () => {
      const data = {
        ...totalsSnapshotColumns(input.totals),
        ...(input.targetsSnapshot
          ? { targetsSnapshot: input.targetsSnapshot as Prisma.InputJsonValue }
          : {}),
      };
      const row = await this.prisma.dailyNutrition.upsert({
        where: { userId_localDate: { userId: input.userId, localDate } },
        create: {
          id: input.id ?? newUuidv7(),
          userId: input.userId,
          localDate,
          ...data,
        },
        update: data,
      });
      return dailyRowToRecord(row);
    });
  }

  async getDaily(userId: string, localDate: CalendarDate): Promise<DailyNutritionRecord | null> {
    const day = parseDay(localDate, "localDate");
    return runDb(async () => {
      const row = await this.prisma.dailyNutrition.findUnique({
        where: { userId_localDate: { userId: userId, localDate: day } },
      });
      return row ? dailyRowToRecord(row) : null;
    });
  }

  async getStateSnapshot(
    userId: string,
    asOf: CalendarDate,
    windowDays: number = 14,
  ): Promise<NutritionStateSnapshot | null> {
    const endDate = parseDay(asOf, "asOf");
    const startDate = new Date(endDate.getTime() - windowDays * 86400000);

    return runDb(async () => {
      const rows = await this.prisma.dailyNutrition.findMany({
        where: {
          userId,
          localDate: { gte: startDate, lte: endDate },
        },
        orderBy: { localDate: "asc" },
      });

      if (rows.length === 0) return null;

      const records = rows.map(dailyRowToRecord);

      // Calculate adherence: days meeting calorie target within ±10%
      let adherentDays = 0;
      for (const record of records) {
        if (record.targetsSnapshot && typeof record.targetsSnapshot === "object") {
          const target = record.targetsSnapshot as { caloriesKcal?: number };
          if (target.caloriesKcal && target.caloriesKcal > 0) {
            const diff = Math.abs(record.totals.caloriesKcal - target.caloriesKcal);
            if (diff / target.caloriesKcal <= 0.1) adherentDays++;
          }
        }
      }

      const avgCalories = records.reduce((sum, r) => sum + r.totals.caloriesKcal, 0) / records.length;
      const avgProtein = records.reduce((sum, r) => sum + (r.totals.proteinGrams ?? 0), 0) / records.length;
      const avgCarbs = records.reduce((sum, r) => sum + (r.totals.carbohydrateGrams ?? 0), 0) / records.length;
      const avgFat = records.reduce((sum, r) => sum + (r.totals.fatGrams ?? 0), 0) / records.length;

      return {
        recentDailyTotals: records,
        averageCalories: avgCalories,
        averageProteinGrams: avgProtein,
        averageCarbsGrams: avgCarbs,
        averageFatGrams: avgFat,
        adherencePercent: records.length > 0 ? (adherentDays / records.length) * 100 : 0,
        daysWithData: records.length,
        windowDays,
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Recipes (reference data; retired, never silently rewritten)
// ---------------------------------------------------------------------------

interface RecipeItemRow {
  id: string;
  recipeId: string;
  foodId: string;
  quantityGrams: unknown;
  position: number;
  notes: string | null;
}

export interface RecipeItemRecord {
  id: EntityId;
  recipeId: RecipeId;
  foodId: FoodId;
  quantityGrams: number;
  position: number;
  notes?: string;
}

interface RecipeRow {
  id: string;
  ownerUserId: string | null;
  name: string;
  servings: number;
  instructions: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecipeRecord {
  id: RecipeId;
  ownerUserId?: string;
  name: string;
  servings: number;
  instructions?: string;
  items: RecipeItemRecord[];
  createdAt: string;
  updatedAt: string;
}

function recipeItemRowToRecord(row: RecipeItemRow): RecipeItemRecord {
  return {
    id: row.id,
    recipeId: row.recipeId,
    foodId: row.foodId,
    quantityGrams: decimalToNumberOr0(row.quantityGrams),
    position: row.position,
    notes: row.notes ?? undefined,
  };
}

function recipeRowToRecord(row: RecipeRow, items: RecipeItemRecord[]): RecipeRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId ?? undefined,
    name: row.name,
    servings: row.servings,
    instructions: row.instructions ?? undefined,
    items,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

const RECIPE_INCLUDE = { items: { orderBy: { position: "asc" as const } } } as const;

export interface CreateRecipeInput {
  id?: string;
  ownerUserId?: string;
  name: string;
  servings: number;
  instructions?: string;
  items: readonly {
    foodId: FoodId;
    quantityGrams: number;
    notes?: string;
  }[];
}

export interface RecipeRepository {
  create(input: CreateRecipeInput): Promise<RecipeRecord>;
  findById(id: RecipeId): Promise<RecipeRecord | null>;
  listByOwner(ownerUserId: string): Promise<RecipeRecord[]>;
  deactivate(id: RecipeId): Promise<void>;
}

export class PrismaRecipeRepository implements RecipeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateRecipeInput): Promise<RecipeRecord> {
    const id = input.id ?? newUuidv7();
    return runDb(async () => {
      return this.prisma.$transaction(async (tx) => {
        const row = await tx.recipe.create({
          data: {
            id,
            ownerUserId: input.ownerUserId ?? null,
            name: input.name,
            servings: input.servings,
            instructions: input.instructions ?? null,
            items: {
              create: input.items.map((item, index) => ({
                id: newUuidv7(),
                recipeId: id,
                foodId: item.foodId,
                quantityGrams: item.quantityGrams,
                position: index,
                notes: item.notes ?? null,
              })),
            },
          },
          include: RECIPE_INCLUDE,
        });
        return recipeRowToRecord(row, row.items.map(recipeItemRowToRecord));
      });
    });
  }

  async findById(id: RecipeId): Promise<RecipeRecord | null> {
    return runDb(async () => {
      const row = await this.prisma.recipe.findUnique({
        where: { id },
        include: RECIPE_INCLUDE,
      });
      return row ? recipeRowToRecord(row, row.items.map(recipeItemRowToRecord)) : null;
    });
  }

  async listByOwner(ownerUserId: string): Promise<RecipeRecord[]> {
    return runDb(async () => {
      const rows = await this.prisma.recipe.findMany({
        where: { ownerUserId },
        include: RECIPE_INCLUDE,
        orderBy: { createdAt: "desc" },
      });
      return rows.map((row) => recipeRowToRecord(row, row.items.map(recipeItemRowToRecord)));
    });
  }

  async deactivate(id: RecipeId): Promise<void> {
    await runDb(async () => {
      await this.prisma.recipe.update({ where: { id }, data: { ownerUserId: null } });
    });
  }
}
