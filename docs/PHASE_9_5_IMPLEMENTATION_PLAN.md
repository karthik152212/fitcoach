# Phase 9.5 Implementation Plan — AI Coach Production Infrastructure

**Status**: **Planning — Phase 9.5A.0 Verification Blocked (No Supabase Project)**
**Based on**: Architecture decisions approved by project owner
**Dependencies**: Phase 9.4 complete (all tests passing, build clean)

---

## 1. Executive Summary

Phase 9.5 transforms the AI Coach from a mock-backed prototype into a production-ready system with:
- **Real AI provider integration** (Anthropic/OpenAI) behind a provider-independent interface
- **Supabase PostgreSQL + Auth** for persistent storage and server-verified identity
- **PostgreSQL-backed rate limiting** with atomic counters and fail-closed behavior
- **Secure environment configuration** with no secrets in code

All existing Phase 9.4 functionality (conversation persistence, evidence grounding, action lifecycle, mock provider, response validation, typed action registry, frontend UI) is preserved and extended.

---

## 2. Exact Files to Create or Modify

### 2.1 New Files — AI Provider Layer

| File | Purpose |
|------|---------|
| `packages/ai/src/provider.ts` | **Modify** — Extend `AIProvider` interface with `metadata`, `countTokens`, `close`; remove `isMock` from provider output |
| `packages/ai/src/anthropicProvider.ts` | **Create** — `AnthropicProvider` implementing `AIProvider` with structured output; no fallback to mock |
| `packages/ai/src/openaiProvider.ts` | **Create** — `OpenAIProvider` implementing `AIProvider` (future-proofing) |
| `packages/ai/src/providerFactory.ts` | **Create** — Runtime provider selection via `AI_PROVIDER` env var; mock ONLY when `AI_PROVIDER=mock` |
| `packages/ai/src/tokenCounter.ts` | **Create** — Token counting utilities; separate estimated (pre-generation) from actual (provider-reported) |
| `packages/ai/src/structuredOutput.ts` | **Create** — JSON schema definitions for provider responses; no hidden chain-of-thought |
| `packages/ai/src/__tests__/anthropicProvider.test.ts` | **Create** — Unit tests with mocked HTTP |
| `packages/ai/src/__tests__/providerFactory.test.ts` | **Create** — Factory selection tests |
| `packages/ai/src/__tests__/tokenCounter.test.ts` | **Create** — Token counting tests (estimate vs actual) |

### 2.2 New Files — Database & Auth Layer

| File | Purpose |
|------|---------|
| `apps/api/src/auth/supabaseAuth.ts` | **Create** — Supabase JWT verification via JWKS; extracts `userId` from `JWT.sub`; no database trigger |
| `apps/api/src/auth/middleware.ts` | **Create** — Express-style auth middleware; attaches verified `userId` to request; never trusts client-supplied `userId` |
| `apps/api/src/auth/rateLimiter.ts` | **Create** — PostgreSQL-backed rate limiter with atomic upsert for expired-window reset; fail-closed for AI endpoints |
| `apps/api/src/auth/postgresRateLimitStore.ts` | **Create** — **REQUIRED** PostgreSQL rate limit store implementation; atomic counters with row-level locks |
| `apps/api/src/auth/rateLimitStore.ts` | **Create** — Rate limit store interface (PostgreSQL impl + Redis-ready) |
| `apps/api/src/auth/__tests__/supabaseAuth.test.ts` | **Create** — Auth middleware tests with JWKS rotation |
| `apps/api/src/auth/__tests__/rateLimiter.test.ts` | **Create** — Rate limiter integration tests including concurrency |
| `apps/api/src/auth/__tests__/postgresRateLimitStore.test.ts` | **Create** — PostgreSQL store tests (atomic upsert, expired window, concurrent requests) |
| `packages/db/prisma/migrations/20261112_add_supabase_auth/` | **Create** — Migration: add `supabase_user_id` to `users`, unique index, RLS policies |
| `packages/db/prisma/migrations/20261112_add_rate_limits/` | **Create** — Migration: `rate_limit_counters` table with `(scope, key, window_start)` composite PK |
| `packages/db/prisma/migrations/20261112_add_idempotency/` | **Create** — Migration: `idempotency_keys` table with `(user_id, idempotency_key)` unique constraint |
| `packages/db/prisma/migrations/20261112_add_audit_trail/` | **Create** — Migration: `audit_trail` table with retention policy |

### 2.3 New Files — Idempotency & Audit

| File | Purpose |
|------|---------|
| `apps/api/src/services/idempotency.ts` | **Create** — Atomic claim mechanism: unique `(user_id, idempotency_key)` constraint; stores request hash + state (claimed/processing/completed/failed) |
| `apps/api/src/services/auditTrail.ts` | **Create** — Audit trail persistence with configurable retention; server-side only |
| `apps/api/src/services/__tests__/idempotency.test.ts` | **Create** — Idempotency tests (concurrent duplicate rejection, different payload rejection) |
| `apps/api/src/services/__tests__/auditTrail.test.ts` | **Create** — Audit trail tests |
| `apps/api/src/jobs/cleanup.ts` | **Create** — Cleanup job: expired rate limit counters, expired idempotency keys, audit trail retention |

### 2.4 Modified Files — Orchestration & Services

| File | Changes |
|------|---------|
| `apps/api/src/services/aiCoaching/orchestrator.ts` | Inject provider factory; add token **reservation** before generation; reconcile **actual** usage after; remove mock-only logic; fail-closed on provider failure |
| `apps/api/src/services/aiCoaching/index.ts` | Export new provider factory, token counter, idempotency, audit |
| `apps/api/src/services/aiCoaching/contextBuilder.ts` | Verify ownership checks use authenticated `userId` from middleware |
| `apps/api/src/services/index.ts` | Export auth middleware, rate limiter, idempotency, audit trail |
| `apps/api/src/routes.ts` | Apply auth middleware to all coaching routes; apply rate limiter; remove client-supplied `userId` trust; add idempotency middleware for POST endpoints |
| `apps/api/src/http.ts` | Add middleware pipeline support; correlation ID propagation |
| `apps/api/src/validation.ts` | Add auth/rate-limit/idempotency validation helpers |

### 2.5 Modified Files — Frontend

| File | Changes |
|------|---------|
| `apps/web/src/session/SupabaseSessionContext.tsx` | **Create** (replaces `SessionContext.tsx`) — Supabase auth session; no localStorage `userId` |
| `apps/web/src/api/client.ts` | Add `Authorization: Bearer <access_token>` header from Supabase session |
| `apps/web/src/screens/OnboardingScreen.tsx` | Integrate Supabase sign-up/sign-in flow |
| `apps/web/src/__tests__/mockApi.ts` | Add auth header mocking for tests |
| `apps/web/src/lib/supabaseClient.ts` | **Create** — Supabase client configuration (browser) |
| `.env.example` | **Update** — Add all Phase 9.5 placeholders (see Section 15) |
| `apps/api/package.json` | Add `@supabase/supabase-js`, `zod`, `jose` (JWT verification) |
| `packages/ai/package.json` | Add `@anthropic-ai/sdk`, `openai` (optional), `zod`, `tiktoken` (local estimation) |
| `packages/db/package.json` | Verify Prisma Supabase compatibility |

### 2.6 Configuration & Schema Files

| File | Changes |
|------|---------|
| `packages/db/prisma/schema.prisma` | Add `supabase_user_id` to `User`; add `RateLimitCounter`, `IdempotencyKey`, `AuditTrail` models; RLS policy annotations |
| `packages/db/src/repositories/rateLimit.ts` | **Create** — Repository for rate limit counter operations |
| `packages/db/src/repositories/idempotency.ts` | **Create** — Repository for idempotency key operations |
| `packages/db/src/repositories/auditTrail.ts` | **Create** — Repository for audit trail operations |
| `packages/db/src/repositories/index.ts` | Export new repositories |

---

## 3. Existing Code to Reuse

| Component | File | Reuse Strategy |
|-----------|------|----------------|
| `ConversationOrchestrator` | `orchestrator.ts` | Core logic preserved; inject provider factory instead of direct provider; add token reservation/reconciliation |
| `PersonalContextBuilder` | `contextBuilder.ts` | Unchanged — evidence retrieval works with authenticated `userId` |
| `ResponseValidator` | `responseValidator.ts` | Unchanged — mandatory validation layer |
| `TypedActionRegistry` | `actionRegistry.ts` | Unchanged — consequential action gating |
| `MockAIProvider` | `mockProvider.ts` | Retained for testing ONLY; implements same `AIProvider` interface; `metadata.isMock = true` assigned by factory |
| `Conversation/Message models` | `schema.prisma` | Preserved; verify Supabase compatibility |
| `Conversation repositories` | `conversation.ts` | Preserved; Prisma client works with Supabase |
| `CoachScreen, CoachMessage, CoachAction, CoachEvidence, CoachDecision, CoachQualityBanner, CoachMockBadge, CoachInput, CoachConversationList, CoachEmpty` | Frontend components | Unchanged — UI already provider-independent |
| `API client & types` | `client.ts`, `endpoints.ts`, `types.ts` | Minor auth header additions |
| `Integration tests` | `aiCoaching.integration.ts` | Extended to run against real provider + Supabase |
| `Frontend tests` | `CoachScreen*.test.tsx`, `CoachAction.test.tsx` | Extended with auth mocking |

---

## 4. Database Migration Strategy

### 4.1 Current State
- Prisma schema defines `Conversation` and `ConversationMessage` models (Phase 9.3 migration: `20261111120000_add_conversation_models`)
- All domain tables exist (users, profiles, goals, workouts, measurements, nutrition, decisions, etc.)

### 4.2 Supabase Integration Requirements
| Requirement | Approach |
|-------------|----------|
| **User identity** | Supabase Auth `auth.users` is source of truth; `public.users.supabase_user_id` synced via **application-level** sync (not database trigger) on user creation/login |
| **Verified identity to Prisma** | Middleware extracts `userId` from verified JWT (`JWT.sub`); passed to Prisma via request context; Prisma runs with service role but **all queries filtered by `user_id = authenticated_user_id`** |
| **Transaction-scoped user context for RLS** | If RLS enabled: `SET LOCAL app.current_user_id = '<userId>';` before queries in transaction; RLS policies use `current_setting('app.current_user_id')` |
| **Ownership** | All coaching routes use `userId` from verified JWT; `userId` removed from URL path |
| **RLS** | Enable for ALL user-owned application tables: `conversations`, `conversation_messages`, `profiles`, `goals`, `workouts`, `measurements`, `nutrition_logs`, `decisions`, `body_measurements`, `muscle_structures`, `environments`, `equipment`, `exercise_preferences`, `knowledge_exercises`, `form_guidance`, `evidence_inputs`, `plan_versions`; policies: `user_id = current_setting('app.current_user_id')` |
| **Service role** | Server-side ONLY; used for admin operations, migrations, background jobs, cleanup; NEVER exposed to frontend |
| **Connection pooling** | Use Supabase PgBouncer (port 6543) for runtime; direct connection (port 5432) for migrations |

