/**
 * Conversation Orchestrator — Phase 9.3
 *
 * Connects the Phase 9.1 conversation persistence layer and the Phase 9.2
 * Personal Context Builder into a working, evidence-grounded coaching
 * pipeline:
 *
 *   1. Validate the coaching request and conversation ownership.
 *   2. Load the conversation and relevant prior messages.
 *   3. Classify the user's intent.
 *   4. Build fresh, intent-relevant personal context via PersonalContextBuilder.
 *   5. Retrieve historical evidence and prior coaching references.
 *   6. Retrieve the current Unified Decision Brain result where relevant.
 *   7. Construct a structured ProviderRequest.
 *   8. Call the injected AIProvider.
 *   9. Validate the provider response via ResponseValidator.
 *   10. Persist the user message, assistant response, context snapshot
 *       reference, evidence references, provider metadata and proposed actions.
 *   11. Return the response with its evidence and uncertainty information.
 *
 * Provider-independent by design: the injected AIProvider is the only
 * provider-facing surface. The mock provider requires no API key and makes
 * no network calls.
 *
 * Context sufficiency is evaluated relative to the question (the intent's
 * relevant sources), not every source in the entire system. Projection and
 * conversation continuity are disclosed when absent, but they do not block
 * advice when the decision-relevant sources are complete.
 */

import type { Repositories } from "@fitcoach/db";
import type {
  ActionId,
  ActionStatus,
  CalendarDate,
  ConversationId,
  MessageId,
  UserId,
} from "@fitcoach/domain";
import type {
  CoachingDecisionContext,
  CoachingResponse,
  CoachingRequest,
  ContextQuality,
  IntentClassification,
  PersonalContextSnapshot,
  ProviderError,
  ProviderResponse,
  ProposedAction,
} from "@fitcoach/ai";
export type { CoachingRequest };
import {
  classifyIntent,
  type ContextSourceSelection,
} from "@fitcoach/ai";
import { PersonalContextBuilder } from "./contextBuilder";
import { ResponseValidator } from "./responseValidator";
import { TypedActionRegistry, PendingActionRecord } from "./actionRegistry";

/** Surface errors from the orchestrator with an HTTP status code. */
export class CoachingError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CoachingError";
    this.status = status;
    this.code = code;
  }
}

export interface OrchestratorDependencies {
  repos: Repositories;
  provider: {
    readonly metadata: { name: string; isMock: boolean; model?: string };
    generate(request: {
      coachingRequest: CoachingRequest;
      systemPrompt: string;
      contextSnapshot: PersonalContextSnapshot;
      decisionContext: CoachingDecisionContext;
      quality: ContextQuality;
    }): Promise<ProviderResponse | ProviderError>;
  };
  contextBuilder: PersonalContextBuilder;
  actionRegistry: TypedActionRegistry;
  validator: ResponseValidator;
}

/** Sources that are informative but never block substantive advice. */
const NON_BLOCKING_SOURCES: readonly string[] = ["projection", "conversation"];

/** Maximum prior messages loaded for follow-up continuity. */
const CONTEXT_MESSAGE_LIMIT = 50;

/** Truncation length for conversation titles derived from the first message. */
const TITLE_MAX_LENGTH = 80;

/**
 * Coaching orchestration service. One instance per request scope is fine;
 * pending actions live in memory for the lifetime of the instance (a
 * production deployment would persist them in a dedicated action table —
 * see the Phase 9.3 report).
 */
export class ConversationOrchestrator {
  private readonly repos: Repositories;
  private readonly provider: OrchestratorDependencies["provider"];
  private readonly contextBuilder: PersonalContextBuilder;
  private readonly actionRegistry: TypedActionRegistry;
  private readonly validator: ResponseValidator;

  /** Pending actions awaiting explicit user confirmation. In-memory only. */
  private readonly pendingActions = new Map<ActionId, PendingActionRecord>();

  constructor(dependencies: OrchestratorDependencies) {
    this.repos = dependencies.repos;
    this.provider = dependencies.provider;
    this.contextBuilder = dependencies.contextBuilder;
    this.actionRegistry = dependencies.actionRegistry;
    this.validator = dependencies.validator;
  }

