/**
 * AI Coach shared contracts.
 *
 * These types define the boundary between the coaching orchestration layer
 * (apps/api) and the AI provider layer (packages/ai). They reuse existing
 * @fitcoach/domain types wherever possible and introduce new types only for
 * concepts that have no existing domain representation.
 *
 * No provider SDK types appear here — the boundary is provider-independent by
 * design.
 */

import type {
  ActionId,
  ActionKind,
  ActionStatus,
  CalendarDate,
  ConfidenceLevel,
  ConversationId,
  ConversationStatus,
  DecisionEvidenceId,
  DecisionSnapshotId,
  DiagnosisId,
  EntityId,
  MessageId,
  MessageRole,
  ProvenanceClass,
  Timestamp,
  UnifiedStateSourceKind,
  UserId,
} from "@fitcoach/domain";

// Re-export domain types for consumers
export type {
  ConversationId,
  MessageId,
  ActionId,
  MessageRole,
  ConversationStatus,
  ActionStatus,
  ActionKind,
};

/**
 * Evidence reference — traces a coaching statement back to deterministic data.
 */
export interface EvidenceReference {
  /** Which specialist domain produced this evidence. */
  source: string;
  /** Machine code identifying the finding. */
  code: string;
  /** Human-readable title. */
  title: string;
  /** Observed value. */
  value: string;
  /** Expected/target value, when applicable. */
  expected?: string;
  /** Confidence in this evidence. */
  confidence: ConfidenceLevel;
  /** Provenance of the underlying observation. */
  provenance: ProvenanceClass;
  /** When the evidence was generated. */
  generatedAt: Timestamp;
  /** Related entity IDs for traceability. */
  relatedEntityIds: readonly EntityId[];
  /** Human-readable explanation of the basis. */
  basis: string;
  /** Decision snapshot this evidence belongs to, if any. */
  decisionSnapshotId?: DecisionSnapshotId;
  /** Diagnosis this evidence supports, if any. */
  diagnosisId?: DiagnosisId;
}

/**
 * A single source of evidence retrieved during context building.
 */
export interface ContextSourceSnapshot {
  /** Which specialist domain produced this evidence. */
  source: UnifiedStateSourceKind | string;
  /** Human-readable label for the source. */
  label: string;
  /** When the most recent observation in this source was recorded. */
  lastObservedAt?: Timestamp;
  /** Staleness in days since last observation. */
  stalenessDays: number;
  /** Whether this source is considered stale for coaching purposes. */
  isStale: boolean;
  /** Completeness percentage (0-100) based on expected vs actual records. */
  completenessPercent: number;
  /** Confidence in this source's data. */
  confidence: ConfidenceLevel;
  /** Expected fields that are absent. */
  missingFields: readonly string[];
  /** Human-readable quality warnings. */
  warnings: readonly string[];
}

/**
 * Quality assessment of the assembled personal context.
 */
export interface ContextQuality {
  /** Overall quality score, 0-100. */
  overallScore: number;
  /** Per-source quality details. */
  sources: readonly ContextSourceSnapshot[];
  /** Warnings about missing data. */
  missingDataWarnings: readonly string[];
  /** Warnings about stale data. */
  staleDataWarnings: readonly string[];
  /** Suggested follow-up questions when data is insufficient. */
  recommendedFollowUpQuestions: readonly string[];
  /** Whether there is sufficient evidence to give substantive advice. */
  sufficientForAdvice: boolean;
}

/**
 * Coaching decision context retrieved from the Unified Decision Brain.
 */
export interface CoachingDecisionContext {
  /** The current decision snapshot, if one exists. */
  decisionSnapshot: {
    id: DecisionSnapshotId;
    kind: string;
    status: string;
    decidedAt: CalendarDate;
    summary: string;
    confidence: ConfidenceLevel;
  } | null;
  /** Diagnoses that drove the current decision. */
  diagnoses: readonly {
    id: DiagnosisId;
    code: string;
    title: string;
    severity: string;
    status: string;
  }[];
  /** Active interventions from the current decision. */
  activeInterventions: readonly string[];
  /** Decision outcomes (feedback loop results). */
  outcomes: readonly {
    id: DecisionEvidenceId;
    verdict: string;
    evaluationWindow: string;
    triggersReevaluation: boolean;
    evaluatedAt: Timestamp;
  }[];
  /** Whether re-evaluation should be triggered. */
  shouldReevaluate: { should: boolean; reason: string } | null;
  /** Evidence citations from the decision. */
  evidenceRefs: readonly EvidenceReference[];
  /** Assumptions underlying the decision. */
  assumptions: readonly {
    code: string;
    description: string;
    category: string;
    value: string;
    sensitive: boolean;
    source: string;
  }[];
}

/**
 * User profile context for coaching.
 */
