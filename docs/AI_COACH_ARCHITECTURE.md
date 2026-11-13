# FitCoach AI Coach — Architecture

**Phase 9.1 — Implementation Complete (Milestone 1)**
**Phase 9.2 — Implementation Complete (Milestone 2)**
**Status: Implemented**
**Verified against**: existing codebase interfaces, repositories, services, routes, frontend conventions; build passes with 0 errors; 72+ new tests pass

---

## 1. Core Principle

**The Unified Decision Brain remains authoritative.** The AI Coach interprets,
explains, and presents — it never invents calorie targets, training prescriptions,
readiness scores, body-fat values, diagnoses, or projection estimates.

This matches the existing `docs/ARCHITECTURE.md` principle: *"The LLM is not the
source of truth. Deterministic domain logic calculates facts and constraints.
The AI layer interprets those facts, handles natural-language input, explains
decisions and presents validated conclusions."*

The AI Coach is the **presentation and explanation layer** over deterministic
domain results. It:
- Reads the user's complete FitCoach context before answering
- Calls existing services/repositories (never duplicates calculations)
- Interprets Unified Decision Brain outputs in plain language
- Explains why a factor matters, with evidence references
- Communicates uncertainty and missing-data warnings
- Proposes actions through a typed action registry (requires explicit user confirmation)
- Executes confirmed actions through existing domain services

---

## 1.1 Milestone 1 Implementation Summary

### What was built — Milestone 1

| Component | Status | File(s) |
|-----------|--------|---------|
| Conversation Prisma model | ✅ | `packages/db/prisma/schema.prisma` |
| ConversationMessage Prisma model | ✅ | `packages/db/prisma/schema.prisma` |
| Migration SQL | ✅ | `packages/db/prisma/migrations/20261111120000_add_conversation_models/` |
| ConversationRepository | ✅ | `packages/db/src/repositories/conversation.ts` |
| ConversationMessageRepository | ✅ | `packages/db/src/repositories/conversation.ts` |
| DI registration | ✅ | `packages/db/src/repositories/index.ts` |
| Shared contracts | ✅ | `packages/ai/src/contracts.ts` |
| AIProvider interface | ✅ | `packages/ai/src/provider.ts` |
| MockAIProvider | ✅ | `packages/ai/src/mockProvider.ts` |

### What was built — Milestone 2

| Component | Status | File(s) |
|-----------|--------|---------|
| Evidence intelligence (freshness/completeness/reliability) | ✅ | `packages/ai/src/evidence.ts` |
| Intent-aware context source selection | ✅ | `packages/ai/src/contextSources.ts` |
| Personal Context Builder service | ✅ | `apps/api/src/services/aiCoaching/contextBuilder.ts` |
| AI Coach services barrel export | ✅ | `apps/api/src/services/aiCoaching/index.ts` |
| Contract: IntentClassification | ✅ | `packages/ai/src/contracts.ts` |
| Tests: conversation mapping | ✅ | `packages/db/src/__tests__/conversation.test.ts` |
| Tests: contracts validation | ✅ | `packages/ai/src/__tests__/contracts.test.ts` |
| Tests: mock provider behavior | ✅ | `packages/ai/src/__tests__/mockProvider.test.ts` |
| Tests: evidence evaluation | ✅ | `packages/ai/src/__tests__/evidence.test.ts` |
| Tests: context builder | ✅ | `apps/api/src/services/aiCoaching/__tests__/contextBuilder.test.ts` |

### What is NOT yet built (Milestones 3–5)