### 4.3 Migration Steps
1. **Verify existing migration** — Apply `20261111120000_add_conversation_models` to Supabase
2. **Add Supabase auth sync** — Migration `20261112_add_supabase_auth`: add `supabase_user_id` UUID unique to `users`; application-level sync on signup/login (not trigger)
3. **Enable RLS** — Migration adds RLS policies on ALL user-owned tables (see 4.2); test thoroughly with transaction-scoped `app.current_user_id`
4. **Add rate limit tables** — Migration `20261112_add_rate_limits`: `rate_limit_counters(scope, key, window_start, count)` with composite PK
5. **Add idempotency table** — Migration `20261112_add_idempotency`: `idempotency_keys(user_id, idempotency_key, request_hash, state, response_body, expires_at)` with unique `(user_id, idempotency_key)`
6. **Add audit trail table** — Migration `20261112_add_audit_trail`: `audit_trail(id, user_id, action, resource, metadata, created_at)` with retention index
7. **Update Prisma schema** — Map `users.supabase_user_id`; add new models; adjust relations
8. **Connection config** — Separate `DATABASE_URL` (direct, migrations) and `DATABASE_URL_POOLED` (runtime)

### 4.4 Rollback
- All migrations are additive (new columns, RLS policies, new tables)
- RLS can be disabled with `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`
- Application-level auth sync: remove sync logic; no trigger to drop
- **Safe RLS rollback**: Disable RLS per table; verify queries work with application-level filtering before re-enabling
- **Never roll back to trusting client-supplied `userId`** — this is a hard constraint

---

## 5. Supabase Authentication Integration

### 5.1 Architecture
```
Frontend (Supabase JS SDK)
    ↓ signUp / signIn / signOut
Supabase Auth (hosted)
    ↓ returns JWT (access_token)
Frontend stores session in memory + localStorage (Supabase handles refresh)
    ↓ Authorization: Bearer <access_token>
API Gateway (Node HTTP router)
    ↓ supabaseAuth middleware
JWT verified via Supabase JWKS (cached, rotating keys)
    ↓ userId = JWT.sub (UUID)
Request proceeds with authenticated userId attached to request context
```

### 5.2 Server-Side Implementation
```typescript
// apps/api/src/auth/supabaseAuth.ts
import { createRemoteJWKSet, jwtVerify } from 'jose';

export async function verifySupabaseToken(token: string): Promise<{ userId: string; email: string } | null> {
  const JWKS = createRemoteJWKSet(new URL(`${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  const { payload } = await jwtVerify(token, JWKS, { issuer: `${process.env.SUPABASE_URL}/auth/v1` });
  return { userId: payload.sub as string, email: payload.email as string };
}

export function authMiddleware(): Middleware {
  return async (req, res, next) => {
    const auth = req.headers.authorization?.replace('Bearer ', '');
    if (!auth) return res.status(401).json({ error: 'Missing authorization header' });
    const verified = await verifySupabaseToken(auth);
    if (!verified) return res.status(401).json({ error: 'Invalid or expired token' });
    req.auth = verified; // { userId, email }
    next();
  };
}
```

### 5.3 Client-Side Implementation
```typescript
// apps/web/src/session/SupabaseSessionContext.tsx
import { createBrowserClient } from '@supabase/supabase-js';

export function SupabaseSessionProvider({ children }) {
  const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  // Supabase handles session persistence + refresh automatically
  // ...
}

export function useSupabaseAuth() {
  // returns { user, session, signIn, signUp, signOut }
}
```

### 5.4 Route Protection
All coaching routes (`/v0/users/:userId/conversations*`) become `/v0/conversations*` with `userId` derived from JWT middleware. Middleware runs before rate limiter and idempotency checks.

---

## 6. AI Provider Architecture

### 6.1 Provider Interface (`packages/ai/src/provider.ts`)
```typescript
export interface AIProvider {
  readonly metadata: ProviderMetadata;
  generate(request: ProviderRequest): Promise<ProviderResponse>;
  countTokens(text: string): Promise<number>; // LOCAL estimation only
  close(): Promise<void>;
}

export interface ProviderMetadata {
  name: 'anthropic' | 'openai' | 'mock'; // assigned by factory, NOT model output
  isMock: boolean;                        // assigned by factory, NOT model output
  model: string;
  contractVersion: string;
  maxTokens?: number;
  supportsStructuredOutput: boolean;
}
```

**Key constraints:**
- `metadata.isMock` is assigned by `providerFactory.ts` based on `AI_PROVIDER` env var — **never by model output**
- `metadata.name` is assigned by factory — **never by model output**
- Provider-reported `tokenUsage` (input/output tokens) is **authoritative** for billing/budgets
- Local `countTokens()` is for **estimation/reservation only** — not accounting

### 6.2 Structured Output Schema (`packages/ai/src/structuredOutput.ts`)
```typescript
// Zod schema for provider response validation
// NO hidden chain-of-thought fields
export const ProviderResponseSchema = z.object({
  answer: z.string(),
  // reasoningTrace REMOVED — do not expose or persist hidden CoT
  confidence: z.number().min(0).max(1).optional(),
  proposedActions: z.array(ProposedActionSchema).optional(),
  warnings: z.array(z.string()).optional(),
  isMock: z.boolean(), // from provider.metadata.isMock (factory-assigned)
  tokenUsage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
  }).optional(), // PROVIDER-REPORTED, authoritative
});
```

### 6.3 Provider Factory (`packages/ai/src/providerFactory.ts`)
```typescript
export async function createProvider(): Promise<AIProvider> {
  const providerType = process.env.AI_PROVIDER || 'mock';
  
  switch (providerType) {
    case 'anthropic':
      return new AnthropicProvider({ apiKey: process.env.AI_API_KEY!, model: process.env.AI_MODEL! });
    case 'openai':
      return new OpenAIProvider({ apiKey: process.env.AI_API_KEY!, model: process.env.AI_MODEL! });
    case 'mock':
      return new MockAIProvider(); // ONLY when explicitly selected
    default:
      throw new Error(`Unknown AI_PROVIDER: ${providerType}`);
  }
}

// Application lifecycle
let provider: AIProvider | null = null;

export async function getProvider(): Promise<AIProvider> {
  if (!provider) provider = await createProvider();
  return provider;
}

export async function shutdownProvider(): Promise<void> {
  if (provider) {
    await provider.close();
    provider = null;
  }
}
```

### 6.4 Failure Behavior
- **Anthropic/OpenAI failures** → Explicit errors propagated to caller; **NO automatic fallback to mock**
- **Mock provider** → ONLY instantiated when `AI_PROVIDER=mock` env var is set
- **Provider-reported usage** → Authoritative for token budgets and rate limiting
- **Local token estimation** → Used only for pre-generation reservation; reconciled against actual after generation

---

## 7. PostgreSQL Rate Limiter

### 7.1 Store Interface (`apps/api/src/auth/rateLimitStore.ts`)
```typescript
export interface RateLimitStore {
  increment(scope: RateLimitScope, key: string, windowSec: number, limit: number): Promise<RateLimitResult>;
  get(scope: RateLimitScope, key: string, windowSec: number): Promise<RateLimitResult>;
  reset(scope: RateLimitScope, key: string, windowSec: number): Promise<void>;
  close(): Promise<void>;
}

export type RateLimitScope = 'user' | 'ip' | 'endpoint' | 'token_budget';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfterSec?: number;
}
```

### 7.2 PostgreSQL Implementation (`apps/api/src/auth/postgresRateLimitStore.ts`)
```typescript
// ATOMIC expired-window upsert using ON CONFLICT with WHERE clause
// Prevents race conditions: expired counters reset atomically, concurrent requests cannot bypass limits

const UPSERT_COUNTER = `
  INSERT INTO rate_limit_counters (scope, key, window_start, count)
  VALUES ($1, $2, $3, 1)
  ON CONFLICT (scope, key, window_start)
  DO UPDATE SET count = rate_limit_counters.count + 1
  WHERE rate_limit_counters.window_start = $3  -- only update if same window (expired windows get new row)
  RETURNING count, window_start;
`;

export class PostgresRateLimitStore implements RateLimitStore {
  constructor(private pool: Pool) {}

  async increment(scope: RateLimitScope, key: string, windowSec: number, limit: number): Promise<RateLimitResult> {
    const windowStart = Math.floor(Date.now() / 1000 / windowSec) * windowSec;
    const result = await this.pool.query(UPSERT_COUNTER, [scope, key, windowStart]);
    const count = result.rows[0].count;
    const allowed = count <= limit;
    return {
      allowed,
      remaining: Math.max(0, limit - count),
      resetAt: new Date((windowStart + windowSec) * 1000),
      retryAfterSec: allowed ? undefined : windowSec - (Date.now() / 1000 - windowStart),
    };
  }

  // ... get, reset, close implementations
}
```

### 7.3 Rate Limiter (`apps/api/src/auth/rateLimiter.ts`)
```typescript
export interface RateLimitPolicy {
  scope: RateLimitScope;
  key: (req: Request) => string; // userId, IP, or endpoint pattern
  windowSec: number;
  limit: number;
  failClosed?: boolean; // for AI endpoints
}

export class RateLimiter {
  constructor(
    private store: RateLimitStore,
    private policies: RateLimitPolicy[],
    private defaultFailClosed: boolean = true
  ) {}

  async check(req: Request): Promise<RateLimitResult> {
    for (const policy of this.policies) {
      const key = policy.key(req);
      const result = await this.store.increment(policy.scope, key, policy.windowSec, policy.limit);
      if (!result.allowed) {
        return result; // first matching policy that blocks
      }
    }
    return { allowed: true, remaining: Infinity, resetAt: new Date(Date.now() + 86400000) };
  }
}