  // ------------------------------------------------------------------
  // Step 1–11: the full coaching pipeline
  // ------------------------------------------------------------------

  async handleCoachingRequest(
    request: CoachingRequest,
  ): Promise<CoachingResponse> {
    // 1. Validate the coaching request.
    this.validateRequest(request);

    // 2. Load the conversation and verify ownership; create when absent.
    const conversation = await this.resolveConversation(request);

    // Persist the user turn up front so the transcript is durable even if
    // the provider call fails.
    await this.repos.conversationMessages.create({
      conversationId: conversation.id,
      role: "user",
      content: request.message,
      isMock: this.provider.metadata.isMock,
      provider: this.provider.metadata.name,
      model: this.provider.metadata.model,
    });

    // 3. Load relevant prior messages (used by the context builder for
    // follow-up continuity) and classify intent.
    await this.repos.conversationMessages.list(conversation.id, {
      limit: CONTEXT_MESSAGE_LIMIT,
    });
    const intent: IntentClassification =
      request.intent ?? classifyIntent(request.message);

    // 4–6. Build fresh, intent-relevant personal context, including the
    // current Unified Decision Brain result (decision source) and prior
    // coaching references (conversation source).
    // contextSources left undefined lets the builder select sources by
    // intent; the sufficiency gate below is evaluated against that same
    // selection, never against the entire system. At runtime the route does
    // not send contextSources, so the cast mirrors that optional presence.
    // Runtime value may be undefined even though the type says otherwise:
    // the route does not send contextSources, so the builder selects sources
    // by intent when the field is absent.
    const contextSources: ContextSourceSelection | undefined = request.contextSources as
      | ContextSourceSelection
      | undefined;
    const contextSnapshot: PersonalContextSnapshot =
      await this.contextBuilder.buildContext(request.userId, {
        userId: request.userId,
        message: request.message,
        intent,
        asOf: request.asOf,
        contextSources: contextSources as ContextSourceSelection,
      });

    // 7+. Evaluate sufficiency relative to the question, not every source
    // in the system. Projection and conversation continuity are disclosed
    // when absent but do not block advice when decision-relevant sources
    // are complete.
    const { quality, disclosures } = this.assessContextQuality(
      contextSnapshot,
      contextSources,
    );
    contextSnapshot.quality = quality;

    // 7. Construct the structured provider request.
    const decisionContext: CoachingDecisionContext =
      contextSnapshot.decision ?? this.emptyDecisionContext();
    const providerRequest = {
      coachingRequest: request,
      systemPrompt: this.buildSystemPrompt(intent, contextSnapshot, quality),
      contextSnapshot,
      decisionContext,
      quality,
    };

    // 8. Call the injected AI provider.
    const providerResult = await this.provider.generate(providerRequest);
    if ((providerResult as ProviderError).code !== undefined) {
      const error = providerResult as ProviderError;
      throw new CoachingError(
        502,
        "provider_error",
        `AI provider failed: ${error.message}`,
      );
    }
    const providerResponse = providerResult as ProviderResponse;

    // 9. Validate the provider response before anything is persisted.
    const validation = this.validator.validate({
      response: providerResponse,
      coachingRequest: request,
      contextSnapshot,
      decisionContext,
      providerIsMock: this.provider.metadata.isMock,
    });
    if (!validation.valid) {
      throw new CoachingError(
        400,
        "validation_failed",
        "Coaching response failed validation: " + validation.errors.join("; "),
      );
    }

    // 10. Persist the assistant response with full provenance.
    const proposedActions: readonly ProposedAction[] =
      providerResponse.proposedActions ?? [];
    const assistantMessage = await this.repos.conversationMessages.create({
      conversationId: conversation.id,
      role: "assistant",
      content: validation.sanitizedAnswer,
      isMock: providerResponse.isMock,
      provider: this.provider.metadata.name,
      model: this.provider.metadata.model,
      contextSnapshot,
      evidenceRefs: decisionContext.evidenceRefs,
      proposedActions,
    });

    // Register proposed actions as pending explicit confirmation.
    for (const action of proposedActions) {
      if (action.requiresConfirmation) {
        this.pendingActions.set(action.id, {
          id: action.id,
          kind: action.kind,
          parameters: action.parameters,
          userId: request.userId,
          conversationId: conversation.id,
          messageId: assistantMessage.id,
          status: "pending",
          proposedAt: new Date().toISOString(),
          contextSnapshot,
        });
      }
    }

    // 11. Return the response with its evidence and uncertainty information.
    // Non-blocking source gaps (projection, conversation continuity) are
    // disclosed as warnings without affecting sufficiency.
    const allWarnings = [...validation.warnings, ...disclosures];
    return {
      conversationId: conversation.id,
      messageId: assistantMessage.id,
      answer: validation.sanitizedAnswer,
      intent,
      contextSnapshot,
      evidenceReferences: decisionContext.evidenceRefs,
      decisionContext,
      quality,
      proposedActions,
      warnings: allWarnings,
      isMock: providerResponse.isMock,
    };
  }

