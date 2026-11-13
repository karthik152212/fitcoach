import assert from "node:assert/strict";
import { test, describe } from "node:test";
import type {
  CoachingRequest,
  PersonalContextSnapshot,
  CoachingResponse,
  EvidenceReference,
  ContextQuality,
  CoachingDecisionContext,
  ProposedAction,
  ProviderResponse,
  ProviderMetadata,
  ValidationResult,
  ActionRegistryEntry,
  MessageRole,
  ConversationStatus,
  ActionKind,
} from "../contracts";

// ---------------------------------------------------------------------------
// Contract shape validation — runtime checks that contract interfaces
// can be instantiated with valid values.
// ---------------------------------------------------------------------------

describe("AI Coach contracts", () => {
  test("EvidenceReference can be constructed with all required fields", () => {
    const ref: EvidenceReference = {
      source: "training_state",
      code: "plateau_signal",
      title: "Bench press stalled",
      value: "60kg x 8 reps @ RIR 2",
      confidence: "measured",
      provenance: "measured",
      generatedAt: "2026-10-06T00:00:00Z",
      relatedEntityIds: ["ex_bench_press"],
      basis: "Bench press has not progressed in 3 weeks",
    };
    assert.equal(ref.source, "training_state");
    assert.equal(ref.code, "plateau_signal");
    assert.equal(ref.confidence, "measured");
    assert.equal(ref.provenance, "measured");
  });

  test("EvidenceReference can be constructed with optional fields omitted", () => {
    const ref: EvidenceReference = {
      source: "nutrition_state",
      code: "protein_intake_below_target",
      title: "Protein below target",
      value: "140g / 180g target",
      confidence: "estimated",
      provenance: "measured",
      generatedAt: "2026-10-06T00:00:00Z",
      relatedEntityIds: [],
      basis: "Protein intake is 78% of target",
    };
    assert.equal(ref.expected, undefined);
    assert.equal(ref.decisionSnapshotId, undefined);
    assert.equal(ref.diagnosisId, undefined);
  });

  test("ContextQuality can be constructed", () => {
    const quality: ContextQuality = {
      overallScore: 72,
      sources: [],
      missingDataWarnings: ["Nutrition data is 5 days stale"],
      staleDataWarnings: ["Body measurements 18 days stale"],
      recommendedFollowUpQuestions: ["Have you logged meals recently?"],
      sufficientForAdvice: true,
    };
    assert.equal(quality.overallScore, 72);
    assert.equal(quality.sufficientForAdvice, true);
    assert.equal(quality.missingDataWarnings.length, 1);
  });

  test("ContextQuality with insufficient advice", () => {
    const quality: ContextQuality = {
      overallScore: 15,
      sources: [],
      missingDataWarnings: ["No training data", "No nutrition data"],
      staleDataWarnings: [],
      recommendedFollowUpQuestions: [
        "What is your training goal?",
        "Have you been logging meals?",
      ],
      sufficientForAdvice: false,
    };
    assert.equal(quality.sufficientForAdvice, false);
    assert.equal(quality.recommendedFollowUpQuestions.length, 2);
  });

  test("CoachingDecisionContext can be constructed", () => {
    const context: CoachingDecisionContext = {
      decisionSnapshot: {
        id: "dec_1",
        kind: "no_change",
        status: "current",
        decidedAt: "2026-10-06",
        summary: "Progressing adequately",
        confidence: "measured",
      },
      diagnoses: [],
      activeInterventions: [],
      outcomes: [],
      shouldReevaluate: { should: false, reason: "No re-evaluation trigger" },
      evidenceRefs: [],
      assumptions: [],
    };
    assert.equal(context.decisionSnapshot?.kind, "no_change");
    assert.equal(context.shouldReevaluate?.should, false);
  });

  test("CoachingDecisionContext with null decision snapshot", () => {
    const context: CoachingDecisionContext = {
      decisionSnapshot: null,
      diagnoses: [],
      activeInterventions: [],
      outcomes: [],
      shouldReevaluate: null,
      evidenceRefs: [],
      assumptions: [],
    };
    assert.equal(context.decisionSnapshot, null);
    assert.equal(context.shouldReevaluate, null);
  });

  test("ProposedAction can be constructed", () => {
    const action: ProposedAction = {
      id: "act_1",
      kind: "log_food",
      title: "Log today's meals",
      description: "Record what you've eaten",
      domainService: "nutrition.createMeal",
      parameters: {},
      requiresConfirmation: true,
      validated: true,
      evidenceRefs: [],
      status: "pending",
    };
    assert.equal(action.kind, "log_food");
    assert.equal(action.requiresConfirmation, true);
    assert.equal(action.validated, true);
    assert.equal(action.status, "pending");
  });

  test("ProposedAction with evidence refs", () => {
    const action: ProposedAction = {
      id: "act_2",
      kind: "adjust_nutrition_target",
      title: "Increase protein target",
      description: "Raise protein target from 180g to 200g",
      domainService: "nutritionTargets.deriveAndStoreTargets",
      parameters: { proteinGrams: 200 },
      requiresConfirmation: true,
      validated: true,
      evidenceRefs: [
        {
          source: "nutrition_state",
          code: "protein_intake_below_target",
          title: "Protein below target",
          value: "140g / 180g target",
          confidence: "measured",
          provenance: "measured",
          generatedAt: "2026-10-06T00:00:00Z",
          relatedEntityIds: [],
          basis: "Protein intake is 78% of target",
        },
      ],
      status: "pending",
    };
    assert.equal(action.evidenceRefs.length, 1);
    assert.equal(action.evidenceRefs[0]!.code, "protein_intake_below_target");
  });

  test("PersonalContextSnapshot can be constructed", () => {
    const snapshot: PersonalContextSnapshot = {
      userId: "usr_1",
      asOf: "2026-10-06",
      generatedAt: "2026-11-11T13:00:00Z",
      sources: [],
      quality: {
        overallScore: 100,
        sources: [],
        missingDataWarnings: [],
        staleDataWarnings: [],
        recommendedFollowUpQuestions: [],
        sufficientForAdvice: true,
      },
    };
    assert.equal(snapshot.userId, "usr_1");
    assert.equal(snapshot.asOf, "2026-10-06");
    assert.equal(snapshot.quality.sufficientForAdvice, true);
  });

  test("CoachingResponse can be constructed", () => {
    const response: CoachingResponse = {
      conversationId: "conv_1",
      messageId: "msg_1",
      answer: "[Mock AI response]\nBased on your training data...",
      intent: { intent: "stalled_progress", confidence: 0.9, entities: {} },
      contextSnapshot: {
        userId: "usr_1",
        asOf: "2026-10-06",
        generatedAt: "2026-11-11T13:00:00Z",
        sources: [],
        quality: {
          overallScore: 72,
          sources: [],
          missingDataWarnings: [],
          staleDataWarnings: [],
          recommendedFollowUpQuestions: [],
          sufficientForAdvice: true,
        },
      },
      evidenceReferences: [],
      decisionContext: {
        decisionSnapshot: null,
        diagnoses: [],
        activeInterventions: [],
        outcomes: [],
        shouldReevaluate: null,
        evidenceRefs: [],
        assumptions: [],
      },
      quality: {
        overallScore: 72,
        sources: [],
        missingDataWarnings: [],
        staleDataWarnings: [],
        recommendedFollowUpQuestions: [],
        sufficientForAdvice: true,
      },
      proposedActions: [],
      warnings: [],
      isMock: true,
    };
    assert.equal(response.isMock, true);
    assert.equal(response.intent.intent, "stalled_progress");
    assert.equal(response.intent.confidence, 0.9);
  });

  test("ProviderMetadata can be constructed", () => {
    const metadata: ProviderMetadata = {
      name: "mock",
      isMock: true,
      model: "mock-local",
      contractVersion: "fitcoach.ai.mock.v1",
    };
    assert.equal(metadata.name, "mock");
    assert.equal(metadata.isMock, true);
  });

  test("ValidationResult can be constructed", () => {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: ["Data is 5 days stale"],
      sanitizedAnswer: "Based on available evidence...",
    };
    assert.equal(result.valid, true);
    assert.equal(result.warnings.length, 1);
  });

  test("ValidationResult with errors", () => {
    const result: ValidationResult = {
      valid: false,
      errors: ["Invented calorie target detected"],
      warnings: [],
      sanitizedAnswer: "I don't have enough data.",
    };
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 1);
  });

  test("ActionRegistryEntry type shape", () => {
    const entry: ActionRegistryEntry = {
      kind: "log_food",
      title: "Log today's meals",
      description: "Record what you've eaten",
      validate: () => ({ valid: true, errors: [] }),
      execute: async () => ({ success: true }),
      requiresConfirmation: true,
    };
    assert.equal(entry.kind, "log_food");
    assert.equal(entry.requiresConfirmation, true);
    const validation = entry.validate({}, {} as PersonalContextSnapshot);
    assert.equal(validation.valid, true);
  });

  test("MessageRole values", () => {
    const roles: readonly MessageRole[] = ["user", "assistant", "system"];
    assert.equal(roles.includes("user"), true);
    assert.equal(roles.includes("assistant"), true);
    assert.equal(roles.includes("system"), true);
  });

  test("ConversationStatus values", () => {
    const statuses: readonly ConversationStatus[] = ["active", "archived"];
    assert.equal(statuses.includes("active"), true);
    assert.equal(statuses.includes("archived"), true);
  });

  test("ActionKind values include all expected kinds", () => {
    const kinds: readonly ActionKind[] = [
      "adjust_nutrition_target",
      "adjust_training_volume",
      "record_measurement",
      "update_goal",
      "reevaluate_decision",
      "log_food",
      "log_workout",
      "custom",
    ];
    assert.equal(kinds.includes("log_food"), true);
    assert.equal(kinds.includes("adjust_nutrition_target"), true);
    assert.equal(kinds.includes("custom"), true);
  });

  test("ProviderResponse can be constructed", () => {
    const response: ProviderResponse = {
      answer: "[Mock AI response]\nHello!",
      reasoningTrace: ["Intent: general_coaching"],
      confidence: 0.5,
      proposedActions: [],
      warnings: [],
      isMock: true,
    };
    assert.equal(response.answer.startsWith("[Mock AI response]"), true);
    assert.equal(response.confidence, 0.5);
  });

  test("CoachingRequest can be constructed", () => {
    const request: CoachingRequest = {
      userId: "usr_1",
      message: "Why am I not progressing?",
      intent: { intent: "stalled_progress", confidence: 0.9, entities: {} },
      asOf: "2026-10-06",
      contextSources: {
        profile: true,
        goal: true,
        training: true,
        nutrition: true,
        activity: false,
        recovery: true,
        body: true,
        projection: false,
        decision: true,
        conversation: true,
      },
    };
    assert.equal(request.userId, "usr_1");
    assert.equal(request.contextSources?.training, true);
    assert.equal(request.contextSources?.activity, false);
  });
});
