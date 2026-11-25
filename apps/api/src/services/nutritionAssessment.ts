import type {
  Repositories,
} from "@fitcoach/db";
import type {
  CalendarDate,
  DailyNutrition,
  NutritionTargets,
  NutrientAmounts,
  UserId,
} from "@fitcoach/domain";
import { NotFoundError } from "@fitcoach/db";
import { analyzeNutritionTrend, divideNutrientAmounts, sumNutrientAmounts, type NutritionTrendReport } from "@fitcoach/nutrition";

type IntakeAssessment = "under" | "on_target" | "over";

function classifyIntake(ratio: number): IntakeAssessment {
  return ratio < 0.9 ? "under" : ratio > 1.1 ? "over" : "on_target";
}

export interface AdherenceAssessment {
  /** Current day's totals vs targets (percentage) */
  dailyAdherence: {
    calories: number;
    protein: number;
    carbohydrates: number | null;
    fat: number | null;
    fiber: number | null;
  };
  /** Rolling window trend analysis */
  trends: NutritionTrendReport;
  /** Summary flags for coaching */
  flags: {
    calories: "under" | "on_track" | "over";
    protein: "under" | "on_track" | "over";
  };
  /** Human-readable summary */
  summary: string;
}

/**
 * Nutrition assessment service — analyzes adherence and trends.
 *
 * Uses the nutrition engine's trend detection to provide actionable
 * insights without over-interpreting single days.
 */
export class NutritionAssessmentService {
  constructor(
    private readonly repos: Repositories,
    private readonly defaultWindowDays = 14,
  ) {}

  private async requireUser(userId: string): Promise<void> {
    const user = await this.repos.users.findById(userId);
    if (!user) throw new NotFoundError(`user ${userId} not found`);
  }

  /**
   * Assess nutrition adherence for a user over a rolling window.
   */
  async assessAdherence(
    userId: string,
    targets: NutritionTargets,
    windowDays?: number,
  ): Promise<AdherenceAssessment & {
    userId: string;
    windowDays: number;
    targets: NutritionTargets;
    averages: NutrientAmounts;
    adherence: { caloriesKcal: number; proteinGrams: number };
    assessment: { caloriesKcal: IntakeAssessment; proteinGrams: IntakeAssessment };
    daysLogged: number;
  }> {
    await this.requireUser(userId);
    const days = windowDays ?? this.defaultWindowDays;

    // Get daily nutrition records for the window
    const dailyRecords = await this.getDailyRecords(userId, days);
    const loggedDays = dailyRecords.filter(({ mealIds }) => mealIds.length > 0);
    const averages = divideNutrientAmounts(
      sumNutrientAmounts(loggedDays.map(({ totals }) => totals)),
      Math.max(loggedDays.length, 1),
    );
    const calorieRatio = targets.caloriesKcal > 0 ? averages.caloriesKcal / targets.caloriesKcal : 0;
    const proteinRatio = targets.proteinGrams > 0 ? averages.proteinGrams / targets.proteinGrams : 0;
    const latest = dailyRecords.at(-1);
    const trends = analyzeNutritionTrend(dailyRecords, days);
    const dailyAdherence = this.calculateDailyAdherence(latest?.totals ?? averages, targets);
    const flags = this.evaluateFlags(trends, targets);

    return {
      ...(latest
        ? { dailyAdherence, trends, flags, summary: this.generateSummary(dailyAdherence, trends, flags) }
        : this.emptyAssessment(targets)),
      userId,
      windowDays: days,
      targets,
      averages,
      adherence: { caloriesKcal: calorieRatio, proteinGrams: proteinRatio },
      assessment: { caloriesKcal: classifyIntake(calorieRatio), proteinGrams: classifyIntake(proteinRatio) },
      daysLogged: loggedDays.length,
    };
  }

  /**
   * Get daily nutrition records for the last N days.
   */
  private async getDailyRecords(userId: string, windowDays: number): Promise<readonly DailyNutrition[]> {
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - windowDays + 1);

    const records: DailyNutrition[] = [];
    const current = new Date(startDate);

    while (current <= endDate) {
      const dateStr = current.toISOString().split("T")[0] as CalendarDate;
      const record = await this.repos.nutrition.getDaily(userId, dateStr);
      if (record) {
        // Get meals for this date to populate mealIds
        const meals = await this.repos.meals.listByDate(userId, dateStr);
        const mealIds = meals.map((m) => m.id);
        records.push({
          id: record.id,
          userId: userId as UserId,
          date: record.localDate,
          mealIds,
          totals: record.totals,
          targetsSnapshot: record.targetsSnapshot ? record.targetsSnapshot as unknown as NutritionTargets : undefined,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        });
      }
      current.setDate(current.getDate() + 1);
    }