// Policy configuration from env
export function createRateLimiterPolicies(): RateLimitPolicy[] {
  return [
    { scope: 'user', key: req => `user:${req.auth.userId}`, windowSec: 60, limit: env.RATE_LIMIT_COACHING_PER_MINUTE },
    { scope: 'user', key: req => `user:${req.auth.userId}`, windowSec: 3600, limit: env.RATE_LIMIT_COACHING_PER_HOUR },
    { scope: 'user', key: req => `user:${req.auth.userId}`, windowSec: 60, limit: env.RATE_LIMIT_CONVERSATION_CREATE_PER_MINUTE },
    { scope: 'ip', key: req => `ip:${req.ip}`, windowSec: 60, limit: env.RATE_LIMIT_GENERAL_PER_MINUTE },
    { scope: 'token_budget', key: req => `tokens:${req.auth.userId}`, windowSec: 86400, limit: env.RATE_LIMIT_AI_TOKENS_DAILY, failClosed: true },
  ];
}
```

### 7.4 Separate Keys and Policies
| Scope | Key Format | Use Case | Env Config |
|-------|------------|----------|------------|
| `user` | `user:{userId}` | Per-user coaching messages, conversations | `RATE_LIMIT_COACHING_PER_MINUTE`, `RATE_LIMIT_COACHING_PER_HOUR`, `RATE_LIMIT_CONVERSATION_CREATE_PER_MINUTE` |
| `ip` | `ip:{clientIp}` | General API protection | `RATE_LIMIT_GENERAL_PER_MINUTE` |
| `endpoint` | `endpoint:{routePattern}` | Specific endpoint limits | (future) |
| `token_budget` | `tokens:{userId}` | Daily AI token budget | `RATE_LIMIT_AI_TOKENS_DAILY` |

### 7.5 AI Endpoints: Fail-Closed
- Token budget scope uses `failClosed: true`
- If `PostgresRateLimitStore` unavailable → **block request** (503), do not allow generation
- `RATE_LIMIT_FAIL_CLOSED=true` is mandatory for AI endpoints

---

## 8. Token Budgets

### 8.1 Separation: Estimated vs Actual
| Phase | Source | Purpose |
|-------|--------|---------|
| **Pre-generation** | Local `countTokens()` (tiktoken) | **Reservation** — atomic reserve from daily budget |
| **Post-generation** | Provider-reported `tokenUsage` | **Accounting** — authoritative; reconcile against reservation |
| **Failed/timeout/abandoned** | N/A | **Release reservation** — return tokens to budget |

### 8.2 Atomic Token Reservation with Lease Reclamation (`apps/api/src/services/tokenBudget.ts`)
```typescript
export interface TokenReservation {
  reservationId: string;
  userId: string;
  estimatedTokens: number;
  leaseExpiresAt: Date;      // TTL: AI_TOKEN_RESERVATION_TTL_MINUTES (default 5)
  state: 'active' | 'reconciled' | 'expired';
}

export class TokenBudget {
  constructor(private repo: TokenBudgetRepository) {} // uses dedicated token_budget table

  async reserve(userId: string, estimatedTokens: number): Promise<TokenReservation> {
    // 1. Atomically reclaim expired leases for this user (returns tokens to budget)
    await this.repo.reclaimExpiredLeases(userId);

    // 2. Check available budget (daily limit - active reservations - actual usage)
    const available = await this.repo.getAvailableBudget(userId);
    if (available < estimatedTokens) throw new InsufficientTokenBudgetError();

    // 3. Create reservation with lease expiry
    const leaseExpiresAt = new Date(Date.now() + AI_TOKEN_RESERVATION_TTL_MINUTES * 60000);
    const reservation = await this.repo.createReservation({
      userId,
      estimatedTokens,
      leaseExpiresAt,
      state: 'active',
    });

    return reservation;
  }

  async extendLease(reservationId: string): Promise<void> {
    const leaseExpiresAt = new Date(Date.now() + AI_TOKEN_RESERVATION_TTL_MINUTES * 60000);
    await this.repo.updateLease(reservationId, leaseExpiresAt);
  }

  async reconcile(reservationId: string, actualUsage: TokenUsage): Promise<void> {
    const reservation = await this.repo.get(reservationId);
    const diff = actualUsage.total - reservation.estimatedTokens;
    
    if (diff > 0) {
      // Additional usage: charge against budget (separate counter)
      await this.repo.chargeActualUsage(reservation.userId, diff);
    }
    // Under-use: reservation already consumed from budget; no refund (simpler, safer)
    
    await this.repo.markReconciled(reservationId, actualUsage);
  }

  async release(reservationId: string): Promise<void> {
    // Return estimated tokens to available budget
    await this.repo.releaseReservation(reservationId);
  }
}
```

**Lease Reclamation (Atomic, During Reservation):**
- `reclaimExpiredLeases(userId)` runs as single transaction: finds reservations where `leaseExpiresAt < NOW()` and `state = 'active'`, marks them `expired`, returns `estimatedTokens` to available budget
- Called at start of every `reserve()` — no separate cleanup needed for lease expiry
- Guarantees no stranded reservations block budget

### 8.3 Lease Cleanup Worker (High Frequency)
- **Interval**: Every 1–5 minutes (`AI_TOKEN_LEASE_CLEANUP_INTERVAL_MS=60000..300000`)
- **Scope**: Reclaim expired leases across all users (batch, `LIMIT 1000` per run)
- **Separate from Daily Cleanup**: Daily job (`cleanup.ts`) handles audit retention, idempotency keys, rate limit counters — long-lived records only
- **Implementation**: `apps/api/src/jobs/tokenLeaseCleanup.ts` — standalone worker, service-role credentials

### 8.4 Orchestrator Integration
```typescript
// In orchestrator.ts
async function generateResponse(req: CoachingRequest): Promise<CoachingResponse> {
  // 1. Estimate tokens from context + prompt template
  const estimated = await provider.countTokens(buildPrompt(req));
  
  // 2. Atomic reservation (includes expired lease reclamation)
  const reservation = await tokenBudget.reserve(req.auth.userId, estimated);
  
  try {
    // 3. Extend lease at generation start (covers long LLM calls)
    await tokenBudget.extendLease(reservation.reservationId);
    
    // 4. Generate
    const response = await provider.generate({ ...req, maxTokens: estimated });
    
    // 5. Reconcile with ACTUAL provider-reported usage
    await tokenBudget.reconcile(reservation.reservationId, response.tokenUsage);
    
    return response;
  } catch (e) {
    // 6. On failure/timeout/abandon: release reservation
    await tokenBudget.release(reservation.reservationId);
    throw e;
  }
}
```

### 8.5 Handling Edge Cases
- **Failed generation**: `release()` returns estimated tokens to budget immediately
- **Timeout**: Lease expires → reclaimed atomically on next `reserve()` by any request
- **Abandoned (client disconnect)**: Same as timeout — lease expiry handles it
- **Provider under-reports**: Use provider-reported as floor; log discrepancy
- **Local estimation inaccurate**: Expected; reconciliation charges actual, reservation is best-effort
- **Concurrent requests**: Each reserves independently; lease reclamation prevents double-counting expired

---

## 9. Idempotency

### 9.1 Atomic Claim Mechanism
```sql
-- Migration: 20261112_add_idempotency
CREATE TABLE idempotency_keys (
  user_id UUID NOT NULL REFERENCES users(id),
  idempotency_key VARCHAR(255) NOT NULL,
  request_hash VARCHAR(64) NOT NULL, -- SHA-256 of canonical request body
  state VARCHAR(20) NOT NULL DEFAULT 'claimed', -- claimed, processing, completed, failed
  response_body JSONB,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, idempotency_key)
);
```

### 9.2 Idempotency Service (`apps/api/src/services/idempotency.ts`)
```typescript
export class IdempotencyService {
  constructor(private repo: IdempotencyRepository) {}

  async claim(userId: string, key: string, requestBody: unknown): Promise<IdempotencyResult> {
    const requestHash = hashRequest(requestBody);
    
    // Atomic upsert: claim or reject
    const result = await this.repo.claim(userId, key, requestHash);
    
    if (result.state === 'completed') {
      return { status: 'duplicate', response: result.responseBody };
    }
    if (result.state === 'processing') {
      throw new ConcurrentRequestError('Request already in progress');
    }
    if (result.state === 'claimed' && result.existingHash !== requestHash) {
      throw new IdempotencyKeyReuseError('Key reused with different request content');
    }
    
    return { status: 'claimed', reservationId: result.id };
  }

  async complete(reservationId: string, response: unknown): Promise<void> {
    await this.repo.update(reservationId, { state: 'completed', responseBody: response });
  }

  async fail(reservationId: string, error: Error): Promise<void> {
    await this.repo.update(reservationId, { state: 'failed' });
  }
}
```

### 9.3 Guarantees
| Requirement | Implementation |
|-------------|----------------|
| Atomic claim | Single `INSERT ... ON CONFLICT` with unique `(user_id, idempotency_key)` |
| Request hash stored | SHA-256 of canonical JSON; compared on claim |
| Reject different content | Compare hash on conflict; throw if mismatch |
| Prevent simultaneous duplicates | `state = 'processing'` blocks second claim |
| No double AI quota consumption | Duplicate returns cached response; no provider call |
| State machine | `claimed` → `processing` → `completed` \| `failed` |

### 9.4 Middleware Integration
```typescript
// apps/api/src/routes.ts
app.post('/v0/conversations/:id/messages', 
  authMiddleware(),
  rateLimiterMiddleware(),
  idempotencyMiddleware(), // extracts Idempotency-Key header
  handler
);
```

---

## 10. Security and Rollback

### 10.1 Hard Constraints
- **Never** roll back to trusting client-supplied `userId`
- **Never** disable production AI rate limits as routine recovery
- **Never** expose AI API keys or Supabase service-role credentials to frontend
- **Never** persist hidden chain-of-thought from provider

### 10.2 Server-Only Credentials
| Credential | Where Used | Never In |
|------------|------------|----------|
| `AI_API_KEY` | `AnthropicProvider`, `OpenAIProvider` (server) | Frontend bundle, logs, client requests |
| `SUPABASE_SERVICE_ROLE_KEY` | Migrations, cleanup jobs, admin ops | Frontend, client requests |
| `DATABASE_URL` (direct) | Migrations, seed | Runtime (use `DATABASE_URL_POOLED`) |

### 10.3 Audit Trail Retention & Cleanup
```typescript
// apps/api/src/services/auditTrail.ts
export const AUDIT_RETENTION_DAYS = 90; // configurable

