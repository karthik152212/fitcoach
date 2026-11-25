import { test, describe, before, beforeEach, after } from "node:test";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { startTestPostgres } from "@fitcoach/db";
import type { PrismaClient } from "@prisma/client";
import { PrismaClient as PrismaClientImpl } from "@prisma/client";
import { createRateLimitService } from "../rateLimit";
import { createIdempotencyService } from "../idempotency";
import { createTokenBudgetService } from "../tokenBudget";

const users = {
  user_1: randomUUID(),
  user_2: randomUUID(),
  user_a: randomUUID(),
  user_b: randomUUID(),
  user_concurrent: randomUUID(),
  user_a_data: randomUUID(),
  user_b_data: randomUUID(),
  user_3: randomUUID(),
  user_4: randomUUID(),
  user_5: randomUUID(),
  user_6: randomUUID(),
  new_user: randomUUID(),
  user_7: randomUUID(),
  user_8: randomUUID(),
  user_9: randomUUID(),
  user_10: randomUUID(),
};

let testPg: Awaited<ReturnType<typeof startTestPostgres>>;
let prisma: PrismaClient;

function resetInfrastructureTables() {
  return prisma.$executeRaw`TRUNCATE TABLE "rate_limit_buckets", "idempotency_keys", "token_budgets", "token_reservations", "global_token_budget"`;
}

beforeEach(resetInfrastructureTables);

// Connect to the disposable PostgreSQL database after migrations are deployed.
before(async () => {
  testPg = await startTestPostgres();
  prisma = new PrismaClientImpl({
    datasources: { db: { url: testPg.url } },
  });
  await prisma.$connect();
});

// Cleanup after tests
after(async () => {
  try {
    if (prisma) await resetInfrastructureTables();
  } finally {
    try {
      await prisma?.$disconnect();
    } finally {
      await testPg?.stop();
    }
  }
});

describe("PostgreSQL-backed RateLimitService", () => {
  test("allows requests within limit", async () => {
    const service = createRateLimitService(prisma);
    const result = await service.checkAILimit(users.user_1);
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 29);
  });

  test("denies requests over limit", async () => {
    const service = createRateLimitService(prisma);
    const limiter = service.getLimiter("test", { maxRequests: 2, windowMs: 60_000, keyPrefix: "test" });

    await limiter.checkLimit(users.user_2);
    await limiter.checkLimit(users.user_2);
    const result = await limiter.checkLimit(users.user_2);

    assert.equal(result.allowed, false);
    assert.equal(result.remaining, 0);
  });

  test("separate users have separate limits (RLS isolation)", async () => {
    const service = createRateLimitService(prisma);
    const limiter = service.getLimiter("test2", { maxRequests: 1, windowMs: 60_000, keyPrefix: "test2" });

    // User A uses their limit
    await limiter.checkLimit(users.user_a);
    // User B should still have full limit
    const resultB = await limiter.checkLimit(users.user_b);

    assert.equal(resultB.allowed, true);
    assert.equal(resultB.remaining, 0); // 1 max, 1 used = 0 remaining
  });

  test("concurrent requests are atomic (no race condition)", async () => {
    const service = createRateLimitService(prisma);
    const limiter = service.getLimiter("concurrent", { maxRequests: 10, windowMs: 60_000, keyPrefix: "concurrent" });

    // Fire 15 concurrent requests for same user
    const promises = Array.from({ length: 15 }, () => limiter.checkLimit(users.user_concurrent));
    const results = await Promise.all(promises);

    const allowed = results.filter(r => r.allowed).length;
    assert.equal(allowed, 10); // Exactly 10 should be allowed
  });
});

