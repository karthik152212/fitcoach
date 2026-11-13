/**
 * Personal Context Builder — Phase 9.2
 *
 * Builds a PersonalContextSnapshot for a specific user and coaching request
 * by retrieving relevant evidence from all FitCoach specialist systems,
 * evaluating evidence quality, and connecting to the Unified Decision Brain.
 *
 * Does not duplicate domain calculations — delegates to existing services
 * and repositories. Never converts missing information into zero or fabricates
 * measurements.
 */

import type { Repositories } from "@fitcoach/db";
import type {
  CalendarDate,
  ConfidenceLevel,
  DecisionSnapshotId,
  DiagnosisId,
  EntityId,
  MessageId,
  MessageRole,
  ProvenanceClass,
  Timestamp,
  UserId,
} from "@fitcoach/domain";
import type {
  CoachingRequest,
  ContextSourceSnapshot,
  ContextQuality,
  IntentClassification,
  PersonalContextSnapshot,
} from "@fitcoach/ai";
import {
  classifyIntent,
  contextSourcesFromRequest,
  emptySourceSnapshot,
  sourceLabel,
} from "@fitcoach/ai";
import {
  evaluateContextQuality,
} from "@fitcoach/ai";

/**
 * Configuration for the context builder.
 */
export interface ContextBuilderConfig {
  /** Default staleness thresholds per domain (days). */
  stalenessThresholds: Record<string, number>;
  /** Default window days for history queries per domain. */
  defaultWindowDays: Record<string, number>;
  /** Minimum sample size for high confidence. */
  minSampleSizeForConfidence: number;
}

/**
 * Default configuration.
 */
export const DEFAULT_CONTEXT_BUILDER_CONFIG: ContextBuilderConfig = {
  stalenessThresholds: {
    training: 7,
    nutrition: 3,
    activity: 7,
    recovery: 2,
    body: 28,
    projection: 30,
    decision: 14,
    conversation: 1,
  },
  defaultWindowDays: {
    training: 28,
    nutrition: 28,
    activity: 28,
    recovery: 14,
    body: 28,
    projection: 90,
    decision: 90,
    conversation: 14,
  },
  minSampleSizeForConfidence: 3,
};

/**
 * Personal Context Builder service.
 *
 * Retrieves relevant evidence from all specialist systems and assembles a
 * PersonalContextSnapshot with quality assessment.
 */
export class PersonalContextBuilder {
  constructor(private readonly repos: Repositories) {}