export class AuditTrail {
  async record(entry: AuditEntry): Promise<void> {
    await this.repo.insert({ ...entry, createdAt: new Date() });
  }

  async cleanup(): Promise<number> {
    const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 86400000);
    return this.repo.deleteOlderThan(cutoff);
  }
}
```
- Retention: 90 days default, configurable via `AUDIT_RETENTION_DAYS`
- Cleanup: Daily cron job via `apps/api/src/jobs/cleanup.ts`
- Deletion: Hard delete (no archive requirement)

### 10.4 Safe Migration & RLS Rollback Procedures
1. **Migration rollback**: `prisma migrate resolve --rolled-back <name>` — additive only
2. **RLS rollback**: 
   - Disable per table: `ALTER TABLE x DISABLE ROW LEVEL SECURITY;`
   - Verify application-level filtering works
   - Re-enable after fix
3. **Auth sync rollback**: Remove application sync logic; no trigger to drop
4. **Rate limiter rollback**: Set `RATE_LIMIT_ENABLED=false` (fail-open for non-AI); AI endpoints stay fail-closed

---

## 11. Testing Strategy

### 11.1 Test Categories (Separate)

| Category | Scope | Tools | Run On |
|----------|-------|-------|--------|
| **Unit (provider HTTP mocked)** | `AnthropicProvider`, `OpenAIProvider`, `tokenCounter`, `providerFactory` | Vitest, MSW/nock | Every PR |
| **Integration/Contract (controlled provider responses)** | Orchestrator + real provider client against recorded fixtures; Supabase auth middleware against test JWKS | Vitest, testcontainers (PostgreSQL), Supabase local dev | Every PR |
| **Live Provider Smoke (real credentials)** | End-to-end with real Anthropic/OpenAI; validates contract, token usage reporting | Manual / scheduled CI | Pre-release, weekly |
| **Supabase Integration (actual runtime connection)** | Auth middleware + JWKS rotation; RLS with transaction-scoped context; pooled vs direct connection | testcontainers + Supabase local, or staging Supabase project | Every PR |
| **Concurrency** | Rate limiter atomic upsert under load; idempotency simultaneous claims; token budget reconciliation | Vitest with `p-limit`, custom stress harness | Every PR |
| **Infrastructure Load** | API throughput, DB connection pool, rate limiter latency — **without LLM calls** | k6, artillery | Dedicated infra tests |
| **AI Provider Latency (E2E)** | Full coaching request latency including LLM — separate from infra | k6 with mocked provider OR live smoke | Dedicated AI tests |

### 11.2 Measurable Performance Criteria (Replaces "100 concurrent users, p95 < 2s, zero errors")

| Dimension | Metric | Target |
|-----------|--------|--------|
| **API Infrastructure** (no LLM) | p95 latency `/health`, `/v0/conversations` (GET) | < 100ms |
| **API Infrastructure** (no LLM) | p99 latency under 1000 RPS sustained | < 500ms |
| **Rate Limiter** | p99 `increment` call latency | < 50ms |
| **Rate Limiter** | Zero lost increments under 500 concurrent/key | 100% atomic |
| **Idempotency** | p99 claim latency | < 30ms |
| **Idempotency** | Zero duplicate processing under 100 concurrent same-key | 100% |
| **Auth Middleware** | p99 JWT verify + JWKS cache hit | < 20ms |
| **Auth Middleware** | JWKS rotation handled without errors | 100% |
| **AI Provider (mocked)** | Orchestrator overhead (excl. LLM) | < 200ms |
| **AI Provider (live)** | p95 total latency (incl. LLM) | < 30s (provider-dependent) |
| **AI Provider (live)** | Token usage reconciliation accuracy | 100% match provider-reported |
| **Database** | PgBouncer connection pool exhaustion | 0 under 2x expected peak |
| **Migrations** | Zero-downtime deploy verified | Yes |

### 11.3 Test File Inventory
| File | Category |
|------|----------|
| `packages/ai/src/__tests__/anthropicProvider.test.ts` | Unit |
| `packages/ai/src/__tests__/openaiProvider.test.ts` | Unit |
| `packages/ai/src/__tests__/providerFactory.test.ts` | Unit |
| `packages/ai/src/__tests__/tokenCounter.test.ts` | Unit |
| `packages/ai/src/__tests__/structuredOutput.test.ts` | Unit |
| `apps/api/src/auth/__tests__/supabaseAuth.test.ts` | Unit + Supabase Integration |
| `apps/api/src/auth/__tests__/rateLimiter.test.ts` | Integration |
| `apps/api/src/auth/__tests__/postgresRateLimitStore.test.ts` | Integration + Concurrency |
| `apps/api/src/services/__tests__/idempotency.test.ts` | Integration + Concurrency |
| `apps/api/src/services/__tests__/tokenBudget.test.ts` | Integration |
| `apps/api/src/services/__tests__/auditTrail.test.ts` | Unit |
| `apps/api/src/services/aiCoaching/__tests__/orchestrator.integration.ts` | Integration |
| `apps/api/src/__tests__/aiCoaching.e2e.test.ts` | Live Provider Smoke (optional) |
| `apps/api/src/__tests__/load.infra.test.ts` | Infrastructure Load |
| `apps/api/src/__tests__/load.ai.test.ts` | AI Provider Latency |
| `packages/db/src/__tests__/rateLimit.integration.ts` | Supabase Integration — **uses `DATABASE_URL_POOLED` (app_user role), transaction pooling** |
| `packages/db/src/__tests__/rls.integration.ts` | Supabase Integration — **uses `DATABASE_URL_POOLED` (app_user role), transaction pooling; verifies `SET LOCAL app.current_user_id` in `$transaction`** |

---

## 12. Complete File Inventory (Create/Modify)

### 12.1 Source Files (Create)
```
packages/ai/src/anthropicProvider.ts
packages/ai/src/openaiProvider.ts
packages/ai/src/providerFactory.ts
packages/ai/src/tokenCounter.ts
packages/ai/src/structuredOutput.ts
apps/api/src/auth/supabaseAuth.ts
apps/api/src/auth/middleware.ts
apps/api/src/auth/rateLimiter.ts
apps/api/src/auth/postgresRateLimitStore.ts
apps/api/src/auth/rateLimitStore.ts
apps/api/src/services/idempotency.ts
apps/api/src/services/tokenBudget.ts
apps/api/src/services/auditTrail.ts
apps/api/src/jobs/cleanup.ts
apps/web/src/session/SupabaseSessionContext.tsx
apps/web/src/lib/supabaseClient.ts
```

### 12.2 Source Files (Modify)
```
packages/ai/src/provider.ts
packages/ai/src/mockProvider.ts (verify isMock assigned by factory)
packages/ai/src/index.ts (exports)
apps/api/src/services/aiCoaching/orchestrator.ts
apps/api/src/services/aiCoaching/index.ts
apps/api/src/services/aiCoaching/contextBuilder.ts
apps/api/src/services/index.ts
apps/api/src/routes.ts
apps/api/src/http.ts
apps/api/src/validation.ts
apps/web/src/api/client.ts
apps/web/src/screens/OnboardingScreen.tsx
apps/web/src/__tests__/mockApi.ts
packages/db/prisma/schema.prisma
packages/db/src/repositories/rateLimit.ts (create)
packages/db/src/repositories/idempotency.ts (create)
packages/db/src/repositories/auditTrail.ts (create)
packages/db/src/repositories/index.ts
```

### 12.3 Database Migrations (Create)
```
packages/db/prisma/migrations/20261112_add_supabase_auth/
packages/db/prisma/migrations/20261112_add_rate_limits/
packages/db/prisma/migrations/20261112_add_idempotency/
packages/db/prisma/migrations/20261112_add_audit_trail/
```

### 12.4 Test Files (Create)
```
packages/ai/src/__tests__/anthropicProvider.test.ts
packages/ai/src/__tests__/openaiProvider.test.ts
packages/ai/src/__tests__/providerFactory.test.ts
packages/ai/src/__tests__/tokenCounter.test.ts
packages/ai/src/__tests__/structuredOutput.test.ts
apps/api/src/auth/__tests__/supabaseAuth.test.ts
apps/api/src/auth/__tests__/rateLimiter.test.ts
apps/api/src/auth/__tests__/postgresRateLimitStore.test.ts
apps/api/src/services/__tests__/idempotency.test.ts
apps/api/src/services/__tests__/tokenBudget.test.ts
apps/api/src/services/__tests__/auditTrail.test.ts
apps/api/src/services/aiCoaching/__tests__/orchestrator.integration.ts
apps/api/src/__tests__/aiCoaching.e2e.test.ts
apps/api/src/__tests__/load.infra.test.ts
apps/api/src/__tests__/load.ai.test.ts
packages/db/src/__tests__/rateLimit.integration.ts
packages/db/src/__tests__/rls.integration.ts
```

### 12.5 Configuration Files (Modify)
```
.env.example
apps/api/package.json
packages/ai/package.json
packages/db/package.json
```

---

## 13. Revised Estimates

### 13.1 Engineering Effort (Person-Days)

| Phase | Task | Effort (days) | Notes |
|-------|------|---------------|-------|
| **9.5A.0: Supabase Infra Verification** | | **2** | |
| | Supabase connectivity verification | 0.5 | Direct + pooled + JWKS |
| | Database role & privileges verification | 0.5 | Service role vs app_user, no BYPASSRLS |
| | PgBouncer transaction pooling verification | 0.5 | SET LOCAL persistence, Prisma $transaction |
| | RLS policy syntax & performance verification | 0.5 | Policy creation, index usage |
| **9.5A.1: Auth & Database** | | **14** | |
| | Supabase JWT verification + middleware | 3 | JWKS caching, rotation handling |
| | Application-level auth sync (no trigger) | 2 | Signup/login sync logic |
| | RLS policies on all user tables | 3 | 17 tables, transaction-scoped context |
| | Migration: supabase_user_id + RLS | 2 | Verification on Supabase |
| | Connection config (pooled vs direct) | 1 | Env separation |
| | Tests: auth, RLS integration | 1 | JWKS rotation, RLS verification |
| | Route protection: remove client userId | 2 | Middleware pipeline, 410 gone routes |
| | Frontend: Supabase session context | 2 | SessionContext replacement, onboarding |
| **9.5B: AI Provider** | | **10** | |
| | AnthropicProvider (structured output) | 3 | No fallback, provider-reported usage |
| | OpenAIProvider (fail-clear stub) | 1 | Throws OpenAIProviderNotImplementedError |
| | ProviderFactory (explicit mock only) | 1 | Startup/shutdown lifecycle |
| | TokenCounter (local estimation) | 1 | tiktoken integration |
| | StructuredOutput schemas | 1 | Zod, no CoT |
| | Tests: provider unit, factory | 2 | Mocked HTTP, fail-clear verification |
| **9.5C: Rate Limiting** | | **8** | |
| | PostgresRateLimitStore (atomic upsert) | 3 | Expired-window race condition fix |
| | RateLimiter with multi-scope policies | 2 | User/IP/token_budget/endpoint |
| | Fail-closed for AI endpoints | 1 | Mandatory |
| | Tests: concurrency, atomic upsert | 2 | 500 concurrent same key |
| **9.5D: Token Budgets** | | **5** | |
| | TokenBudget service (reserve/reconcile/lease) | 2 | Atomic reservation, lease reclamation |
| | Orchestrator integration | 2 | Pre-generation estimate, post-generation reconcile, lease extend |
| | Tests: failed/timeout/abandoned, lease cleanup | 1 | Reservation cleanup, high-frequency worker |
| **9.5E: Idempotency** | | **5** | |
| | IdempotencyService + repository | 2 | Atomic claim, hash compare, state machine |
| | Migration + unique constraint | 1 | |
| | Middleware integration | 1 | |
| | Tests: concurrent, different payload | 1 | |
| **9.5F: Audit & Cleanup** | | **3** | |
| | AuditTrail service + repository | 1 | |
| | Cleanup jobs (daily + token lease 1-5min) | 1 | Two-tier cleanup |
| | Tests | 1 | |
| **9.5G: Frontend Auth** | | **4** | |
| | SupabaseSessionContext (replace SessionContext) | 2 | Sign up/in/out flow |
| | API client auth header | 1 | |
| | OnboardingScreen integration | 1 | |
| **9.5H: Testing Infrastructure** | | **6** | |
| | Test fixtures for provider responses | 2 | Contract tests |
| | Supabase local dev / testcontainers setup | 2 | Auth + RLS integration |
| | Concurrency test harness | 1 | |
| | Load test scripts (infra + AI separate) | 1 | k6 scripts |
| **9.5I: Integration & Hardening** | | **7** | |
| | End-to-end integration tests | 3 | Real provider + Supabase |
| | Migration verification (staging) | 1 | |
| | Failure testing (RLS rollback, rate limiter fail-closed) | 2 | |
| | Documentation updates | 1 | |
| **TOTAL ENGINEERING EFFORT** | | **62 person-days** | |

### 13.2 Calendar Duration (with 1 engineer)

| Phase | Calendar Weeks | Notes |
|-------|----------------|-------|
| 9.5A.0 | 0.5 | Parallel verification tasks |
| 9.5A.1 | 3 | Sequential dependencies; 9.5A.0 must complete first |
| 9.5B | 2 | Can start after 9.5A.1 auth middleware |
| 9.5C | 1.5 | Depends on 9.5A.1 DB |
| 9.5D | 1 | Depends on 9.5B provider, 9.5C rate limiter |
| 9.5E | 1 | Depends on 9.5A.1 DB |
| 9.5F | 0.5 | Independent |
| 9.5G | 1 | Depends on 9.5A.1 auth |
| 9.5H | 1.5 | Parallel with implementation |
| 9.5I | 1.5 | After all features |
| **TOTAL CALENDAR** | **~12.5 weeks** | ~3 months, includes debugging, migration verification, deployment, failure testing |

### 13.3 Key Dependencies
- 9.5A must complete before 9.5B (orchestrator needs auth), 9.5C (needs DB), 9.5E (needs DB), 9.5G (needs auth)
- 9.5B and 9.5C can run in parallel after 9.5A
- 9.5D requires 9.5B (provider) and 9.5C (token_budget scope)
- 9.5H runs throughout; 9.5I requires all features complete

---

## 14. Architectural Changes Made (vs Original Plan)

| Area | Original Plan | Revised Plan |
|------|---------------|--------------|
| **Auth Sync** | Database trigger | Application-level sync on signup/login |
| **Verified Identity → Prisma** | Assumed `auth.uid()` works | Middleware extracts JWT.sub; passed via request context; Prisma queries filtered by `user_id` |
| **RLS Strategy** | `auth.uid()` in policies | Transaction-scoped `SET LOCAL app.current_user_id`; policies use `current_setting()` |
| **RLS Scope** | conversations, messages only | ALL user-owned application tables (15+) |
| **Rate Limiter Expired Window** | Not specified | Atomic upsert with `WHERE window_start = $3` prevents race condition |
| **postgresRateLimitStore.ts** | Missing from inventory | **Added** as required file |
| **Rate Limit Scopes** | User + IP only | User, IP, endpoint, token_budget (separate keys/policies) |
| **AI Endpoints Fail-Closed** | Implied | Explicit: token_budget scope `failClosed: true`; store unavailable → 503 |
| **Token Budgets** | Approximate local counting | Separate: local estimation (reservation) vs provider-reported (accounting) |
| **Token Reservation** | Not specified | Atomic pre-generation reservation; reconcile post-generation; release on failure |
| **Idempotency** | Client key + rate limiter check | Atomic claim with unique `(user_id, key)` constraint; request hash; state machine |
| **AI Provider Fallback** | Automatic Anthropic→Mock | **Removed**; mock ONLY when `AI_PROVIDER=mock` |
| **Provider Failure** | Fallback to mock | Explicit errors; no fabricated responses |
| **Provider Lifecycle** | Per-request | Long-lived instance with startup/shutdown |
| **Token Usage Authority** | Local counting | Provider-reported authoritative |
| **Chain-of-Thought** | `reasoningTrace` in schema | **Removed**; no hidden CoT exposure |
| **Provider Identity** | Model output | Factory-assigned (`metadata.name`, `metadata.isMock`) |
| **Rollback to client userId** | Listed as option | **Forbidden** — hard constraint |
| **Disable AI Rate Limits** | Listed as recovery | **Forbidden** as routine mechanism |
| **Credentials** | Not specified | Server-only: AI_API_KEY, SERVICE_ROLE_KEY, direct DATABASE_URL |
| **Audit Retention** | 90 days | Configurable, cleanup job, hard delete |
| **Test Categories** | Not separated | 7 distinct categories with measurable criteria |
| **Performance Targets** | 100 users, p95<2s, zero errors | Infrastructure vs AI latency separated; specific measurable targets |
| **File Inventory** | Incomplete | Complete: every source, migration, repo, test, config file listed |

---

## 15. Resolved Technical Decisions

All eight decisions resolved per architecture review conditional approval. Defaults applied unless repository inspection revealed incompatibility.

| # | Decision | Resolution | Rationale |
|---|----------|------------|-----------|
| 1 | **RLS + Application-Level Ownership Checks** | **Enable RLS on all user-owned tables** (`conversations`, `conversation_messages`, `profiles`, `goals`, `workouts`, `measurements`, `nutrition_logs`, `decisions`, `body_measurements`, `muscle_structures`, `environments`, `equipment`, `exercise_preferences`, `knowledge_exercises`, `form_guidance`, `evidence_inputs`, `plan_versions`) with transaction-scoped `SET LOCAL app.current_user_id`. Application-level ownership checks preserved as defense-in-depth. | Defense-in-depth: RLS is the primary enforcement; application checks catch logic errors. All tables protected consistently. |
| 2 | **Token Budget: Expiring Reservations with Lease-Based Recovery** | **Lease-based reservations** with TTL (`AI_TOKEN_RESERVATION_TTL_MINUTES=5`). Reservation record includes `lease_expires_at`. On generation start, extend lease. On completion, reconcile actual usage and release lease. Cleanup job releases expired leases (returns tokens to budget). | Prevents stranded reservations from failed/timeouts/abandoned requests. No negative increments needed. |
| 3 | **Idempotency Key TTL** | **24 hours default** (`IDEMPOTENCY_TTL_HOURS=24`), configurable via env. Keys auto-expire; cleanup job removes expired rows daily. | Balances replay protection with storage. 24h covers typical client retry windows. |
| 4 | **Scheduled Cleanup Workers** | **Two-tier cleanup**:<br>• **High-frequency token lease cleanup** (1–5 min): `apps/api/src/jobs/tokenLeaseCleanup.ts` — reclaims expired token reservations atomically across all users. Runs as standalone worker with service-role credentials.<br>• **Daily maintenance cleanup** (`apps/api/src/jobs/cleanup.ts`): expired rate limit counters, expired idempotency keys (24h TTL), audit trail older than `AUDIT_RETENTION_DAYS`. Runs via Node `node-cron` or external scheduler. | Separates latency-sensitive lease reclamation (must run frequently to unblock budgets) from long-lived record cleanup. Both portable, observable in application logs. |
| 5 | **Supabase CI Strategy** | **Local Supabase (CLI) for PR CI integration tests**; **Isolated hosted Supabase project for deployment smoke tests**. Local for fast feedback on auth/RLS/migrations; hosted for real-network validation pre-release. | Local is fast and free; hosted catches networking/pooling/RLS differences. |
| 6 | **Defer OpenAIProvider — Fail Clearly** | **Stub only** (`packages/ai/src/openaiProvider.ts` implements `AIProvider` but **every method throws `OpenAIProviderNotImplementedError`** with message: `"OpenAI provider not implemented. Set AI_PROVIDER=anthropic or AI_PROVIDER=mock."`). Factory **throws at startup** if `AI_PROVIDER=openai` — fails fast, no warning-only fallback. Tests verify explicit failure. | Fail-fast prevents accidental production use. Clear error guides operator to valid providers. |
| 7 | **Audit Trail: Minimal Structured Metadata** | **Structured summary only**: `{ action, resource, resourceId, userId, outcome, durationMs, metadata: { key: value } }`. No full request/response bodies. No chain-of-thought. `AUDIT_VERBOSE` flag removed. | Privacy/compliance: avoids PII and hidden CoT leakage. Structured metadata enables querying. |
| 8 | **JWKS Cache TTL** | **5 minutes** with **unknown-`kid` refresh**. Cache JWKS for 5 min; on `jwtVerify` failure with `kid` not in cache, force single refresh then retry once. `JOSE` library handles this via `createRemoteJWKSet` with custom `cacheMaxAge`. | Balances rotation responsiveness (Supabase rotates ~hourly) with latency. 5min < rotation interval. |

---

### 15.1 RLS Security Limitations & Trust Boundary Documentation

**`app.current_user_id` is Trusted Application Context, Not Independent PostgreSQL Identity**

`current_setting('app.current_user_id')` is set by the application middleware from the verified Supabase JWT. It is **not** an independently authenticated PostgreSQL identity. The database trusts the application to supply the correct value. If the application is compromised, RLS can be bypassed by setting a different `user_id`.

**Mandatory Controls:**

| Control | Requirement |
|---------|-------------|
| **Least-Privilege Application Role** | `DATABASE_URL_POOLED` connects as a custom role (e.g., `app_user`) with `NOINHERIT` and **no `BYPASSRLS`**. Grants: `SELECT, INSERT, UPDATE, DELETE` on user-owned tables only. No `CREATE`, `DROP`, `ALTER`, `TRUNCATE`. Service role (`postgres` equivalent) used ONLY for migrations, seed, cleanup jobs — separate connection string, never for request handling. |
| **Transaction-Local Context + Same-Transaction Protected Queries** | Middleware executes `SET LOCAL app.current_user_id = '<userId>'` **inside the same explicit transaction** (`$transaction`) that runs the protected queries. Prisma implicit transactions are insufficient — every multi-query operation must use `$transaction([...])` with `SET LOCAL` as the first statement. Single-query operations: wrap in `$transaction` or verify Prisma executes `SET LOCAL` and query in same physical transaction under PgBouncer. |
| **PgBouncer Transaction Pooling Implications** | Supabase PgBouncer runs in **transaction pooling mode**: each client transaction gets a server connection, released on `COMMIT`/`ROLLBACK`. `SET LOCAL` persists only for that transaction. **Implication**: middleware must set `app.current_user_id` at the start of **every** `$transaction`. Prisma's default behavior (one query = one transaction) works if `SET LOCAL` is issued via `$executeRaw` before the query in the same `$transaction` array. Long-running operations must not rely on session-level state. |
| **SECURITY DEFINER Functions & Privilege Boundaries** | **Audit requirement**: zero `SECURITY DEFINER` functions on user-owned tables. Any such function runs as definer (typically service role) and bypasses RLS. Migration must include: `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC;` for any existing definer functions. Application role must not own or be able to create `SECURITY DEFINER` functions. |

**Transaction-Scoped Custom Settings (`SET LOCAL app.current_user_id`) — Limitations:**

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| **Session-scoped in some drivers** | Prisma query batching may span multiple physical transactions, losing `LOCAL` | Use explicit `$transaction([SET_LOCAL, query1, query2])` for all multi-query operations; verify with PgBouncer |
| **No protection against `SET LOCAL` override** | Compromised app code could set another user's ID | Defense-in-depth: application-level `where: { userId }` on every query; audit trail records JWT-verified `userId` |
| **RLS bypass via `SECURITY DEFINER` functions** | Definer functions run as service role, bypass RLS | Zero definer functions on user tables (audited in migration); app role cannot create them |
| **PgBouncer transaction pooling** | `SET LOCAL` lost after each transaction | Mandatory: `SET LOCAL` as first statement in every `$transaction`; no session reuse assumptions |

**Trust Boundary: Application Database Role**

| Boundary | Description |
|----------|-------------|
| **Service Role (Supabase)** | Full `postgres` superuser equivalent. Used ONLY for: migrations, seed, cleanup jobs, admin operations. **Separate connection string (`DATABASE_URL`)**. NEVER used for application request handling. |
| **Application Role (Pooled Connection)** | `DATABASE_URL_POOLED` connects as custom `app_user` role: `NOINHERIT`, **no `BYPASSRLS`**, grants `SELECT, INSERT, UPDATE, DELETE` on user tables only. RLS enforced. Cannot `SET ROLE`, `CREATE FUNCTION SECURITY DEFINER`, or escalate. |
| **JWT-Verified Identity** | Middleware extracts `userId` from verified Supabase JWT. Single source of truth for request context. Prisma queries filtered by `where: { userId }` as application-level check. |
| **RLS Policy Context** | `current_setting('app.current_user_id')` set at **transaction start** from middleware-verified `userId`. Policies: `user_id = current_setting('app.current_user_id')::uuid`. |
| **Compromise Scenario** | If `app_user` role compromised: attacker sees only RLS-permitted data (one user). Service role separate. Rotation: rotate `DATABASE_URL_POOLED` independently. |

**Key Principle**: RLS is the **primary enforcement layer**. Application-level `userId` filtering is **defense-in-depth**. Never rely on only one. **The application role must be least-privilege with no `BYPASSRLS` and no `SECURITY DEFINER` capability.**

---

## 16. Implementation-Readiness Assessment

| Criterion | Status | Notes |
|-----------|--------|-------|
| **Architecture Defined** | ✅ Complete | All 9 correction areas addressed |
| **File Inventory Complete** | ✅ Complete | 47 source files, 4 migrations, 17 test files, 4 config files |
| **Dependencies Mapped** | ✅ Complete | Critical path: Auth → DB → Rate Limit/Idempotency → Token Budget → Orchestrator |
| **Estimates Realistic** | ✅ Complete | 62 person-days / 12.5 calendar weeks with buffers |
| **Test Strategy Defined** | ✅ Complete | 7 categories, measurable criteria, separated infra vs AI latency |
| **Rollback Procedures Safe** | ✅ Complete | No client-userId rollback; RLS disable verified; fail-closed preserved |
| **Security Constraints Enforced** | ✅ Complete | Server-only credentials; no CoT; explicit mock; no auto-fallback |
| **Migration Strategy Verified** | ⚠️ Needs Review | **Phase 9.5A.0 verifies**: Supabase connectivity, app_user role (no BYPASSRLS), PgBouncer transaction pooling, RLS policy syntax & index usage — must pass before 9.5A.1 |
| **Technical Decisions Resolved** | ✅ Complete | All 8 decisions resolved in Section 15 with rationale |

**Overall Readiness**: **Conditionally Approved** — all mandatory corrections incorporated, decisions resolved, file inventory complete, estimates revised, test strategy defined. Migration verification on Supabase project required before 9.5A.1 starts.

---

## 17. Phase 9.5A.0 — Supabase Infrastructure Verification (Pre-Implementation)

**Prerequisites**: Phase 9.4 complete; Supabase project provisioned; owner approval.

**Estimated Effort**: 2 person-days (0.5 calendar weeks)

### 17.0 Task List

| Task ID | Task | Effort (days) | Files Affected | Prerequisites | Acceptance Criteria |
|---------|------|---------------|----------------|---------------|---------------------|
| **9.5A.0.1** | **Verify Supabase Project Connectivity** | 0.5 | None (manual verification) | Supabase project URL, keys | • Direct connection (port 5432) works: `psql $DATABASE_URL -c 'SELECT 1'`<br>• Pooled connection (port 6543) works: `psql $DATABASE_URL_POOLED -c 'SELECT 1'`<br>• Supabase Auth JWKS endpoint accessible: `curl $SUPABASE_URL/auth/v1/.well-known/jwks.json` |
| **9.5A.0.2** | **Verify Database Role & Privileges** | 0.5 | None (manual verification) | 9.5A.0.1 | • Service role (`DATABASE_URL`) has superuser privileges<br>• Application role (`DATABASE_URL_POOLED`) is custom `app_user` with `NOINHERIT`, no `BYPASSRLS`<br>• `app_user` grants: `SELECT, INSERT, UPDATE, DELETE` on user tables only<br>• No `SECURITY DEFINER` functions owned by `app_user` on user tables |
| **9.5A.0.3** | **Verify PgBouncer Transaction Pooling Behavior** | 0.5 | Test script (temporary) | 9.5A.0.2 | • `SET LOCAL app.current_user_id` persists within single transaction<br>• Connection released after `COMMIT`/`ROLLBACK`<br>• Prisma `$transaction` keeps same physical connection for all queries in array |
| **9.5A.0.4** | **Verify RLS Policy Syntax & Performance** | 0.5 | Test migration (temporary) | 9.5A.0.2 | • `CREATE POLICY` with `user_id = current_setting('app.current_user_id')::uuid` works<br>• `EXPLAIN ANALYZE` shows index usage on `user_id` columns<br>• No sequential scans on user-owned tables under RLS |

### 17.0.1 Dependencies
All 9.5A.0 tasks are independent and can run in parallel. **All must pass before 9.5A.1 starts.**

---

## 17.0.2 Phase 9.5A.0 Verification Results (2025-01-XX)

**Verification Date**: 2025-01-XX
**Verifier**: Automated verification attempt
**Overall Status**: **BLOCKED** — Supabase project not provisioned; credentials missing

### Task-by-Task Results

#### 9.5A.0.1 — Verify Supabase Project Connectivity: **UNVERIFIED (BLOCKED)**

| Check | Status | Evidence |
|-------|--------|----------|
| `DATABASE_URL` (direct, port 5432) | ❌ Missing | No Supabase project configured. Current `.env` uses local PostgreSQL: `postgresql://postgres:postgres@127.0.0.1:5432/fitcoach` |
| `DATABASE_URL_POOLED` (PgBouncer, port 6543) | ❌ Missing | No Supabase pooled connection string available |
| `SUPABASE_URL` | ❌ Missing | Not configured |
| `SUPABASE_ANON_KEY` | ❌ Missing | Not configured |
| `SUPABASE_SERVICE_ROLE_KEY` | ❌ Missing | Not configured |
| JWKS endpoint (`$SUPABASE_URL/auth/v1/.well-known/jwks.json`) | ❌ Cannot test | Requires `SUPABASE_URL` |

