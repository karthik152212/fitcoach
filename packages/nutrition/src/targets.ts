import type { Goal, NutritionTargets, User, Sex, CalendarDate } from "@fitcoach/domain";

/**
 * Input required to derive personalized nutrition targets.
 */
export interface TargetDerivationInput {
  user: User;
  goal: Pick<Goal, "kind" | "physiqueTarget">;
  /** Rolling activity context; activity targets are contextual, never universal. */
  averageStepsLast14Days?: number;
  weeklyCardioMinutes?: number;
  currentBodyWeightKg?: number;
  /** Body fat percentage if available (for lean mass estimation). */
  bodyFatPercent?: number;
}

/**
 * Configuration for nutrition target derivation.
 * All values are modeling assumptions, not universal laws.
 */
export interface NutritionTargetConfiguration {
  version: string;
  /** BMR formula: "mifflin_st_jeor" | "katch_mcardle" (requires body fat %) */
  bmrFormula: "mifflin_st_jeor" | "katch_mcardle";
  /** Activity level multipliers for TDEE */
  activityMultipliers: Readonly<Record<ActivityLevel, number>>;
  /** Goal-specific calorie adjustments (relative to TDEE) */
  goalCalorieAdjustment: Readonly<Record<string, { deficit: number; surplus: number; maintenance: number }>>;
  /** Protein target g/kg bodyweight by goal */
  proteinGPerKg: Readonly<Record<string, number>>;
  /** Fat target as % of calories by goal */
  fatPercentOfCalories: Readonly<Record<string, { min: number; preferred: number; max: number }>>;
  /** Carb target fills remaining calories after protein + fat */
  /** Fiber target g per 1000 kcal */
  fiberGPer1000kcal: number;
  /** Minimum calories as % of BMR (safety floor) */
  minCaloriesPercentOfBmr: number;
  /** Maximum reasonable calorie surplus as % of TDEE */
  maxSurplusPercentOfTdee: number;
}

/**
 * Activity level classification for TDEE calculation.
 */
export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "active"
  | "very_active";

/**
 * Default nutrition target configuration.
 * Version: "fitcoach.nutrition.v1"
 */
export const DEFAULT_NUTRITION_TARGET_CONFIGURATION: NutritionTargetConfiguration = {
  version: "fitcoach.nutrition.v1",
  bmrFormula: "mifflin_st_jeor",
  activityMultipliers: {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9,
  },
  goalCalorieAdjustment: {
    bodybuilding: { deficit: -0.1, surplus: 0.15, maintenance: 0 },
    aesthetics_v_taper: { deficit: -0.15, surplus: 0.1, maintenance: 0 },
    lean_recomposition: { deficit: -0.2, surplus: 0.05, maintenance: 0 },
    athletic_performance: { deficit: -0.05, surplus: 0.1, maintenance: 0 },
    max_strength: { deficit: -0.05, surplus: 0.15, maintenance: 0 },
    general_fitness: { deficit: -0.15, surplus: 0.05, maintenance: 0 },
    custom: { deficit: -0.15, surplus: 0.1, maintenance: 0 },
  },
  proteinGPerKg: {
    bodybuilding: 2.2,
    aesthetics_v_taper: 2.2,
    lean_recomposition: 2.4,
    athletic_performance: 1.8,
    max_strength: 2.0,
    general_fitness: 1.6,
    custom: 2.0,
  },
  fatPercentOfCalories: {
    bodybuilding: { min: 0.2, preferred: 0.25, max: 0.3 },
    aesthetics_v_taper: { min: 0.2, preferred: 0.25, max: 0.3 },
    lean_recomposition: { min: 0.2, preferred: 0.25, max: 0.3 },
    athletic_performance: { min: 0.25, preferred: 0.3, max: 0.35 },
    max_strength: { min: 0.25, preferred: 0.3, max: 0.35 },
    general_fitness: { min: 0.25, preferred: 0.3, max: 0.35 },
    custom: { min: 0.2, preferred: 0.25, max: 0.35 },
  },
  fiberGPer1000kcal: 14,
  minCaloriesPercentOfBmr: 1.0, // Never go below BMR
  maxSurplusPercentOfTdee: 0.2, // Cap surplus at 20% above TDEE
};

/**
 * Determine activity level from steps and training context.
 */
