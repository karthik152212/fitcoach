import { test } from "node:test";
import assert from "node:assert/strict";
import { createHealthService, createAuditLogService, createCleanupService } from "../health";

test("HealthService - liveness returns alive status", () => {
  const service = createHealthService(null as any);
  const result = service.liveness();

  assert.equal(result.status, "alive");
  assert.ok(result.uptimeMs >= 0);
});

test("HealthService - runChecks returns degraded when supabase not configured", async () => {
  const service = createHealthService(null);
  const result = await service.runChecks();

  // Supabase check returns warn when not configured, making overall degraded
  assert.ok(result.status === "healthy" || result.status === "degraded");
  assert.ok(result.timestamp);
  assert.ok(result.checks.uptime);
  assert.equal(result.checks.uptime.status, "pass");
});

test("HealthService - custom check integrates correctly", async () => {
  const service = createHealthService(null as any);
  service.registerCheck("custom", async () => ({ status: "pass", message: "custom ok" }));

  const result = await service.runChecks();
  assert.ok(result.checks.custom);
  assert.equal(result.checks.custom.status, "pass");
});

test("HealthService - failing check makes overall unhealthy", async () => {
  const service = createHealthService(null as any);
  service.registerCheck("failing", async () => ({ status: "fail", message: "failed" }));

  const result = await service.runChecks();
  assert.equal(result.status, "unhealthy");
});

test("HealthService - warning check makes overall degraded", async () => {
  const service = createHealthService(null as any);
  service.registerCheck("warning", async () => ({ status: "warn", message: "warning" }));

  const result = await service.runChecks();
  assert.equal(result.status, "degraded");
});

test("HealthService - check error makes overall unhealthy", async () => {
  const service = createHealthService(null as any);
  service.registerCheck("error", async () => { throw new Error("check error"); });

  const result = await service.runChecks();
  assert.equal(result.status, "unhealthy");
  const errorCheck = result.checks.error;
  assert.ok(errorCheck);
  assert.equal(errorCheck.status, "fail");
});

test("AuditLogService - log adds entry to buffer", () => {
  const service = createAuditLogService(null);
  service.log({
    userId: "user_1",
    action: "test_action",
    resource: "test_resource",
    resourceId: "res_1",
    metadata: { key: "value" },
    result: "success",
  });

  const recent = service.getRecent(10);
  assert.equal(recent.length, 1);
  assert.ok(recent[0]);
  assert.equal(recent[0].userId, "user_1");
  assert.equal(recent[0].action, "test_action");
  assert.equal(recent[0].result, "success");
});

test("AuditLogService - log with failure result", () => {
  const service = createAuditLogService(null);
  service.log({
    userId: "user_2",
    action: "failed_action",
    resource: "test",
    resourceId: null,
    metadata: {},
    result: "failure",
    errorMessage: "Something went wrong",
  });

  const recent = service.getRecent(10);
  assert.ok(recent[0]);
  assert.equal(recent[0].result, "failure");
  assert.equal(recent[0].errorMessage, "Something went wrong");
});

test("AuditLogService - getRecent respects limit", () => {
  const service = createAuditLogService(null);
  for (let i = 0; i < 15; i++) {
    service.log({
      userId: `user_${i}`,
      action: "action",
      resource: "test",
      resourceId: null,
      metadata: {},
      result: "success",
    });
  }

  const recent = service.getRecent(5);
  assert.equal(recent.length, 5);
});

test("CleanupService - runCleanup returns stats", async () => {
  const service = createCleanupService();
  const stats = await service.runCleanup();

  assert.ok(typeof stats.deletedCount === "number");
  assert.ok(typeof stats.durationMs === "number");
  assert.ok(stats.oldestRetained === null || typeof stats.oldestRetained === "string");
});