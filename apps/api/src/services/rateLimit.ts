/**
 * Rate Limiting Service.
 *
 * Implements token-bucket rate limiting with PostgreSQL-backed storage
 * for multi-instance deployments. In-memory fallback for development.
 * Fail-closed for AI endpoints — if rate limit check fails, request is denied.
 */

import type { PrismaClient } from "@prisma/client";
import { runDb, type TransactionClient } from "@fitcoach/db";

export interface RateLimitConfig {
  /** Maximum requests allowed in the window. */
  maxRequests: number;
  /** Window size in milliseconds. */
  windowMs: number;
  /** Unique identifier for this rate limit bucket. */
  keyPrefix: string;
}

export interface RateLimitResult {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Remaining requests in current window. */
  remaining: number;
  /** Unix timestamp (ms) when the window resets. */
  resetAt: number;
  /** Seconds until reset (for Retry-After header). */
  retryAfterSeconds: number;
}

/**
 * In-memory token bucket store (development/test only).
 * In production, replace with PostgreSQL implementation.
 */
interface BucketState {
  tokens: number;
  lastRefill: number;
}

class InMemoryRateLimiter {
  private buckets = new Map<string, BucketState>();

  constructor(
    private readonly config: RateLimitConfig,
    private readonly maxTokenBuckets = 10000,
  ) {}

  private getBucketKey(identifier: string): string {
    return `${this.config.keyPrefix}:${identifier}`;
  }

  private refill(bucket: BucketState, now: number): number {
    const elapsed = now - bucket.lastRefill;
    const refillAmount = (elapsed / this.config.windowMs) * this.config.maxRequests;
    bucket.tokens = Math.min(this.config.maxRequests, bucket.tokens + refillAmount);
    bucket.lastRefill = now;
    return bucket.tokens;
  }

  async checkLimit(identifier: string): Promise<RateLimitResult> {
    const now = Date.now();
    const key = this.getBucketKey(identifier);

    // Prevent unbounded memory growth
    if (this.buckets.size >= this.maxTokenBuckets && !this.buckets.has(key)) {
      // Evict oldest bucket (simple LRU approximation)
      const firstKey = this.buckets.keys().next().value;
      if (firstKey) this.buckets.delete(firstKey);
    }

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.config.maxRequests, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    const tokens = this.refill(bucket, now);
    const allowed = tokens >= 1;

    if (allowed) {
      bucket.tokens -= 1;
    }

    const resetAt = bucket.lastRefill + this.config.windowMs;
    const retryAfterSeconds = Math.ceil((resetAt - now) / 1000);

    return {
      allowed,
      remaining: Math.max(0, Math.floor(bucket.tokens)),
      resetAt,
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
    };
  }

  async reset(identifier: string): Promise<void> {
    this.buckets.delete(this.getBucketKey(identifier));
  }

  /** Clean up expired buckets periodically. */
  cleanup(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets.entries()) {
      if (now - bucket.lastRefill > this.config.windowMs * 2) {
        this.buckets.delete(key);
      }
    }
  }
}

interface RateLimitBucketRow {
  id: string;
  tokens: number;
  window_start: Date;
}

/**
 * PostgreSQL-backed token bucket rate limiter.
 * Atomic operations safe for multi-instance deployments.
 */
