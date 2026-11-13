/**
 * Intent-aware context source selection for the AI Coach.
 *
 * Different coaching questions require different subsets of the user's
 * FitCoach history. A workout question should not receive the user's entire
 * food history; a stalled-progress question needs training, nutrition,
 * recovery, body, and decision history together.
 *
 * All functions are deterministic and rule-based — no ML, no API key.
 */

import type {
  IntentClassification,
} from "./contracts";
import type { ContextSourceSnapshot } from "./contracts";

/**
 * Classification of a user message intent.
 *
 * Re-exported from contracts for convenience.
 */
export type { IntentClassification } from "./contracts";

/**
 * Which domain sources to include for a given intent.
 */
export interface ContextSourceSelection {
  profile: boolean;
  goal: boolean;
  training: boolean;
  nutrition: boolean;
  activity: boolean;
  recovery: boolean;
  body: boolean;
  projection: boolean;
  decision: boolean;
  conversation: boolean;
}

/**
 * Default context source selection (all sources included).
 */
export const DEFAULT_CONTEXT_SOURCE_SELECTION: ContextSourceSelection = {
  profile: true,
  goal: true,
  training: true,
  nutrition: true,
  activity: true,
  recovery: true,
  body: true,
  projection: true,
  decision: true,
  conversation: true,
};

/**
 * Minimal context source selection (only essential sources).
 */
export const MINIMAL_CONTEXT_SOURCE_SELECTION: ContextSourceSelection = {
  profile: true,
  goal: false,
  training: false,
  nutrition: false,
  activity: false,
  recovery: false,
  body: false,
  projection: false,
  decision: false,
  conversation: false,
};

/**
 * Mapping from intent to context source selection.
 *
 * Each intent maps to the minimum set of domains needed to answer
 * questions about that topic responsibly.
 */
const INTENT_SOURCE_MAP: ReadonlyMap<string, ContextSourceSelection> = new Map([
  [
    "stalled_progress",
    {
      profile: true,
      goal: true,
      training: true,
      nutrition: true,
      activity: false,
      recovery: true,
      body: true,
      projection: true,
      decision: true,
      conversation: true,
    },
  ],
  [
    "todays_workout",
    {
      profile: true,
      goal: true,
      training: true,
      nutrition: false,
      activity: false,
      recovery: true,
      body: false,
      projection: false,
      decision: true,
      conversation: true,
    },
  ],
  [
    "nutrition_question",
    {
      profile: true,
      goal: true,
      training: false,
      nutrition: true,
      activity: false,
      recovery: false,
      body: true,
      projection: false,
      decision: true,
      conversation: true,
    },
  ],
  [
    "weight_physique",
    {
      profile: true,
      goal: true,
      training: false,
      nutrition: false,
      activity: false,
      recovery: false,
      body: true,
      projection: true,
      decision: true,
      conversation: true,
    },
  ],
  [
    "recovery_readiness",
    {
      profile: true,
      goal: false,
      training: false,
      nutrition: false,
      activity: false,
      recovery: true,
      body: false,
      projection: false,
      decision: false,
      conversation: true,
    },
  ],
  [
    "follow_up",
    {
      profile: true,
      goal: true,
      training: true,
      nutrition: true,
      activity: true,
      recovery: true,
      body: true,
      projection: true,
      decision: true,
      conversation: true,
    },
  ],
  [
    "general_coaching",
    DEFAULT_CONTEXT_SOURCE_SELECTION,
  ],
]);

/**
 * Rule-based intent classification for user messages.
 *
 * No ML, no API key — keyword and pattern matching only.
 * Returns the best-matching intent with confidence.
 */
