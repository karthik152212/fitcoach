import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { MockAIProvider, createMockProvider } from "../mockProvider";
import type { PersonalContextSnapshot, CoachingDecisionContext, ContextQuality } from "../contracts";

function makeQuality(overrides?: Partial<ContextQuality>): ContextQuality {
  return {
    overallScore: 100,
    sources: [],
    missingDataWarnings: [],
    staleDataWarnings: [],
    recommendedFollowUpQuestions: [],
    sufficientForAdvice: true,
    ...overrides,
  };
}

function makeContext(overrides?: Partial<PersonalContextSnapshot>): PersonalContextSnapshot {
  return {
    userId: "usr_1",
    asOf: "2026-10-06",
    generatedAt: "2026-11-11T13:00:00Z",
    sources: [],
    quality: makeQuality(),
    ...overrides,
  };
}

function makeDecisionContext(): CoachingDecisionContext {
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

function makeRequest(overrides?: {
  contextSnapshot?: Partial<PersonalContextSnapshot>;
  quality?: Partial<ContextQuality>;
}) {
  return {
    coachingRequest: {
      userId: "usr_1",
      message: "test message",
      contextSources: {
        profile: false,
        goal: false,
        training: false,
        nutrition: false,
        activity: false,
        recovery: false,
        body: false,
        projection: false,
        decision: false,
        conversation: false,
      },
    },
    systemPrompt: "You are a helpful coach.",
    contextSnapshot: makeContext(overrides?.contextSnapshot),
    decisionContext: makeDecisionContext(),
    quality: makeQuality(overrides?.quality),
  };
}

describe("MockAIProvider", () => {
  test("provider metadata identifies as mock", () => {
    const provider = new MockAIProvider();
    assert.equal(provider.metadata.name, "mock");
    assert.equal(provider.metadata.isMock, true);
    assert.equal(provider.metadata.model, "mock-local");
    assert.equal(provider.metadata.contractVersion, "fitcoach.ai.mock.v1");
  });

  test("createMockProvider returns a MockAIProvider", () => {
    const provider = createMockProvider();
    assert.ok(provider instanceof MockAIProvider);
    assert.equal(provider.metadata.isMock, true);
  });

  test("generate returns a ProviderResponse with isMock true", async () => {
    const provider = new MockAIProvider();
    const result = await provider.generate(makeRequest());
    assert.ok("answer" in result);
    if ("answer" in result) {
      assert.equal(result.isMock, true);
      assert.ok(result.answer.startsWith("[Mock AI response]"));
    } else {
      assert.fail("Expected ProviderResponse, got ProviderError");
    }
  });

  test("generate is deterministic for equivalent inputs", async () => {
    const provider = new MockAIProvider();
    const request1 = makeRequest();
    const request2 = makeRequest();
    const result1 = await provider.generate(request1);
    const result2 = await provider.generate(request2);
    if ("answer" in result1 && "answer" in result2) {
      assert.equal(result1.answer, result2.answer);
    } else {
      assert.fail("Expected ProviderResponse");
    }
  });

  test("generate with insufficient advice reports missing data", async () => {
    const provider = new MockAIProvider();
    const result = await provider.generate(
      makeRequest({ quality: { sufficientForAdvice: false, missingDataWarnings: ["No training data"] } }),
    );
    if ("answer" in result) {
      assert.ok(result.answer.includes("don't have enough information"));
      assert.ok(result.answer.includes("No training data"));
      assert.equal(result.isMock, true);
    } else {
      assert.fail("Expected ProviderResponse");
    }
  });

  test("generate preserves evidence references in response", async () => {
    const provider = new MockAIProvider();
    const result = await provider.generate(
      makeRequest({
        contextSnapshot: {
          decision: {
            decisionSnapshot: null,
            diagnoses: [],
            activeInterventions: [],
            outcomes: [],
            shouldReevaluate: null,
            evidenceRefs: [
              {
                source: "training_state",
                code: "plateau_signal",
                title: "Bench press stalled",
                value: "60kg x 8 reps",
                confidence: "measured",
                provenance: "measured",
                generatedAt: "2026-10-06T00:00:00Z",
                relatedEntityIds: ["ex_bench"],
                basis: "Bench press has not progressed",
                decisionSnapshotId: "dec_1",
              },
            ],
            assumptions: [],
          },
        },
      }),
    );
    if ("answer" in result) {
      assert.ok(result.answer.includes("Based on your current evidence"));
      assert.ok(result.answer.includes("Bench press has not progressed"));
    } else {
      assert.fail("Expected ProviderResponse");
    }
  });

  test("generate includes staleness warnings", async () => {
    const provider = new MockAIProvider();
    const result = await provider.generate(
      makeRequest({
        quality: {
          staleDataWarnings: ["Body measurements 18 days stale"],
        },
      }),
    );
    if ("answer" in result) {
      assert.ok(result.answer.includes("Data freshness warnings"));
      assert.ok(result.answer.includes("Body measurements 18 days stale"));
    } else {
      assert.fail("Expected ProviderResponse");
    }
  });

  test("generate does not invent measurements or prescriptions", async () => {
    const provider = new MockAIProvider();
    const result = await provider.generate(makeRequest());
    if ("answer" in result) {
      // Mock responses should not contain specific calorie targets, training
      // prescriptions, or body-fat values that weren't in the context.
      assert.ok(
        !result.answer.includes("2000 calories") &&
          !result.answer.includes("eat more protein"),
        "Mock should not invent specific targets",
      );
    } else {
      assert.fail("Expected ProviderResponse");
    }
  });

  test("generate handles empty context gracefully", async () => {
    const provider = new MockAIProvider();
    const result = await provider.generate(
      makeRequest({
        quality: { sufficientForAdvice: false, missingDataWarnings: ["No data"] },
      }),
    );
    if ("answer" in result) {
      assert.ok(result.answer.includes("don't have enough information"));
    } else {
      assert.fail("Expected ProviderResponse");
    }
  });

  test("multiple generate calls produce identical output", async () => {
    const provider = new MockAIProvider();
    const request = makeRequest();
    const results = await Promise.all([
      provider.generate(request),
      provider.generate(request),
      provider.generate(request),
    ]);
    const answers = results.map((r: { answer?: string }) => ("answer" in r ? r.answer : ""));
    assert.equal(answers[0], answers[1]);
    assert.equal(answers[1], answers[2]);
  });
});