**Commands attempted**: None (credentials missing)
**Blocker**: Supabase project not provisioned. Owner must provision project and share:
- `SUPABASE_URL` (e.g., `https://xxxxx.supabase.co`)
- `SUPABASE_ANON_KEY` (client-safe)
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `DATABASE_URL` (direct, port 5432)
- `DATABASE_URL_POOLED` (PgBouncer, port 6543)

#### 9.5A.0.2 — Verify Database Role & Privileges: **UNVERIFIED (BLOCKED)**

| Check | Status | Evidence |
|-------|--------|----------|
| Service role has superuser privileges | ❌ Cannot test | Requires Supabase `DATABASE_URL` |
| Application role is custom `app_user` | ❌ Cannot test | Requires Supabase `DATABASE_URL_POOLED` |
| `app_user` has `NOINHERIT`, no `BYPASSRLS` | ❌ Cannot test | Requires Supabase project |
| `app_user` grants: `SELECT, INSERT, UPDATE, DELETE` on user tables only | ❌ Cannot test | Requires Supabase project |
| No `SECURITY DEFINER` functions owned by `app_user` on user tables | ❌ Cannot test | Requires Supabase project |

**Blocker**: Same as 9.5A.0.1 — Supabase project not provisioned.

#### 9.5A.0.3 — Verify PgBouncer Transaction Pooling Behavior: **UNVERIFIED (BLOCKED)**

