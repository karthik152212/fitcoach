import type {
  EquipmentId,
  MuscleId,
  SessionTemplate,
  TrainingExperience,
  TrainingGoalProfile,
  UserId,
} from "@fitcoach/domain";
import type { TrainingContext, GoalContext, SplitConfiguration } from "@fitcoach/domain";
import {
  DEFAULT_SPLIT_CONFIGURATION,
  GOAL_TRAINING_MODIFIERS,
  type GoalTrainingModifiers,
} from "./trainingConfig";

/**
 * Split generation engine (Phase 3).
 *
 * Replaces the Phase 1/2 stub. Generates an appropriate training split from
 * user constraints: available days, session duration, goal, experience.
 *
 * The split is an OUTPUT of the planner, not a hardcoded assumption:
 * different contexts produce different structures. Selection is deterministic
 * — the same (days, duration, experience, goal) always yields the same split.
 */

// ---------------------------------------------------------------------------
// Split structure types
// ---------------------------------------------------------------------------

export type SplitType =
  | "full_body"
  | "upper_lower"
  | "push_pull_legs"
  | "upper_lower_full_body"
  | "bro_split"
  | "torso_limbs"
  | "specialization";

export interface GeneratedSplit {
  type: SplitType;
  /** Human-readable name. */
  name: string;
  /** Number of sessions per week. */
  sessionsPerWeek: number;
  /** Sessions in order. */
  sessions: readonly SplitSession[];
  /** Rationale for this split. */
  rationale: string;
  /** Why this split was chosen over alternatives. */
  selectionJustification: string;
}

export interface SplitSession {
  /** Position within the week (0-indexed). */
  weekPosition: number;
  /** Suggested day name (based on preferred days or sequential). */
  suggestedDay: string;
  /** Session name. */
  name: string;
  /** Focus/muscle groups for this session. */
  focus: readonly string[];
  /** Session type. */
  sessionType: string;
  /** Estimated exercise count range. */
  estimatedExerciseCount: { min: number; max: number };
}

// ---------------------------------------------------------------------------
// Split selection logic
// ---------------------------------------------------------------------------

/**
 * Select the most appropriate split for the user's constraints.
 *
 * @param context - Training context (days, duration, experience).
 * @param goalContext - Goal context (goal profile, priorities).
 * @param configuration - Split configuration.
 * @returns The generated split with rationale.
 */