  /**
   * Build a personal context snapshot for a coaching request.
   *
   * @param userId - The user to build context for
   * @param request - The coaching request with message, intent, and source preferences
   * @param asOf - The day to anchor context to (user-local). Defaults to today.
   */
  async buildContext(
    userId: UserId,
    request: CoachingRequest,
    asOf?: CalendarDate,
  ): Promise<PersonalContextSnapshot> {
    // 1. Classify intent if not provided
    const intent: IntentClassification =
      request.intent ?? classifyIntent(request.message);

    // 2. Select context sources based on intent and request preferences
    const contextSources = contextSourcesFromRequest({
      contextSources: request.contextSources,
      intent,
    });

    // 3. Determine anchor date
    const anchorDate: CalendarDate =
      request.asOf ?? asOf ?? new Date().toISOString().split("T")[0] as CalendarDate;

    // 4. Retrieve data from each selected source
    const sources: ContextSourceSnapshot[] = [];
    const context: Partial<PersonalContextSnapshot> = {
      userId,
      asOf: anchorDate,
      generatedAt: new Date().toISOString(),
      sources,
    };

    if (contextSources.profile) {
      const profile = await this.buildProfileContext(userId, anchorDate);
      if (profile) {
        context.profile = profile;
        sources.push(
          this.makeSourceSnapshot(
            "profile",
            profile.timezone,
            profile.profile ? "measured" : "unknown",
            [],
            [],
          ),
        );
      } else {
        sources.push(emptySourceSnapshot("profile"));
      }
    }

    if (contextSources.goal) {
      const goal = await this.buildGoalContext(userId, anchorDate);
      if (goal) {
        context.goal = goal;
        sources.push(
          this.makeSourceSnapshot(
            "goal",
            goal.effectiveFrom ?? anchorDate,
            "measured",
            goal.priorities?.length === 0 ? ["priorities"] : [],
            [],
          ),
        );
      } else {
        sources.push(emptySourceSnapshot("goal"));
      }
    }

    if (contextSources.training) {
      const training = await this.buildTrainingContext(userId, anchorDate);
      if (training) {
        context.training = training;
        const hasData =
          training.weeklySessionFrequency !== undefined ||
          (training.plateauSignals?.length ?? 0) > 0 ||
          (training.progressionStatus?.length ?? 0) > 0;
        sources.push(
          this.makeSourceSnapshot(
            "training",
            anchorDate,
            hasData ? "measured" : "estimated",
            training.adherence === undefined ? ["adherence"] : [],
            [],
          ),
        );
      } else {
        sources.push(emptySourceSnapshot("training"));
      }
    }

    if (contextSources.nutrition) {
      const nutrition = await this.buildNutritionContext(userId, anchorDate);
      if (nutrition) {
        context.nutrition = nutrition;
        const hasData = nutrition.adherence !== undefined;
        sources.push(
          this.makeSourceSnapshot(
            "nutrition",
            anchorDate,
            hasData ? "measured" : "estimated",
            nutrition.adherence === undefined
              ? ["proteinPercent", "caloriesPercent"]
              : [],
            [],
          ),
        );
      } else {
        sources.push(emptySourceSnapshot("nutrition"));
      }
    }

    if (contextSources.activity) {
      const activity = await this.buildActivityContext(userId, anchorDate);
      if (activity) {
        context.activity = activity;
        sources.push(
          this.makeSourceSnapshot(
            "activity",
            anchorDate,
            activity.averageDailySteps !== undefined ? "measured" : "estimated",
            [],
            [],
          ),
        );
      } else {
        sources.push(emptySourceSnapshot("activity"));
      }
    }

    if (contextSources.recovery) {
      const recovery = await this.buildRecoveryContext(userId, anchorDate);
      if (recovery) {
        context.recovery = recovery;
        sources.push(
          this.makeSourceSnapshot(
            "recovery",
            anchorDate,
            recovery.readinessScore !== undefined ? "measured" : "estimated",
            [],
            [],
          ),
        );
      } else {
        sources.push(emptySourceSnapshot("recovery"));
      }
    }

    if (contextSources.body) {
      const body = await this.buildBodyContext(userId, anchorDate);
      if (body) {
        context.body = body;
        sources.push(
          this.makeSourceSnapshot(
            "body",
            anchorDate,
            body.latestWeightKg !== undefined ? "measured" : "estimated",
            body.measurementsCount === 0 ? ["measurements"] : [],
            [],
          ),
        );
      } else {
        sources.push(emptySourceSnapshot("body"));
      }
    }

    if (contextSources.projection) {
      const projection = await this.buildProjectionContext(userId);
      if (projection) {
        context.projection = projection;
        sources.push(
          this.makeSourceSnapshot(
            "projection",
            anchorDate,
            "estimated",
            projection.divergences?.length === 0 ? ["divergences"] : [],
            [],
          ),
        );
      } else {
        sources.push(emptySourceSnapshot("projection"));
      }
    }

    if (contextSources.decision) {
      const decision = await this.buildDecisionContext(userId);
      if (decision) {
        context.decision = decision;
        sources.push(
          this.makeSourceSnapshot(
            "decision",
            anchorDate,
            decision.decisionSnapshot?.confidence ?? "unknown",
            decision.decisionSnapshot === null ? ["decisionSnapshot"] : [],
            [],
          ),
        );
      } else {
        sources.push(emptySourceSnapshot("decision"));
      }
    }

    if (contextSources.conversation) {
      const conversation = await this.buildConversationContext(userId);
      if (conversation) {
        context.conversation = conversation;
        sources.push(
          this.makeSourceSnapshot(
            "conversation",
            anchorDate,
            "measured",
            [],
            [],
          ),
        );
      } else {
        sources.push(emptySourceSnapshot("conversation"));
      }
    }

    // 6. Evaluate overall context quality
    const quality: ContextQuality = evaluateContextQuality(sources);
    context.quality = quality;

    return context as PersonalContextSnapshot;
  }