export function classifyIntent(message: string): IntentClassification {
  const lower = message.toLowerCase().trim();

  // Stalled progress patterns
  const stalledPatterns = [
    "not progressing",
    "plateau",
    "stalled",
    "why am i not",
    "why is my progress",
    "progress has stopped",
    "not improving",
    "not getting better",
    "stuck at",
  ];
  if (stalledPatterns.some((p) => lower.includes(p))) {
    return {
      intent: "stalled_progress",
      confidence: 0.85,
      entities: {},
    };
  }

  // Today's workout patterns
  const workoutPatterns = [
    "should i train today",
    "today's workout",
    "what should i do today",
    "what should i do",
    "can i train",
    "is it ok to train",
    "workout today",
    "session today",
  ];
  if (workoutPatterns.some((p) => lower.includes(p))) {
    return {
      intent: "todays_workout",
      confidence: 0.85,
      entities: {},
    };
  }

  // Nutrition question patterns
  const nutritionPatterns = [
    "protein",
    "calories",
    "what should i eat",
    "am i eating enough",
    "nutrition",
    "meal",
    "food",
    "diet",
  ];
  if (
    nutritionPatterns.some((p) => lower.includes(p)) &&
    !lower.includes("workout") &&
    !lower.includes("train")
  ) {
    return {
      intent: "nutrition_question",
      confidence: 0.7,
      entities: {},
    };
  }

  // Weight/physique patterns
  const physiquePatterns = [
    "weight not dropping",
    "why is my weight",
    "body fat",
    "measurements",
    "waist",
    "physique",
    "body composition",
    "losing weight",
    "gaining weight",
  ];
  if (physiquePatterns.some((p) => lower.includes(p))) {
    return {
      intent: "weight_physique",
      confidence: 0.8,
      entities: {},
    };
  }

  // Recovery/readiness patterns
  const recoveryPatterns = [
    "recovery",
    "readiness",
    "sleep",
    "fatigue",
    "soreness",
    "hrv",
    "rest",
    "recovered",
  ];
  if (
    recoveryPatterns.some((p) => lower.includes(p)) &&
    !lower.includes("workout") &&
    !lower.includes("train")
  ) {
    return {
      intent: "recovery_readiness",
      confidence: 0.75,
      entities: {},
    };
  }

  // Follow-up patterns
  const followUpPatterns = [
    "why",
    "what should i change",
    "what about tomorrow",
    "what about next",
    "challenge",
    "disagree",
    "but",
    "however",
    "follow-up",
    "follow up",
  ];
  if (followUpPatterns.some((p) => lower.includes(p))) {
    return {
      intent: "follow_up",
      confidence: 0.6,
      entities: {},
    };
  }

  return {
    intent: "general_coaching",
    confidence: 0.5,
    entities: {},
  };
}

/**
 * Select context sources based on intent classification.
 *
 * If the intent is unknown or low confidence, returns all sources (safe default).
 */
export function selectContextSources(
  intent: IntentClassification,
): ContextSourceSelection {
  // Low confidence → include all sources to be safe
  if (intent.confidence < 0.65) {
    return DEFAULT_CONTEXT_SOURCE_SELECTION;
  }

  const mapped = INTENT_SOURCE_MAP.get(intent.intent);
  if (mapped) {
    return mapped;
  }

  return DEFAULT_CONTEXT_SOURCE_SELECTION;
}

/**
 * Build a ContextSourceSelection from a CoachingRequest's contextSources field.
 * If contextSources is not set, fall back to intent-based selection.
 */
export function contextSourcesFromRequest(
  request: {
    contextSources?: Partial<ContextSourceSelection>;
    intent?: IntentClassification;
  },
): ContextSourceSelection {
  if (request.contextSources) {
    return {
      profile: request.contextSources.profile ?? true,
      goal: request.contextSources.goal ?? true,
      training: request.contextSources.training ?? true,
      nutrition: request.contextSources.nutrition ?? true,
      activity: request.contextSources.activity ?? true,
      recovery: request.contextSources.recovery ?? true,
      body: request.contextSources.body ?? true,
      projection: request.contextSources.projection ?? true,
      decision: request.contextSources.decision ?? true,
      conversation: request.contextSources.conversation ?? true,
    };
  }

  if (request.intent) {
    return selectContextSources(request.intent);
  }

  return DEFAULT_CONTEXT_SOURCE_SELECTION;
}

/**
 * Get a human-readable label for a context source domain.
 */
export function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    profile: "User Profile & Preferences",
    goal: "Goals & Physique Targets",
    training: "Training Plans & Workouts",
    nutrition: "Nutrition & Meals",
    activity: "Activity & Steps",
    recovery: "Sleep & Recovery",
    body: "Body Measurements & Physique",
    projection: "Projections & Trajectory",
    decision: "Decision Brain & Outcomes",
    conversation: "Previous Conversations",
  };
  return labels[source] ?? source;
}

/**
 * Build an empty ContextSourceSnapshot for a source that was not included.
 */
export function emptySourceSnapshot(source: string): ContextSourceSnapshot {
  return {
    source,
    label: sourceLabel(source),
    lastObservedAt: undefined,
    stalenessDays: Number.POSITIVE_INFINITY,
    isStale: true,
    completenessPercent: 0,
    confidence: "unknown",
    missingFields: ["all"],
    warnings: [`${sourceLabel(source)} data not retrieved`],
  };
}

/**
 * Check if an intent requires longitudinal (time-series) evidence.
 */
export function requiresLongitudinalEvidence(intent: string): boolean {
  const longitudinalIntents = [
    "stalled_progress",
    "weight_physique",
    "recovery_readiness",
    "follow_up",
  ];
  return longitudinalIntents.includes(intent);
}