export function selectSplit(
  context: Pick<
    TrainingContext,
    "availableTrainingDays" | "maxSessionDurationMinutes" | "trainingExperience" | "limitations"
  >,
  goalContext: Pick<GoalContext, "goalKind" | "priorities" | "physiquePriorities">,
  configuration: SplitConfiguration = DEFAULT_SPLIT_CONFIGURATION,
): GeneratedSplit {
  const days = context.availableTrainingDays;
  const duration = context.maxSessionDurationMinutes;
  const experience = context.trainingExperience;
  const goalProfile = mapGoalKindToProfile(goalContext.goalKind);
  const modifiers = GOAL_TRAINING_MODIFIERS[goalProfile];
  const priorities = goalContext.priorities;
  const physiquePriorities = goalContext.physiquePriorities ?? [];

  // Apply the configured per-duration exercise ceiling to whatever split is
  // generated, so a 45-minute user is never handed a 90-minute structure.
  const finalize = (split: GeneratedSplit): GeneratedSplit =>
    applyDurationCeiling(split, configuration, duration);

  // Handle edge cases
  if (days <= 0) {
    return createImpossibleSplit("No training days available.");
  }

  if (days === 1) {
    return finalize(
      generateFullBodySplit(
        days,
        duration,
        experience,
        goalProfile,
        modifiers,
        "Single session per week; full-body to maximize frequency per session.",
      ),
    );
  }

  // 2 days: full body is optimal
  if (days === 2) {
    return finalize(
      generateFullBodySplit(
        days,
        duration,
        experience,
        goalProfile,
        modifiers,
        "Two sessions per week; full-body split maximizes frequency for each muscle group.",
      ),
    );
  }

  // 3 days: full body, or upper/lower/full-body hybrid for strength/athletic goals
  if (days === 3) {
    if (goalProfile === "strength" || goalProfile === "athletic") {
      return finalize(
        generateUpperLowerFullBodyHybrid(
          days,
          duration,
          experience,
          goalProfile,
          modifiers,
          "Three sessions with upper/lower/full-body hybrid prioritizes compound movement frequency for strength/athletic goals.",
        ),
      );
    }
    return finalize(
      generateFullBodySplit(
        days,
        duration,
        experience,
        goalProfile,
        modifiers,
        "Three sessions per week; full-body split provides good frequency for hypertrophy goals.",
      ),
    );
  }

  // 4 days: upper/lower is the natural fit
  if (days === 4) {
    return finalize(
      generateUpperLowerSplit(
        days,
        duration,
        experience,
        goalProfile,
        modifiers,
        "Four sessions per week; upper/lower split provides 2x/week frequency for all major muscle groups.",
      ),
    );
  }

  // 5 days: upper/lower + specialization, or push/pull/legs + focus day
  if (days === 5) {
    if (hasVtaperPriority(priorities, physiquePriorities)) {
      return finalize(
        generateUpperLowerWithSpecialization(
          days,
          duration,
          experience,
          goalProfile,
          modifiers,
          "Five sessions with upper/lower base plus V-taper specialization day.",
          "V-taper priority benefits from dedicated lateral delt/upper back focus.",
        ),
      );
    }
    return finalize(
      generatePushPullLegsPlus(
        days,
        duration,
        experience,
        goalProfile,
        modifiers,
        "Five sessions per week; push/pull/legs with an additional focus or weak-point day.",
      ),
    );
  }

  // 6 days: push/pull/legs is the natural 6-day structure
  if (days === 6) {
    return finalize(
      generatePushPullLegsSplit(
        days,
        duration,
        experience,
        goalProfile,
        modifiers,
        "Six sessions per week; push/pull/legs provides 2x/week frequency with dedicated movement pattern days.",
      ),
    );
  }

  // 7 days: push/pull/legs + specialization, or a capped 5-day variant
  if (days >= 7) {
    if (experience === "advanced" || experience === "intermediate") {
      return finalize(
        generatePushPullLegsWithWeakPoint(
          days,
          duration,
          experience,
          goalProfile,
          modifiers,
          "Seven sessions per week; push/pull/legs plus dedicated weak-point/specialization day for advanced lifters.",
        ),
      );
    }
    // Beginners with 7 available days: cap at 5 effective sessions
    return finalize(
      generatePushPullLegsPlus(
        days,
        duration,
        experience,
        goalProfile,
        modifiers,
        "Seven available days; using 5-session push/pull/legs plus two active recovery or optional sessions.",
      ),
    );
  }

  // Fallback
  return finalize(
    generateFullBodySplit(
      days,
      duration,
      experience,
      goalProfile,
      modifiers,
      "Defaulting to full-body split.",
    ),
  );
}

// ---------------------------------------------------------------------------
// Split generators
// ---------------------------------------------------------------------------

function createImpossibleSplit(rationale: string): GeneratedSplit {
  return {
    type: "full_body",
    name: "Infeasible",
    sessionsPerWeek: 0,
    sessions: [],
    rationale,
    selectionJustification: "Cannot generate a valid split with the given constraints.",
  };
}

function generateFullBodySplit(
  days: number,
  duration: number,
  experience: TrainingExperience,
  goalProfile: TrainingGoalProfile,
  modifiers: GoalTrainingModifiers,
  rationale: string,
): GeneratedSplit {
  const sessionCount = Math.min(days, DEFAULT_SPLIT_CONFIGURATION.fullBodyMaxSessions);
  const exercises = estimateExercisesPerSession(duration, experience);

  const sessions: SplitSession[] = [];
  const dayNames = ["Monday", "Wednesday", "Friday"];

  for (let i = 0; i < sessionCount; i++) {
    sessions.push({
      weekPosition: i,
      suggestedDay: dayNames[i] ?? `Day ${i + 1}`,
      name: `Full Body ${i + 1}`,
      focus: ["chest", "back", "shoulders", "arms", "legs", "core"],
      sessionType: "full_body",
      estimatedExerciseCount: {
        min: Math.max(3, exercises.min),
        max: Math.max(3, exercises.max),
      },
    });
  }

  return {
    type: "full_body",
    name: "Full Body",
    sessionsPerWeek: sessionCount,
    sessions,
    rationale:
      `${rationale} Each session trains all major muscle groups. ` +
      `Estimated ${exercises.min}-${exercises.max} exercises per session. ${goalContextNote(goalProfile, modifiers)}.`,
    selectionJustification:
      `Chosen because ${days} available day(s) favors full-body frequency. ` +
      `Full body provides 2-3x/week exposure for each muscle with ${sessionCount} sessions.`,
  };
}