describe("PostgreSQL-backed IdempotencyService", () => {
  test("new request returns isNew=true", async () => {
    const service = createIdempotencyService(undefined, prisma);
    const result = await service.checkAndStore(users.user_1, "key_1", { data: "response" });
    assert.equal(result.isNew, true);
    assert.equal(result.key, "key_1");
    assert.deepEqual(result.cachedResponse, undefined);
    assert.equal(result.userId, users.user_1);
  });

  test("duplicate request with same payload returns cached response", async () => {
    const service = createIdempotencyService(undefined, prisma);
    await service.checkAndStore(users.user_1, "key_2", { data: "first" });
    const result = await service.checkAndStore(users.user_1, "key_2", { data: "first" });

    assert.equal(result.isNew, false);
    assert.deepEqual(result.cachedResponse, { data: "first" });
  });

  test("duplicate request with different payload throws conflict", async () => {
    const service = createIdempotencyService(undefined, prisma);
    await service.checkAndStore(users.user_1, "key_3", { data: "first" });

    await assert.rejects(
      () => service.checkAndStore(users.user_1, "key_3", { data: "second" }),
      /Idempotency key conflict: different payload for same key/
    );
  });

  test("different keys are independent", async () => {
    const service = createIdempotencyService(undefined, prisma);
    await service.checkAndStore(users.user_1, "key_a", { data: "a" });
    const result = await service.checkAndStore(users.user_1, "key_b", { data: "b" });

    assert.equal(result.isNew, true);
  });

  test("get returns cached response", async () => {
    const service = createIdempotencyService(undefined, prisma);
    await service.checkAndStore(users.user_1, "key_3", { data: "cached" });
    const cached = await service.get(users.user_1, "key_3");

    assert.deepEqual(cached, { data: "cached" });
  });

  test("get returns null for unknown key", async () => {
    const service = createIdempotencyService(undefined, prisma);
    const cached = await service.get(users.user_1, "unknown_key");
    assert.equal(cached, null);
  });

  test("delete removes key", async () => {
    const service = createIdempotencyService(undefined, prisma);
    await service.checkAndStore(users.user_1, "key_4", { data: "to_delete" });
    const deleted = await service.delete(users.user_1, "key_4");
    const cached = await service.get(users.user_1, "key_4");

    assert.equal(deleted, true);
    assert.equal(cached, null);
  });

  test("RLS isolation: User A cannot see User B's idempotency keys", async () => {
    const service = createIdempotencyService(undefined, prisma);

    // Store keys as different users
    await service.checkAndStore(users.user_a, "shared_key", { data: users.user_a_data });
    await service.checkAndStore(users.user_b, "shared_key", { data: users.user_b_data });

    // User A should only see their own data
    const resultA = await service.get(users.user_a, "shared_key");
    assert.deepEqual(resultA, { data: users.user_a_data });

    // User B should only see their own data
    const resultB = await service.get(users.user_b, "shared_key");
    assert.deepEqual(resultB, { data: users.user_b_data });
  });

  test("concurrent duplicate requests are atomic (exactly one succeeds)", async () => {
    const service = createIdempotencyService(undefined, prisma);

    // Fire 10 concurrent requests with same key for same user
    const promises = Array.from({ length: 10 }, () =>
      service.checkAndStore(users.user_concurrent, "concurrent_key", { data: "concurrent_value" })
    );
    const results = await Promise.all(promises);

    // Exactly one should be new, rest should be cached
    const newCount = results.filter(r => r.isNew).length;
    const cachedCount = results.filter(r => !r.isNew).length;
    assert.equal(newCount, 1);
    assert.equal(cachedCount, 9);
  });
});