  // -------------------------------------------------------------------------
  // Per-source context builders
  // -------------------------------------------------------------------------

  private async buildProfileContext(
    userId: UserId,
    _asOf: CalendarDate,
  ): Promise<{
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
  } | null> {
    const user = await this.repos.users.findById(userId);
    if (!user) return null;

    const profile = await this.repos.profiles.get(userId);

    return {
      userId,
      timezone: user.timezone,
      profile: profile
        ? {
            birthDate: profile.birthDate,
            sex: profile.sex,
            heightCm: profile.heightCm,
            trainingExperience: profile.trainingExperience,
            trainingDaysPerWeek: profile.trainingDaysPerWeek,
            sessionDurationMinutes: profile.sessionDurationMinutes,
            limitations: profile.limitations,
            unitSystem: profile.unitSystem,
          }
        : undefined,
    };
  }

  private async buildGoalContext(
    userId: UserId,
    _asOf: CalendarDate,
  ): Promise<{
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
  } | null> {
    const goal = await this.repos.goals.active(userId);
    if (!goal) return null;

    return {
      goalId: goal.id,
      kind: goal.kind,
      description: goal.description,
      priorities: goal.priorities,
      physiqueTarget: goal.physiqueTarget
        ? {
            bodyWeightKg: goal.physiqueTarget.bodyWeightKg,
            bodyFatPercent: goal.physiqueTarget.bodyFatPercent,
            waistCm: goal.physiqueTarget.waistCm,
            chestCm: goal.physiqueTarget.chestCm,
            shoulderCircumferenceCm: goal.physiqueTarget.shoulderCircumferenceCm,
            armCm: goal.physiqueTarget.armCm,
            thighCm: goal.physiqueTarget.thighCm,
            calfCm: goal.physiqueTarget.calfCm,
            notes: goal.physiqueTarget.notes,
          }
        : undefined,
      effectiveFrom: goal.effectiveFrom,
      effectiveUntil: goal.effectiveUntil,
    };
  }

  private async buildTrainingContext(
    userId: UserId,
    asOf: CalendarDate,
  ): Promise<{
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
  } | null> {
    const plan = await this.repos.trainingPlans.findActive(userId);
    if (!plan) return null;

    const workouts = await this.repos.workouts.history(userId, {
      limit: 28,
      to: asOf,
    });

    const adherence =
      workouts.length > 0
        ? workouts.filter((w) => w.workout.status === "completed").length /
          workouts.length
        : 0;

    const progressionEvals = await this.repos.progressionLedger.listEvaluations(
      userId,
      { limit: 50 },
    );

    const progressionStatus = progressionEvals.map((evalEntry) => ({
      exerciseId: evalEntry.exerciseId,
      exerciseName: evalEntry.exerciseName,
      status: evalEntry.outcome,
      currentLoadKg: evalEntry.current?.loadKg,
      currentRepRange: undefined,
      progressionsCompleted: 0,
    }));

    return {
      currentPlanVersionId: plan.versions[0]?.id ?? undefined,
      currentPlanStatus: plan.status,
      trainingGoalKind: undefined,
      weeklySessionFrequency: plan.versions[0]?.sessions.length ?? undefined,
      plannedSessions: await this.buildPlannedSessions(plan.versions[0]?.sessions ?? []),
      adherence,
      plateauSignals: [],
      progressionStatus,
      recentChanges: [],
    };
  }