function generateUpperLowerSplit(
  days: number,
  duration: number,
  experience: TrainingExperience,
  goalProfile: TrainingGoalProfile,
  modifiers: GoalTrainingModifiers,
  rationale: string,
): GeneratedSplit {
  const sessionCount = Math.min(days, DEFAULT_SPLIT_CONFIGURATION.upperLowerSessions);
  const exercises = estimateExercisesPerSession(duration, experience);

  const sessions: SplitSession[] = [];
  const dayNames = ["Monday", "Tuesday", "Thursday", "Friday"];

  for (let i = 0; i < sessionCount; i++) {
    const isUpper = i % 2 === 0;
    sessions.push({
      weekPosition: i,
      suggestedDay: dayNames[i] ?? `Day ${i + 1}`,
      name: `${isUpper ? "Upper" : "Lower"} ${Math.floor(i / 2) + 1}`,
      focus: isUpper
        ? ["chest", "back", "shoulders", "arms"]
        : ["quads", "hamstrings", "glutes", "calves", "lower_back"],
      sessionType: isUpper ? "upper" : "lower",
      estimatedExerciseCount: {
        min: Math.max(3, exercises.min),
        max: Math.max(3, exercises.max),
      },
    });
  }

  return {
    type: "upper_lower",
    name: "Upper/Lower",
    sessionsPerWeek: sessionCount,
    sessions,
    rationale:
      `${rationale} Upper sessions: chest, back, shoulders, arms. ` +
      `Lower sessions: quads, hamstrings, glutes, calves. ` +
      `Estimated ${exercises.min}-${exercises.max} exercises per session. ${goalContextNote(goalProfile, modifiers)}.`,
    selectionJustification:
      `Chosen because ${days} available days maps naturally to a ${sessionCount}-day upper/lower structure. ` +
      `Provides 2x/week frequency for all muscles with adequate recovery between same-muscle sessions.`,
  };
}

function generateUpperLowerFullBodyHybrid(
  days: number,
  duration: number,
  experience: TrainingExperience,
  goalProfile: TrainingGoalProfile,
  modifiers: GoalTrainingModifiers,
  rationale: string,
): GeneratedSplit {
  const exercises = estimateExercisesPerSession(duration, experience);

  const template = [
    {
      weekPosition: 0,
      suggestedDay: "Monday",
      name: "Upper Body",
      focus: ["chest", "back", "shoulders", "arms"],
      sessionType: "upper",
    },
    {
      weekPosition: 1,
      suggestedDay: "Wednesday",
      name: "Lower Body",
      focus: ["quads", "hamstrings", "glutes", "calves"],
      sessionType: "lower",
    },
    {
      weekPosition: 2,
      suggestedDay: "Friday",
      name: "Full Body",
      focus: ["chest", "back", "shoulders", "arms", "quads", "hamstrings", "glutes"],
      sessionType: "full_body",
    },
  ];

  const sessions: SplitSession[] = template.map((session) => ({
    ...session,
    estimatedExerciseCount: {
      min: Math.max(3, exercises.min),
      max: Math.max(3, exercises.max),
    },
  }));

  return {
    type: "upper_lower_full_body",
    name: "Upper/Lower/Full Body Hybrid",
    sessionsPerWeek: 3,
    sessions,
    rationale: `${rationale} ${goalContextNote(goalProfile, modifiers)}.`,
    selectionJustification:
      `Chosen for strength/athletic goals with ${days} available days. ` +
      `Upper and lower days allow focused intensity; full body day provides additional frequency.`,
  };
}