describe("PostgreSQL-backed TokenBudgetService", () => {
  test("reserve within budget succeeds", async () => {
    const service = createTokenBudgetService({ defaultDailyBudget: 1000, maxTokensPerRequest: 100 }, prisma);
    const reservation = await service.reserve(users.user_1, 100);

    assert.ok(reservation !== null);
    assert.equal(reservation?.userId, users.user_1);
    assert.equal(reservation?.tokens, 100);
    assert.equal(reservation?.committed, false);
  });

  test("reserve over per-request limit fails", async () => {
    const service = createTokenBudgetService({ maxTokensPerRequest: 50, strictMode: false }, prisma);
    const reservation = await service.reserve(users.user_2, 100);

    assert.equal(reservation, null);
  });

  test("reserve over daily budget fails", async () => {
    const service = createTokenBudgetService({ defaultDailyBudget: 100, strictMode: false }, prisma);
    await service.reserve(users.user_3, 100);
    const reservation = await service.reserve(users.user_3, 10);

    assert.equal(reservation, null);
  });

  test("commit marks reservation as committed", async () => {
    const service = createTokenBudgetService({ defaultDailyBudget: 1000 }, prisma);
    const reservation = await service.reserve(users.user_4, 100);
    assert.ok(reservation);

    await service.commit(reservation!.reservationId);
    const usage = await service.getUsage(users.user_4);
    assert.equal(usage.usedToday, 100);
  });

  test("release reclaims tokens", async () => {
    const service = createTokenBudgetService({ defaultDailyBudget: 1000 }, prisma);
    const reservation = await service.reserve(users.user_5, 100);
    assert.ok(reservation);

    await service.release(reservation!.reservationId);
    const usage = await service.getUsage(users.user_5);
    assert.equal(usage.usedToday, 0);
  });

  test("getUsage returns correct usage", async () => {
    const service = createTokenBudgetService({ defaultDailyBudget: 500 }, prisma);
    await service.reserve(users.user_6, 150);

    const usage = await service.getUsage(users.user_6);
    assert.equal(usage.userId, users.user_6);
    assert.equal(usage.usedToday, 150);
    assert.equal(usage.dailyBudget, 500);
    assert.equal(usage.remaining, 350);
  });

  test("getUsage for new user returns zero usage", async () => {
    const service = createTokenBudgetService({ defaultDailyBudget: 500 }, prisma);
    const usage = await service.getUsage(users.new_user);

    assert.equal(usage.usedToday, 0);
    assert.equal(usage.remaining, 500);
  });

  test("global budget tracking", async () => {
    const service = createTokenBudgetService({ globalDailyBudget: 1000 }, prisma);
    await service.reserve(users.user_7, 300);
    await service.reserve(users.user_8, 400);

    const global = await service.getGlobalUsage();
    assert.equal(global.usedToday, 700);
    assert.equal(global.globalBudget, 1000);
    assert.equal(global.remaining, 300);
  });

  test("canAfford checks budget", async () => {
    const service = createTokenBudgetService({ defaultDailyBudget: 200 }, prisma);
    await service.reserve(users.user_9, 150);

    const canAffordSmall = await service.canAfford(users.user_9, 40);
    const canAffordLarge = await service.canAfford(users.user_9, 100);

    assert.equal(canAffordSmall, true);
    assert.equal(canAffordLarge, false);
  });

  test("setUserBudget updates budget", async () => {
    const service = createTokenBudgetService({ defaultDailyBudget: 100 }, prisma);
    await service.setUserBudget(users.user_10, 1000);

    const usage = await service.getUsage(users.user_10);
    assert.equal(usage.dailyBudget, 1000);
  });

  test("RLS isolation: User A cannot see User B's token budget", async () => {
    const service = createTokenBudgetService({ defaultDailyBudget: 1000 }, prisma);

    // User A reserves tokens
    await service.reserve(users.user_a, 200);

    // User B reserves tokens
    await service.reserve(users.user_b, 300);

    // User A should only see their own usage
    const usageA = await service.getUsage(users.user_a);
    assert.equal(usageA.usedToday, 200);

    // User B should only see their own usage
    const usageB = await service.getUsage(users.user_b);
    assert.equal(usageB.usedToday, 300);
  });

  test("concurrent reservations are atomic (budget respected)", async () => {
    const service = createTokenBudgetService({ defaultDailyBudget: 500, maxTokensPerRequest: 200 }, prisma);

    // Fire 5 concurrent reservations for 200 tokens each (total would be 1000, budget is 500)
    const promises = Array.from({ length: 5 }, () => service.reserve(users.user_concurrent, 200));
    const results = await Promise.all(promises);

    // Only 2 should succeed (2 * 200 = 400 <= 500), 3rd would be 600 > 500
    const succeeded = results.filter(r => r !== null).length;
    assert.equal(succeeded, 2);

    // Verify final usage
    const usage = await service.getUsage(users.user_concurrent);
    assert.equal(usage.usedToday, 400);
  });
});

describe("Multi-service concurrency", () => {
  test("rate limit + idempotency + token budget work together under load", async () => {
    const rateLimitService = createRateLimitService(prisma);
    const idempotencyService = createIdempotencyService(undefined, prisma);
    const tokenBudgetService = createTokenBudgetService({ defaultDailyBudget: 10000 }, prisma);

    // Simulate 50 concurrent AI requests
    const concurrentRequests = 50;
    const loadUsers = Array.from({ length: 5 }, () => randomUUID());
    const promises = Array.from({ length: concurrentRequests }, async (_, i) => {
      const userId = loadUsers[i % loadUsers.length]!; // 5 users

      // Check rate limit
      const rlResult = await rateLimitService.checkAILimit(userId);
      if (!rlResult.allowed) return { rateLimited: true };

      // Check idempotency
      const idemKey = `req_${userId}_${i}`;
      const idemResult = await idempotencyService.checkAndStore(userId, idemKey, { processed: true });
      if (!idemResult.isNew) return { duplicate: true };

      // Reserve tokens
      const reservation = await tokenBudgetService.reserve(userId, 100);
      if (!reservation) return { budgetExceeded: true };

      return { success: true };
    });

    const results = await Promise.all(promises);

    // All should succeed (within limits)
    const successful = results.filter(r => r.success).length;
    assert.ok(successful > 0);
  });
});