- Conversation Orchestrator service
- Response Validator
- Typed Action Registry
- API Routes (POST/GET /v0/users/:userId/conversations/*)
- Frontend Chat UI
- E2E acceptance scenarios A–H

**Test results**: 72+ new tests pass across 7 suites.
**Build results**: `tsc -b tsconfig.build.json` passes with 0 errors.
**Root typecheck**: `tsc -p tsconfig.json --noEmit` passes with 0 errors.
**Frontend typecheck**: `tsc -p apps/web/tsconfig.json --noEmit` passes with 0 errors.
**Existing unit tests**: 343 fitness-core, 24 nutrition, 20 db, 19 barcode — all pass.

---

## 2. System Context

The AI Coach slots into the existing layered architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                    CLIENT (React/Vite web app)                  │
│  Chat UI → typed API client → /v0/users/:userId/conversations/* │
└─────────────────────────────────────────────────────────────────┘
                                 │ HTTP /v0
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API (node:http router)                     │
│  routes.ts:  POST /conversations  POST /conversations/:id/msg   │
│              GET  /conversations  GET  /conversations/:id       │
│  validation: typed request bodies                               │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│              AI Coach Orchestration Service (NEW)               │
│  ConversationOrchestrator                                         │
│    ├── IntentRecognizer                                           │
│    ├── PersonalContextBuilder                                     │
│    ├── EvidenceEvaluator                                          │
│    ├── DecisionBrainAdapter                                       │
│    ├── CoachingRequestBuilder                                     │
│    ├── AIProvider (interface + mock impl)                        │
│    ├── ResponseValidator                                          │
│    └── ActionRegistry                                             │
└─────────────────────────────────────────────────────────────────┘
                                 │
              ┌──────────────────┴──────────────────┐
              ▼                                     ▼
┌─────────────────────┐                   ┌──────────────────┐
│ Existing Services   │                   │   packages/ai    │
│ (UnifiedDecision,   │                   │  AIProvider iface│
│  Training, Nutrition│                   │  (mock impl)     │
│  Body, Coaching, etc│                   └──────────────────┘
│  via Repositories   │
└─────────────────────┘                   ▲
              │                           │
              ▼                           │ mock responses
┌─────────────────────────────────────────────────────────────────┐
│                    PostgreSQL (Prisma)                          │
│  New tables: conversations, conversation_messages               │
│  Existing tables reused: all domain tables                      │
└─────────────────────────────────────────────────────────────────┘
```

**Package dependency direction (preserved):**
```
packages/domain → packages/fitness-core → packages/db → apps/api → apps/web
                               ↑              ↑
                         packages/nutrition  packages/ai
```

- `packages/ai` depends only on `@fitcoach/domain` (provider interfaces, request/response types)
- `apps/api` depends on `@fitcoach/ai` (provider interfaces), `@fitcoach/db` (repositories), `@fitcoach/domain`, `@fitcoach/nutrition`, `@fitcoach/fitness-core`
- `apps/web` calls API routes via typed fetch client (no internal package deps)

---

## 3. Component Design

### A. Conversation Orchestrator

**File**: `apps/api/src/services/aiCoaching.ts` (new)

The orchestrator is the entry point for every coaching turn. It owns the
end-to-end sequence:

```
USER MESSAGE
  → IntentRecognizer (classify + extract entities)
  → requireUser (load user + timezone)
  → PersonalContextBuilder (retrieve relevant evidence)
  → EvidenceEvaluator (freshness/completeness/reliability)
  → DecisionBrainAdapter (current decision + diagnoses)
  → CoachingRequestBuilder (assemble structured request)
  → AIProvider.generate (mock: returns structured placeholder)
  → ResponseValidator (evidence check, safety, uncertainty)
  → ActionRegistry (register proposed actions)
  → persist (conversation + message + proposed actions)
  → RETURN CoachingResponse
```

**Responsibilities:**
- Load authorized user context (user, profile, timezone)
- Route intent to the right evidence-gathering path
- Assemble `PersonalContextSnapshot` from existing services
- Evaluate evidence quality before sending to provider
- Validate provider output against evidence and safety rules
- Persist conversation, messages, and proposed actions
- Return `CoachingResponse` to the API handler

**Input**: `CoachingRequest` (userId, message, conversationId?, intent override?)
**Output**: `CoachingResponse` (answer, evidence refs, decision context, proposed actions, quality flags)

### B. Intent Recognition & Routing

**File**: `packages/ai/src/intent.ts` (new)

Classifies user messages into intent categories. Rule-based (no ML, no API key):

| Intent | Keywords/Patterns | Evidence needed |
|--------|------------------|-----------------|
| `stalled_progress` | "not progressing", "plateau", "stalled", "why am I not" | training history, nutrition, recovery, physique, decisions |
| `todays_workout` | "should I train today", "today's workout", "what should I do" | plan, workout, recovery state, readiness |
| `nutrition_question` | "protein", "calories", "what should I eat", "am I eating enough" | meals, nutrition targets, adherence, trends |
| `weight_physique` | "weight not dropping", "waist", "body fat", "measurements" | body measurements, projections, physique goals |
| `follow_up` | "why", "what about", "what should I change", "challenge" | previous conversation context + evidence refs |
| `general_coaching` | anything else | current unified state + decision |

**Output**: `IntentClassification` { intent, confidence, entities: { timeWindow?, metric?, exerciseId? } }

Routing: each intent maps to a subset of `PersonalContextSource` (training, nutrition, activity, recovery, body, projection, decision).

### C. Personal Context Builder

**File**: `apps/api/src/services/aiCoaching/contextBuilder.ts` (new)

Retrieves relevant evidence from existing services. Does **not** duplicate
calculations — calls existing service methods:

```typescript
interface PersonalContextSource {
  profile: boolean;           // User + profile + preferences
  goal: boolean;              // Active goal + physique target
  training: boolean;          // Plan, workouts, progression ledger
  nutrition: boolean;         // Meals, targets, adherence, trends
  activity: boolean;          // Steps, activity sessions
  recovery: boolean;          // Sleep, recovery indicators, readiness
  body: boolean;              // Measurements, physique goals, development
  projection: boolean;        // Projection snapshot + divergences
  decision: boolean;          // Current decision, diagnoses, outcomes
  conversation: boolean;      // Previous messages in this conversation
}
```

**Per-source retrieval methods (existing services):**

| Source | Service method | Returns |
|--------|---------------|---------|
| profile | `users.findById`, `profiles.get` | `User`, `Profile` |
| goal | `goals.getActive`, `physiqueGoals.get` | `Goal`, `PhysiqueGoalRecord` |
| training | `planner.findActive`, `workouts.history`, `continuity.getLedgerEntries` | Plan, WorkoutAggregate[], ProgressionLedgerEntry[] |
| nutrition | `nutrition.getDailyNutrition`, `nutritionTargets.getTargets`, `nutritionAssessment.getAssessment` | DailyNutrition[], NutritionTargets, assessment |
| activity | `activity.getStateSnapshot`, `activity.history` | ActivityStateSnapshot, ActivityRecordRow[] |
| recovery | `recovery.getStateSnapshot`, `sleep.getStateSnapshot` | RecoveryStateSnapshot, SleepStateSnapshot |
| body | `bodyIntelligence.getBodyAssessment`, `bodyMeasurements.history` | BodyAssessment, BodyMeasurementRecord[] |
| projection | `unifiedDecision.buildUnifiedStateForUser` (slice) | UnifiedStateSlice (projection_state) |
| decision | `unifiedDecision.getCurrentDecision`, `listDecisionOutcomes` | DecisionSnapshot, DecisionOutcomeRecord[] |
| conversation | `messageRepository.history` | ConversationMessage[] |

**Window selection**: Each source retrieves a relevant window (default 28 days for trends, 14 days for sleep/recovery, all for decisions/goals). Not "every raw record" — relevant history only.

### D. Evidence Freshness, Completeness & Reliability Evaluation

**File**: `packages/ai/src/evidence.ts` (new)

Evaluates each evidence source before it reaches the provider:

```typescript
interface EvidenceQuality {
  source: UnifiedStateSourceKind | string;
  lastObservedAt?: Timestamp;       // most recent record timestamp
  stalenessDays: number;            // days since last observation
  isStale: boolean;                 // exceeds staleness threshold for this source
  completenessPercent: number;      // 0-100, based on expected vs actual records
  confidence: ConfidenceLevel;      // measured/label_declared/estimated/unknown
  missingFields: string[];          // expected fields that are absent
  warnings: string[];               // human-readable quality notes
}
```

**Staleness thresholds** (configurable, domain-aligned):
- Training/workouts: 7 days (workout cadence)
- Nutrition/meals: 3 days (daily logging expected)
- Sleep/recovery: 2 days (nightly)
- Body measurements: 28 days (measurement cadence)
- Activity/steps: 7 days
- Decisions/outcomes: review window from decision

**Completeness**: Compare expected records (e.g., 14 nights of sleep in 14-day window) vs actual. Below threshold → `isStale` or `missingData` warning.

**Reliability**: Based on `confidence` field on each record and `provenanceClass`. `measured` > `label_declared` > `estimated` > `unknown`.

**Output**: `ContextQuality` { overallScore, sources: EvidenceQuality[], missingDataWarnings, staleDataWarnings, recommendedFollowUpQuestions }

### E. Unified Decision Brain Integration

**File**: `apps/api/src/services/aiCoaching/decisionBrainAdapter.ts` (new)

Wraps existing `UnifiedDecisionService` calls:

```typescript
interface CoachingDecisionContext {
  decisionSnapshot: DecisionSnapshot | null;
  unifiedState: UnifiedFitCoachState | null;
  diagnoses: readonly UnifiedDiagnosis[];
  activeInterventions: readonly string[];
  outcomes: readonly DecisionOutcomeRecord[];
  shouldReevaluate: { should: boolean; reason: string } | null;
  evidenceRefs: readonly DecisionEvidenceRecord[];
  assumptions: readonly DecisionAssumptionRecord[];
}
```

**Methods:**
- `getCurrentDecisionContext(userId, asOf?)` — current decision + unified state + diagnoses
- `getDecisionEvidenceTrail(decisionId)` — full evidence chain for a decision
- `checkReevaluationTriggers(decisionId)` — whether new data warrants re-evaluation

**Constraint**: The AI Coach never calls `makeUnifiedDecision` or `selectInterventions` directly — those are deterministic engine functions called only through `UnifiedDecisionService.generateDecision`. The AI Coach reads results, never writes decisions.

### F. Provider-Independent AI Interface

**File**: `packages/ai/src/provider.ts` (new)

```typescript
export interface AIProvider {
  readonly name: string;
  readonly isMock: boolean;
  generate(request: ProviderRequest): Promise<ProviderResponse>;
}

export interface ProviderRequest {
  coachingRequest: CoachingRequest;
  systemPrompt: string;
  contextSnapshot: PersonalContextSnapshot;
  decisionContext: CoachingDecisionContext;
  quality: ContextQuality;
}

export interface ProviderResponse {
  answer: string;
  reasoningTrace?: string[];
  confidence?: number;
  proposedActions?: ProposedAction[];
  warnings?: string[];
  rawResponse?: unknown; // only for debugging, never exposed to user
}
```

**Mock implementation** (`packages/ai/src/mockProvider.ts`):
- Returns structured placeholder responses
- Clearly labeled `isMock: true`
- Never pretends to be a real AI
- Echoes back key evidence facts so the flow is testable
- Frontend must display "Mock AI response" badge

**Real provider** (deferred — no API key in Phase 9):
- Same interface, different implementation
- Swapped via DI container

### G. Structured Prompt/Request & Response Contracts

**File**: `packages/ai/src/contracts.ts` (new)

```typescript
export interface CoachingRequest {
  userId: UserId;
  conversationId?: ConversationId;
  message: string;
  intent?: IntentClassification;
  asOf?: CalendarDate;           // defaults to today
  contextSources: PersonalContextSource;  // which domains to include
}

export interface PersonalContextSnapshot {
  userId: UserId;
  asOf: CalendarDate;
  generatedAt: Timestamp;
  sources: ContextSourceSnapshot[];  // one per retrieved domain
  profile?: UserProfileContext;
  goal?: GoalContext;
  training?: TrainingContext;
  nutrition?: NutritionContext;
  activity?: ActivityContext;
  recovery?: RecoveryContext;
  body?: BodyContext;
  projection?: ProjectionContext;
  decision?: CoachingDecisionContext;
  conversation?: ConversationContext; // previous messages
  quality: ContextQuality;
}

export interface EvidenceReference {
  source: string;              // "training_state", "nutrition_state", etc.
  code: string;                // decision evidence code, e.g. "protein_intake_below_target"
  title: string;
  value: string;               // observed value
  expected?: string;
  confidence: ConfidenceLevel;
  provenance: ProvenanceClass;
  generatedAt: Timestamp;
  relatedEntityIds: readonly EntityId[];
  basis: string;               // human-readable explanation
  decisionSnapshotId?: DecisionSnapshotId;
  diagnosisId?: DiagnosisId;
}

export interface ContextQuality {
  overallScore: number;        // 0-100
  sources: readonly EvidenceQuality[];
  missingDataWarnings: readonly string[];
  staleDataWarnings: readonly string[];
  recommendedFollowUpQuestions: readonly string[];
  sufficientForAdvice: boolean; // false if too much missing/stale data
}

export interface CoachingResponse {
  conversationId: ConversationId;
  messageId: MessageId;
  answer: string;              // user-facing, natural language
  intent: IntentClassification;
  contextSnapshot: PersonalContextSnapshot;
  evidenceReferences: readonly EvidenceReference[];
  decisionContext: CoachingDecisionContext;
  quality: ContextQuality;
  proposedActions: readonly ProposedAction[];
  warnings: readonly string[];
  isMock: boolean;             // true when mock provider used
}

export interface ProposedAction {
  id: ActionId;
  kind: ActionKind;            // "adjust_nutrition_target" | "adjust_training_volume" | "record_measurement" | "update_goal" | "reevaluate_decision" | "custom"
  title: string;
  description: string;
  domainService: string;       // which service method to call
  parameters: Record<string, unknown>;
  requiresConfirmation: boolean;
  validated: boolean;          // true after ResponseValidator passes
  evidenceRefs: readonly EvidenceReference[];
  decisionSnapshotId?: DecisionSnapshotId;
}
```

### H. Response Validation & Evidence Traceability

**File**: `apps/api/src/services/aiCoaching/responseValidator.ts` (new)

Validates provider output before returning to user:

1. **Evidence grounding**: Every factual claim in the answer must reference at least one `EvidenceReference` from the context. Claims without evidence → flag as unsupported.
2. **Decision consistency**: If the answer contradicts the current Unified Decision Brain decision (e.g., suggests increasing volume when decision says `no_change`), either explain why or flag as conflicting.
3. **No invention**: The answer must not contain specific calorie targets, training prescriptions, readiness scores, or body-fat values that weren't in the context. Numbers must trace to `EvidenceReference.value`.
4. **Uncertainty communication**: If `quality.sufficientForAdvice` is false, the answer must express uncertainty and suggest clarification questions.
5. **Safety**: No medical advice, no diagnosis of injuries, no prescription of supplements/drugs.

**Output**: `ValidationResult` { valid, errors, warnings, sanitizedAnswer }

**Audit trail**: Every `CoachingResponse` is stored with full `contextSnapshot`, `evidenceReferences`, `decisionContext`, and `quality` so any answer can be re-audited.

### I. Typed Action Registry

**File**: `apps/api/src/services/aiCoaching/actionRegistry.ts` (new)

```typescript
export type ActionKind =
  | "adjust_nutrition_target"
  | "adjust_training_volume"
  | "record_measurement"
  | "update_goal"
  | "reevaluate_decision"
  | "log_food"
  | "log_workout"
  | "custom";

export interface ActionRegistryEntry {
  kind: ActionKind;
  title: string;
  description: string;
  validate: (params: Record<string, unknown>, context: PersonalContextSnapshot) => { valid: boolean; errors: string[] };
  execute: (params: Record<string, unknown>, userId: string, repos: Repositories) => Promise<{ success: boolean; result?: unknown; error?: string }>;
  requiresConfirmation: boolean;
}
```

**Registered actions** (mapped to existing service methods):
- `adjust_nutrition_target` → `nutritionTargets.deriveAndStoreTargets` (requires user confirmation)
- `adjust_training_volume` → `unifiedDecision.generateDecision` with `forceReevaluate` (requires confirmation)
- `record_measurement` → `bodyMeasurements.record` (requires confirmation)
- `reevaluate_decision` → `unifiedDecision.shouldReevaluateDecision` + `generateDecision` (requires confirmation)
- `log_food` → `nutrition.createFood` / `createMeal` (requires confirmation)
- `log_workout` → `training.createWorkout` / `addSet` (requires confirmation)

**Flow**: AI proposes action → ActionRegistry validates against context → action stored with `status: "pending"` → user confirms → action executed via domain service → status updated to "completed" or "rejected".

### J. Conversation Persistence & Contextual Memory

**New Prisma models** (to be added to `packages/db/prisma/schema.prisma`):

```prisma
model Conversation {
  id          String    @id @db.Uuid
  userId      String    @map("user_id") @db.Uuid
  title       String?   @db.Text
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)
  
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  messages    ConversationMessage[]
  
  @@index([userId, updatedAt(sort: Desc)])
  @@map("conversations")
}

model ConversationMessage {
  id            String    @id @db.Uuid
  conversationId String   @map("conversation_id") @db.Uuid
  role          String    @db.Text   // "user" | "assistant" | "system"
  content       String    @db.Text
  // Structured context used for this turn (serialized JSON)
  contextSnapshot Json?   @map("context_snapshot") @db.JsonB
  // Evidence references cited (serialized JSON)
  evidenceRefs    Json?   @map("evidence_refs") @db.JsonB
  // Proposed actions (serialized JSON)
  proposedActions Json?  @map("proposed_actions") @db.JsonB
  // Whether this was a mock AI response
  isMock        Boolean   @default(false) @map("is_mock")
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  
  @@index([conversationId, createdAt(sort: Asc)])
  @@map("conversation_messages")
}
```

**New repositories**: `ConversationRepository`, `ConversationMessageRepository` in `packages/db/src/repositories/coaching.ts` (existing coaching repository file) or new file.

**Context window management**: For follow-up questions, retrieve last N messages (default 10) + the most recent `PersonalContextSnapshot`. If conversation is long, summarize older turns and store summary in `ConversationMessage` with `role: "system"`.

**Refresh rule**: New logs/observations (workout, meal, measurement, sleep) invalidate the cached context snapshot. The next coaching turn rebuilds context from current data.

### K. API Routes & Frontend Integration

**New routes** (`apps/api/src/routes.ts`):

| Method | Path | Handler | Auth |
|--------|------|---------|------|
| POST | `/v0/users/:userId/conversations` | create conversation | userId from params |
| GET | `/v0/users/:userId/conversations` | list conversations | userId from params |
| GET | `/v0/users/:userId/conversations/:conversationId` | get conversation + messages | userId from params |
| POST | `/v0/users/:userId/conversations/:conversationId/messages` | send message, get coaching response | userId from params |
| POST | `/v0/users/:userId/conversations/:conversationId/actions/:actionId/confirm` | confirm proposed action | userId from params |
| POST | `/v0/users/:userId/conversations/:conversationId/actions/:actionId/reject` | reject proposed action | userId from params |

**Frontend** (`apps/web/src/api/endpoints.ts` additions):
- `createConversation(userId)`
- `listConversations(userId)`
- `getConversation(userId, conversationId)`
- `sendMessage(userId, conversationId, message)`
- `confirmAction(userId, conversationId, actionId)`
- `rejectAction(userId, conversationId, actionId)`

**Frontend UI** (to be built, not in Phase 9.0):
- Conversation screen with message list
- User message input
- Assistant response rendering with evidence badges
- "Mock AI response" label when `isMock: true`
- Proposed action confirmation buttons
- Evidence reference expandable details

### L. Safety & Uncertainty Handling

| Situation | Handling |
|-----------|----------|
| Insufficient evidence (`quality.sufficientForAdvice === false`) | Answer expresses uncertainty, lists missing data, suggests clarification questions. No specific advice given. |
| Stale data (> staleness threshold) | Answer includes "data from X days ago" warning. Advice is qualified. |
| Conflicting decision | If AI suggestion contradicts current Decision Brain decision, explain the decision's reasoning and why maintaining may be appropriate. |
| Medical/safety concerns | No diagnosis of injuries, no drug/supplement prescriptions, no medical advice. Flag and suggest consulting a professional. |
| Mock provider | Response clearly labeled. Never presented as real AI. |
| Decision `no_change` | AI explains why maintaining current approach is appropriate, citing evidence. |

---

## 4. Context Architecture Flow

### Turn-by-turn sequence

```
1. USER MESSAGE
   User types "Why am I not progressing?" in the chat UI.

2. INTENT RECOGNITION
   IntentRecognizer classifies: intent="stalled_progress", confidence=0.9
   Entities: { timeWindow: "28_days" }

3. AUTHORIZED USER CONTEXT
   requireUser(userId) → User { id, timezone, profile }
   Load timezone for local-day anchoring.

4. HISTORICAL EVIDENCE RETRIEVAL
   PersonalContextBuilder retrieves (based on intent):
   - training: plan + workouts (28 days) + progression ledger
   - nutrition: daily nutrition (28 days) + targets + adherence
   - recovery: sleep (14 days) + recovery indicators (14 days)
   - body: measurements (28 days) + physique goals
   - projection: unified state projection_state slice
   - decision: current decision + diagnoses + outcomes
   - conversation: last 10 messages

5. FRESHNESS/COMPLETENESS/RELIABILITY
   EvidenceEvaluator scores each source:
   - training: complete, 3 workouts in 14 days, confidence=measured
   - nutrition: stale (5 days since last meal), completeness=60%
   - recovery: complete, 10 nights, confidence=measured
   - body: stale (18 days since last measurement), completeness=80%
   - decision: current, decision="no_change", reason="progressing"

   Overall quality: 72/100, sufficientForAdvice=true
   Warnings: ["Nutrition data is 5 days stale", "Body measurements 18 days stale"]

6. UNIFIED DECISION BRAIN
   DecisionBrainAdapter.getCurrentDecisionContext(userId):
   - decisionSnapshot: { kind: "no_change", reason: "progressing well", confidence: 0.8 }
   - diagnoses: [] (none open)
   - activeInterventions: []
   - outcomes: [{ verdict: "improved_as_expected", ... }]

7. COACHING REQUEST ASSEMBLY
   CoachingRequestBuilder creates:
   {
     userId, message, intent,
     contextSnapshot: PersonalContextSnapshot (all sources above),
     decisionContext: CoachingDecisionContext,
     quality: ContextQuality,
     asOf: today
   }

8. AI PROVIDER
   MockProvider.generate(request) → ProviderResponse:
   - answer: "Based on your training history over the last 28 days, you've
     completed 3 of 4 planned sessions. Your bench press is progressing
     (+2.5 kg last week). Nutrition adherence is 85% but data is 5 days
     stale. Recovery is good (readiness 78/100). The Decision Brain says
     no_change because you're progressing. Consider logging meals more
     consistently."
   - proposedActions: [{ kind: "log_food", title: "Log today's meals", ... }]
   - isMock: true

9. RESPONSE VALIDATION
   ResponseValidator checks:
   - Every number traces to EvidenceReference ✓
   - No invented calorie targets ✓
   - Consistent with decision (no_change) ✓
   - Uncertainty communicated (stale data warnings) ✓
   - No medical advice ✓

10. PERSIST & RETURN
    - Store conversation message, assistant response, evidence refs, proposed actions
    - Return CoachingResponse to API handler
    - API returns to frontend
    - Frontend renders: answer text + "Mock AI response" badge + evidence chips + action confirmation button
```

### Follow-up Questions

User: "What should I change?"

1. Load conversation context (last 10 messages + most recent `PersonalContextSnapshot`)
2. Recognize intent: `follow_up`, linked to previous turn
3. Re-evaluate evidence freshness (data may have changed since last turn)
4. Rebuild `CoachingRequest` with `conversationId` and previous `messageId` references
5. Provider generates response referencing previous evidence + new data
6. Answer: "Since your last question, no new logs have been recorded. The
   same factors apply: training is progressing, nutrition data is stale.
   Would you like to log today's meals so I can reassess?"

### New Logs Invalidate Context

When a user logs a workout, meal, measurement, or sleep:
1. The domain service persists the record (existing flow)
2. Any cached `PersonalContextSnapshot` for that user is invalidated
3. The next coaching turn rebuilds context from current data
4. `contextSnapshot.generatedAt` updated, `asOf` = today

---

## 5. Contracts

All TypeScript interfaces defined in Section 3 (components G and H) are the
canonical contracts. They are summarized here for reference:

**New types (packages/ai/src/):**
- `IntentClassification`, `PersonalContextSource`
- `EvidenceQuality`, `ContextQuality`
- `CoachingRequest`, `PersonalContextSnapshot`, `EvidenceReference`
- `CoachingDecisionContext`, `CoachingResponse`
- `ProposedAction`, `ActionKind`
- `AIProvider`, `ProviderRequest`, `ProviderResponse`
- `ValidationResult`

**Reused existing types (packages/domain/src/):**
- `User`, `Profile`, `Goal`, `PhysiqueTarget`
- `UnifiedFitCoachState`, `UnifiedStateSlice`, `UnifiedStateSourceKind`
- `UnifiedDiagnosis`, `DecisionEvidence`
- `DecisionSnapshot`, `DecisionOutcome`, `DecisionAssumption`
- `ValidatedInterventionCandidate`, `SpecialistValidation`
- `BodyMeasurement`, `ActivityRecord`, `SleepObservation`, `RecoveryIndicator`
- `Workout`, `ExerciseSet`, `ProgressionLedgerEntry`
- `ConfidenceLevel`, `ProvenanceClass`, `UncertaintyRange`, `Estimated`
- `Timestamp`, `CalendarDate`, `UserId`, `EntityId`, `DecisionSnapshotId`

**Reused existing types (packages/db/src/repositories/):**
- `Repositories`, `DecisionSnapshotRecord`, `DecisionOutcomeRecord`, etc.

**New types (apps/api/src/services/aiCoaching/):**
- `ConversationRepository`, `ConversationMessageRepository`
- `ConversationOrchestrator`, `IntentRecognizer`, `PersonalContextBuilder`
- `EvidenceEvaluator`, `DecisionBrainAdapter`, `CoachingRequestBuilder`
- `ResponseValidator`, `ActionRegistry`

---

## 6. Implementation Sequence

### Milestone 1 — Foundation (Complete)
- Add `Conversation`, `ConversationMessage` Prisma models + migration
- Add `ConversationRepository`, `ConversationMessageRepository`
- Add `packages/ai/src/provider.ts` (AIProvider interface + mock implementation)
- Add `packages/ai/src/contracts.ts` (all shared types)
- Add `packages/ai/src/intent.ts` (rule-based intent recognition)
- **Acceptance**: Typecheck passes, mock provider returns structured responses, conversation CRUD compiles

### Milestone 2 — Context Builder & Evidence Evaluation (Complete)
- Add `apps/api/src/services/aiCoaching/contextBuilder.ts`
- Add `packages/ai/src/evidence.ts` (EvidenceQuality, ContextQuality)
- Add `packages/ai/src/contextSources.ts` (intent classification, context source selection)
- Wire all existing service methods into context retrieval
- **Acceptance**: PersonalContextSnapshot built from real data, quality scoring works, staleness detected

### Milestone 3 — Orchestrator & API Routes (Week 3)
- Add `apps/api/src/services/aiCoaching/decisionBrainAdapter.ts`
- Add `apps/api/src/services/aiCoaching/responseValidator.ts`
- Add `apps/api/src/services/aiCoaching/actionRegistry.ts`
- Add `apps/api/src/services/aiCoaching/orchestrator.ts` (ConversationOrchestrator)
- Add API routes: conversations, messages, action confirm/reject
- Add frontend endpoints
- **Acceptance**: E2E flow works with mock provider, conversation persisted, actions proposed and confirmable

### Milestone 4 — Frontend Chat UI (Week 4)
- Conversation screen component
- Message list + input
- Evidence badge rendering
- "Mock AI response" label
- Proposed action confirmation UI
- **Acceptance**: User can send message, receive mock response, see evidence, confirm/reject actions

### Milestone 5 — E2E Acceptance Scenarios (Week 5)
- Implement scenarios A–H (see `docs/AI_COACH_ACCEPTANCE.md`)
- Run against real service composition (mock provider, real repositories)
- **Acceptance**: All 8 scenarios pass

---

## 7. Unresolved Questions

1. **AI Coach service location**: Orchestration in `apps/api/src/services/aiCoaching/` vs `packages/ai/src/`? Recommendation: `apps/api` for orchestration (needs repositories), `packages/ai` for provider interfaces + mock + contracts.

2. **Conversation summary strategy**: When to summarize vs truncate? Need to define summary schema and max message count before summarization.

3. **RecipeRepository verification**: Pre-existing test failure (`this.repos.recipes.create is not a function`) — verify before AI Coach depends on recipe data for scenario C.

4. **Projection data access**: No standalone route for projection history/divergences. AI Coach reads projection via unified state slice. May need `getProjectionHistory` route for scenario D.

5. **Mock provider labeling**: What visual treatment in frontend? Badge color? Placement? Needs UX decision.

6. **Action confirmation UX**: Modal dialog? Inline buttons? Needs frontend design.

7. **Rate limiting / abuse prevention**: No auth exists. AI Coach routes use `userId` from params — same as existing routes. Consider adding basic rate limiting before Phase 10 (real AI provider).