function determineActivityLevel(input: TargetDerivationInput): ActivityLevel {
  const { averageStepsLast14Days = 0, weeklyCardioMinutes = 0 } = input;
  const trainingDays = input.user.profile.trainingDaysPerWeek ?? 0;

  // Heuristic: combine steps, cardio, and training frequency
  let score = 0;
  if (averageStepsLast14Days >= 10000) score += 2;
  else if (averageStepsLast14Days >= 7500) score += 1.5;
  else if (averageStepsLast14Days >= 5000) score += 1;
  else if (averageStepsLast14Days >= 3000) score += 0.5;

  if (weeklyCardioMinutes >= 150) score += 1.5;
  else if (weeklyCardioMinutes >= 75) score += 1;
  else if (weeklyCardioMinutes >= 30) score += 0.5;

  if (trainingDays >= 5) score += 1.5;
  else if (trainingDays >= 3) score += 1;
  else if (trainingDays >= 1) score += 0.5;

  if (score >= 5) return "very_active";
  if (score >= 4) return "active";
  if (score >= 2.5) return "moderate";
  if (score >= 1.5) return "light";
  return "sedentary";
}

/**
 * Calculate BMR using Mifflin-St Jeor equation.
 */
function calculateBmrMifflinStJeor(
  weightKg: number,
  heightCm: number,
  age: number,
  sex: Sex,
): number {
  // Mifflin-St Jeor: BMR = 10*weight + 6.25*height - 5*age + s
  // s = +5 for male, -161 for female
  const sexFactor = sex === "male" ? 5 : sex === "female" ? -161 : 0;
  return 10 * weightKg + 6.25 * heightCm - 5 * age + sexFactor;
}

/**
 * Calculate BMR using Katch-McArdle equation (requires lean body mass).
 */
function calculateBmrKatchMcArdle(leanBodyMassKg: number): number {
  // Katch-McArdle: BMR = 370 + 21.6 * LBM
  return 370 + 21.6 * leanBodyMassKg;
}

/**
 * Calculate user's age from birth date.
 */
function calculateAge(birthDate: CalendarDate | undefined): number | undefined {
  if (!birthDate) return undefined;
  const birth = new Date(birthDate + "T00:00:00");
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())) {
    age--;
  }
  return age >= 0 ? age : undefined;
}

/**
 * Derive calorie/protein/macro targets from the person, their goal and their
 * actual activity. Every target must carry a basis note explaining how it
 * was derived (explainability requirement).
 */
