/**
 * Health Check and Observability Service.
 *
 * Provides health endpoints for load balancers, readiness/liveness probes,
 * and audit logging for compliance.
 */

import type { Repositories } from "@fitcoach/db";

export interface HealthCheckResult {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  checks: Record<string, HealthCheck>;
}

export interface HealthCheck {
  status: "pass" | "fail" | "warn";
  message?: string;
  durationMs?: number;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  result: "success" | "failure";
  errorMessage?: string;
}

export interface CleanupStats {
  deletedCount: number;
  oldestRetained: string | null;
  durationMs: number;
}

/**
 * Health check service for /healthz, /ready, /live endpoints.
 */
export class HealthService {
  private startTime = Date.now();
  private checks: Map<string, () => Promise<HealthCheck>> = new Map();

  constructor() {
    // Register default checks
    this.registerCheck("uptime", async () => ({
      status: "pass",
      message: `Up ${Math.floor((Date.now() - this.startTime) / 1000)}s`,
    }));
  }

  /**
   * Register a custom health check.
   */
  registerCheck(name: string, check: () => Promise<HealthCheck>): void {
    this.checks.set(name, check);
  }

  /**
   * Run all health checks.
   */
  async runChecks(): Promise<HealthCheckResult> {
    const results: Record<string, HealthCheck> = {};
    let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";

    for (const [name, check] of this.checks.entries()) {
      const start = Date.now();
      try {
        const result = await check();
        result.durationMs = Date.now() - start;
        results[name] = result;

        if (result.status === "fail") {
          overallStatus = "unhealthy";
        } else if (result.status === "warn" && overallStatus === "healthy") {
          overallStatus = "degraded";
        }
      } catch (error) {
        results[name] = {
          status: "fail",
          message: error instanceof Error ? error.message : "Check failed",
          durationMs: Date.now() - start,
        };
        overallStatus = "unhealthy";
      }
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks: results,
    };
  }

  /**
   * Liveness check - always returns healthy if process is running.
   */
  liveness(): { status: "alive"; uptimeMs: number } {
    return {
      status: "alive",
      uptimeMs: Date.now() - this.startTime,
    };
  }
}

/**
 * Audit log service for compliance and debugging.
 * Writes to database in production; logs to console in development.
 */
export class AuditLogService {
  private buffer: AuditLogEntry[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private readonly bufferSize = 100;
  private readonly flushIntervalMs = 5000;

  constructor(
    private readonly repos: Repositories | null,
    private readonly isProduction = process.env.NODE_ENV === "production",
  ) {
    if (!this.isProduction && this.repos) {
      // Periodic flush in development when DB available
      this.flushInterval = setInterval(() => this.flush(), this.flushIntervalMs);
      this.flushInterval.unref();
    }
  }

  /**
   * Log an audit event.
   * Non-blocking - adds to buffer for async persistence.
   */
  log(entry: Omit<AuditLogEntry, "id" | "timestamp">): void {
    const fullEntry: AuditLogEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };

    if (this.isProduction && this.repos) {
      // In production with DB, persist immediately
      this.persist(fullEntry).catch(() => {
        // Fallback to buffer on failure
        this.buffer.push(fullEntry);
      });
    } else {
      // Development: log to console and buffer
      console.log("[AUDIT]", JSON.stringify(fullEntry));
      this.buffer.push(fullEntry);

      // Trim buffer
      if (this.buffer.length > this.bufferSize) {
        this.buffer.shift();
      }
    }
  }

  /**
   * Persist audit entry to database.
   */
  private async persist(_entry: AuditLogEntry): Promise<void> {
    if (!this.repos) return;

    // Note: This would use a dedicated audit log table in production
    // For now, we just ensure the interface exists
    // await this.repos.auditLogs.create(_entry);
  }

  /**
   * Flush buffer to database.
   */
  async flush(): Promise<number> {
    if (!this.repos || this.buffer.length === 0) return 0;

    const toFlush = [...this.buffer];
    this.buffer = [];

    let success = 0;
    for (const entry of toFlush) {
      try {
        await this.persist(entry);
        success++;
      } catch {
        // Re-queue failed entries
        this.buffer.push(entry);
      }
    }

    return success;
  }

  /**
   * Get recent audit entries (for debugging).
   */
  getRecent(limit = 50): AuditLogEntry[] {
    return this.buffer.slice(-limit);
  }

  /**
   * Shutdown - flush remaining buffer.
   */
  shutdown(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush().catch(() => {});
  }
}

/**
 * Data cleanup service for GDPR/retention compliance.
 */
export class CleanupService {
  constructor() {}

  /**
   * Clean up expired data based on retention policies.
   */
  async runCleanup(): Promise<CleanupStats> {
    const start = Date.now();

    // In a real implementation, this would:
    // 1. Delete expired sessions/tokens
    // 2. Anonymize user data after retention period
    // 3. Clean up old audit logs
    // 4. Remove temporary training plans past their expiration

    // For now, return empty stats
    return {
      deletedCount: 0,
      oldestRetained: null,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Schedule periodic cleanup (e.g., daily at 3 AM).
   */
  scheduleCleanup(cronExpression = "0 3 * * *"): void {
    // In production, use a proper scheduler (node-cron, or external)
    // For now, this is a placeholder
    console.log(`Cleanup scheduled: ${cronExpression}`);
  }
}

/**
 * Create health service with database check.
 */
export function createHealthService(repos: Repositories | null = null): HealthService {
  const service = new HealthService();

  // Database connectivity check (only if repos provided)
  if (repos) {
    service.registerCheck("database", async () => {
      try {
        // Simple query to verify DB connectivity
        await repos.users.findById("health-check");
        return { status: "pass", message: "Database connected" };
      } catch {
        return { status: "fail", message: "Database unavailable" };
      }
    });
  }

  // Supabase connectivity check
  service.registerCheck("supabase", async () => {
    try {
      // This would check Supabase connectivity
      // For now, just return pass if configured
      if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return { status: "pass", message: "Supabase configured" };
      }
      return { status: "warn", message: "Supabase not configured" };
    } catch {
      return { status: "fail", message: "Supabase unavailable" };
    }
  });

  // AI provider check
  service.registerCheck("ai_provider", async () => {
    const provider = process.env.AI_PROVIDER ?? "mock";
    if (provider === "mock") {
      return { status: "pass", message: "Mock provider (development)" };
    }
    if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
      return { status: "pass", message: "Anthropic configured" };
    }
    if (provider === "openai" && process.env.OPENAI_API_KEY) {
      return { status: "pass", message: "OpenAI configured" };
    }
    return { status: "warn", message: `${provider} provider not configured` };
  });

  return service;
}

/**
 * Create audit log service.
 */
export function createAuditLogService(repos: Repositories | null = null): AuditLogService {
  return new AuditLogService(repos);
}

/**
 * Create cleanup service.
 */
export function createCleanupService(): CleanupService {
  return new CleanupService();
}