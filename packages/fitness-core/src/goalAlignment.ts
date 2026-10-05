import type { BodyMeasurement, DailyNutrition, Goal, Workout } from "@fitcoach/domain";
import { NotImplementedError } from "./errors";
import type { TrendAnalysis } from "./trendDetection";

export interface GoalAlignmentInputs {
  weightTrend?: TrendAnalysis;
  recentMeasurements: readonly BodyMeasurement[];
  recentWorkouts: readonly Workout[];
  recentNutrition: readonly DailyNutrition[];
}

export type AlignmentStatus = "on_track" | "needs_attention" | "off_track" | "insufficient_data";

export interface AlignmentFinding {
  topic: string;
  status: AlignmentStatus;
  detail: string;
}

export interface GoalAlignmentReport {
  overall: AlignmentStatus;
  findings: readonly AlignmentFinding[];
}

export interface GoalAlignmentRequest {
  goal: Goal;
  inputs: GoalAlignmentInputs;
}

/**
 * Evaluate whether the user's actual trajectory serves their stated goal.
 * Example: for an aesthetics/V-taper goal, chest growth does not imply
 * on-track progress if waist circumference grows disproportionately.
 */
export function evaluateGoalAlignment(_request: GoalAlignmentRequest): GoalAlignmentReport {
  throw new NotImplementedError("goalAlignment.evaluateGoalAlignment");
}