function generatePushPullLegsSplit(
  days: number,
  duration: number,
  experience: TrainingExperience,
  goalProfile: TrainingGoalProfile,
  modifiers: GoalTrainingModifiers,
  rationale: string,
): GeneratedSplit {
  const exercises = estimateExercisesPerSession(duration, experience);
  const dayNames = ["Monday", "Tuesday", "Thursday", "Friday", "Saturday", "Sunday"];

  const blocks = [
    { name: "Push", focus: ["chest", "shoulders", "triceps"], sessionType: "push" },
    { name: "Pull", focus: ["back", "biceps", "rear_delts"], sessionType: "pull" },
    { name: "Legs", focus: ["quads", "hamstrings", "glutes", "calves"], sessionType: "legs" },
    { name: "Push 2", focus: ["chest", "shoulders", "triceps"], sessionType: "push" },
    { name: "Pull 2", focus: ["back", "biceps", "rear_delts"], sessionType: "pull" },
    { name: "Legs 2", focus: ["quads", "hamstrings", "glutes", "calves"], sessionType: "legs" },
  ];

  const sessions: SplitSession[] = blocks.map((block, index) => ({
    weekPosition: index,
    suggestedDay: dayNames[index] ?? `Day ${index + 1}`,
    name: block.name,
    focus: block.focus,
    sessionType: block.sessionType,
    estimatedExerciseCount: {
      min: Math.max(3, exercises.min),
      max: Math.max(3, exercises.max),
    },
  }));

  return {
    type: "push_pull_legs",
    name: "Push/Pull/Legs",
    sessionsPerWeek: 6,
    sessions,
    rationale:
      `${rationale} Push: chest, shoulders, triceps. Pull: back, biceps, rear delts. Legs: quads, hamstrings, glutes, calves. ` +
      `Each muscle group trained 2x/week. ${goalContextNote(goalProfile, modifiers)}.`,
    selectionJustification:
      `Chosen because ${days} available days supports 6-day push/pull/legs. ` +
      `Provides 2x/week frequency with movement-pattern specialization.`,
  };
}

function generatePushPullLegsPlus(
  days: number,
  duration: number,
  experience: TrainingExperience,
  goalProfile: TrainingGoalProfile,
  modifiers: GoalTrainingModifiers,
  rationale: string,
): GeneratedSplit {
  const exercises = estimateExercisesPerSession(duration, experience);
  const dayNames = ["Monday", "Tuesday", "Thursday", "Friday", "Saturday"];

  const blocks = [
    { name: "Push", focus: ["chest", "shoulders", "triceps"], sessionType: "push" },
    { name: "Pull", focus: ["back", "biceps", "rear_delts"], sessionType: "pull" },
    { name: "Legs", focus: ["quads", "hamstrings", "glutes", "calves"], sessionType: "legs" },
    { name: "Push", focus: ["chest", "shoulders", "triceps"], sessionType: "push" },
    {
      name: "Pull/Legs",
      focus: ["back", "biceps", "quads", "hamstrings", "glutes"],
      sessionType: "pull_legs",
    },
  ];

  const sessions: SplitSession[] = blocks.map((block, index) => ({
    weekPosition: index,
    suggestedDay: dayNames[index] ?? `Day ${index + 1}`,
    name: block.name,
    focus: block.focus,
    sessionType: block.sessionType,
    estimatedExerciseCount: {
      min: Math.max(3, exercises.min),
      max: Math.max(3, exercises.max),
    },
  }));

  return {
    type: "push_pull_legs",
    name: "Push/Pull/Legs + Focus",
    sessionsPerWeek: 5,
    sessions,
    rationale: `${rationale} 5-day PPL variant with an additional combined pull/legs session. ${goalContextNote(goalProfile, modifiers)}.`,
    selectionJustification:
      `Chosen because ${days} available days doesn't fit cleanly into 6-day PPL. ` +
      `5-day variant provides 2x/week frequency for most muscles with a hybrid session.`,
  };
}

