import { test } from "node:test";
import assert from "node:assert/strict";
import { createIdempotencyService, IdempotencyService } from "../idempotency";

test("IdempotencyService - new request returns isNew=true", async () => {
  const service = createIdempotencyService();
  const result = await service.checkAndStore("user_1", "key_1", { data: "response" });
  assert.equal(result.isNew, true);
  assert.equal(result.key, "key_1");
  assert.deepEqual(result.cachedResponse, undefined);
  assert.equal(result.userId, "user_1");
});

test("IdempotencyService - duplicate request with same payload returns cached response", async () => {
  const service = createIdempotencyService();
  await service.checkAndStore("user_1", "key_2", { data: "first" });
  const result = await service.checkAndStore("user_1", "key_2", { data: "first" });

  assert.equal(result.isNew, false);
  assert.deepEqual(result.cachedResponse, { data: "first" });
});

test("IdempotencyService - duplicate request with different payload throws conflict", async () => {
  const service = createIdempotencyService();
  await service.checkAndStore("user_1", "key_3", { data: "first" });

  await assert.rejects(
    () => service.checkAndStore("user_1", "key_3", { data: "second" }),
    /Idempotency key conflict: different payload for same key/
  );
});

test("IdempotencyService - different keys are independent", async () => {
  const service = createIdempotencyService();
  await service.checkAndStore("user_1", "key_a", { data: "a" });
  const result = await service.checkAndStore("user_1", "key_b", { data: "b" });

  assert.equal(result.isNew, true);
});

test("IdempotencyService - get returns cached response", async () => {
  const service = createIdempotencyService();
  await service.checkAndStore("user_1", "key_3", { data: "cached" });
  const cached = await service.get("user_1", "key_3");

  assert.deepEqual(cached, { data: "cached" });
});

test("IdempotencyService - get returns null for unknown key", async () => {
  const service = createIdempotencyService();
  const cached = await service.get("user_1", "unknown_key");
  assert.equal(cached, null);
});

test("IdempotencyService - delete removes key", async () => {
  const service = createIdempotencyService();
  await service.checkAndStore("user_1", "key_4", { data: "to_delete" });
  const deleted = await service.delete("user_1", "key_4");
  const cached = await service.get("user_1", "key_4");

  assert.equal(deleted, true);
  assert.equal(cached, null);
});

test("IdempotencyService - extractKey from headers", () => {
  const key = IdempotencyService.extractKey({ "idempotency-key": "test_key" });
  assert.equal(key, "test_key");
});

test("IdempotencyService - extractKey handles case variations", () => {
  const key = IdempotencyService.extractKey({ "Idempotency-Key": "test_key" });
  assert.equal(key, "test_key");
});

test("IdempotencyService - extractKey returns null when missing", () => {
  const key = IdempotencyService.extractKey({});
  assert.equal(key, null);
});

test("IdempotencyService - generateKey produces valid key", () => {
  const key = IdempotencyService.generateKey();
  assert.equal(key.length, 32); // 16 bytes = 32 hex chars
  assert.ok(/^[a-f0-9]+$/.test(key));
});

test("IdempotencyService - clear removes all keys", async () => {
  const service = createIdempotencyService();
  await service.checkAndStore("user_1", "key_1", { data: "1" });
  await service.checkAndStore("user_1", "key_2", { data: "2" });
  await service.clear();

  assert.equal(await service.get("user_1", "key_1"), null);
  assert.equal(await service.get("user_1", "key_2"), null);
});