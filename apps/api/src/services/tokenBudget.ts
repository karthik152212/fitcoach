/**
 * Token Budget Service.
 *
 * Manages AI token budgets with atomic reservations and lease reclamation.
 * Prevents runaway token consumption by enforcing per-user and global limits.
 * PostgreSQL-backed for multi-instance deployments. In-memory fallback for development.
 */

import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { withUserTransaction, runDb } from "@fitcoach/db";

export interface TokenBudgetConfig {
  /** Default daily token budget per user. */
  defaultDailyBudget: number;
  /** Maximum tokens allowed in a single request. */
  maxTokensPerRequest: number;
  /** Global daily token budget across all users. */
  globalDailyBudget: number;
  /** Lease duration in milliseconds (for reservation). */
  leaseDurationMs: number;
  /** Whether to enforce budgets strictly (fail-closed). */
  strictMode: boolean;
}

export interface TokenReservation {
  /** Unique reservation ID. */
  reservationId: string;
  /** User ID. */
  userId: string;
  /** Number of tokens reserved. */
  tokens: number;
  /** Unix timestamp (ms) when reservation expires. */
  expiresAt: number;
  /** Whether this reservation has been committed. */
  committed: boolean;
}

export interface TokenUsage {
  /** User ID. */
  userId: string;
  /** Tokens used today. */
  usedToday: number;
  /** Daily budget. */
  dailyBudget: number;
  /** Remaining budget. */
  remaining: number;
  /** Unix timestamp (ms) when budget resets. */
  resetsAt: number;
}

export interface GlobalTokenUsage {
  /** Tokens used globally today. */
  usedToday: number;
  /** Global daily budget. */
  globalBudget: number;
  /** Remaining global budget. */
  remaining: number;
  /** Unix timestamp (ms) when budget resets. */
  resetsAt: number;
}

interface UserBudgetState {
  userId: string;
  usedToday: number;
  budget: number;
  lastReset: number;
  activeReservations: Map<string, TokenReservation>;
}

interface TokenBudgetRow {
  id: string;
  daily_budget: number;
  used_today: number;
  day_start: Date;
}

interface GlobalBudgetRow {
  used_today: number;
}

interface TokenReservationRow {
  id: string;
  user_id: string;
  tokens: number;
  status: string;
}

/**
 * In-memory token budget store (development/test only).
 * In production, replace with PostgreSQL with atomic operations for multi-instance deployments.
 */
class InMemoryTokenBudgetStore {
  private users = new Map<string, UserBudgetState>();
  private globalUsed = 0;
  private globalLastReset = Date.now();

  constructor(private readonly config: TokenBudgetConfig) {}

  private getDayStart(ts: number): number {
    const d = new Date(ts);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }

  private ensureUser(userId: string, now: number): UserBudgetState {
    let state = this.users.get(userId);
    const dayStart = this.getDayStart(now);

    if (!state || state.lastReset < dayStart) {
      // New day — reset usage
      state = {
        userId,
        usedToday: 0,
        budget: this.config.defaultDailyBudget,
        lastReset: dayStart,
        activeReservations: new Map(),
      };
      this.users.set(userId, state);
    }

    return state;
  }

  private ensureGlobalReset(now: number): void {
    const dayStart = this.getDayStart(now);
    if (this.globalLastReset < dayStart) {
      this.globalUsed = 0;
      this.globalLastReset = dayStart;
    }
  }

  private cleanupExpiredReservations(state: UserBudgetState, now: number): void {
    for (const [id, reservation] of state.activeReservations.entries()) {
      if (reservation.expiresAt < now && !reservation.committed) {
        // Expired uncommitted reservation — reclaim tokens
        state.usedToday = Math.max(0, state.usedToday - reservation.tokens);
        this.globalUsed = Math.max(0, this.globalUsed - reservation.tokens);
        state.activeReservations.delete(id);
      }
    }
  }

