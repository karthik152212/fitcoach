import { test } from "node:test";
import assert from "node:assert/strict";
import { createRateLimitService } from "../rateLimit";

test("RateLimitService - allows requests within limit", async () => {
  const service = createRateLimitService();
  const result = await service.checkAILimit("user_1");
  assert.equal(result.allowed, true);
  assert.equal(result.remaining, 29);
});

test("RateLimitService - denies requests over limit", async () => {
  const service = createRateLimitService();
  const limiter = service.getLimiter("test", { maxRequests: 2, windowMs: 60_000, keyPrefix: "test" });

  await limiter.checkLimit("user_2");
  await limiter.checkLimit("user_2");
  const result = await limiter.checkLimit("user_2");

  assert.equal(result.allowed, false);
  assert.equal(result.remaining, 0);
});

test("RateLimitService - separate users have separate limits", async () => {
  const service = createRateLimitService();
  const limiter = service.getLimiter("test2", { maxRequests: 1, windowMs: 60_000, keyPrefix: "test2" });

  await limiter.checkLimit("user_a");
  const resultB = await limiter.checkLimit("user_b");

  assert.equal(resultB.allowed, true);
});

test("RateLimitService - auth limit uses IP", async () => {
  const service = createRateLimitService();
  const result = await service.checkAuthLimit("192.168.1.1");
  assert.equal(result.allowed, true);
  assert.equal(result.remaining, 9);
});

test("RateLimitService - API limit uses userId", async () => {
  const service = createRateLimitService();
  const result = await service.checkAPILimit("user_3");
  assert.equal(result.allowed, true);
  assert.equal(result.remaining, 99);
});

test("RateLimitService - shutdown cleans up", async () => {
  const service = createRateLimitService();
  service.shutdown();
  // Should not throw
  assert.ok(true);
});