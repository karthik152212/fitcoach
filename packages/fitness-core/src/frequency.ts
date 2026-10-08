import type { TrainingGoalProfile, TrainingExperience } from "@fitcoach/domain";
import { DEFAULT_MUSCLE_FREQUENCY_TARGETS } from "./trainingConfig";

/**
 * Frequency planning engine (Phase 3).
 *
 * Distributes muscle training across available sessions based on:
 * - Goal priorities
 * - Volume requirements
 * - Recovery needs
 * - Available days
 * - Session duration
 * - Exercise overlap
 *
 * Frequency is a means, not the goal. The engine avoids:
 * - All weekly work in one session
 * - Excessive frequency without reason
 * - Unnecessary frequency to hit numeric targets
 */

// ---------------------------------------------------------------------------
// Frequency targets
// ---------------------------------------------------------------------------

/**
 * Get frequency target for a muscle group based on goal and volume.
 */
export function getMuscleFrequencyTarget(
  muscleGroup: string,
  goalProfile: TrainingGoalProfile,
  volume: number,
  experience: TrainingExperience,
): { min: number; preferred: number; max: number } | null {
  const base = DEFAULT_MUSCLE_FREQUENCY_TARGETS[muscleGroup];
  if (!base) return null;

  // Higher volume muscles may benefit from more frequency
  const volumeFactor = Math.min(volume / 12, 1.5); // Cap at 1.5x for high volume

  // Goal modifier
  let goalModifier = 1.0;
  switch (goalProfile) {
    case "strength":
      goalModifier = 0.8; // Strength: slightly lower frequency, higher intensity
      break;
    case "hypertrophy":
      goalModifier = 1.0; // Hypertrophy: standard frequency
      break;
    case "v_taper":
      goalModifier = 1.0; // V-taper: standard
      break;
    case "athletic":
      goalModifier = 1.1; // Athletic: slightly higher for movement practice
      break;
    case "recomposition":
      goalModifier = 0.9; // Recomposition: moderate
      break;
    case "general_fitness":
      goalModifier = 0.7; // General: lower volume, lower frequency
      break;
  }

  // Experience modifier
  let expModifier = 1.0;
  switch (experience) {
    case "untrained":
      expModifier = 0.7; // Beginners: less frequency, more recovery
      break;
    case "beginner":
      expModifier = 0.85;
      break;
    case "intermediate":
      expModifier = 1.0;
      break;
    case "advanced":
      expModifier = 1.15; // Advanced: can handle more frequency
      break;
  }

  const min = Math.max(1, Math.round(base.min * goalModifier * expModifier));
  const preferred = Math.max(1, Math.round(base.preferred * goalModifier * expModifier * volumeFactor));
  const max = Math.max(preferred, Math.round(base.max * goalModifier * expModifier));

  return { min, preferred, max };
}

// ---------------------------------------------------------------------------
// Frequency distribution
// ---------------------------------------------------------------------------

/**
 * Distribute muscle training across available sessions.
 *
 * @param muscleGroups - Muscle groups to train with their weekly volume.
 * @param availableSessions - Number of available sessions per week.
 * @param goalProfile - Goal profile.
 * @param experience - Training experience.
 * @param splitType - The split type being used.
 * @returns Frequency distribution with session assignments.
 */
export function distributeFrequency(
  muscleGroups: Readonly<Record<string, number>>, // muscleSlug → weekly effective sets
  availableSessions: number,
  goalProfile: TrainingGoalProfile,
  experience: TrainingExperience,
  splitType: string,
): {
  distribution: readonly SessionFrequency[];
  sessionAssignments: readonly SessionAssignment[];
  warnings: readonly string[];
} {
  const sessions: MutableSession[] = [];
  const assignments: SessionAssignment[] = [];
  const warnings: string[] = [];

  // Initialize sessions
  for (let i = 0; i < availableSessions; i++) {
    sessions.push({
      sessionIndex: i,
      muscles: new Map<string, number>(),
      totalVolume: 0,
    });
  }

  // Sort muscles by priority (volume descending)
  const sortedMuscles = Object.entries(muscleGroups)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  // Distribute each muscle across sessions
  for (const [muscleSlug, weeklyVolume] of sortedMuscles) {
    const target = getMuscleFrequencyTarget(muscleSlug, goalProfile, weeklyVolume, experience);
    if (!target) {
      warnings.push(`No frequency target for muscle: ${muscleSlug}`);
      continue;
    }

    const desiredFrequency = Math.min(target.preferred, availableSessions);
    const setsPerSession = Math.ceil(weeklyVolume / desiredFrequency);

    // Choose sessions for this muscle
    const chosenSessions = chooseSessionsForMuscle(
      muscleSlug,
      desiredFrequency,
      availableSessions,
      splitType,
    );

    for (const sessionIdx of chosenSessions) {
      const session = sessions[sessionIdx];
      if (!session) continue;
      const existingVolume = session.muscles.get(muscleSlug) ?? 0;
      session.muscles.set(muscleSlug, existingVolume + setsPerSession);
      session.totalVolume += setsPerSession;

      assignments.push({
        muscleSlug,
        sessionIndex: sessionIdx,
        sets: setsPerSession,
      });
    }

    // Warn if volume can't be evenly distributed
    if (sessionsPerWeekVolume(sessions, muscleSlug) !== weeklyVolume) {
      warnings.push(
        `Muscle ${muscleSlug}: target ${weeklyVolume} sets distributed as ${sessionsPerWeekVolume(sessions, muscleSlug)} sets across ${desiredFrequency} session(s).`,
      );
    }
  }

  return {
    distribution: sessions.map(s => ({
      sessionIndex: s.sessionIndex,
      muscleCount: s.muscles.size,
      totalVolume: s.totalVolume,
      muscles: [...s.muscles.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([slug, volume]) => ({ muscleSlug: slug, volume })),
    })),
    sessionAssignments: assignments,
    warnings,
  };
}