  /**
   * Reserve tokens for a request.
   * Returns reservation ID if successful, null if budget exceeded.
   */
  async reserveTokens(userId: string, tokens: number): Promise<TokenReservation | null> {
    const now = Date.now();

    if (tokens > this.config.maxTokensPerRequest) {
      return null;
    }

    this.ensureGlobalReset(now);
    const state = this.ensureUser(userId, now);
    this.cleanupExpiredReservations(state, now);

    // Check user budget
    const availableUser = state.budget - state.usedToday;
    if (tokens > availableUser) {
      return null;
    }

    // Check global budget
    const availableGlobal = this.config.globalDailyBudget - this.globalUsed;
    if (tokens > availableGlobal) {
      return null;
    }

    // Create reservation with UUID
    const reservationId = randomUUID();
    const expiresAt = now + this.config.leaseDurationMs;

    const reservation: TokenReservation = {
      reservationId,
      userId,
      tokens,
      expiresAt,
      committed: false,
    };

    state.activeReservations.set(reservationId, reservation);
    state.usedToday += tokens;
    this.globalUsed += tokens;

    return reservation;
  }

  /**
   * Commit a reservation (mark as used permanently).
   * Called after successful AI request.
   */
  async commitReservation(reservationId: string): Promise<boolean> {
    for (const state of this.users.values()) {
      const reservation = state.activeReservations.get(reservationId);
      if (reservation) {
        reservation.committed = true;
        // Keep in map for audit, but don't count against available budget
        // (already counted at reservation time)
        return true;
      }
    }
    return false;
  }

  /**
   * Release a reservation (reclaim tokens).
   * Called when request fails or is cancelled.
   */
  async releaseReservation(reservationId: string): Promise<boolean> {
    for (const state of this.users.values()) {
      const reservation = state.activeReservations.get(reservationId);
      if (reservation && !reservation.committed) {
        state.usedToday = Math.max(0, state.usedToday - reservation.tokens);
        this.globalUsed = Math.max(0, this.globalUsed - reservation.tokens);
        state.activeReservations.delete(reservationId);
        return true;
      }
    }
    return false;
  }

  /**
   * Get current token usage for a user.
   */
  async getUsage(userId: string): Promise<TokenUsage> {
    const now = Date.now();
    const dayStart = this.getDayStart(now);
    const resetsAt = dayStart + 24 * 60 * 60 * 1000;

    const state = this.users.get(userId);
    if (!state || state.lastReset < dayStart) {
      return {
        userId,
        usedToday: 0,
        dailyBudget: this.config.defaultDailyBudget,
        remaining: this.config.defaultDailyBudget,
        resetsAt,
      };
    }

    return {
      userId,
      usedToday: state.usedToday,
      dailyBudget: state.budget,
      remaining: Math.max(0, state.budget - state.usedToday),
      resetsAt,
    };
  }

  /**
   * Get global token usage.
   */
  async getGlobalUsage(): Promise<GlobalTokenUsage> {
    const now = Date.now();
    const dayStart = this.getDayStart(now);
    const resetsAt = dayStart + 24 * 60 * 60 * 1000;

    this.ensureGlobalReset(now);

    return {
      usedToday: this.globalUsed,
      globalBudget: this.config.globalDailyBudget,
      remaining: Math.max(0, this.config.globalDailyBudget - this.globalUsed),
      resetsAt,
    };
  }

  /**
   * Set custom budget for a user (admin operation).
   */
  async setUserBudget(userId: string, budget: number): Promise<void> {
    const now = Date.now();
    const state = this.ensureUser(userId, now);
    state.budget = budget;
  }

  /**
   * Check if user has enough budget for tokens (without reserving).
   */
  async canAfford(userId: string, tokens: number): Promise<boolean> {
    const now = Date.now();
    this.ensureGlobalReset(now);
    const state = this.ensureUser(userId, now);
    this.cleanupExpiredReservations(state, now);

    const availableUser = state.budget - state.usedToday;
    const availableGlobal = this.config.globalDailyBudget - this.globalUsed;

    return tokens <= availableUser && tokens <= availableGlobal;
  }

  /**
   * Reconcile token usage with committed reservations.
   * Fixes drift between used_today and sum of committed reservations.
   */
  async reconcile(): Promise<number> {
    const now = Date.now();
    const dayStart = this.getDayStart(now);

    // Reset all users' usedToday to sum of committed reservations
    let reconciledCount = 0;
    for (const [_userId, state] of this.users.entries()) {
      if (state.lastReset < dayStart) continue;
      let totalCommitted = 0;
      for (const res of state.activeReservations.values()) {
        if (res.committed) {
          totalCommitted += res.tokens;
        }
      }
      if (state.usedToday !== totalCommitted) {
        state.usedToday = totalCommitted;
        reconciledCount++;
      }
    }

    // Reconcile global
    let globalCommitted = 0;
    for (const state of this.users.values()) {
      for (const res of state.activeReservations.values()) {
        if (res.committed) {
          globalCommitted += res.tokens;
        }
      }
    }
    if (this.globalUsed !== globalCommitted) {
      this.globalUsed = globalCommitted;
      reconciledCount++;
    }

    return reconciledCount;
  }
}

