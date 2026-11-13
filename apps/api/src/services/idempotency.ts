/**
 * Idempotency Service.
 *
 * Provides request deduplication using idempotency keys.
 * Stores hashed keys with TTL to prevent replay attacks and duplicate processing.
 * PostgreSQL-backed for multi-instance deployments. In-memory fallback for development.
 */

import { randomBytes, createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { withUserTransaction, runDb } from "@fitcoach/db";

export interface IdempotencyConfig {
  /** TTL for idempotency keys in milliseconds. Default: 24 hours. */
  ttlMs: number;
  /** Maximum number of stored keys. Default: 10000. */
  maxKeys: number;
}

export interface IdempotencyResult {
  /** Whether this is a new request (not a duplicate). */
  isNew: boolean;
  /** The cached response if this is a duplicate. */
  cachedResponse?: unknown;
  /** The idempotency key used. */
  key: string;
  /** The user ID this key belongs to. */
  userId?: string;
}

interface IdempotencyEntry {
  keyHash: string;
  response: unknown;
  requestHash: string;
  createdAt: number;
  expiresAt: number;
}

interface IdempotencyKeyRow {
  id: string;
  status: string;
  response: unknown;
  request_hash: string;
}

/**
 * In-memory idempotency store (development/test only).
 * In production, replace with PostgreSQL implementation.
 */
class InMemoryIdempotencyStore {
  private store = new Map<string, IdempotencyEntry>();

  constructor(private readonly config: IdempotencyConfig) {}

  private hashKey(userId: string, key: string): string {
    return createHash("sha256").update(`${userId}:${key}`).digest("hex");
  }

  private hashRequest(payload: unknown): string {
    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt < now) {
        this.store.delete(key);
      }
    }
  }

  async checkAndStore(userId: string, key: string, response: unknown): Promise<IdempotencyResult> {
    this.cleanup();

    // Prevent unbounded memory growth
    if (this.store.size >= this.config.maxKeys) {
      this.cleanup();
      // If still at max, remove oldest
      if (this.store.size >= this.config.maxKeys) {
        const firstKey = this.store.keys().next().value;
        if (firstKey) this.store.delete(firstKey);
      }
    }

    const keyHash = this.hashKey(userId, key);
    const requestHash = this.hashRequest(response);
    const existing = this.store.get(keyHash);

    if (existing) {
      // Verify request hash matches (prevent different payload with same key)
      if (existing.requestHash && existing.requestHash !== requestHash) {
        throw new Error("Idempotency key conflict: different payload for same key");
      }
      // Duplicate request — return cached response
      return {
        isNew: false,
        cachedResponse: existing.response,
        key,
        userId,
      };
    }

    // New request — store the response
    const now = Date.now();
    this.store.set(keyHash, {
      keyHash,
      response,
      requestHash,
      createdAt: now,
      expiresAt: now + this.config.ttlMs,
    });

    return {
      isNew: true,
      key,
      userId,
    };
  }

  async get(userId: string, key: string): Promise<unknown | null> {
    this.cleanup();
    const keyHash = this.hashKey(userId, key);
    const entry = this.store.get(keyHash);
    return entry?.response ?? null;
  }

  async delete(userId: string, key: string): Promise<boolean> {
    const keyHash = this.hashKey(userId, key);
    return this.store.delete(keyHash);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

/**
 * PostgreSQL-backed idempotency store.
 * Atomic operations safe for multi-instance deployments.
 */
class PostgresIdempotencyStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: IdempotencyConfig,
  ) {}

  private hashKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }

  private hashRequest(payload: unknown): string {
    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }

  async checkAndStore(userId: string, key: string, response: unknown): Promise<IdempotencyResult> {
    const keyHash = this.hashKey(key);
    const requestHash = this.hashRequest(response);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.ttlMs);

    try {
      return await withUserTransaction(this.prisma, userId, async (tx) => {
        // Try to insert new key atomically with PENDING status
        const result = await tx.$queryRaw<IdempotencyKeyRow[]>`
          INSERT INTO "idempotency_keys" ("user_id", "key_hash", "request_hash", "status", "response", "expires_at", "created_at", "updated_at")
          VALUES (${userId}::uuid, ${keyHash}, ${requestHash}, 'PENDING', NULL, ${expiresAt}, ${now}, ${now})
          ON CONFLICT ("user_id", "key_hash") DO UPDATE SET
            "status" = CASE
              WHEN "idempotency_keys"."status" = 'PENDING' THEN 'PENDING'
              ELSE "idempotency_keys"."status"
            END,
            "request_hash" = "idempotency_keys"."request_hash",
            "updated_at" = ${now}
          RETURNING "id", "status", "response", "request_hash";
        `;

        const row = result[0];
        if (!row) {
          throw new Error("Idempotency upsert returned no row");
        }

        // If existing COMPLETED with matching request_hash, return cached response
        if (row.status === 'COMPLETED' && row.response !== null && row.response !== undefined) {
          if (row.request_hash !== requestHash) {
            throw new Error("Idempotency key conflict: different payload for same key");
          }
          return {
            isNew: false,
            cachedResponse: row.response,
            key,
            userId,
          };
        }

        // If existing PENDING (in-progress), fail-closed: reject duplicate
        if (row.status === 'PENDING') {
          throw new Error("Idempotency key already in progress");
        }

        // New PENDING request - now update with response and mark COMPLETED
        const updateResult = await tx.$queryRaw<IdempotencyKeyRow[]>`
          UPDATE "idempotency_keys"
          SET "status" = 'COMPLETED', "response" = ${response}, "updated_at" = ${now}
          WHERE "user_id" = ${userId}::uuid AND "key_hash" = ${keyHash}
          AND "status" = 'PENDING'
          RETURNING "id", "status", "response";
        `;

        const updated = updateResult[0];
        if (!updated) {
          throw new Error("Failed to commit idempotency key");
        }

        return {
          isNew: true,
          key,
          userId,
        };
      });
    } catch (error) {
      // Fail-closed: on any error, deny to prevent duplicate processing
      console.error("[Idempotency] checkAndStore failed:", error);
      throw error;
    }
  }

  async get(userId: string, key: string): Promise<unknown | null> {
    const keyHash = this.hashKey(key);

    try {
      return await withUserTransaction(this.prisma, userId, async (tx) => {
        const result = await tx.$queryRaw<{ response: unknown }[]>`
          SELECT "response" FROM "idempotency_keys"
          WHERE "user_id" = ${userId}::uuid AND "key_hash" = ${keyHash}
          AND "expires_at" > ${new Date()}
          AND "status" = 'COMPLETED'
          LIMIT 1
        `;
        return result[0]?.response ?? null;
      });
    } catch {
      return null;
    }
  }

  async delete(userId: string, key: string): Promise<boolean> {
    const keyHash = this.hashKey(key);

    try {
      const result = await runDb(() =>
        this.prisma.$executeRaw`DELETE FROM "idempotency_keys" WHERE "user_id" = ${userId}::uuid AND "key_hash" = ${keyHash}`,
      );
      return Number(result) > 0;
    } catch {
      return false;
    }
  }

  async clear(): Promise<void> {
    // Clear is not user-scoped in PG - would need admin context
    // This is mainly for testing
    try {
      await runDb(() =>
        this.prisma.$executeRaw`DELETE FROM "idempotency_keys"`,
      );
    } catch {
      // Ignore
    }
  }

  /** Clean up expired keys (run periodically). */
  async cleanup(): Promise<number> {
    const now = new Date();
    const result = await runDb(() =>
      this.prisma.$executeRaw`DELETE FROM "idempotency_keys" WHERE "expires_at" < ${now}`,
    );
    return Number(result);
  }
}