/**
 * Choose which sessions to assign a muscle to.
 */
function chooseSessionsForMuscle(
  muscleSlug: string,
  desiredFrequency: number,
  availableSessions: number,
  splitType: string,
): number[] {
  const chosen: number[] = [];

  // For full body: every session
  if (splitType === "full_body" || splitType === "upper_lower_full_body") {
    for (let i = 0; i < availableSessions && chosen.length < desiredFrequency; i++) {
      chosen.push(i);
    }
    return chosen;
  }

  // For upper/lower: alternate sessions
  if (splitType === "upper_lower") {
    const isUpper = muscleSlugMatchesSessionType(muscleSlug, "upper");
    const isLower = muscleSlugMatchesSessionType(muscleSlug, "lower");

    if (isUpper || isLower) {
      // Alternate sessions of the appropriate type
      for (let i = 0; i < availableSessions && chosen.length < desiredFrequency; i++) {
        if (isUpper && i % 2 === 0) chosen.push(i);
        if (isLower && i % 2 === 1) chosen.push(i);
      }
      return chosen;
    }
  }

  // For PPL: sessions of the appropriate type
  if (splitType === "push_pull_legs" || splitType === "push_pull_legs_plus" || splitType === "push_pull_legs_specialization") {
    const sessionType = getSessionTypeForMuscle(muscleSlug);
    if (sessionType) {
      for (let i = 0; i < availableSessions && chosen.length < desiredFrequency; i++) {
        if (getSessionTypeAtIndex(i, splitType) === sessionType) {
          chosen.push(i);
        }
      }
      return chosen;
    }
  }

  // Fallback: spread across sessions with minimum gap
  const minGap = Math.max(1, Math.floor(availableSessions / desiredFrequency) - 1);

  for (let i = 0; chosen.length < desiredFrequency && i < availableSessions; i++) {
    // Ensure minimum gap from the previously chosen session
    const previous = chosen[chosen.length - 1];
    if (previous !== undefined && i - previous < minGap) continue;
    chosen.push(i);
  }

  return chosen;
}

function muscleSlugMatchesSessionType(muscleSlug: string, type: "upper" | "lower"): boolean {
  return bodyKindForMuscle(muscleSlug) === type;
}

/**
 * Canonical slugs (and colloquial aliases used by split focus lists) mapped
 * to the session type that trains them in a push/pull/legs structure.
 */
const UPPER_BODY_MUSCLES: readonly string[] = [
  "pectoralis_major",
  "pectoralis_minor",
  "latissimus_dorsi",
  "trapezius",
  "rhomboids",
  "deltoid_anterior",
  "deltoid_lateral",
  "deltoid_posterior",
  "biceps_brachii",
  "triceps_brachii",
  "brachialis",
  "brachioradialis",
  "serratus_anterior",
  // aliases used in split focus lists
  "chest",
  "back",
  "shoulders",
  "arms",
  "biceps",
  "triceps",
  "forearms",
  "lats",
  "upper_back",
  "traps",
  "front_delts",
  "side_delts",
  "rear_delts",
];

const LOWER_BODY_MUSCLES: readonly string[] = [
  "quadriceps",
  "hamstrings",
  "gluteus_maximus",
  "gluteus_medius",
  "gluteus_minimus",
  "gastrocnemius",
  "soleus",
  "adductors",
  "spinal_erectors",
  // aliases used in split focus lists
  "quads",
  "glutes",
  "calves",
  "lower_back",
];

function bodyKindForMuscle(muscleSlug: string): "upper" | "lower" | null {
  if (UPPER_BODY_MUSCLES.includes(muscleSlug)) return "upper";
  if (LOWER_BODY_MUSCLES.includes(muscleSlug)) return "lower";
  return null;
}