export interface UserProfileContext {
  userId: UserId;
  timezone: string;
  profile?: {
    birthDate?: CalendarDate;
    sex?: string;
    heightCm?: number;
    trainingExperience?: string;
    trainingDaysPerWeek?: number;
    sessionDurationMinutes?: number;
    limitations?: readonly string[];
    unitSystem?: string;
  };
}

/**
 * Goal context for coaching.
 */
export interface GoalContext {
  goalId?: string;
  kind?: string;
  description?: string;
  priorities?: readonly string[];
  physiqueTarget?: {
    bodyWeightKg?: number;
    bodyFatPercent?: number;
    waistCm?: number;
    chestCm?: number;
    shoulderCircumferenceCm?: number;
    armCm?: number;
    thighCm?: number;
    calfCm?: number;
    notes?: string;
  };
  effectiveFrom?: CalendarDate;
  effectiveUntil?: CalendarDate;
}

/**
 * Training context for coaching.
 */
export interface TrainingContext {
  currentPlanVersionId?: string | null;
  currentPlanStatus?: string | null;
  trainingGoalKind?: string | null;
  weeklySessionFrequency?: number;
  adherence?: number;
  plateauSignals?: readonly {
    kind: string;
    observation: string;
    affectedEntity?: string;
    severity?: number;
    observedWeeks?: number;
  }[];
  progressionStatus?: readonly {
    exerciseId: string;
    exerciseName: string;
    status: string;
    currentLoadKg?: number;
    currentRepRange?: string;
    progressionsCompleted: number;
  }[];
  /** Planned sessions of the current plan version (exercise names and targets). */
  plannedSessions?: readonly {
    id: string;
    name: string;
    slots: readonly {
      exerciseId: string;
      exerciseName?: string;
      targetSets?: number;
      targetRepRange?: { min: number; max: number };
      targetRir?: number;
    }[];
  }[];
  recentChanges?: readonly {
    kind: string;
    description: string;
    reason: string;
  }[];
}

/**
 * Nutrition context for coaching.
 */
export interface NutritionContext {
  dailyNutrition?: readonly {
    date: CalendarDate;
    totals: { caloriesKcal: number; proteinGrams: number; carbohydrateGrams: number; fatGrams: number };
    targetsSnapshot?: { caloriesKcal: number; proteinGrams: number; [key: string]: unknown };
  }[];
  targets?: { caloriesKcal: number; proteinGrams: number; [key: string]: unknown };
  adherence?: { proteinPercent: number; caloriesPercent: number };
  trends?: { proteinTrend: string; caloriesTrend: string };
}

/**
 * Activity context for coaching.
 */
export interface ActivityContext {
  averageDailySteps?: number;
  stepsTrend7d?: number;
  stepsTrend28d?: number;
  sessionsPerWeek?: number;
  totalActiveMinutesWeekly?: number;
}

/**
 * Recovery context for coaching.
 */
export interface RecoveryContext {
  readinessScore?: number;
  sleepAdequacy?: string;
  hrvTrend?: string;
  fatigueAccumulation?: string;
  limitingFactors?: readonly string[];
  trainingRecommendation?: string;
}

/**
 * Body context for coaching.
 */
export interface BodyContext {
  latestWeightKg?: number;
  latestBodyFatPercent?: number;
  weightTrend7d?: number;
  weightTrend28d?: number;
  measurementsCount: number;
}

/**
 * Projection context for coaching.
 */
export interface ProjectionContext {
  planId?: string;
  assumptions?: readonly { code: string; value: string }[];
  divergences?: readonly { significant: boolean; description: string }[];
}

/**
 * Conversation context — previous messages for follow-up continuity.
 */
export interface ConversationContext {
  conversationId: ConversationId;
  messageCount: number;
  lastMessageAt?: Timestamp;
  /** Previous messages, most recent first, limited to context window. */
  messages: readonly {
    id: MessageId;
    role: MessageRole;
    content: string;
    createdAt: Timestamp;
  }[];
}

/**
 * Complete personal context snapshot assembled for a coaching turn.
 */
export interface PersonalContextSnapshot {
  userId: UserId;
  /** The day this context was anchored to (user-local). */
  asOf: CalendarDate;
  /** When this snapshot was generated. */
  generatedAt: Timestamp;
  /** Which domain sources were included. */
  sources: ContextSourceSnapshot[];
  profile?: UserProfileContext;
  goal?: GoalContext;
  training?: TrainingContext;
  nutrition?: NutritionContext;
  activity?: ActivityContext;
  recovery?: RecoveryContext;
  body?: BodyContext;
  projection?: ProjectionContext;
  decision?: CoachingDecisionContext;
  conversation?: ConversationContext;
  /** Overall quality assessment. */
  quality: ContextQuality;
}

/**
 * Classification of a user message intent.
 */
export interface IntentClassification {
  /** Stable machine code, e.g. "stalled_progress", "todays_workout". */
  intent: string;
  /** Confidence in the classification, 0-1. */
  confidence: number;
  /** Extracted entities from the message. */
  entities: Record<string, string | number | boolean | null>;
}