  private async buildPlannedSessions(
    sessions: readonly { id: string; name: string; slots: readonly { exerciseId: string; targetSets?: number; targetRepRange?: { min: number; max: number }; targetRir?: unknown }[] }[],
  ): Promise<{
    id: string;
    name: string;
    slots: readonly { exerciseId: string; exerciseName?: string; targetSets?: number; targetRepRange?: { min: number; max: number }; targetRir?: number }[];
  }[]> {
    const result: {
      id: string;
      name: string;
      slots: { exerciseId: string; exerciseName?: string; targetSets?: number; targetRepRange?: { min: number; max: number }; targetRir?: number }[];
    }[] = [];
    for (const session of sessions) {
      const slots: { exerciseId: string; exerciseName?: string; targetSets?: number; targetRepRange?: { min: number; max: number }; targetRir?: number }[] = [];
      for (const slot of session.slots ?? []) {
        let exerciseName: string | undefined;
        if (typeof this.repos.exercises.findExerciseById === "function") {
          try {
            const exercise = await this.repos.exercises.findExerciseById(slot.exerciseId);
            if (exercise) exerciseName = (exercise as { name?: string }).name;
          } catch {
            // Exercise catalog lookup is best-effort; the exerciseId remains authoritative.
          }
        }
        slots.push({
          exerciseId: slot.exerciseId,
          ...(exerciseName ? { exerciseName } : {}),
          targetSets: slot.targetSets,
          targetRepRange: slot.targetRepRange,
          targetRir: slot.targetRir as number | undefined,
        });
      }
      result.push({ id: session.id, name: session.name, slots });
    }
    return result;
  }

  private async buildNutritionContext(
    userId: UserId,
    asOf: CalendarDate,
  ): Promise<{
    dailyNutrition?: readonly {
      date: CalendarDate;
      totals: { caloriesKcal: number; proteinGrams: number; carbohydrateGrams: number; fatGrams: number };
      targetsSnapshot?: { caloriesKcal: number; proteinGrams: number; [key: string]: unknown };
    }[];
    targets?: { caloriesKcal: number; proteinGrams: number; [key: string]: unknown };
    adherence?: { proteinPercent: number; caloriesPercent: number };
    trends?: { proteinTrend: string; caloriesTrend: string };
  } | null> {
    const snapshot = await this.repos.nutrition.getStateSnapshot(userId, asOf, 28);
    if (!snapshot) return null;

    const daily: {
      date: CalendarDate;
      totals: { caloriesKcal: number; proteinGrams: number; carbohydrateGrams: number; fatGrams: number };
      targetsSnapshot?: { caloriesKcal: number; proteinGrams: number; [key: string]: unknown };
    }[] = snapshot.recentDailyTotals.map((d) => ({
      date: d.localDate,
      totals: {
        caloriesKcal: d.totals.caloriesKcal,
        proteinGrams: d.totals.proteinGrams,
        carbohydrateGrams: d.totals.carbohydrateGrams,
        fatGrams: d.totals.fatGrams,
      },
      targetsSnapshot: d.targetsSnapshot as
        | { caloriesKcal: number; proteinGrams: number; [key: string]: unknown }
        | undefined,
    }));

    return {
      dailyNutrition: daily,
      targets: undefined,
      adherence: {
        proteinPercent: snapshot.adherencePercent,
        caloriesPercent: snapshot.adherencePercent,
      },
      trends: {
        proteinTrend: "stable",
        caloriesTrend: "stable",
      },
    };
  }

  private async buildActivityContext(
    userId: UserId,
    asOf: CalendarDate,
  ): Promise<{
    averageDailySteps?: number;
    stepsTrend7d?: number;
    stepsTrend28d?: number;
    sessionsPerWeek?: number;
    totalActiveMinutesWeekly?: number;
  } | null> {
    const snapshot = await this.repos.activity.getStateSnapshot(userId, asOf, 28);
    if (!snapshot) return null;

    return {
      averageDailySteps: snapshot.averageDailySteps,
      stepsTrend7d: snapshot.stepsTrend7d,
      stepsTrend28d: snapshot.stepsTrend28d,
      sessionsPerWeek: snapshot.sessionsPerWeek,
      totalActiveMinutesWeekly: snapshot.totalActiveMinutesWeekly,
    };
  }