/**
 * PostgreSQL-backed token budget store.
 * Atomic operations safe for multi-instance deployments.
 */
class PostgresTokenBudgetStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: TokenBudgetConfig,
  ) {}

  private getDayStart(ts: Date): Date {
    const d = new Date(ts);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  /**
   * Reserve tokens for a request.
   * Returns reservation or null if budget exceeded.
   */
  async reserveTokens(userId: string, tokens: number): Promise<TokenReservation | null> {
    const now = new Date();
    const dayStart = this.getDayStart(now);
    const expiresAt = new Date(now.getTime() + this.config.leaseDurationMs);

    if (tokens > this.config.maxTokensPerRequest) {
      return null;
    }

    try {
      return await withUserTransaction(this.prisma, userId, async (tx) => {
        // Ensure user budget exists and is current
        const budget = await tx.$queryRaw<TokenBudgetRow[]>`
          INSERT INTO "token_budgets" ("user_id", "daily_budget", "used_today", "day_start", "updated_at")
          VALUES (${userId}::uuid, ${this.config.defaultDailyBudget}, 0, ${dayStart}, ${now})
          ON CONFLICT ("user_id") DO UPDATE SET
            "used_today" = CASE
              WHEN "token_budgets"."day_start" < ${dayStart} THEN 0
              ELSE "token_budgets"."used_today"
            END,
            "day_start" = CASE
              WHEN "token_budgets"."day_start" < ${dayStart} THEN ${dayStart}
              ELSE "token_budgets"."day_start"
            END,
            "updated_at" = ${now}
          RETURNING "id", "daily_budget", "used_today", "day_start";
        `;

        const b = budget[0];
        if (!b) {
          throw new Error("Token budget upsert returned no row");
        }
        const availableUser = b.daily_budget - b.used_today;
        if (tokens > availableUser) {
          return null;
        }

        // Check global budget
        const global = await tx.$queryRaw<GlobalBudgetRow[]>`
          INSERT INTO "global_token_budget" ("id", "used_today", "day_start", "updated_at")
          VALUES ('global', 0, ${dayStart}, ${now})
          ON CONFLICT ("id") DO UPDATE SET
            "used_today" = CASE
              WHEN "global_token_budget"."day_start" < ${dayStart} THEN 0
              ELSE "global_token_budget"."used_today"
            END,
            "day_start" = CASE
              WHEN "global_token_budget"."day_start" < ${dayStart} THEN ${dayStart}
              ELSE "global_token_budget"."day_start"
            END,
            "updated_at" = ${now}
          RETURNING "used_today";
        `;

        const availableGlobal = this.config.globalDailyBudget - Number(global[0]?.used_today ?? 0);
        if (tokens > availableGlobal) {
          return null;
        }

        // Create reservation with UUID
        const reservationId = randomUUID();

        await tx.$executeRaw`
          INSERT INTO "token_reservations" ("id", "user_id", "tokens", "status", "expires_at", "created_at", "updated_at")
          VALUES (${reservationId}, ${userId}::uuid, ${tokens}, 'ACTIVE', ${expiresAt}, ${now}, ${now})
        `;

        // Atomically increment used_today
        await tx.$executeRaw`
          UPDATE "token_budgets" SET "used_today" = "used_today" + ${tokens}, "updated_at" = ${now}
          WHERE "user_id" = ${userId}::uuid
        `;
        await tx.$executeRaw`
          UPDATE "global_token_budget" SET "used_today" = "used_today" + ${tokens}, "updated_at" = ${now}
          WHERE "id" = 'global'
        `;

        return {
          reservationId,
          userId,
          tokens,
          expiresAt: expiresAt.getTime(),
          committed: false,
        };
      });
    } catch (error) {
      // Fail-closed: deny on any error if strict mode
      console.error("[TokenBudget] reserveTokens failed:", error);
      return null;
    }
  }

  /**
   * Commit a reservation with actual provider usage.
   * Reconciles reserved vs actual tokens.
   */
  async commitReservation(reservationId: string, actualUsage?: number): Promise<boolean> {
    const now = new Date();

    try {
      const result = await runDb(() =>
        this.prisma.$queryRaw<TokenReservationRow[]>`
          UPDATE "token_reservations"
          SET "status" = 'COMMITTED',
              "provider_usage" = ${actualUsage ?? null},
              "updated_at" = ${now}
          WHERE "id" = ${reservationId}
          AND "status" = 'ACTIVE'
          RETURNING "id", "user_id", "tokens", "status";
        `,
      );

      if (result.length === 0 || !result[0]) return false;

      const res = result[0];
      const { user_id, tokens } = res;
      const actualTokens = actualUsage ?? tokens;

      // If actual usage differs from reserved, reconcile
      if (actualUsage !== undefined && actualUsage !== tokens) {
        const diff = actualTokens - tokens;
        if (diff > 0) {
          // Charge additional tokens
          await runDb(() =>
            this.prisma.$executeRaw`
              UPDATE "token_budgets" SET "used_today" = "used_today" + ${diff}, "updated_at" = ${now}
              WHERE "user_id" = ${user_id}::uuid
            `,
          );
          await runDb(() =>
            this.prisma.$executeRaw`
              UPDATE "global_token_budget" SET "used_today" = "used_today" + ${diff}, "updated_at" = ${now}
              WHERE "id" = 'global'
            `,
          );
        } else if (diff < 0) {
          // Refund unused tokens
          await runDb(() =>
            this.prisma.$executeRaw`
              UPDATE "token_budgets" SET "used_today" = GREATEST("used_today" + ${diff}, 0), "updated_at" = ${now}
              WHERE "user_id" = ${user_id}::uuid
            `,
          );
          await runDb(() =>
            this.prisma.$executeRaw`
              UPDATE "global_token_budget" SET "used_today" = GREATEST("used_today" + ${diff}, 0), "updated_at" = ${now}
              WHERE "id" = 'global'
            `,
          );
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Release a reservation (reclaim tokens).
   */
  async releaseReservation(reservationId: string): Promise<boolean> {
    const now = new Date();

    try {
      const result = await runDb(() =>
        this.prisma.$queryRaw<{ user_id: string; tokens: number }[]>`
          UPDATE "token_reservations"
          SET "status" = 'RELEASED',
              "updated_at" = ${now}
          WHERE "id" = ${reservationId}
          AND "status" = 'ACTIVE'
          RETURNING "user_id", "tokens";
        `,
      );

      if (result.length === 0 || !result[0]) return false;

      const { user_id, tokens } = result[0];

      // Reclaim tokens
      await runDb(() =>
        this.prisma.$executeRaw`
          UPDATE "token_budgets" SET "used_today" = GREATEST("used_today" - ${tokens}, 0), "updated_at" = ${now}
          WHERE "user_id" = ${user_id}::uuid
        `,
      );
      await runDb(() =>
        this.prisma.$executeRaw`
          UPDATE "global_token_budget" SET "used_today" = GREATEST("used_today" - ${tokens}, 0), "updated_at" = ${now}
          WHERE "id" = 'global'
        `,
      );

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current token usage for a user.
   */
  async getUsage(userId: string): Promise<TokenUsage> {
    const now = new Date();
    const dayStart = this.getDayStart(now);
    const resetsAt = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    try {
      const result = await runDb(() =>
        this.prisma.$queryRaw<TokenBudgetRow[]>`
          SELECT "daily_budget", "used_today" FROM "token_budgets"
          WHERE "user_id" = ${userId}::uuid
          AND "day_start" = ${dayStart}
        `,
      );

      if (result.length === 0 || !result[0]) {
        return {
          userId,
          usedToday: 0,
          dailyBudget: this.config.defaultDailyBudget,
          remaining: this.config.defaultDailyBudget,
          resetsAt: resetsAt.getTime(),
        };
      }

      const { daily_budget, used_today } = result[0];
      return {
        userId,
        usedToday: used_today,
        dailyBudget: daily_budget,
        remaining: Math.max(0, daily_budget - used_today),
        resetsAt: resetsAt.getTime(),
      };
    } catch {
      return {
        userId,
        usedToday: 0,
        dailyBudget: this.config.defaultDailyBudget,
        remaining: this.config.defaultDailyBudget,
        resetsAt: resetsAt.getTime(),
      };
    }
  }

  /**
   * Get global token usage.
   */
  async getGlobalUsage(): Promise<GlobalTokenUsage> {
    const now = new Date();
    const dayStart = this.getDayStart(now);
    const resetsAt = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    try {
      const result = await runDb(() =>
        this.prisma.$queryRaw<GlobalBudgetRow[]>`
          SELECT "used_today" FROM "global_token_budget"
          WHERE "id" = 'global'
          AND "day_start" = ${dayStart}
        `,
      );

      const usedToday = Number(result[0]?.used_today ?? 0);
      return {
        usedToday,
        globalBudget: this.config.globalDailyBudget,
        remaining: Math.max(0, this.config.globalDailyBudget - usedToday),
        resetsAt: resetsAt.getTime(),
      };
    } catch {
      return {
        usedToday: 0,
        globalBudget: this.config.globalDailyBudget,
        remaining: this.config.globalDailyBudget,
        resetsAt: resetsAt.getTime(),
      };
    }
  }

  /**
   * Set custom budget for a user (admin operation).
   */
  async setUserBudget(userId: string, budget: number): Promise<void> {
    const now = new Date();
    const dayStart = this.getDayStart(now);

    await runDb(() =>
      this.prisma.$executeRaw`
        INSERT INTO "token_budgets" ("user_id", "daily_budget", "used_today", "day_start", "updated_at")
        VALUES (${userId}::uuid, ${budget}, 0, ${dayStart}, ${now})
        ON CONFLICT ("user_id") DO UPDATE SET
          "daily_budget" = ${budget},
          "updated_at" = ${now}
      `,
    );
  }

  /**
   * Check if user has enough budget for tokens (without reserving).
   */
  async canAfford(userId: string, tokens: number): Promise<boolean> {
    const now = new Date();
    const dayStart = this.getDayStart(now);

    try {
      const budget = await runDb(() =>
        this.prisma.$queryRaw<TokenBudgetRow[]>`
          SELECT "daily_budget", "used_today" FROM "token_budgets"
          WHERE "user_id" = ${userId}::uuid
          AND "day_start" = ${dayStart}
        `,
      );

      const global = await runDb(() =>
        this.prisma.$queryRaw<GlobalBudgetRow[]>`
          SELECT "used_today" FROM "global_token_budget"
          WHERE "id" = 'global'
          AND "day_start" = ${dayStart}
        `,
      );

      const availableUser = (budget[0]?.daily_budget ?? this.config.defaultDailyBudget) - (budget[0]?.used_today ?? 0);
      const availableGlobal = this.config.globalDailyBudget - (global[0]?.used_today ?? 0);

      return tokens <= availableUser && tokens <= availableGlobal;
    } catch {
      return false;
    }
  }

  /** Clean up expired reservations (run periodically). */
  async cleanupExpired(): Promise<number> {
    const now = new Date();

    // First, find expired active reservations and reclaim their tokens
    const expired = await runDb(() =>
      this.prisma.$queryRaw<{ id: string; user_id: string; tokens: number }[]>`
        SELECT "id", "user_id", "tokens" FROM "token_reservations"
        WHERE "status" = 'ACTIVE'
        AND "expires_at" < ${now}
      `,
    );

    for (const res of expired) {
      await this.releaseReservation(res.id);
    }

    // Mark expired
    const result = await runDb(() =>
      this.prisma.$executeRaw`
        UPDATE "token_reservations"
        SET "status" = 'EXPIRED', "updated_at" = ${now}
        WHERE "status" = 'ACTIVE'
        AND "expires_at" < ${now}
      `,
    );

    return Number(result);
  }

  /**
   * Reconcile token usage with committed reservations.
   * Fixes drift between used_today and sum of committed reservations.
   */
  async reconcile(): Promise<number> {
    const now = new Date();
    const dayStart = this.getDayStart(now);

    // For each user, compute actual usage from committed reservations
    // and update token_budgets.used_today
    const users = await runDb(() =>
      this.prisma.$queryRaw<{ user_id: string; total: number }[]>`
        SELECT "user_id", SUM("tokens") as total
        FROM "token_reservations"
        WHERE "status" = 'COMMITTED'
        AND "created_at" >= ${dayStart}
        GROUP BY "user_id"
      `,
    );

    let reconciledCount = 0;
    for (const u of users) {
      const result = await runDb(() =>
        this.prisma.$executeRaw`
          UPDATE "token_budgets"
          SET "used_today" = ${u.total}, "updated_at" = ${now}
          WHERE "user_id" = ${u.user_id}::uuid
          AND "day_start" = ${dayStart}
        `,
      );
      if (Number(result) > 0) reconciledCount++;
    }

    // Also reconcile global budget
    const global = await runDb(() =>
      this.prisma.$queryRaw<{ total: number | null }[]>`
        SELECT SUM("tokens") as total
        FROM "token_reservations"
        WHERE "status" = 'COMMITTED'
        AND "created_at" >= ${dayStart}
      `,
    );

    const globalTotal = global[0]?.total ?? 0;
    if (globalTotal !== 0 || global.length > 0) {
      await runDb(() =>
        this.prisma.$executeRaw`
          UPDATE "global_token_budget"
          SET "used_today" = ${Number(globalTotal)}, "updated_at" = ${now}
          WHERE "id" = 'global'
          AND "day_start" = ${dayStart}
        `,
      );
      reconciledCount++;
    }

    return reconciledCount;
  }
}

/**
 * Token budget service for managing AI token consumption.
 */
export class TokenBudgetService {
  private store: InMemoryTokenBudgetStore | PostgresTokenBudgetStore;
  private readonly config: TokenBudgetConfig;

  constructor(
    config: Partial<TokenBudgetConfig> = {},
    prisma?: PrismaClient,
  ) {
    this.config = {
      defaultDailyBudget: config.defaultDailyBudget ?? 100_000,
      maxTokensPerRequest: config.maxTokensPerRequest ?? 8_000,
      globalDailyBudget: config.globalDailyBudget ?? 1_000_000,
      leaseDurationMs: config.leaseDurationMs ?? 5 * 60 * 1000,
      strictMode: config.strictMode ?? true,
    };

    if (prisma) {
      this.store = new PostgresTokenBudgetStore(prisma, this.config);
    } else {
      this.store = new InMemoryTokenBudgetStore(this.config);
    }
  }

  /**
   * Reserve tokens for an AI request.
   * Returns reservation or null if budget exceeded.
   * In strict mode, throws on budget exceeded.
   */
  async reserve(userId: string, tokens: number): Promise<TokenReservation | null> {
    const reservation = await this.store.reserveTokens(userId, tokens);
    if (!reservation && this.config.strictMode) {
      throw new Error(`Token budget exceeded for user ${userId}`);
    }
    return reservation;
  }

  /**
   * Commit a successful reservation with actual provider usage.
   */
  async commit(reservationId: string, actualUsage?: number): Promise<void> {
    if (this.store instanceof PostgresTokenBudgetStore) {
      await this.store.commitReservation(reservationId, actualUsage);
    } else {
      await this.store.commitReservation(reservationId);
    }
  }

  /**
   * Release a failed/cancelled reservation.
   */
  async release(reservationId: string): Promise<void> {
    await this.store.releaseReservation(reservationId);
  }

  /**
   * Get current usage for a user.
   */
  async getUsage(userId: string): Promise<TokenUsage> {
    return this.store.getUsage(userId);
  }

  /**
   * Get global usage.
   */
  async getGlobalUsage(): Promise<GlobalTokenUsage> {
    return this.store.getGlobalUsage();
  }

  /**
   * Set custom budget for a user.
   */
  async setUserBudget(userId: string, budget: number): Promise<void> {
    return this.store.setUserBudget(userId, budget);
  }

  /**
   * Check if user can afford tokens.
   */
  async canAfford(userId: string, tokens: number): Promise<boolean> {
    return this.store.canAfford(userId, tokens);
  }

  /**
   * Reconcile token usage with committed reservations.
   * Fixes drift between used_today and sum of committed reservations.
   * Returns number of users/global budgets that were reconciled.
   */
  async reconcile(): Promise<number> {
    if (this.store instanceof PostgresTokenBudgetStore) {
      return this.store.reconcile();
    }
    return this.store.reconcile();
  }
}

/**
 * Create a token budget service instance.
 * Pass PrismaClient for production PostgreSQL-backed token budgeting.
 */
export function createTokenBudgetService(
  config?: Partial<TokenBudgetConfig>,
  prisma?: PrismaClient,
): TokenBudgetService {
  return new TokenBudgetService(config, prisma);
}