function generatePushPullLegsWithWeakPoint(
  days: number,
  duration: number,
  experience: TrainingExperience,
  goalProfile: TrainingGoalProfile,
  modifiers: GoalTrainingModifiers,
  rationale: string,
): GeneratedSplit {
  const exercises = estimateExercisesPerSession(duration, experience);
  const dayNames = [
    "Monday",
    "Tuesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
    "Optional",
  ];

  const blocks = [
    { name: "Push", focus: ["chest", "shoulders", "triceps"], sessionType: "push" },
    { name: "Pull", focus: ["back", "biceps", "rear_delts"], sessionType: "pull" },
    { name: "Legs", focus: ["quads", "hamstrings", "glutes", "calves"], sessionType: "legs" },
    { name: "Push", focus: ["chest", "shoulders", "triceps"], sessionType: "push" },
    { name: "Pull", focus: ["back", "biceps", "rear_delts"], sessionType: "pull" },
    { name: "Legs", focus: ["quads", "hamstrings", "glutes", "calves"], sessionType: "legs" },
    { name: "Weak Point / Specialization", focus: ["arms", "shoulders", "calves"], sessionType: "specialization" },
  ];

  const sessions: SplitSession[] = blocks.map((block, index) => ({
    weekPosition: index,
    suggestedDay: dayNames[index] ?? `Day ${index + 1}`,
    name: block.name,
    focus: block.focus,
    sessionType: block.sessionType,
    estimatedExerciseCount:
      block.sessionType === "specialization"
        ? { min: Math.max(3, exercises.min - 1), max: Math.max(3, exercises.max - 2) }
        : { min: Math.max(3, exercises.min), max: Math.max(3, exercises.max) },
  }));

  return {
    type: "push_pull_legs",
    name: "Push/Pull/Legs + Specialization",
    sessionsPerWeek: 7,
    sessions,
    rationale:
      `${rationale} Standard 6-day PPL plus a dedicated specialization day for advanced lifters. ` +
      `${goalContextNote(goalProfile, modifiers)}.`,
    selectionJustification:
      `Chosen for ${experience} lifters with ${days} available days. ` +
      `6-day PPL provides 2x/week frequency; specialization day targets lagging muscle groups.`,
  };
}