| Check | Status | Evidence |
|-------|--------|----------|
| `SET LOCAL app.current_user_id` persists within single transaction | ❌ Cannot test | Requires Supabase PgBouncer pooled connection |
| Connection released after `COMMIT`/`ROLLBACK` | ❌ Cannot test | Requires Supabase PgBouncer pooled connection |
| Prisma `$transaction` keeps same physical connection for all queries in array | ❌ Cannot test | Requires Supabase PgBouncer pooled connection |

**Test script prepared**: Yes (see below)
**Blocker**: Same as 9.5A.0.1 — Supabase project not provisioned.

**Prepared test script** (`verify-pgbouncer.ts`):
```typescript
import { createPrismaClient } from '@fitcoach/db/client';

async function verifyPgBouncer() {
  const prisma = createPrismaClient({ url: process.env.DATABASE_URL_POOLED });
  
  // Test 1: SET LOCAL persists within transaction
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.current_user_id = 'test-user-id'`;
    const result = await tx.$queryRaw`SELECT current_setting('app.current_user_id')`;
    console.log('Test 1 - SET LOCAL in transaction:', result);
  });
  
  // Test 2: SET LOCAL does NOT persist across transactions
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.current_user_id = 'test-user-id-2'`;
  });
  await prisma.$transaction(async (tx) => {
    const result = await tx.$queryRaw`SELECT current_setting('app.current_user_id')`;
    console.log('Test 2 - SET LOCAL not persisted:', result); // Should be empty/error
  });
  
  // Test 3: Multiple queries in $transaction share connection
  const results = await prisma.$transaction([
    prisma.$executeRaw`SET LOCAL app.current_user_id = 'test-user-id-3'`,
    prisma.$queryRaw`SELECT current_setting('app.current_user_id')`,
    prisma.$queryRaw`SELECT 1 as dummy`,
  ]);
  console.log('Test 3 - Multiple queries in $transaction:', results);
  
  await prisma.$disconnect();
}
```

