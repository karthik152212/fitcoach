import { test } from "node:test";
import assert from "node:assert/strict";
import { createTokenBudgetService } from "../tokenBudget";

test("TokenBudgetService - reserve within budget succeeds", async () => {
  const service = createTokenBudgetService({ defaultDailyBudget: 1000, maxTokensPerRequest: 100 });
  const reservation = await service.reserve("user_1", 100);

  assert.ok(reservation !== null);
  assert.equal(reservation?.userId, "user_1");
  assert.equal(reservation?.tokens, 100);
  assert.equal(reservation?.committed, false);
});

test("TokenBudgetService - reserve over per-request limit fails", async () => {
  const service = createTokenBudgetService({ maxTokensPerRequest: 50, strictMode: false });
  const reservation = await service.reserve("user_2", 100);

  assert.equal(reservation, null);
});

test("TokenBudgetService - reserve over daily budget fails", async () => {
  const service = createTokenBudgetService({ defaultDailyBudget: 100, strictMode: false });
  await service.reserve("user_3", 100);
  const reservation = await service.reserve("user_3", 10);

  assert.equal(reservation, null);
});

test("TokenBudgetService - commit marks reservation as committed", async () => {
  const service = createTokenBudgetService({ defaultDailyBudget: 1000 });
  const reservation = await service.reserve("user_4", 100);
  assert.ok(reservation);

  await service.commit(reservation!.reservationId);
  // Committed reservations don't affect available budget (already counted)
  const usage = await service.getUsage("user_4");
  assert.equal(usage.usedToday, 100);
});

test("TokenBudgetService - release reclaims tokens", async () => {
  const service = createTokenBudgetService({ defaultDailyBudget: 1000 });
  const reservation = await service.reserve("user_5", 100);
  assert.ok(reservation);

  await service.release(reservation!.reservationId);
  const usage = await service.getUsage("user_5");
  assert.equal(usage.usedToday, 0);
});

test("TokenBudgetService - getUsage returns correct usage", async () => {
  const service = createTokenBudgetService({ defaultDailyBudget: 500 });
  await service.reserve("user_6", 150);

  const usage = await service.getUsage("user_6");
  assert.equal(usage.userId, "user_6");
  assert.equal(usage.usedToday, 150);
  assert.equal(usage.dailyBudget, 500);
  assert.equal(usage.remaining, 350);
});

test("TokenBudgetService - getUsage for new user returns zero usage", async () => {
  const service = createTokenBudgetService({ defaultDailyBudget: 500 });
  const usage = await service.getUsage("new_user");

  assert.equal(usage.usedToday, 0);
  assert.equal(usage.remaining, 500);
});

test("TokenBudgetService - global budget tracking", async () => {
  const service = createTokenBudgetService({ globalDailyBudget: 1000 });
  await service.reserve("user_7", 300);
  await service.reserve("user_8", 400);

  const global = await service.getGlobalUsage();
  assert.equal(global.usedToday, 700);
  assert.equal(global.globalBudget, 1000);
  assert.equal(global.remaining, 300);
});

test("TokenBudgetService - canAfford checks budget", async () => {
  const service = createTokenBudgetService({ defaultDailyBudget: 200 });
  await service.reserve("user_9", 150);

  const canAffordSmall = await service.canAfford("user_9", 40);
  const canAffordLarge = await service.canAfford("user_9", 100);

  assert.equal(canAffordSmall, true);
  assert.equal(canAffordLarge, false);
});

test("TokenBudgetService - setUserBudget updates budget", async () => {
  const service = createTokenBudgetService({ defaultDailyBudget: 100 });
  await service.setUserBudget("user_10", 1000);

  const usage = await service.getUsage("user_10");
  assert.equal(usage.dailyBudget, 1000);
});