/**
 * A coaching request — input to the AI provider.
 */
export interface CoachingRequest {
  userId: UserId;
  conversationId?: ConversationId;
  message: string;
  intent?: IntentClassification;
  /** The day to anchor context to. Defaults to today. */
  asOf?: CalendarDate;
  /** Which domain sources to include. Omitted lets the context builder
   * select sources based on the classified intent. */
  contextSources?: {
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
  };
}

/**
 * A proposed action — an action the AI Coach suggests the user take.
 */
export interface ProposedAction {
  id: ActionId;
  kind: ActionKind;
  title: string;
  description: string;
  /** Which domain service method should execute this action. */
  domainService: string;
  /** Parameters for the domain service call. */
  parameters: Record<string, string | number | boolean | null>;
  /** Whether the user must explicitly confirm before execution. */
  requiresConfirmation: boolean;
  /** Whether this action has been validated against the current context. */
  validated: boolean;
  /** Evidence references supporting this action. */
  evidenceRefs: readonly EvidenceReference[];
  /** Decision snapshot this action relates to, if any. */
  decisionSnapshotId?: DecisionSnapshotId;
  /** Current status of the action. */
  status: ActionStatus;
}

/**
 * Coaching response — output from the AI provider, post-validation.
 */
export interface CoachingResponse {
  conversationId: ConversationId;
  messageId: MessageId;
  /** User-facing answer in natural language. */
  answer: string;
  /** Intent that was recognized. */
  intent: {
    intent: string;
    confidence: number;
    entities: Record<string, string | number | boolean | null>;
  };
  /** The personal context used to generate this response. */
  contextSnapshot: PersonalContextSnapshot;
  /** Evidence references cited in the answer. */
  evidenceReferences: readonly EvidenceReference[];
  /** Decision context from the Unified Decision Brain. */
  decisionContext: CoachingDecisionContext;
  /** Quality assessment of the context. */
  quality: ContextQuality;
  /** Proposed actions for the user to consider. */
  proposedActions: readonly ProposedAction[];
  /** Warnings to surface to the user. */
  warnings: readonly string[];
  /** True when the response came from a mock provider. */
  isMock: boolean;
}

/**
 * Provider request — input to an AIProvider implementation.
 */
export interface ProviderRequest {
  coachingRequest: CoachingRequest;
  /** System prompt for the provider. */
  systemPrompt: string;
  contextSnapshot: PersonalContextSnapshot;
  decisionContext: CoachingDecisionContext;
  quality: ContextQuality;
}

/**
 * Provider response — raw output from an AIProvider implementation.
 */
export interface ProviderResponse {
  /** User-facing answer. */
  answer: string;
  /** Reasoning trace, if the provider can produce one. */
  reasoningTrace?: readonly string[];
  /** Provider's confidence, 0-1, if available. */
  confidence?: number;
  /** Proposed actions, if any. */
  proposedActions?: readonly ProposedAction[];
  /** Warnings from the provider. */
  warnings?: readonly string[];
  /** True when the response came from a mock provider. */
  isMock: boolean;
  /** Raw provider output (debug only, never exposed to user). */
  rawResponse?: unknown;
}

/**
 * Validation result for a coaching response.
 */
export interface ValidationResult {
  valid: boolean;
  errors: readonly string[];
  warnings: readonly string[];
  sanitizedAnswer: string;
}

/**
 * Identity and capability metadata for an AI provider.
 */
export interface ProviderMetadata {
  /** Stable provider name, e.g. "mock", "anthropic", "openai". */
  name: string;
  /** True when this is a mock/test provider. */
  isMock: boolean;
  /** Model identifier, if applicable. */
  model?: string;
  /** Version of the provider contract implemented. */
  contractVersion: string;
}

/**
 * Error representation from an AI provider.
 */
export interface ProviderError {
  /** Stable error code. */
  code: string;
  /** Human-readable message. */
  message: string;
  /** Whether the request can be retried. */
  retryable: boolean;
}

/**
 * Result of a provider call — either success or error.
 */
export type ProviderResult = ProviderResponse | ProviderError;

/**
 * Result of validating a proposed action before execution.
 */
export interface ActionValidationResult {
  valid: boolean;
  errors: readonly string[];
}

/**
 * Entry in the typed action registry.
 */
export interface ActionRegistryEntry {
  kind: ActionKind;
  title: string;
  description: string;
  /**
   * Validate proposed parameters against the current context.
   * Returns errors if the action cannot be safely executed.
   */
  validate: (
    parameters: Record<string, unknown>,
    context: PersonalContextSnapshot,
  ) => ActionValidationResult;
  /**
   * Execute the action through an existing domain service.
   * Returns success/failure and any result.
   */
  execute: (
    parameters: Record<string, unknown>,
    userId: UserId,
  ) => Promise<{ success: boolean; result?: unknown; error?: string }>;
  /** Whether the user must explicitly confirm before execution. */
  requiresConfirmation: boolean;
}
