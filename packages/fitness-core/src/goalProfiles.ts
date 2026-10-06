import type { GoalKind, TrainingGoalProfile } from "@fitcoach/domain";

/**
 * Goal-aware exercise quality (Phase 2, §32).
 *
 * Exercise quality is not a property of the exercise. The same bench press is
 * an excellent S choice for maximum strength and a mediocre B choice for a
 * beginner's first hypertrophy block. The engines therefore score against a
 * *goal profile*, not against a universal ranking.
 *
 * The mapping is a small, explicit table rather than a heuristic over free
 * text. Goal priorities refine it (a "lean" priority inside bodybuilding does
 * not change what an exercise stimulates), so they are carried alongside the
 * profile and surfaced in explanations, never folded into the score as if they
 * were physiological facts.
 */
const KIND_TO_PROFILE: Readonly<Record<GoalKind, TrainingGoalProfile>> = {
  bodybuilding: "hypertrophy",
  aesthetics_v_taper: "v_taper",
  lean_recomposition: "recomposition",
  athletic_performance: "athletic",
  max_strength: "strength",
  general_fitness: "general_fitness",
  // A custom goal is judged as general fitness until the user names something
  // more specific; inventing a profile from a description would be a guess.
  custom: "general_fitness",
};

/**
 * Priority tags that refine how a profile reads an exercise's roles. These
 * adjust emphasis in the *explanation*, never the physiological score, because
 * a priority cannot change what a movement stimulates.
 */
const PRIORITY_AFFINITY: Readonly<Record<string, readonly string[]>> = {
  v_taper: ["lat_emphasis_pull", "lateral_delt_isolation", "upper_chest_press"],
  shoulder_width: ["lateral_delt_isolation"],
  upper_body: ["horizontal_push", "horizontal_pull", "vertical_pull", "vertical_push"],
  arm_development: ["isolation_movement"],
  chest_development: ["upper_chest_press", "horizontal_push"],
  leg_development: ["knee_extension_movement", "squat"],
  posterior_chain: ["hinge", "hip_extension_movement", "hamstring_knee_flexion"],
  core: ["core_anti_extension", "core_rotation"],
};

export interface GoalProfileResult {
  profile: TrainingGoalProfile;
  /** Goal priority tags carried through to explanations. */
  priorities: readonly string[];
  /**
   * Program roles this goal specifically values. A role listed here does not
   * add score; it is what lets an explanation say "this serves your V-taper
   * priority" with a reason that is checkable.
   */
  emphasisedRoles: readonly string[];
}

/** Deterministic, total mapping from a goal to the axis exercises are judged on. */
export function goalProfileFor(goal: {
  kind: GoalKind;
  priorities?: readonly string[];
}): GoalProfileResult {
  const profile = KIND_TO_PROFILE[goal.kind] ?? "general_fitness";
  const priorities = [...(goal.priorities ?? [])];
  const emphasised = new Set<string>();
  for (const priority of priorities) {
    for (const role of PRIORITY_AFFINITY[priority] ?? []) emphasised.add(role);
  }
  // Profile defaults, so a goal with no priorities still has a stated intent.
  for (const role of DEFAULT_ROLE_EMPHASIS[profile]) emphasised.add(role);
  return {
    profile,
    priorities,
    emphasisedRoles: [...emphasised].sort(),
  };
}

const DEFAULT_ROLE_EMPHASIS: Readonly<Record<TrainingGoalProfile, readonly string[]>> = {
  hypertrophy: ["hypertrophy_movement", "lengthened_position_emphasis"],
  strength: ["primary_strength_movement", "compound_movement"],
  athletic: ["compound_movement", "primary_strength_movement"],
  v_taper: ["lat_emphasis_pull", "lateral_delt_isolation", "upper_chest_press"],
  recomposition: ["compound_movement", "hypertrophy_movement"],
  general_fitness: ["compound_movement"],
};

/**
 * Weight of each scoring axis per goal profile.
 *
 * These are the model's stated assumptions, not measurements. They are exposed
 * so a reviewer can see exactly what "a strength goal" means numerically, and
 * they are versioned with the scoring model so an old decision stays legible.
 */
export interface GoalAxisWeights {
  stimulus: number;
  progression: number;
  control: number;
  fatigueEfficiency: number;
  balance: number;
}

export const GOAL_AXIS_WEIGHTS: Readonly<Record<TrainingGoalProfile, GoalAxisWeights>> = {
  // Hypertrophy cares about the stimulus itself and how cheaply it can be
  // repeated, and rewards control and range more than peak load.
  hypertrophy: {
    stimulus: 1.0,
    progression: 0.75,
    control: 1.0,
    fatigueEfficiency: 1.0,
    balance: 0.75,
  },
  // Strength cares about specificity and loadability, and cares much less
  // about fatigue efficiency because heavy work is expensive by design.
  strength: {
    stimulus: 0.75,
    progression: 1.0,
    control: 0.8,
    fatigueEfficiency: 0.4,
    balance: 0.4,
  },
  // Athletic performance rewards whole-pattern competence and control.
  athletic: {
    stimulus: 0.7,
    progression: 0.85,
    control: 1.0,
    fatigueEfficiency: 0.7,
    balance: 0.9,
  },
  // A V-taper goal is a balance goal: the exercise matters because of what it
  // adds to the silhouette, not because it is the best lat exercise possible.
  v_taper: {
    stimulus: 0.8,
    progression: 0.6,
    control: 0.9,
    fatigueEfficiency: 0.85,
    balance: 1.0,
  },
  recomposition: {
    stimulus: 0.85,
    progression: 0.8,
    control: 0.95,
    fatigueEfficiency: 1.0,
    balance: 0.7,
  },
  general_fitness: {
    stimulus: 0.7,
    progression: 0.7,
    control: 0.85,
    fatigueEfficiency: 0.9,
    balance: 0.8,
  },
};