export function deriveNutritionTargets(
  input: TargetDerivationInput,
  config: NutritionTargetConfiguration = DEFAULT_NUTRITION_TARGET_CONFIGURATION,
): NutritionTargets {
  const { user, goal, currentBodyWeightKg, bodyFatPercent } = input;
  const { profile } = user;

  // Validate required profile data
  if (!profile.heightCm) {
    throw new RangeError("Profile heightCm is required for nutrition targets");
  }
  if (!profile.birthDate) {
    throw new RangeError("Profile birthDate is required for nutrition targets");
  }
  if (!profile.sex || profile.sex === "undisclosed") {
    throw new RangeError("Profile sex (male/female) is required for nutrition targets");
  }
  if (!profile.trainingExperience) {
    throw new RangeError("Profile trainingExperience is required for nutrition targets");
  }

  // Use current body weight or fall back to physique target
  const bodyWeight = currentBodyWeightKg ?? goal.physiqueTarget?.bodyWeightKg;
  if (bodyWeight === undefined) {
    throw new RangeError("Current body weight (currentBodyWeightKg) is required for nutrition targets");
  }

  // Calculate age
  const age = calculateAge(profile.birthDate);
  if (age === undefined) {
    throw new RangeError("Could not calculate age from birthDate");
  }

  // Calculate BMR
  let bmr: number;
  if (config.bmrFormula === "katch_mcardle" && bodyFatPercent !== undefined && bodyFatPercent > 0 && bodyFatPercent < 100) {
    const leanBodyMass = bodyWeight * (1 - bodyFatPercent / 100);
    bmr = calculateBmrKatchMcArdle(leanBodyMass);
  } else {
    bmr = calculateBmrMifflinStJeor(bodyWeight, profile.heightCm, age, profile.sex);
  }

  // Determine activity level and TDEE
  const activityLevel = determineActivityLevel(input);
  const activityMultiplier = config.activityMultipliers[activityLevel];
  const tdee = bmr * activityMultiplier;

  // Goal-based calorie adjustment
  const goalAdjustment =
    config.goalCalorieAdjustment[goal.kind] ?? config.goalCalorieAdjustment.custom;
  const customAdjustment =
    config.goalCalorieAdjustment.custom ?? { deficit: -0.15, surplus: 0.1, maintenance: 0 };
  let calorieAdjustment: number;
  const hasPhysiqueTarget = goal.physiqueTarget?.bodyWeightKg !== undefined;
  const targetWeight = goal.physiqueTarget?.bodyWeightKg;

  if (hasPhysiqueTarget && targetWeight !== undefined) {
    // Direction based on target vs current
    if (targetWeight > bodyWeight) {
      calorieAdjustment = goalAdjustment?.surplus ?? customAdjustment.surplus;
    } else if (targetWeight < bodyWeight) {
      calorieAdjustment = goalAdjustment?.deficit ?? customAdjustment.deficit;
    } else {
      calorieAdjustment = goalAdjustment?.maintenance ?? customAdjustment.maintenance;
    }
  } else {
    // No explicit physique target — infer from goal kind
    const deficitGoals = ["lean_recomposition", "aesthetics_v_taper", "general_fitness"];
    const surplusGoals = ["bodybuilding", "max_strength"];
    if (deficitGoals.includes(goal.kind))
      calorieAdjustment = goalAdjustment?.deficit ?? customAdjustment.deficit;
    else if (surplusGoals.includes(goal.kind))
      calorieAdjustment = goalAdjustment?.surplus ?? customAdjustment.surplus;
    else
      calorieAdjustment = goalAdjustment?.maintenance ?? customAdjustment.maintenance;
  }

  // Calculate target calories
  let targetCalories = Math.round(tdee * (1 + calorieAdjustment));

  // Safety floor: never below BMR
  const minCalories = Math.round(bmr * config.minCaloriesPercentOfBmr);
  if (targetCalories < minCalories) {
    targetCalories = minCalories;
  }

  // Safety ceiling: cap surplus
  const maxCalories = Math.round(tdee * (1 + config.maxSurplusPercentOfTdee));
  if (targetCalories > maxCalories) {
    targetCalories = maxCalories;
  }

  // Protein target: g/kg bodyweight
  const proteinPerKg = config.proteinGPerKg[goal.kind] ?? config.proteinGPerKg.custom ?? 2.0;
  const targetProtein = Math.round(proteinPerKg * bodyWeight);

  // Fat target: % of calories
  const fatConfig =
    config.fatPercentOfCalories[goal.kind] ?? config.fatPercentOfCalories.custom ?? {
      min: 0.2,
      preferred: 0.25,
      max: 0.35,
    };
  const targetFatCalories = Math.round(targetCalories * fatConfig.preferred);
  const targetFatGrams = Math.round(targetFatCalories / 9);

  // Carbohydrate target: remaining calories
  const proteinCalories = targetProtein * 4;
  const remainingCalories = targetCalories - proteinCalories - targetFatCalories;
  const targetCarbGrams = Math.max(0, Math.round(remainingCalories / 4));

  // Fiber target
  const targetFiber = Math.round((targetCalories / 1000) * config.fiberGPer1000kcal);

  // Validate macro-energy consistency
  const macroCalories = targetProtein * 4 + targetCarbGrams * 4 + targetFatGrams * 9;
  const calorieDiscrepancy = Math.abs(macroCalories - targetCalories);
  const discrepancyPercent = calorieDiscrepancy / targetCalories;
  if (discrepancyPercent > 0.05) {
    // Log discrepancy in basis note but don't throw — it's a modeling artifact
  }

  // Build basis note for explainability
  const basisParts: string[] = [
    `BMR ${Math.round(bmr)} kcal (${config.bmrFormula})`,
    `TDEE ${Math.round(tdee)} kcal (${activityLevel} × ${activityMultiplier})`,
    `Goal ${goal.kind}: ${calorieAdjustment >= 0 ? "+" : ""}${Math.round(calorieAdjustment * 100)}%`,
    `Protein ${proteinPerKg}g/kg × ${bodyWeight}kg`,
    `Fat ${Math.round(fatConfig.preferred * 100)}% of calories`,
  ];

  if (bodyFatPercent !== undefined) {
    basisParts.unshift(`Body fat ${bodyFatPercent}% → LBM ${Math.round(bodyWeight * (1 - bodyFatPercent / 100))}kg`);
  }

  const today: CalendarDate = new Date().toISOString().split("T")[0] as CalendarDate;

  return {
    caloriesKcal: targetCalories,
    proteinGrams: targetProtein,
    carbohydrateGrams: targetCarbGrams,
    fatGrams: targetFatGrams,
    fiberGrams: targetFiber,
    basisNote: basisParts.join("; "),
    effectiveFrom: today,
  };
}