function getSessionTypeForMuscle(muscleSlug: string): string | null {
  const push = [
    "pectoralis_major",
    "deltoid_anterior",
    "deltoid_lateral",
    "triceps_brachii",
    "chest",
    "shoulders",
    "triceps",
    "front_delts",
    "side_delts",
  ];
  const pull = [
    "latissimus_dorsi",
    "trapezius",
    "rhomboids",
    "biceps_brachii",
    "deltoid_posterior",
    "brachialis",
    "brachioradialis",
    "back",
    "biceps",
    "lats",
    "upper_back",
    "traps",
    "rear_delts",
  ];
  const legs = [
    "quadriceps",
    "hamstrings",
    "gluteus_maximus",
    "gluteus_medius",
    "gastrocnemius",
    "soleus",
    "spinal_erectors",
    "quads",
    "glutes",
    "calves",
    "lower_back",
  ];

  if (push.includes(muscleSlug)) return "push";
  if (pull.includes(muscleSlug)) return "pull";
  if (legs.includes(muscleSlug)) return "legs";
  return null;
}

function getSessionTypeAtIndex(index: number, splitType: string): string | null {
  const cycle = ["push", "pull", "legs"] as const;
  if (splitType === "push_pull_legs" || splitType === "push_pull_legs_plus") {
    return cycle[index % 3] ?? null;
  }
  if (splitType === "push_pull_legs_specialization") {
    if (index < 6) return cycle[index % 3] ?? null;
    return "specialization";
  }
  return null;
}

function sessionsPerWeekVolume(sessions: readonly MutableSession[], muscleSlug: string): number {
  return sessions.reduce((sum, s) => {
    const vol = s.muscles.get(muscleSlug) ?? 0;
    return sum + vol;
  }, 0);
}

// ---------------------------------------------------------------------------
// Frequency assessment
// ---------------------------------------------------------------------------

/**
 * Assess whether the frequency distribution is appropriate.
 */
export function assessFrequency(
  distribution: readonly SessionFrequency[],
  availableSessions: number,
  goalProfile: TrainingGoalProfile,
): {
  isAppropriate: boolean;
  issues: readonly string[];
  summary: string;
} {
  const issues: string[] = [];

  if (distribution.length === 0) {
    return {
      isAppropriate: false,
      issues: ["No sessions in distribution."],
      summary: "Cannot assess frequency with no sessions.",
    };
  }

  // The split must fill the days the user actually has.
  if (distribution.length !== availableSessions) {
    issues.push(
      `Distribution covers ${distribution.length} session(s) but ${availableSessions} training day(s) are available.`,
    );
  }

  // Check for excessive frequency on any single session
  const maxSessionVolume = Math.max(...distribution.map(s => s.totalVolume));
  if (maxSessionVolume > 12) {
    issues.push(`Session ${distribution.findIndex(s => s.totalVolume === maxSessionVolume) + 1} has ${maxSessionVolume} exercises — may be too long.`);
  }

  // Check for muscle imbalance
  const muscleTotalVolume = new Map<string, number>();
  for (const session of distribution) {
    for (const muscle of session.muscles) {
      muscleTotalVolume.set(
        muscle.muscleSlug,
        (muscleTotalVolume.get(muscle.muscleSlug) ?? 0) + muscle.volume,
      );
    }
  }

  const volumes = [...muscleTotalVolume.values()];
  if (volumes.length > 0) {
    const maxVol = Math.max(...volumes);
    const minVol = Math.min(...volumes.filter(v => v > 0));

    if (maxVol > 0 && minVol / maxVol < 0.3) {
      issues.push("Significant volume imbalance between muscles — largest muscle has >3x the volume of smallest.");
    }
  }

  // Check frequency appropriateness
  for (const session of distribution) {
    if (session.muscleCount > 8 && goalProfile !== "hypertrophy" && goalProfile !== "v_taper") {
      issues.push(`Session ${session.sessionIndex + 1} has ${session.muscleCount} muscles — may be too broad for ${goalProfile} goal.`);
    }
  }

  const isAppropriate = issues.length === 0;

  return {
    isAppropriate,
    issues: issues as readonly string[],
    summary: isAppropriate
      ? "Frequency distribution is appropriate."
      : `Frequency issues: ${issues.join("; ")}`,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Working representation while the distribution is being built. */
interface MutableSession {
  sessionIndex: number;
  muscles: Map<string, number>;
  totalVolume: number;
}

export interface SessionFrequency {
  sessionIndex: number;
  muscleCount: number;
  totalVolume: number;
  muscles: readonly SessionMuscleVolume[];
}

export interface SessionMuscleVolume {
  muscleSlug: string;
  volume: number; // effective sets
}

export interface SessionAssignment {
  muscleSlug: string;
  sessionIndex: number;
  sets: number;
}