class PostgresRateLimiter {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: RateLimitConfig,
  ) {}

  private async refillAndCheck(
    tx: TransactionClient,
    keyPrefix: string,
    identifier: string,
    maxRequests: number,
    windowMs: number,
    now: Date,
  ): Promise<RateLimitResult> {
    const windowStart = new Date(now.getTime() - windowMs);

    // Upsert bucket atomically
    const bucket = await tx.$queryRaw<RateLimitBucketRow[]>`
      INSERT INTO "rate_limit_buckets" ("key_prefix", "identifier", "tokens", "window_start", "updated_at")
      VALUES (${keyPrefix}, ${identifier}, ${maxRequests}, ${now}, ${now})
      ON CONFLICT ("key_prefix", "identifier") DO UPDATE SET
        "tokens" = CASE
          WHEN "rate_limit_buckets"."window_start" < ${windowStart}
          THEN ${maxRequests}
          ELSE GREATEST("rate_limit_buckets"."tokens" - 1, 0)
        END,
        "window_start" = CASE
          WHEN "rate_limit_buckets"."window_start" < ${windowStart}
          THEN ${now}
          ELSE "rate_limit_buckets"."window_start"
        END,
        "updated_at" = ${now}
      RETURNING "id", "tokens", "window_start";
    `;

    const b = bucket[0];
    if (!b) {
      throw new Error("Rate limit bucket upsert returned no row");
    }
    const tokens = b.tokens;
    const allowed = tokens > 0;
    const resetAt = b.window_start.getTime() + windowMs;
    const retryAfterSeconds = Math.ceil((resetAt - now.getTime()) / 1000);

    return {
      allowed,
      remaining: Math.max(0, tokens - (allowed ? 1 : 0)),
      resetAt,
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
    };
  }

  async checkLimit(identifier: string): Promise<RateLimitResult> {
    const now = new Date();
    const { maxRequests, windowMs, keyPrefix } = this.config;

    try {
      return await this.prisma.$transaction(async (tx) => {
        return this.refillAndCheck(tx, keyPrefix, identifier, maxRequests, windowMs, now);
      });
    } catch (error) {
      // Fail-closed: deny on any error
      return {
        allowed: false,
        remaining: 0,
        resetAt: now.getTime() + windowMs,
        retryAfterSeconds: Math.ceil(windowMs / 1000),
      };
    }
  }

  async reset(identifier: string): Promise<void> {
    await runDb(() =>
      this.prisma.$executeRaw`DELETE FROM "rate_limit_buckets" WHERE "key_prefix" = ${this.config.keyPrefix} AND "identifier" = ${identifier}`,
    );
  }

  /** Clean up expired buckets (run periodically). */
  async cleanup(): Promise<number> {
    const cutoff = new Date(Date.now() - this.config.windowMs * 2);
    const result = await runDb(() =>
      this.prisma.$executeRaw`DELETE FROM "rate_limit_buckets" WHERE "window_start" < ${cutoff}`,
    );
    return Number(result);
  }
}

/**
 * Rate limiter service with configurable limits per endpoint type.
 */
export class RateLimitService {
  private limiters: Map<string, InMemoryRateLimiter | PostgresRateLimiter> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private readonly usePostgres: boolean;
  private readonly prisma?: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.usePostgres = !!prisma;
    this.prisma = prisma;

    // Start periodic cleanup - use unref so it doesn't keep process alive
    this.cleanupInterval = setInterval(() => {
      for (const limiter of this.limiters.values()) {
        if (limiter instanceof PostgresRateLimiter) {
          limiter.cleanup().catch(() => {});
        } else {
          limiter.cleanup();
        }
      }
    }, 60_000); // Every minute
    this.cleanupInterval.unref();
  }

  /**
   * Get or create a rate limiter for a specific endpoint type.
   */
  getLimiter(name: string, config: RateLimitConfig): InMemoryRateLimiter | PostgresRateLimiter {
    let limiter = this.limiters.get(name);
    if (!limiter) {
      if (this.usePostgres && this.prisma) {
        limiter = new PostgresRateLimiter(this.prisma, config);
      } else {
        limiter = new InMemoryRateLimiter(config);
      }
      this.limiters.set(name, limiter);
    }
    return limiter;
  }

  /**
   * Check rate limit for an AI request.
   * Fail-closed: if check fails, deny the request.
   */
  async checkAILimit(userId: string): Promise<RateLimitResult> {
    const limiter = this.getLimiter("ai", {
      maxRequests: 30, // 30 requests
      windowMs: 60_000, // per minute
      keyPrefix: "ai",
    });

    try {
      return await limiter.checkLimit(userId);
    } catch {
      // Fail-closed: deny on any error
      return {
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 60_000,
        retryAfterSeconds: 60,
      };
    }
  }

  /**
   * Check rate limit for auth endpoints (signup, signin).
   */
  async checkAuthLimit(ip: string): Promise<RateLimitResult> {
    const limiter = this.getLimiter("auth", {
      maxRequests: 10, // 10 requests
      windowMs: 60_000, // per minute
      keyPrefix: "auth",
    });

    return limiter.checkLimit(ip);
  }

  /**
   * Check rate limit for general API endpoints.
   */
  async checkAPILimit(userId: string): Promise<RateLimitResult> {
    const limiter = this.getLimiter("api", {
      maxRequests: 100, // 100 requests
      windowMs: 60_000, // per minute
      keyPrefix: "api",
    });

    return limiter.checkLimit(userId);
  }

  /**
   * Shutdown the service (cleanup intervals).
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.limiters.clear();
  }
}

/**
 * Create a rate limit service instance.
 * Pass PrismaClient for production PostgreSQL-backed rate limiting.
 */
export function createRateLimitService(prisma?: PrismaClient): RateLimitService {
  return new RateLimitService(prisma);
}