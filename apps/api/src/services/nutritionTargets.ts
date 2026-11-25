import type {
  Repositories,
} from "@fitcoach/db";
import type {
  CalendarDate,
  Goal,
  NutritionTargets,
  User,
} from "@fitcoach/domain";
import { NotFoundError } from "@fitcoach/db";
import {
  deriveNutritionTargets,
  type TargetDerivationInput,
  DEFAULT_NUTRITION_TARGET_CONFIGURATION,
} from "@fitcoach/nutrition";

type TargetDetails = NutritionTargets & {
  userId: string;
  goal?: Goal["kind"];
  derivedFrom?: { profile: boolean; goal: boolean; bodyComposition: boolean };
};

export interface NutritionTargetService {
  /**
   * Derive and store personalized nutrition targets for a user.
   * Returns the derived targets with basis note for explainability.
   */
  deriveAndStoreTargets(
    userId: string,
    goal: TargetDerivationInput["goal"],
    overrides?: Partial<TargetDerivationInput>,
  ): Promise<TargetDetails>;

  /**
   * Get stored targets for a user (from latest daily_nutrition target snapshot or recompute).
   */
  getTargets(userId: string): Promise<NutritionTargets | null>;

  /**
   * Update the targets snapshot on a specific day (e.g., when user manually adjusts).
   */
  updateTargetsSnapshot(userId: string, localDate: CalendarDate, targets: NutritionTargets): Promise<void>;
}

export class PrismaNutritionTargetService implements NutritionTargetService {
  constructor(
    private readonly repos: Repositories,
    private readonly config = DEFAULT_NUTRITION_TARGET_CONFIGURATION,
  ) {}

  private async requireUser(userId: string): Promise<User> {
    const user = await this.repos.users.findById(userId);
    if (!user) throw new NotFoundError(`user ${userId} not found`);
    return user;
  }

  async deriveAndStoreTargets(
    userId: string,
    goal: TargetDerivationInput["goal"],
    overrides?: Partial<TargetDerivationInput>,
  ): Promise<TargetDetails> {
    const user = await this.requireUser(userId);

    // Build the derivation input
    const input: TargetDerivationInput = {
      user,
      goal,
      ...overrides,
    };

    // Derive targets using the nutrition engine
    const targets: TargetDetails = {
      ...deriveNutritionTargets(input, this.config),
      userId,
      goal: goal.kind,
      derivedFrom: {
        profile: true,
        goal: true,
        bodyComposition: input.currentBodyWeightKg !== undefined || input.bodyFatPercent !== undefined,
      },
    };

    // Store as snapshot on today's daily nutrition record
    const today = new Date().toISOString().split("T")[0] as CalendarDate;
    await this.updateTargetsSnapshot(userId, today, targets);

    return targets;
  }

  async getTargets(userId: string): Promise<TargetDetails | null> {
    // First check today's daily nutrition for a targets snapshot
    const today = new Date().toISOString().split("T")[0] as CalendarDate;
    const daily = await this.repos.nutrition.getDaily(userId, today);

    if (daily?.targetsSnapshot) {
      const snapshot = daily.targetsSnapshot as Record<string, unknown>;
      return {
        userId,
        goal: snapshot.goal as TargetDetails["goal"],
        derivedFrom: snapshot.derivedFrom as TargetDetails["derivedFrom"],
        caloriesKcal: snapshot.caloriesKcal as number,
        proteinGrams: snapshot.proteinGrams as number,
        carbohydrateGrams: snapshot.carbohydrateGrams as number | undefined,
        fatGrams: snapshot.fatGrams as number | undefined,
        fiberGrams: snapshot.fiberGrams as number | undefined,
        basisNote: snapshot.basisNote as string | undefined,
        effectiveFrom: snapshot.effectiveFrom as CalendarDate,
      };
    }

    // Fallback: check most recent daily nutrition record
    // (would need a query method; for now return null if today has none)
    return null;
  }

  async updateTargetsSnapshot(userId: string, localDate: CalendarDate, targets: NutritionTargets): Promise<void> {
    // Upsert the daily nutrition record with the targets snapshot
    const existing = await this.repos.nutrition.getDaily(userId, localDate);
    const totals = existing?.totals ?? { caloriesKcal: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0 };

    await this.repos.nutrition.upsertDaily({
      userId,
      localDate,
      totals,
      targetsSnapshot: { ...targets },
    });
  }
}

/**
 * Helper to get activity context for target derivation from stored data.
 */
export async function buildTargetDerivationInput(
  repos: Repositories,
  userId: string,
  goal: Goal,
  currentBodyWeightKg?: number,
  bodyFatPercent?: number,
): Promise<TargetDerivationInput> {
  // Fetch the user first
  const user = await repos.users.findById(userId);
  if (!user) throw new Error(`user ${userId} not found`);

  // Get average steps from last 14 days
  const endDate = new Date().toISOString().split("T")[0] as CalendarDate;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 13);
  const startDateStr = startDate.toISOString().split("T")[0] as CalendarDate;

  const activityRecords = await repos.activity.history(userId, {
    kind: "steps" as import("@fitcoach/domain").ActivityKind,
    from: startDateStr,
    to: endDate,
    limit: 14,
  });

  const stepValues = activityRecords
    .map((r: { steps?: number }) => r.steps)
    .filter((s: number | undefined): s is number => s !== undefined && s > 0);

  const averageStepsLast14Days = stepValues.length > 0
    ? Math.round(stepValues.reduce((a: number, b: number) => a + b, 0) / stepValues.length)
    : undefined;

  // Get weekly cardio minutes (simplified: sum of non-steps activity in last 7 days)
  const cardioStartDate = new Date();
  cardioStartDate.setDate(cardioStartDate.getDate() - 6);
  const cardioStartStr = cardioStartDate.toISOString().split("T")[0] as CalendarDate;

  const cardioRecords = await repos.activity.history(userId, {
    from: cardioStartStr,
    to: endDate,
    limit: 50,
  });

  const cardioMinutes = cardioRecords
    .filter((r: { kind: string; durationMinutes?: number }) => r.kind !== "steps" && r.durationMinutes)
    .reduce((sum: number, r: { durationMinutes?: number }) => sum + (r.durationMinutes ?? 0), 0);

  return {
    user,
    goal,
    currentBodyWeightKg,
    bodyFatPercent,
    averageStepsLast14Days,
    weeklyCardioMinutes: cardioMinutes > 0 ? cardioMinutes : undefined,
  };
}