/**
 * Idempotency service for request deduplication.
 */
export class IdempotencyService {
  private store: InMemoryIdempotencyStore | PostgresIdempotencyStore;

  constructor(
    config: Partial<IdempotencyConfig> = {},
    prisma?: PrismaClient,
  ) {
    const fullConfig = {
      ttlMs: config.ttlMs ?? 24 * 60 * 60 * 1000, // 24 hours
      maxKeys: config.maxKeys ?? 10000,
    };

    if (prisma) {
      this.store = new PostgresIdempotencyStore(prisma, fullConfig);
    } else {
      this.store = new InMemoryIdempotencyStore(fullConfig);
    }
  }

  /**
   * Extract idempotency key from request headers.
   * Standard header: Idempotency-Key
   */
  static extractKey(headers: Record<string, string | string[] | undefined>): string | null {
    const key = headers["idempotency-key"] ?? headers["Idempotency-Key"];
    if (Array.isArray(key)) return key[0] ?? null;
    return key ?? null;
  }

  /**
   * Generate a new idempotency key (for testing or client-side generation).
   */
  static generateKey(): string {
    return randomBytes(16).toString("hex");
  }

  /**
   * Check if request is new and store response.
   * Returns cached response if duplicate.
   * Throws on idempotency key conflict or in-progress duplicate.
   */
  async checkAndStore(userId: string, key: string, response: unknown): Promise<IdempotencyResult> {
    return this.store.checkAndStore(userId, key, response);
  }

  /**
   * Get cached response for a key without storing.
   */
  async get(userId: string, key: string): Promise<unknown | null> {
    return this.store.get(userId, key);
  }

  /**
   * Delete a key (e.g., after successful processing with different outcome).
   */
  async delete(userId: string, key: string): Promise<boolean> {
    return this.store.delete(userId, key);
  }

  /**
   * Clear all keys (for testing).
   */
  async clear(): Promise<void> {
    return this.store.clear();
  }
}

/**
 * Create an idempotency service instance.
 * Pass PrismaClient for production PostgreSQL-backed idempotency.
 */
export function createIdempotencyService(
  config?: Partial<IdempotencyConfig>,
  prisma?: PrismaClient,
): IdempotencyService {
  return new IdempotencyService(config, prisma);
}