#### 9.5A.0.4 — Verify RLS Policy Syntax & Performance: **UNVERIFIED (BLOCKED)**

| Check | Status | Evidence |
|-------|--------|----------|
| `CREATE POLICY` with `user_id = current_setting('app.current_user_id')::uuid` works | ❌ Cannot test | Requires Supabase project |
| `EXPLAIN ANALYZE` shows index usage on `user_id` columns | ❌ Cannot test | Requires Supabase project with data |
| No sequential scans on user-owned tables under RLS | ❌ Cannot test | Requires Supabase project with data |

**Prepared test migration** (temporary):
```sql
-- Test RLS policy creation
CREATE POLICY test_policy ON conversations
  USING (user_id = current_setting('app.current_user_id')::uuid);
  
-- Test query plan
SET LOCAL app.current_user_id = '00000000-0000-0000-0000-000000000000';
EXPLAIN ANALYZE SELECT * FROM conversations WHERE user_id = '00000000-0000-0000-0000-000000000000';

-- Cleanup
DROP POLICY test_policy ON conversations;
```

### 17.0.3 User-Owned Tables Inventory (for RLS)

Per Section 15.1 and schema inspection, the following **17 tables** require RLS policies:

| Table | Primary Key | User FK Column | Index on user_id |
|-------|-------------|----------------|------------------|
| `conversations` | `id` | `user_id` | ✅ `conversations_user_id_updated_at_idx` |
| `conversation_messages` | `id` | via `conversation_id` → `conversations.user_id` | ⚠️ Indirect (no direct index) |
| `profiles` | `user_id` (PK) | `user_id` (PK) | ✅ PK |
| `goals` | `id` | `user_id` | ✅ `@@index([userId, activeFrom])` |
| `workouts` | `id` | `user_id` | ✅ `@@index([userId, startedAt])` |
| `body_measurements` | `id` | `user_id` | ✅ `@@index([userId, date])` |
| `nutrition_logs` (→ `meals`) | `id` | `user_id` | ✅ `@@index([userId, localDate])` |
| `daily_nutrition` | composite | `user_id` | ✅ `@@index([userId, localDate])` |
| `decisions` (→ `decision_snapshots`) | `id` | `user_id` | ✅ `@@index([userId, createdAt])` |
| `training_environment_periods` | `id` | `user_id` | ✅ `@@index([userId, validFrom])` |
| `user_equipment` | composite | `user_id` | ✅ `@@index([userId, validFrom])` |
| `user_exercise_preferences` | composite | `user_id` | ✅ `@@index([userId])` |
| `knowledge_exercises` | `id` | `owner_user_id` (nullable) | ⚠️ Nullable owner |
| `form_guidance` | `id` | `owner_user_id` (nullable) | ⚠️ Nullable owner |
| `evidence_inputs` | `id` | via `decision_snapshot_id` | ⚠️ Indirect |
| `plan_versions` (→ `training_plans`) | `id` | via `training_plan_id` | ⚠️ Indirect |
| `projection_snapshots` | `id` | `user_id` | ✅ `@@index([userId, generatedAt])` |

**Notes**:
- Tables with nullable `owner_user_id` (`knowledge_exercises`, `form_guidance`) are global/shared when null — RLS policy must handle `owner_user_id IS NULL` as publicly readable
- Indirect ownership tables need policy via JOIN or `EXISTS` subquery
- All tables have `user_id` or cascade through parent with `user_id` (per schema design note)

### 17.0.4 Phase 9.4 Regression Baseline

**Test Suite Run**: 2025-01-XX
**Result**: **534 pass, 5 fail** (98.1% pass rate)

| Failing Test | Error |
|--------------|-------|
| Journey B: temporary home plan preserves the gym plan | Assertion error |
| Journey C: a session the user skips stays missed | Assertion error |
| planner generates a persisted, budget-aware plan through the HTTP route | Assertion error |
| adaptation records a no_change decision without rewriting the version | TypeError: Cannot read properties of undefined (reading 'reasonCodes') |
| adaptation after declining performance produces a new version and comparison | TypeError: Cannot read properties of undefined (reading 'evidence') |

**Assessment**: Phase 9.4 baseline has **pre-existing failures** (5/539 tests). These must be resolved before Phase 9.5A.0 can be considered complete per the "Zero Phase 9.4 regressions" DoD criterion.

### 17.0.5 Summary & Blockers

| Blocker | Severity | Resolution |
|---------|----------|------------|
| **Supabase project not provisioned** | 🔴 Critical | Owner must provision Supabase project and provide all 5 credentials |
| **Phase 9.4 test failures (5 tests)** | 🟠 High | Fix failing tests before 9.5A.0 DoD can be met |
| **No Supabase credentials in `.env`** | 🔴 Critical | Owner must add credentials to `.env` (not committed) |

**Phase 9.5A.0 Verdict**: **NOT PASSED** — Cannot proceed to 9.5A.1 until:
1. Supabase project provisioned and credentials provided
2. Phase 9.4 regression baseline passes (539/539)

**Estimated time to unblock**: 1–2 days after Supabase project provisioned and credentials shared.

---

## 17.1 Phase 9.5A.1 Task Breakdown — Supabase Auth Integration & Database Foundation

**Prerequisites**: Phase 9.4 complete (all tests passing, build clean); **Phase 9.5A.0 complete**; owner approval of resolved decisions (Section 15).

**Estimated Effort**: **14 person-days** (3 calendar weeks for 1 engineer)

### 17.1 Task List

| Task ID | Task | Effort (days) | Files Affected | Prerequisites | Acceptance Criteria |
|---------|------|---------------|----------------|---------------|---------------------|
| **9.5A.1.1** | **Supabase JWT Verification Middleware** | 3 | `apps/api/src/auth/supabaseAuth.ts`<br>`apps/api/src/auth/middleware.ts`<br>`apps/api/src/auth/__tests__/supabaseAuth.test.ts` | Supabase project URL, JWKS endpoint accessible | • `verifySupabaseToken()` validates JWT via JWKS<br>• Middleware attaches `{ userId, email }` to request<br>• Rejects expired/invalid/malformed tokens (401)<br>• JWKS cached 5min; unknown-`kid` triggers refresh + retry once<br>• Unit tests: valid token, expired token, invalid signature, rotated key |
| **9.5A.1.2** | **Application-Level Auth Sync (No Trigger)** | 2 | `apps/api/src/services/authSync.ts` (new)<br>`apps/api/src/services/index.ts`<br>`apps/api/src/routes.ts` (signup/login endpoints) | 9.5A.1.1 complete | • On signup: create `public.users` row with `supabase_user_id = JWT.sub`<br>• On login: upsert `public.users` if missing (idempotent)<br>• No database trigger — sync in application code<br>• Integration test: signup → user row created; login → user row exists |
| **9.5A.1.3** | **RLS Migration: All User-Owned Tables** | 3 | `packages/db/prisma/migrations/20261112_add_supabase_auth/`<br>`packages/db/prisma/schema.prisma`<br>`packages/db/src/__tests__/rls.integration.ts` | Supabase project; 9.5A.1.1 middleware working; **9.5A.0 complete** | • Migration adds `supabase_user_id` UUID unique to `users`<br>• RLS enabled on 17 user-owned tables (see Section 15.1)<br>• Policies: `user_id = current_setting('app.current_user_id')::uuid`<br>• `SET LOCAL app.current_user_id` set in middleware **inside Prisma `$transaction`** before protected queries<br>• **RLS integration test uses `DATABASE_URL_POOLED` (app_user role), transaction pooling**<br>• Integration test: user A cannot read user B data via Prisma; service role bypasses RLS<br>• Test verifies `SET LOCAL` + query execute in same physical transaction under PgBouncer |
| **9.5A.1.4** | **Connection Config: Pooled vs Direct** | 1 | `.env.example`<br>`apps/api/src/http.ts` (Prisma client init)<br>`packages/db/package.json` | Supabase project provisioned | • `DATABASE_URL` (port 5432) used for migrations/seed only<br>• `DATABASE_URL_POOLED` (port 6543, PgBouncer) used for runtime<br>• Prisma client initialized with pooled URL<br>• Verified: migrations apply via direct; queries route via pooled |
| **9.5A.1.5** | **Route Protection: Remove Client `userId`** | 2 | `apps/api/src/routes.ts`<br>`apps/api/src/validation.ts`<br>`apps/api/src/http.ts` (middleware pipeline) | 9.5A.1.1 complete | • All `/v0/conversations*` routes require auth middleware<br>• `userId` derived from `req.auth.userId` — never from URL params<br>• Old `/v0/users/:userId/conversations*` routes return 410 (gone)<br>• Integration test: request without token → 401; with token → 200; wrong user → 403 (RLS) |
| **9.5A.1.6** | **Frontend: Supabase Session Context** | 2 | `apps/web/src/session/SupabaseSessionContext.tsx` (new, replaces `SessionContext.tsx`)<br>`apps/web/src/lib/supabaseClient.ts` (new)<br>`apps/web/src/api/client.ts`<br>`apps/web/src/screens/OnboardingScreen.tsx`<br>`apps/web/src/__tests__/mockApi.ts` | 9.5A.1.1 complete | • `SupabaseSessionProvider` wraps Supabase auth state<br>• `useSupabaseAuth()` returns `{ user, session, signIn, signUp, signOut }`<br>• API client adds `Authorization: Bearer <access_token>` header<br>• OnboardingScreen: sign-up/sign-in flow with Supabase<br>• Tests: auth header included; mock API supports auth |
| **9.5A.1.7** | **Environment Configuration** | 1 | `.env.example`<br>`apps/api/package.json` (`@supabase/supabase-js`, `jose`)<br>`packages/ai/package.json` (no new deps) | Supabase project credentials | • All Section 17 placeholders documented in `.env.example`<br>• `@supabase/supabase-js` for frontend; `jose` for JWT verification<br>• No secrets in code; service role key server-only |