    return records;
  }

  private calculateDailyAdherence(
    totals: NutrientAmounts,
    targets: NutritionTargets,
  ): AdherenceAssessment["dailyAdherence"] {
    return {
      calories: targets.caloriesKcal > 0
        ? Math.round((totals.caloriesKcal / targets.caloriesKcal) * 100)
        : 0,
      protein: targets.proteinGrams > 0
        ? Math.round((totals.proteinGrams / targets.proteinGrams) * 100)
        : 0,
      carbohydrates: targets.carbohydrateGrams !== undefined && targets.carbohydrateGrams > 0
        ? Math.round((totals.carbohydrateGrams / targets.carbohydrateGrams) * 100)
        : null,
      fat: targets.fatGrams !== undefined && targets.fatGrams > 0
        ? Math.round((totals.fatGrams / targets.fatGrams) * 100)
        : null,
      fiber: targets.fiberGrams !== undefined && targets.fiberGrams > 0 && totals.fiberGrams !== undefined
        ? Math.round((totals.fiberGrams / targets.fiberGrams) * 100)
        : null,
    };
  }

  private evaluateFlags(
    trends: NutritionTrendReport,
    targets: NutritionTargets,
  ): AdherenceAssessment["flags"] {
    // Use trend direction for calories and protein
    const calorieTrend = trends.calories.direction;
    const proteinTrend = trends.protein.direction;

    let calories: "under" | "on_track" | "over" = "on_track";
    if (calorieTrend === "increasing" && trends.calories.slopePerDay !== null && trends.calories.slopePerDay > targets.caloriesKcal * 0.01) {
      calories = "over";
    } else if (calorieTrend === "decreasing" && trends.calories.slopePerDay !== null && trends.calories.slopePerDay < -targets.caloriesKcal * 0.01) {
      calories = "under";
    }

    let protein: "under" | "on_track" | "over" = "on_track";
    if (proteinTrend === "decreasing" && trends.protein.slopePerDay !== null && trends.protein.slopePerDay < -targets.proteinGrams * 0.01) {
      protein = "under";
    } else if (proteinTrend === "increasing" && trends.protein.slopePerDay !== null && trends.protein.slopePerDay > targets.proteinGrams * 0.01) {
      protein = "over";
    }

    return { calories, protein };
  }

  private generateSummary(
    dailyAdherence: AdherenceAssessment["dailyAdherence"],
    trends: NutritionTrendReport,
    flags: AdherenceAssessment["flags"],
  ): string {
    const parts: string[] = [];

    // Daily snapshot
    parts.push(
      `Today: ${dailyAdherence.calories}% calories, ${dailyAdherence.protein}% protein` +
      (dailyAdherence.carbohydrates !== null ? `, ${dailyAdherence.carbohydrates}% carbs` : "") +
      (dailyAdherence.fat !== null ? `, ${dailyAdherence.fat}% fat` : "") +
      (dailyAdherence.fiber !== null ? `, ${dailyAdherence.fiber}% fiber` : ""),
    );

    // Trend summary
    const trendDescriptions: string[] = [];
    if (trends.calories.direction !== "insufficient_data") {
      trendDescriptions.push(`calories ${trends.calories.direction}`);
    }
    if (trends.protein.direction !== "insufficient_data") {
      trendDescriptions.push(`protein ${trends.protein.direction}`);
    }
    if (trendDescriptions.length > 0) {
      parts.push(`Trends (${trends.windowDays}d): ${trendDescriptions.join(", ")}.`);
    }

    // Flags
    if (flags.calories !== "on_track") {
      parts.push(`⚠ Calories trending ${flags.calories}.`);
    }
    if (flags.protein !== "on_track") {
      parts.push(`⚠ Protein trending ${flags.protein}.`);
    }

    return parts.join(" ");
  }

  private emptyAssessment(_targets: NutritionTargets): AdherenceAssessment {
    return {
      dailyAdherence: {
        calories: 0,
        protein: 0,
        carbohydrates: null,
        fat: null,
        fiber: null,
      },
      trends: {
        calories: { direction: "insufficient_data", slopePerDay: null, confidence: null, pointsUsed: 0, warnings: [] },
        protein: { direction: "insufficient_data", slopePerDay: null, confidence: null, pointsUsed: 0, warnings: [] },
        carbohydrates: { direction: "insufficient_data", slopePerDay: null, confidence: null, pointsUsed: 0, warnings: [] },
        fat: { direction: "insufficient_data", slopePerDay: null, confidence: null, pointsUsed: 0, warnings: [] },
        windowDays: this.defaultWindowDays,
      },
      flags: { calories: "on_track", protein: "on_track" },
      summary: "No nutrition data recorded yet.",
    };
  }
}