function generateUpperLowerWithSpecialization(
  days: number,
  duration: number,
  experience: TrainingExperience,
  goalProfile: TrainingGoalProfile,
  modifiers: GoalTrainingModifiers,
  rationale: string,
  selectionJustification: string,
): GeneratedSplit {
  const exercises = estimateExercisesPerSession(duration, experience);
  const dayNames = ["Monday", "Tuesday", "Thursday", "Friday", "Saturday"];

  const blocks = [
    { name: "Upper Body", focus: ["chest", "back", "shoulders", "arms"], sessionType: "upper" },
    { name: "Lower Body", focus: ["quads", "hamstrings", "glutes", "calves"], sessionType: "lower" },
    { name: "Upper Body", focus: ["chest", "back", "shoulders", "arms"], sessionType: "upper" },
    { name: "Lower Body", focus: ["quads", "hamstrings", "glutes", "calves"], sessionType: "lower" },
    { name: "V-Taper Focus", focus: ["lats", "side_delts", "upper_back"], sessionType: "specialization" },
  ];

  const sessions: SplitSession[] = blocks.map((block, index) => ({
    weekPosition: index,
    suggestedDay: dayNames[index] ?? `Day ${index + 1}`,
    name: block.name,
    focus: block.focus,
    sessionType: block.sessionType,
    estimatedExerciseCount:
      block.sessionType === "specialization"
        ? { min: Math.max(3, exercises.min - 1), max: Math.max(3, exercises.max - 2) }
        : { min: Math.max(3, exercises.min), max: Math.max(3, exercises.max) },
  }));

  return {
    type: "specialization",
    name: "Upper/Lower + V-Taper Focus",
    sessionsPerWeek: 5,
    sessions,
    rationale: `${rationale} ${goalContextNote(goalProfile, modifiers)}.`,
    selectionJustification: `${selectionJustification} Structure derived from ${days} available days at ${experience} experience.`,
  };
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Estimate how many exercises fit inside one session.
 *
 * Model: 8 minutes of warm-up, then ~8 minutes per exercise (setup + 3 work
 * sets at ~90s rest + transitions). Experience adjusts the estimate because
 * beginners spend longer per exercise on setup and technique.
 *
 * This is a documented modeling assumption, configurable in trainingConfig.
 */
function estimateExercisesPerSession(
  duration: number,
  experience: TrainingExperience,
): { min: number; max: number } {
  const availableMinutes = Math.max(0, duration - 8);
  const minutesPerExercise = 8;
  const experienceFactor =
    experience === "untrained" || experience === "beginner"
      ? 0.8
      : experience === "advanced"
        ? 1.1
        : 1;

  const maxExercises = Math.max(
    DEFAULT_SPLIT_CONFIGURATION.minExercisesPerSession,
    Math.floor((availableMinutes / minutesPerExercise) * experienceFactor),
  );
  const minExercises = Math.max(
    Math.min(DEFAULT_SPLIT_CONFIGURATION.minExercisesPerSession, maxExercises),
    Math.floor(maxExercises * 0.6),
  );

  return { min: minExercises, max: maxExercises };
}

/**
 * Clamp every session's estimated exercise count to the configured ceiling
 * for the user's session duration bracket.
 */
function applyDurationCeiling(
  split: GeneratedSplit,
  configuration: SplitConfiguration,
  duration: number,
): GeneratedSplit {
  const brackets = Object.keys(configuration.maxExercisesPerSession)
    .map(Number)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  const applicable = brackets.filter((bracket) => bracket <= duration).pop();
  const cap =
    applicable === undefined
      ? undefined
      : configuration.maxExercisesPerSession[String(applicable)];

  if (!cap || split.sessions.length === 0) return split;

  return {
    ...split,
    sessions: split.sessions.map((session) => ({
      ...session,
      estimatedExerciseCount: {
        min: Math.min(session.estimatedExerciseCount.min, cap),
        max: Math.min(Math.max(session.estimatedExerciseCount.max, session.estimatedExerciseCount.min), cap),
      },
    })),
  };
}

/** Deterministic one-line description of how the goal shapes this split. */
function goalContextNote(goalProfile: TrainingGoalProfile, modifiers: GoalTrainingModifiers): string {
  return (
    `Goal profile "${goalProfile}": rep targets centered around ${modifiers.preferredRepRangeCenter} reps, ` +
    `~${modifiers.preferredRestSeconds}s rest`
  );
}

function mapGoalKindToProfile(goalKind: string): TrainingGoalProfile {
  const mapping: Record<string, TrainingGoalProfile> = {
    bodybuilding: "hypertrophy",
    aesthetics_v_taper: "v_taper",
    lean_recomposition: "recomposition",
    athletic_performance: "athletic",
    max_strength: "strength",
    general_fitness: "general_fitness",
    custom: "general_fitness",
  };
  return mapping[goalKind] ?? "general_fitness";
}

function hasVtaperPriority(
  priorities: readonly string[],
  physiquePriorities: readonly string[],
): boolean {
  const vtaperIndicators = ["v_taper", "shoulder_width", "wide_shoulders", "narrow_waist", "upper_back"];
  for (const p of [...priorities, ...physiquePriorities]) {
    if (vtaperIndicators.includes(p)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Phase 1/2 request-shape adapter
// ---------------------------------------------------------------------------

export interface SplitGenerationRequest {
  userId: UserId;
  daysPerWeek: number;
  sessionDurationMinutes: number;
  experienceLevel: TrainingExperience;
  availableEquipmentIds: readonly EquipmentId[];
  priorityMuscleIds?: readonly MuscleId[];
}

export interface SplitProposal {
  sessionsPerWeek: number;
  sessionTemplates: readonly SessionTemplate[];
  rationaleNotes: readonly string[];
}

/**
 * Generate a weekly split proposal from the user's constraints (Phase 1/2
 * request shape, kept for compatibility).
 *
 * Output is a candidate structure only: exercise slots are intentionally
 * empty because exercises are selected later by the session builder, which
 * combines the split with the Phase 2 exercise decision engine. Turning the
 * proposal into a persisted TrainingPlan is the application layer's job.
 */
export function generateSplit(request: SplitGenerationRequest): SplitProposal {
  const split = selectSplit(
    {
      availableTrainingDays: request.daysPerWeek,
      maxSessionDurationMinutes: request.sessionDurationMinutes,
      trainingExperience: request.experienceLevel,
    },
    // No goal supplied at this legacy entry point: the generic profile keeps
    // the structure deterministic; goal-aware callers should use selectSplit.
    { goalKind: "general_fitness", priorities: [] },
  );

  return {
    sessionsPerWeek: split.sessionsPerWeek,
    sessionTemplates: split.sessions.map((session, index) => ({
      id: `tpl_${split.type}_${index + 1}`,
      name: session.name,
      weekdayHint: weekdayHintFor(session.suggestedDay),
      slots: [],
    })),
    rationaleNotes: [
      split.rationale,
      split.selectionJustification,
      "Exercise slots are populated later by session construction using the Phase 2 exercise decision engine.",
    ],
  };
}

function weekdayHintFor(dayName: string): number {
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const index = days.indexOf(dayName);
  return index >= 0 ? index : 0;
}