  // ------------------------------------------------------------------
  // Action lifecycle: preview, confirm, reject
  // ------------------------------------------------------------------

  async previewAction(
    actionId: ActionId,
    userId: UserId,
  ): Promise<{ record: PendingActionRecord; preview: ReturnType<TypedActionRegistry["preview"]> }> {
    const record = this.pendingActions.get(actionId);
    if (!record) {
      throw new CoachingError(404, "not_found", "proposed action not found");
    }
    if (record.userId !== userId) {
      throw new CoachingError(403, "forbidden", "action belongs to another user");
    }
    const preview = this.actionRegistry.preview(
      record.kind,
      record.parameters,
      record.contextSnapshot ?? this.emptyContextSnapshot(record.userId),
    );
    return { record, preview };
  }

  async confirmAction(
    actionId: ActionId,
    userId: UserId,
  ): Promise<{
    status: ActionStatus;
    result?: unknown;
    error?: string;
  }> {
    const record = this.pendingActions.get(actionId);
    if (!record) {
      throw new CoachingError(404, "not_found", "proposed action not found");
    }
    if (record.userId !== userId) {
      throw new CoachingError(403, "forbidden", "action belongs to another user");
    }

    // Idempotent: a previously executed action returns its recorded outcome.
    if (record.status === "executed") {
      return { status: "executed", result: record.result };
    }
    if (record.status === "rejected") {
      throw new CoachingError(409, "action_already_resolved", "action has already been rejected");
    }

    const execution = await this.actionRegistry.executeAction(
      record.kind,
      record.parameters,
      record.userId,
    );

    if (!execution.success) {
      // A failed execution leaves the action pending so the user can retry.
      throw new CoachingError(400, "action_execution_failed", execution.error ?? "action execution failed");
    }

    record.status = "executed";
    record.executedAt = new Date().toISOString();
    record.result = execution.result;
    this.pendingActions.set(actionId, record);

    return { status: "executed", result: execution.result };
  }

  async rejectAction(
    actionId: ActionId,
    userId: UserId,
  ): Promise<{ status: ActionStatus }> {
    const record = this.pendingActions.get(actionId);
    if (!record) {
      throw new CoachingError(404, "not_found", "proposed action not found");
    }
    if (record.userId !== userId) {
      throw new CoachingError(403, "forbidden", "action belongs to another user");
    }
    if (record.status === "executed") {
      throw new CoachingError(409, "action_already_executed", "action has already been executed");
    }
    if (record.status === "rejected") {
      return { status: "rejected" }; // idempotent rejection
    }

    record.status = "rejected";
    this.pendingActions.set(actionId, record);
    return { status: "rejected" };
  }

  // ------------------------------------------------------------------
  // Message retrieval
  // ------------------------------------------------------------------

