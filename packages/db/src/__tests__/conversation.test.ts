import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  conversationRowToRecord,
  messageRowToRecord,
} from "../repositories/conversation";
import type {
  ConversationStatus,
  MessageRole,
} from "@fitcoach/domain";

// ---------------------------------------------------------------------------
// Mapping unit tests — no database required. These verify that Prisma rows
// are correctly translated into domain record types.
// ---------------------------------------------------------------------------

describe("conversation row mapping", () => {
  test("conversationRowToRecord maps all fields", () => {
    const row = {
      id: "conv_1",
      userId: "usr_1",
      title: "My coaching conversation",
      status: "active",
      createdAt: new Date("2026-11-11T13:00:00.000Z"),
      updatedAt: new Date("2026-11-11T13:05:00.000Z"),
    };

    const record = conversationRowToRecord(row);

    assert.equal(record.id, "conv_1");
    assert.equal(record.userId, "usr_1");
    assert.equal(record.title, "My coaching conversation");
    assert.equal(record.status, "active");
    assert.equal(record.createdAt, "2026-11-11T13:00:00.000Z");
    assert.equal(record.updatedAt, "2026-11-11T13:05:00.000Z");
  });

  test("conversationRowToRecord handles null title", () => {
    const row = {
      id: "conv_2",
      userId: "usr_1",
      title: null,
      status: "archived",
      createdAt: new Date("2026-11-10T00:00:00.000Z"),
      updatedAt: new Date("2026-11-10T01:00:00.000Z"),
    };

    const record = conversationRowToRecord(row);

    assert.equal(record.title, undefined);
    assert.equal(record.status, "archived");
  });

  test("messageRowToRecord maps all fields", () => {
    const row = {
      id: "msg_1",
      conversationId: "conv_1",
      role: "user",
      content: "Why am I not progressing?",
      contextSnapshot: null,
      evidenceRefs: null,
      proposedActions: null,
      isMock: false,
      provider: null,
      model: null,
      createdAt: new Date("2026-11-11T13:00:00.000Z"),
    };

    const record = messageRowToRecord(row);

    assert.equal(record.id, "msg_1");
    assert.equal(record.conversationId, "conv_1");
    assert.equal(record.role, "user");
    assert.equal(record.content, "Why am I not progressing?");
    assert.equal(record.contextSnapshot, null);
    assert.equal(record.evidenceRefs, null);
    assert.equal(record.proposedActions, null);
    assert.equal(record.isMock, false);
    // Prisma returns SQL NULL as null; the repository layer converts to undefined
    assert.ok(record.provider === null || record.provider === undefined);
    assert.ok(record.model === null || record.model === undefined);
    assert.equal(record.createdAt, "2026-11-11T13:00:00.000Z");
  });

  test("messageRowToRecord maps assistant message with context", () => {
    const contextSnapshot: any = {
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
    };

    const row = {
      id: "msg_2",
      conversationId: "conv_1",
      role: "assistant",
      content: "[Mock AI response]\nBased on your data...",
      contextSnapshot: contextSnapshot,
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
          basis: "Bench press stalled",
        },
      ],
      proposedActions: [],
      isMock: true,
      provider: "mock",
      model: "mock-local",
      createdAt: new Date("2026-11-11T13:01:00.000Z"),
    };

    const record = messageRowToRecord(row);

    assert.equal(record.role, "assistant");
    assert.equal(record.isMock, true);
    assert.equal(record.provider, "mock");
    assert.equal(record.model, "mock-local");
    assert.ok(record.contextSnapshot);
    if (record.contextSnapshot) {
      const ctx = record.contextSnapshot as { userId: string; asOf: string };
      assert.equal(ctx.userId, "usr_1");
      assert.equal(ctx.asOf, "2026-10-06");
    }
    assert.ok(record.evidenceRefs);
    if (record.evidenceRefs) {
      const refs = record.evidenceRefs as { code: string }[];
      assert.equal(refs.length, 1);
      assert.equal(refs[0]!.code, "plateau_signal");
    }
  });

  test("messageRowToRecord handles null JSON fields", () => {
    const row = {
      id: "msg_3",
      conversationId: "conv_1",
      role: "system",
      content: "System message",
      contextSnapshot: null,
      evidenceRefs: null,
      proposedActions: null,
      isMock: false,
      provider: null,
      model: null,
      createdAt: new Date("2026-11-11T12:00:00.000Z"),
    };

    const record = messageRowToRecord(row);

    assert.equal(record.role, "system");
    assert.ok(record.contextSnapshot === null || record.contextSnapshot === undefined);
    assert.ok(record.evidenceRefs === null || record.evidenceRefs === undefined);
    assert.ok(record.proposedActions === null || record.proposedActions === undefined);
    assert.ok(record.provider === null || record.provider === undefined);
    assert.ok(record.model === null || record.model === undefined);
  });
});

describe("message role values", () => {
  test("all MessageRole values are valid", () => {
    const roles: readonly MessageRole[] = ["user", "assistant", "system"];
    for (const role of roles) {
      assert.ok(role === "user" || role === "assistant" || role === "system");
    }
  });
});

describe("conversation status values", () => {
  test("all ConversationStatus values are valid", () => {
    const statuses: readonly ConversationStatus[] = ["active", "archived"];
    for (const status of statuses) {
      assert.ok(status === "active" || status === "archived");
    }
  });
});