### 17.2 Dependencies & Critical Path

```
9.5A.1.1 (JWT Middleware)
    ├─→ 9.5A.1.2 (Auth Sync)
    ├─→ 9.5A.1.3 (RLS Migration) ← requires Supabase project
    ├─→ 9.5A.1.4 (Connection Config) ← independent, can parallel
    ├─→ 9.5A.1.5 (Route Protection) ← requires 9.5A.1.1
    └─→ 9.5A.1.6 (Frontend Auth) ← requires 9.5A.1.1
    └─→ 9.5A.1.7 (Env Config) ← independent, do first
```

**Blocking**: 9.5A.1.3 requires Supabase project access. All other tasks can proceed with local Supabase CLI.

### 17.3 Definition of Done for Phase 9.5A

- [ ] **Phase 9.5A.0 complete**: Supabase connectivity, roles, PgBouncer, RLS syntax verified
- [ ] All 7 tasks in 9.5A.1 complete with passing tests
- [ ] Supabase JWT verification works end-to-end (frontend → API → DB)
- [ ] RLS enforced on all 17 user-owned tables; verified via integration tests **using `DATABASE_URL_POOLED` (app_user role), transaction pooling**
- [ ] No route accepts client-supplied `userId`; all use `req.auth.userId`
- [ ] Frontend sign-up/sign-in works with Supabase; session persists across refresh
- [ ] Pooled connection used for runtime; direct for migrations
- [ ] Zero Phase 9.4 regressions (run full test suite)

### 17.4 Files Created/Modified in 9.5A.1

**Created (11):**
- `apps/api/src/auth/supabaseAuth.ts`
- `apps/api/src/auth/middleware.ts`
- `apps/api/src/auth/__tests__/supabaseAuth.test.ts`
- `apps/api/src/services/authSync.ts`
- `packages/db/prisma/migrations/20261112_add_supabase_auth/migration.sql`
- `packages/db/src/__tests__/rls.integration.ts`
- `apps/web/src/session/SupabaseSessionContext.tsx`
- `apps/web/src/lib/supabaseClient.ts`
- `apps/api/src/auth/rateLimitStore.ts` (interface — stub for 9.5C)
- `apps/api/src/auth/postgresRateLimitStore.ts` (stub — implemented in 9.5C)
- `apps/api/src/auth/rateLimiter.ts` (stub — implemented in 9.5C)

**Modified (8):**
- `packages/db/prisma/schema.prisma` (`supabase_user_id`, RLS annotations)
- `apps/api/src/routes.ts` (auth middleware, route changes)
- `apps/api/src/http.ts` (middleware pipeline, Prisma client config)
- `apps/api/src/validation.ts` (auth helpers)
- `apps/api/src/services/index.ts` (exports)
- `apps/web/src/api/client.ts` (auth header)
- `apps/web/src/screens/OnboardingScreen.tsx` (Supabase flow)
- `apps/web/src/__tests__/mockApi.ts` (auth mocking)
- `.env.example` (all placeholders)
- `apps/api/package.json` (deps)
- `packages/ai/package.json` (no change)

---

## 19. Remaining Blockers

| Blocker | Description | Resolution Path |
|---------|-------------|-----------------|
| **Supabase Project Access** | Phase 9.5A.0 and 9.5A.1.3 require a provisioned Supabase project with: custom `app_user` role (no `BYPASSRLS`), PgBouncer transaction pooling, direct + pooled connection strings | Owner provisions project; shares `DATABASE_URL`, `DATABASE_URL_POOLED`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| **Owner Approval of Resolved Decisions** | Section 15 decisions (RLS scope, token lease, cleanup workers, OpenAI fail-clear, audit minimalism, JWKS 5min) require explicit owner sign-off | Owner reviews Section 15, confirms or requests changes |
| **Owner Approval of 9.5A.0 + 9.5A.1 Task Breakdown** | Section 17 task estimates, dependencies, acceptance criteria require owner approval | Owner reviews Section 17, approves or requests changes |
| **Phase 9.4 Regression Baseline** | Zero-regression requirement for Phase 9.5A DoD needs confirmed passing Phase 9.4 test suite | Run full test suite before 9.5A.0 starts; document baseline |

**No technical blockers** — all architecture decisions resolved, file inventory complete, estimates revised, test strategy defined. Blockers are exclusively access and approval.

---

## 20. Plan Status

**Plan Status**: **Phase 9.5A.0 BLOCKED — Awaiting Supabase Project Provisioning**
**Next Step**: 
1. Owner provisions Supabase project and provides: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (direct), `DATABASE_URL_POOLED` (PgBouncer)
2. Owner adds credentials to `.env` (not committed)
3. Fix Phase 9.4 test failures (5 failing tests)
4. Re-run Phase 9.5A.0 verification
5. If all pass, authorize 9.5A.1 start

---

## 21. Appendix: Updated `.env.example` Placeholders

```bash
# ---------------------------------------------------------------------------
# Supabase (Phase 9.5)
# ---------------------------------------------------------------------------
# Supabase project URL (e.g., https://xxxxx.supabase.co)
SUPABASE_URL=
# Supabase anon key (client-safe, used by frontend)
NEXT_PUBLIC_SUPABASE_ANON_KEY=
# Supabase service role key (SERVER ONLY - never expose to frontend)
SUPABASE_SERVICE_ROLE_KEY=
# PostgreSQL connections
# Direct connection (for migrations, seed, admin)
DATABASE_URL="postgresql://postgres:password@db.xxxxx.supabase.co:5432/postgres"
# Pooled connection (for runtime via PgBouncer)
DATABASE_URL_POOLED="postgresql://postgres:password@db.xxxxx.supabase.co:6543/postgres?pgbouncer=true"

# ---------------------------------------------------------------------------
# AI Provider (Phase 9.5)
# ---------------------------------------------------------------------------
# Provider: "anthropic" | "openai" | "mock" — mock ONLY when explicitly set
AI_PROVIDER=mock
# Model identifier (e.g., "claude-3-5-sonnet-20241022", "gpt-4o")
AI_MODEL=
# API key for real provider (REQUIRED when AI_PROVIDER != "mock")
# NEVER commit real keys. Use environment secret management.
AI_API_KEY=
# Optional provider tuning
AI_MAX_TOKENS=4096
AI_TIMEOUT_MS=120000
AI_MAX_RETRIES=3

# ---------------------------------------------------------------------------
# Rate Limiting (Phase 9.5)
# ---------------------------------------------------------------------------
# Enable rate limiting (set to "false" to disable entirely)
RATE_LIMIT_ENABLED=true
# Fail closed when rate limiter store unavailable (AI endpoints) — MANDATORY true for AI
RATE_LIMIT_FAIL_CLOSED=true
# Per-user coaching message limits
RATE_LIMIT_COACHING_PER_MINUTE=10
RATE_LIMIT_COACHING_PER_HOUR=60
# Per-user conversation creation limit
RATE_LIMIT_CONVERSATION_CREATE_PER_MINUTE=10
# Per-IP general API limit
RATE_LIMIT_GENERAL_PER_MINUTE=120
# Daily AI token budget per user
RATE_LIMIT_AI_TOKENS_DAILY=100000

# ---------------------------------------------------------------------------
# Token Budget (Phase 9.5)
# ---------------------------------------------------------------------------
# Enable daily AI token budget enforcement
AI_TOKEN_BUDGET_ENABLED=true
# Minimum tokens to reserve per request (avoids over-reservation)
AI_TOKEN_MIN_RESERVATION=100

# ---------------------------------------------------------------------------
# Idempotency (Phase 9.5)
# ---------------------------------------------------------------------------
# Enable idempotency key deduplication
IDEMPOTENCY_ENABLED=true
# TTL for idempotency keys (hours)
IDEMPOTENCY_TTL_HOURS=24

# ---------------------------------------------------------------------------
# Audit Trail (Phase 9.5)
# ---------------------------------------------------------------------------
# Enable audit trail persistence
AUDIT_TRAIL_ENABLED=true
# Retention period (days)
AUDIT_RETENTION_DAYS=90
# Log full request/response bodies (verbose)
AUDIT_VERBOSE=false

# ---------------------------------------------------------------------------
# Feature Flags (Phase 9.5)
# ---------------------------------------------------------------------------
# Enable RLS (can be disabled for emergency rollback)
RLS_ENABLED=true
```

---

**Plan Status**: **Decisions Resolved — Awaiting Owner Approval to Begin 9.5A.1**
**Next Step**: Owner reviews resolved decisions (Section 15), approves Phase 9.5A.1 task breakdown (Section 17), authorizes implementation start.