  async createConversation(
    userId: UserId,
    input: { title?: string },
  ): Promise<{
    id: ConversationId;
    userId: UserId;
    title?: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }> {
    const conversation = await this.repos.conversations.create({
      userId,
      ...(input.title !== undefined ? { title: input.title } : {}),
    });
    return {
      id: conversation.id,
      userId: conversation.userId,
      title: conversation.title,
      status: conversation.status,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  async listConversations(
    userId: UserId,
    options?: { limit?: number; cursor?: string },
  ): Promise<Array<{
    id: ConversationId;
    userId: UserId;
    title?: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>> {
    const conversations = await this.repos.conversations.list(userId, {
      limit: options?.limit,
      cursor: options?.cursor,
    });
    return conversations.map((c) => ({
      id: c.id,
      userId: c.userId,
      title: c.title,
      status: c.status,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  }

  async listMessages(
    conversationId: ConversationId,
    userId: UserId,
    options?: { limit?: number },
  ): Promise<Array<{
    id: MessageId;
    conversationId: ConversationId;
    role: string;
    content: string;
    isMock: boolean;
    provider?: string;
    model?: string;
    createdAt: string;
  }>> {
    const conversation = await this.repos.conversations.findById(conversationId);
    if (!conversation) {
      throw new CoachingError(404, "not_found", "conversation not found");
    }
    if (conversation.userId !== userId) {
      throw new CoachingError(403, "forbidden", "conversation belongs to another user");
    }
    const messages = await this.repos.conversationMessages.list(conversationId, {
      limit: options?.limit,
    });
    return messages.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      role: m.role,
      content: m.content,
      isMock: m.isMock,
      provider: m.provider,
      model: m.model,
      createdAt: m.createdAt,
    }));
  }

  async getMessage(
    messageId: MessageId,
    userId: UserId,
  ): Promise<{
    id: MessageId;
    conversationId: ConversationId;
    role: string;
    content: string;
    isMock: boolean;
    provider?: string;
    model?: string;
    createdAt: string;
    contextSnapshot?: unknown;
    evidenceRefs?: unknown;
    proposedActions?: unknown;
  }> {
    const message = await this.repos.conversationMessages.findById(messageId);
    if (!message) {
      throw new CoachingError(404, "not_found", "message not found");
    }
    const conversation = await this.repos.conversations.findById(
      message.conversationId,
    );
    if (!conversation) {
      throw new CoachingError(404, "not_found", "conversation not found");
    }
    if (conversation.userId !== userId) {
      throw new CoachingError(403, "forbidden", "message belongs to another user");
    }
    return message;
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  private async resolveConversation(request: CoachingRequest) {
    if (request.conversationId) {
      const conversation = await this.repos.conversations.findById(
        request.conversationId,
      );
      if (!conversation) {
        throw new CoachingError(404, "not_found", "conversation not found");
      }
      if (conversation.userId !== request.userId) {
        throw new CoachingError(403, "forbidden", "conversation belongs to another user");
      }
      return conversation;
    }

    const title = request.message.slice(0, TITLE_MAX_LENGTH);
    return this.repos.conversations.create({
      userId: request.userId,
      title: title.length ? title : "Coaching conversation",
    });
  }

  private validateRequest(request: CoachingRequest): void {
    if (!request.userId || typeof request.userId !== "string") {
      throw new CoachingError(400, "validation_failed", "userId is required");
    }
    if (
      typeof request.message !== "string" ||
      request.message.trim().length === 0
    ) {
      throw new CoachingError(400, "validation_failed", "message is required");
    }
    if (request.message.length > 4000) {
      throw new CoachingError(400, "validation_failed", "message must be at most 4000 characters");
    }
    if (request.asOf !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(request.asOf)) {
      throw new CoachingError(400, "validation_failed", "asOf must be a calendar date (YYYY-MM-DD)");
    }
    if (
      request.intent !== undefined &&
      (typeof request.intent.intent !== "string" || request.intent.intent.length === 0)
    ) {
      throw new CoachingError(400, "validation_failed", "intent must have a non-empty intent code");
    }
  }

  private assessContextQuality(
    contextSnapshot: PersonalContextSnapshot,
    contextSources: ContextSourceSelection | undefined,
  ): { quality: ContextQuality; disclosures: readonly string[] } {
    const builderQuality = contextSnapshot.quality;
    const sources = contextSnapshot.sources.filter((s) =>
      (contextSources as unknown as Record<string, boolean> | undefined)?.[s.source] ?? true,
    );

    if (sources.length === 0) {
      return { quality: builderQuality, disclosures: [] };
    }

    let scoreSum = 0;
    const missingDataWarnings: string[] = [];
    const staleDataWarnings: string[] = [];
    const disclosures: string[] = [];

    for (const source of sources) {
      let score = source.completenessPercent;
      if (source.isStale) score *= 0.5;
      if (source.confidence === "unknown") score *= 0.6;
      else if (source.confidence === "estimated") score *= 0.8;
      score -= source.missingFields.length * 5;
      scoreSum += Math.max(0, Math.min(100, score));

      const isBlocking = !NON_BLOCKING_SOURCES.includes(source.source);
      if (source.completenessPercent < 50 && isBlocking) {
        missingDataWarnings.push(
          `${source.label}: only ${source.completenessPercent}% complete (missing: ${source.missingFields.join(", ")})`,
        );
      }
      if (source.isStale && isBlocking) {
        staleDataWarnings.push(
          `${source.label}: data is ${source.stalenessDays} day(s) old`,
        );
      }
      // Non-blocking sources are disclosed, not sufficiency gates.
      if (!isBlocking && source.completenessPercent < 50) {
        disclosures.push(
          `${source.label}: only ${source.completenessPercent}% complete (not required for this question)`,
        );
      }
      if (!isBlocking && source.isStale) {
        disclosures.push(
          `${source.label}: data is ${source.stalenessDays} day(s) old (not required for this question)`,
        );
      }
    }

    const overallScore = Math.round(scoreSum / sources.length);

    const sufficientForAdvice =
      overallScore >= 60 &&
      missingDataWarnings.length === 0 &&
      staleDataWarnings.length === 0;

    return {
      quality: {
        overallScore,
        sources: builderQuality.sources, // preserve the full source trace
        missingDataWarnings,
        staleDataWarnings,
        recommendedFollowUpQuestions: [
          ...builderQuality.recommendedFollowUpQuestions,
        ],
        sufficientForAdvice,
      },
      disclosures,
    };
  }

  private emptyDecisionContext(): CoachingDecisionContext {
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

  private emptyContextSnapshot(userId: UserId): PersonalContextSnapshot {
    // Fallback only; preview paths always have a real snapshot stored.
    return {
      userId,
      asOf: new Date().toISOString().split("T")[0] as CalendarDate,
      generatedAt: new Date().toISOString(),
      sources: [],
      quality: {
        overallScore: 0,
        sources: [],
        missingDataWarnings: [],
        staleDataWarnings: [],
        recommendedFollowUpQuestions: [],
        sufficientForAdvice: false,
      },
    };
  }

  private buildSystemPrompt(
    intent: IntentClassification,
    contextSnapshot: PersonalContextSnapshot,
    quality: ContextQuality,
  ): string {
    const lines: string[] = [];
    lines.push("You are FitCoach's AI Coach. Ground every answer in the supplied personal context only.");
    lines.push("Never invent measurements, calories, targets, workout prescriptions, or diagnoses.");
    lines.push(`Recognized intent: ${intent.intent} (confidence ${(intent.confidence * 100).toFixed(0)}%).`);
    lines.push(`Context quality: ${quality.overallScore}/100; sufficient for advice: ${quality.sufficientForAdvice}.`);
    for (const warning of quality.missingDataWarnings) lines.push(`Missing data: ${warning}`);
    for (const warning of quality.staleDataWarnings) lines.push(`Stale data: ${warning}`);
    if (contextSnapshot.decision?.decisionSnapshot) {
      const d = contextSnapshot.decision.decisionSnapshot;
      lines.push(`Current decision: ${d.kind} — ${d.summary} (confidence ${d.confidence}).`);
    }
    if (!quality.sufficientForAdvice) {
      lines.push("Say what data is missing and ask clarification questions; do not invent calorie targets or meal plans.");
    }
    lines.push("Every recommendation must be traceable to an evidence reference supplied in the context.");
    return lines.join("\n");
  }
}