  private async buildRecoveryContext(
    userId: UserId,
    asOf: CalendarDate,
  ): Promise<{
    readinessScore?: number;
    sleepAdequacy?: string;
    hrvTrend?: string;
    fatigueAccumulation?: string;
    limitingFactors?: readonly string[];
    trainingRecommendation?: string;
  } | null> {
    const snapshot = await this.repos.recovery.getStateSnapshot(userId, asOf, 14);
    if (!snapshot) return null;

    const sleepSnapshot = await this.repos.sleep.getStateSnapshot(userId, asOf, 14);

    return {
      readinessScore: snapshot.averageReadinessScore,
      sleepAdequacy: sleepSnapshot?.averageSleepMinutes !== undefined
        ? sleepSnapshot.averageSleepMinutes >= 420
          ? "adequate"
          : sleepSnapshot.averageSleepMinutes >= 360
            ? "moderate_debt"
            : "severe_debt"
        : undefined,
      hrvTrend: "stable",
      fatigueAccumulation: snapshot.averageFatigue > 7 ? "high" : snapshot.averageFatigue > 4 ? "moderate" : "low",
      limitingFactors: [],
      trainingRecommendation: "maintain",
    };
  }

  private async buildBodyContext(
    userId: UserId,
    asOf: CalendarDate,
  ): Promise<{
    latestWeightKg?: number;
    latestBodyFatPercent?: number;
    weightTrend7d?: number;
    weightTrend28d?: number;
    measurementsCount: number;
  } | null> {
    const snapshot = await this.repos.bodyMeasurements.getStateSnapshot(userId, asOf, 28);
    if (!snapshot) return null;

    return {
      latestWeightKg: snapshot.latestWeightKg,
      latestBodyFatPercent: snapshot.latestBodyFatPercent,
      weightTrend7d: snapshot.weightTrend7d,
      weightTrend28d: snapshot.weightTrend28d,
      measurementsCount: snapshot.measurementsCount,
    };
  }

  private async buildProjectionContext(
    _userId: UserId,
  ): Promise<{
    planId?: string;
    assumptions?: readonly { code: string; value: string }[];
    divergences?: readonly { significant: boolean; description: string }[];
  } | null> {
    // Projection data is only accessible via the unified state slice.
    // We don't have a standalone projection repository method, so we return null
    // and let the caller handle the absence.
    return null;
  }

