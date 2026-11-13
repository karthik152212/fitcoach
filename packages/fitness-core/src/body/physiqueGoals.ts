import type { UserId, Timestamp } from "@fitcoach/domain";
import type { PhysiquePriorityTag, PhysiqueGoal } from "./types";
import { DEFAULT_PHYSIQUE_GOAL_CONFIG, type PhysiqueGoalConfig } from "./configuration";

/**
 * Physique goals and priorities model.
 * Users define ordered priorities; engine reasons from these for assessments and recommendations.
 */

export interface PhysiqueGoalInput {
  userId: UserId;
  priorities: readonly PhysiquePriorityTag[];
  customPriorities?: readonly { tag: string; label: string }[];
  targetTimeframeWeeks?: number;
  direction?: "maintain" | "gain" | "lose" | "recomp";
}

let _lastTimestamp = 0;

function getUniqueTimestamp(): Timestamp {
  const now = Date.now();
  if (now <= _lastTimestamp) {
    _lastTimestamp += 1;
    return new Date(_lastTimestamp).toISOString() as Timestamp;
  }
  _lastTimestamp = now;
  return new Date(now).toISOString() as Timestamp;
}

// For testing: allow timestamp reset
export function _resetTimestampForTesting(): void {
  _lastTimestamp = 0;
}

/**
 * Create a new physique goal record.
 */