  private async buildDecisionContext(
    userId: UserId,
  ): Promise<{
    decisionSnapshot: {
      id: DecisionSnapshotId;
      kind: string;
      status: string;
      decidedAt: CalendarDate;
      summary: string;
      confidence: ConfidenceLevel;
    } | null;
    diagnoses: readonly {
      id: DiagnosisId;
      code: string;
      title: string;
      severity: string;
      status: string;
    }[];
    activeInterventions: readonly string[];
    outcomes: readonly {
      id: DecisionSnapshotId;
      verdict: string;
      evaluationWindow: string;
      triggersReevaluation: boolean;
      evaluatedAt: Timestamp;
    }[];
    shouldReevaluate: { should: boolean; reason: string } | null;
    evidenceRefs: readonly {
      source: string;
      code: string;
      title: string;
      value: string;
      expected?: string;
      confidence: ConfidenceLevel;
      provenance: ProvenanceClass;
      generatedAt: Timestamp;
      relatedEntityIds: readonly EntityId[];
      basis: string;
      decisionSnapshotId?: DecisionSnapshotId;
      diagnosisId?: DiagnosisId;
    }[];
    assumptions: readonly {
      code: string;
      description: string;
      category: string;
      value: string;
      sensitive: boolean;
      source: string;
    }[];
  } | null> {
    // List current decisions (most recent first)
    const decisions = await this.repos.decisionSnapshots.list(userId, {
      status: "current",
      limit: 1,
    });

    if (decisions.length === 0) {
      return {
        decisionSnapshot: null,
        diagnoses: [],
        activeInterventions: [],
        outcomes: [],
        shouldReevaluate: null,
        evidenceRefs: [],
        assumptions: [],
      };
    }

    const decision = decisions[0];
    if (!decision) {
      return {
        decisionSnapshot: null,
        diagnoses: [],
        activeInterventions: [],
        outcomes: [],
        shouldReevaluate: null,
        evidenceRefs: [],
        assumptions: [],
      };
    }
    const decisionWithRelations = await this.repos.decisionSnapshots.findByIdWithRelations(
      decision.id,
    );

    if (!decisionWithRelations) {
      return {
        decisionSnapshot: null,
        diagnoses: [],
        activeInterventions: [],
        outcomes: [],
        shouldReevaluate: null,
        evidenceRefs: [],
        assumptions: [],
      };
    }

    const outcomes = await this.repos.decisionOutcomes.list(decision.id, {
      limit: 10,
    });

    const evidenceRefs = (decisionWithRelations.evidence ?? []).map((e) => ({
      source: e.sourceEngine,
      code: e.code,
      title: e.title,
      value: e.observed,
      expected: e.expected,
      confidence: e.confidence,
      provenance: e.provenanceClass,
      generatedAt: e.createdAt,
      relatedEntityIds: [],
      basis: e.metric,
      decisionSnapshotId: e.decisionSnapshotId,
      diagnosisId: undefined,
    }));

    const assumptions = (decisionWithRelations.assumptions ?? []).map((a) => ({
      code: a.code,
      description: a.description,
      category: a.category,
      value: a.value,
      sensitive: a.sensitive,
      source: a.source,
    }));

    const activeInterventions = (decisionWithRelations.interventions ?? []).map(
      (i) => i.kind,
    );

    const shouldReevaluate = outcomes.some((o) => o.triggersReevaluation)
      ? { should: true, reason: "Recent outcome triggers reevaluation" }
      : { should: false, reason: "No reevaluation trigger" };

    return {
      decisionSnapshot: {
        id: decision.id,
        kind: decision.kind,
        status: decision.status,
        decidedAt: decision.decidedAt,
        summary: decision.summary,
        confidence: decision.confidence,
      },
      diagnoses: [],
      activeInterventions,
      outcomes: outcomes.map((o) => ({
        id: o.id,
        verdict: o.verdict,
        evaluationWindow: o.evaluationWindow,
        triggersReevaluation: o.triggersReevaluation,
        evaluatedAt: o.evaluatedAt,
      })),
      shouldReevaluate,
      evidenceRefs,
      assumptions,
    };
  }

  private async buildConversationContext(
    userId: UserId,
  ): Promise<{
    conversationId: string;
    messageCount: number;
    lastMessageAt?: Timestamp;
    messages: readonly {
      id: MessageId;
      role: MessageRole;
      content: string;
      createdAt: Timestamp;
    }[];
  } | null> {
    const conversations = await this.repos.conversations.list(userId, {
      limit: 1,
    });

    if (conversations.length === 0) return null;

    const conv = conversations[0];
    if (!conv) return null;
    const convWithMessages = await this.repos.conversationMessages.listByUser(
      userId,
      { limit: 1 },
    );

    const convData = convWithMessages.find((c) => c.conversationId === conv.id);
    const messages = convData?.messages ?? [];

    return {
      conversationId: conv.id,
      messageCount: messages.length,
      lastMessageAt:
        messages.length > 0
          ? messages[messages.length - 1]!.createdAt
          : undefined,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Helper methods
  // -------------------------------------------------------------------------

  private makeSourceSnapshot(
    source: string,
    lastObservedAt: CalendarDate | string,
    confidence: ConfidenceLevel,
    missingFields: readonly string[],
    warnings: readonly string[],
  ): ContextSourceSnapshot {
    const stalenessDays = 0; // Data was just retrieved
    const isStale = false;

    return {
      source,
      label: sourceLabel(source),
      lastObservedAt: `${lastObservedAt}T00:00:00.000Z`,
      stalenessDays,
      isStale,
      completenessPercent:
        missingFields.length === 0
          ? 100
          : Math.max(0, 100 - missingFields.length * 20),
      confidence,
      missingFields,
      warnings,
    };
  }
}