export function createPhysiqueGoal(input: PhysiqueGoalInput): PhysiqueGoal {
  const now = getUniqueTimestamp();
  return {
    id: crypto.randomUUID(),
    userId: input.userId,
    priorities: input.priorities,
    customPriorities: input.customPriorities,
    targetTimeframeWeeks: input.targetTimeframeWeeks,
    direction: input.direction ?? "recomp",
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Update an existing physique goal.
 */
export function updatePhysiqueGoal(
  existing: PhysiqueGoal,
  updates: Partial<PhysiqueGoalInput>,
): PhysiqueGoal {
  const hasChanges =
    (updates.priorities !== undefined && updates.priorities.length !== existing.priorities.length) ||
    (updates.priorities !== undefined && updates.priorities.some((p, i) => p !== existing.priorities[i])) ||
    (updates.customPriorities !== undefined && updates.customPriorities !== existing.customPriorities) ||
    (updates.targetTimeframeWeeks !== undefined && updates.targetTimeframeWeeks !== existing.targetTimeframeWeeks) ||
    (updates.direction !== undefined && updates.direction !== existing.direction);

  return {
    ...existing,
    priorities: updates.priorities ?? existing.priorities,
    customPriorities: updates.customPriorities ?? existing.customPriorities,
    targetTimeframeWeeks: updates.targetTimeframeWeeks ?? existing.targetTimeframeWeeks,
    direction: updates.direction ?? existing.direction,
    updatedAt: hasChanges ? getUniqueTimestamp() : existing.updatedAt,
  };
}

/**
 * Get the primary priority tag.
 */
export function getPrimaryPriority(goal: PhysiqueGoal): PhysiquePriorityTag | null {
  return goal.priorities[0] ?? null;
}

/**
 * Get all muscle groups relevant to a user's physique priorities.
 */
export function getPriorityMuscleGroups(
  goal: PhysiqueGoal,
  config: PhysiqueGoalConfig = DEFAULT_PHYSIQUE_GOAL_CONFIG,
): readonly string[] {
  const muscles = new Set<string>();
  for (const priority of goal.priorities) {
    const mapped = config.priorityToMuscles[priority] ?? [];
    for (const m of mapped) muscles.add(m);
  }
  return Array.from(muscles);
}

/**
 * Check if a priority is explicitly set by the user.
 */
export function hasPriority(goal: PhysiqueGoal, tag: PhysiquePriorityTag): boolean {
  return goal.priorities.includes(tag);
}

/**
 * Get priority rank (0 = highest priority).
 */
export function getPriorityRank(goal: PhysiqueGoal, tag: PhysiquePriorityTag): number | null {
  const index = goal.priorities.indexOf(tag);
  return index >= 0 ? index : null;
}

/**
 * Assess whether current measurements/progress align with physique goals.
 * Returns goal-relative progress status.
 */
export function assessGoalRelativeProgress(
  goal: PhysiqueGoal,
  weightTrendDirection: "increasing" | "decreasing" | "stable" | "insufficient_data",
  weightSlopeKgPerWeek: number | null,
  circumferenceTrends: readonly { site: string; direction: string; slopeCmPerWeek: number | null }[],
  _composition?: { bodyFatPercent: number; confidence: number },
): "on_track" | "needs_attention" | "insufficient_data" {
  const primary = getPrimaryPriority(goal);
  if (!primary) return "insufficient_data";

  // If insufficient data overall, can't assess
  if (weightTrendDirection === "insufficient_data") return "insufficient_data";

  const direction = goal.direction ?? "recomp";

  switch (primary) {
    case "overall_mass":
      if (direction === "gain") {
        return weightTrendDirection === "increasing" && (weightSlopeKgPerWeek ?? 0) > 0.1
          ? "on_track"
          : "needs_attention";
      }
      if (direction === "recomp") {
        // For recomp, stable weight is acceptable (maintaining while recomping)
        return weightTrendDirection === "stable" || (weightTrendDirection === "increasing" && (weightSlopeKgPerWeek ?? 0) > 0.05)
          ? "on_track"
          : "needs_attention";
      }
      return "on_track"; // maintain/loss not primary for mass

    case "leanness":
      if (direction === "lose" || direction === "recomp") {
        const waistTrend = circumferenceTrends.find((t) => t.site === "waist");
        return waistTrend?.direction === "decreasing" && (waistTrend.slopeCmPerWeek ?? 0) < -0.1
          ? "on_track"
          : "needs_attention";
      }
      return "on_track";

    case "shoulder_width":
    case "chest_development":
    case "back_width":
    case "arm_size":
    case "leg_size":
    case "glutes":
      // These need muscle-specific measurements; if we have circumference trends, check relevant sites
      const relevantSites = getRelevantCircumferenceSites(primary);
      const relevantTrends = circumferenceTrends.filter((t) => relevantSites.includes(t.site));
      if (relevantTrends.length === 0) return "insufficient_data";
      const anyIncreasing = relevantTrends.some(
        (t) => t.direction === "increasing" && (t.slopeCmPerWeek ?? 0) > 0.05
      );
      return anyIncreasing ? "on_track" : "needs_attention";

    case "waist_proportion":
      const waist = circumferenceTrends.find((t) => t.site === "waist");
      const shoulder = circumferenceTrends.find((t) => t.site === "shoulders");
      if (!waist || !shoulder) return "insufficient_data";
      // Waist should decrease or stay stable, shoulders should increase
      const waistGood = waist.direction !== "increasing";
      const shoulderGood = shoulder.direction === "increasing";
      return waistGood && shoulderGood ? "on_track" : "needs_attention";

    case "symmetry":
    case "proportion":
      // These are assessed via disproportionate development rules
      return "insufficient_data";

    case "upper_body":
    case "lower_body":
    case "push_muscles":
    case "pull_muscles":
    case "legs":
    case "core":
      return "insufficient_data"; // Need muscle development analysis

    default:
      return "insufficient_data";
  }
}

function getRelevantCircumferenceSites(priority: PhysiquePriorityTag): string[] {
  const map: Record<PhysiquePriorityTag, string[]> = {
    shoulder_width: ["shoulders"],
    chest_development: ["chest"],
    back_width: ["chest", "shoulders"], // Proxy
    arm_size: ["left_upper_arm", "right_upper_arm"],
    leg_size: ["left_thigh", "right_thigh"],
    glutes: ["hips", "left_thigh", "right_thigh"],
    waist_proportion: ["waist", "shoulders"],
    symmetry: ["left_upper_arm", "right_upper_arm", "left_thigh", "right_thigh", "left_calf", "right_calf"],
    proportion: ["shoulders", "waist", "chest", "hips", "left_thigh", "right_thigh", "left_calf", "right_calf"],
    overall_mass: ["chest", "shoulders", "waist", "hips", "left_thigh", "right_thigh", "left_upper_arm", "right_upper_arm"],
    leanness: ["waist", "hips"],
    upper_body: ["chest", "shoulders", "left_upper_arm", "right_upper_arm"],
    lower_body: ["left_thigh", "right_thigh", "left_calf", "right_calf", "hips"],
    push_muscles: ["chest", "shoulders", "left_upper_arm", "right_upper_arm"],
    pull_muscles: ["chest", "shoulders", "left_upper_arm", "right_upper_arm"], // Proxy
    legs: ["left_thigh", "right_thigh", "left_calf", "right_calf"],
    core: ["waist", "hips"],
    custom: [],
  };
  return map[priority] ?? [];
}

/**
 * Generate default physique goal for a user based on their training goal.
 */
export function defaultPhysiqueGoalForTrainingGoal(
  userId: UserId,
  trainingGoalKind: string,
): PhysiqueGoal {
  let priorities: PhysiquePriorityTag[] = [];
  let direction: PhysiqueGoal["direction"] = "recomp";

  switch (trainingGoalKind) {
    case "build_muscle":
    case "bodybuilding":
      priorities = ["overall_mass", "symmetry", "proportion", "chest_development", "back_width", "arm_size", "leg_size"];
      direction = "gain";
      break;
    case "lose_fat":
    case "lean_recomposition":
      priorities = ["leanness", "waist_proportion", "overall_mass", "symmetry"];
      direction = "lose";
      break;
    case "athletic_performance":
      priorities = ["lower_body", "core", "proportion", "overall_mass"];
      direction = "recomp";
      break;
    case "max_strength":
      priorities = ["overall_mass", "push_muscles", "pull_muscles", "legs", "core"];
      direction = "gain";
      break;
    case "general_fitness":
      priorities = ["proportion", "symmetry", "overall_mass", "leanness"];
      direction = "recomp";
      break;
    case "aesthetics_v_taper":
      priorities = ["shoulder_width", "back_width", "waist_proportion", "chest_development", "symmetry"];
      direction = "recomp";
      break;
    default:
      priorities = ["symmetry", "proportion", "overall_mass"];
      direction = "recomp";
  }

  return createPhysiqueGoal({ userId, priorities, direction });
}