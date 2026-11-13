# FitCoach AI Coach — Data Integration Map

**Phase 9.0 — Existing-System Discovery**
**Status: Verified against source code** — every interface, method and type below
was read from the actual repository. Nothing is assumed.

---

## 1. Purpose

This document maps every data source the AI Coach must integrate with, identifies
the actual service and repository names, public methods, input/output types,
date-range and pagination capabilities, provenance/timestamp/confidence support,
and gaps that must be filled before Phase 9 implementation.

**Key rule**: Reuse existing services and repositories. Do not create duplicate
calculations or a parallel coaching brain.

---

## 2. Source-of-Truth Inventory

### 2.1 User Profile, Goals, Preferences & Constraints

| Area | Domain type | Repository | Service | Public methods |
|------|-----------|------------|---------|----------------|
| User | `User`, `Profile` (`packages/domain/src/user.ts`) | `PrismaUserRepository`, `PrismaProfileRepository` (`packages/db/src/repositories/identity.ts`) | `UserService`, `ProfileService` (`apps/api/src/services/identity.ts`) | `findById`, `create`, `update`, `history` |
| Goal | `Goal`, `PhysiqueTarget`, `GoalPriorityTag` (`packages/domain/src/goal.ts`) | `PrismaGoalRepository` (`packages/db/src/repositories/goals.ts`) | `GoalService` (`apps/api/src/services/identity.ts`) | `create`, `getActive`, `history`, `update`, `delete` |
| Physique goal | `PhysiqueGoal` (via `PhysiqueGoalRecord`) | `PrismaPhysiqueGoalRepository` (`packages/db/src/repositories/body.ts`) | `BodyIntelligenceService` (`apps/api/src/services/bodyIntelligence.ts`) | `create`, `get`, `update`, `delete`, `history`, `getDefaultForTrainingGoal` |
| Equipment | `Equipment`, `UserEquipment` (`packages/domain/src/exercise.ts`, `packages/domain/src/user.ts`) | `PrismaEquipmentRepository` (`packages/db/src/repositories/equipment.ts`) | `EquipmentService` (`apps/api/src/services/identity.ts`) | catalog + per-user inventory with validity intervals |
| Exercise preferences | `UserExercisePreference` (`packages/domain/src/exercise.ts`) | `PrismaExercisePreferenceRepository` (`packages/db/src/repositories/preferences.ts`) | — | read/write per user-exercise preference with `validFrom`/`validTo` |

**Routes**: `GET /v0/users`, `GET /v0/users/:userId`, `PUT /v0/users/:userId/profile`, `POST /v0/users/:userId/goals`, `GET /v0/users/:userId/goals/active`, `POST /v0/users/:userId/equipment`, `GET /v0/users/:userId/equipment`

**Frontend**: `apps/web/src/api/endpoints.ts` — `createUser`, `getUser`, `getProfile`, `putProfile`, `createGoal`, `getActiveGoal`, `getEquipmentCatalog`, `getUserEquipment`

**History**: `ProfileRevision` (append-only, indexed by `[userId, createdAt desc]`), `Goal` interval versioning (`supersededByGoalId`, `effectiveFrom`/`effectiveUntil`), `UserEquipment` validity intervals

**Date-range**: Profile revisions sortable by `createdAt desc`; goals sortable by `effectiveFrom desc`

**Provenance/timestamps**: `createdAt`/`updatedAt` on all entities; `User.timezone` defines local-day boundary

**Gap**: No method to get "profile at point in time T" — must compute from `ProfileRevision` history manually. No unified "get all user context at date T" endpoint.

---

### 2.2 Exercise Knowledge & Exercise Selection

| Area | Domain type | Repository | Service | Public methods |
|------|-----------|------------|---------|----------------|
| Exercise catalog | `Exercise`, `ExerciseMuscleRelation`, `ExerciseMuscleStructureRelation` (`packages/domain/src/exercise.ts`) | `PrismaExerciseRepository`, `PrismaKnowledgeRepository` (`packages/db/src/repositories/catalog.ts`) | `KnowledgeService` (`apps/api/src/services/knowledge.ts`) | `muscleCatalog`, `muscleById`, `movementFunctions`, `searchExercises`, `exerciseDetail` |
| Form guidance | `ExerciseFormVersion`, `FormGuidanceStep` | via `KnowledgeRepository` | `KnowledgeService` | form guidance retrieval per exercise |
| Media | `ExerciseMediaReference`, `FormOverlayKind` | via `KnowledgeRepository` | `KnowledgeService` | media asset retrieval per exercise |
| Exercise universe (user-specific) | resolved via `fitness-core` engine | `PrismaExerciseRepository` | `TrainingPlannerService` (indirectly) | universe filtered by user equipment |

**Routes**: `GET /v0/exercises`, `GET /v0/exercises/:exerciseId`, `GET /v0/exercises/:exerciseId/target-map`, `GET /v0/exercises/:exerciseId/form-guidance`, `GET /v0/exercises/:exerciseId/media`, `GET /v0/users/:userId/exercise-universe`, `GET /v0/muscles`, `GET /v0/muscles/:muscleId`, `GET /v0/movement-functions`

**Frontend**: `apps/web/src/api/endpoints.ts` — `getExerciseDetail`, `getExerciseUniverse`, `getMuscles`, etc.

**History**: Exercise rows are reference data, retired (`is_active`) never deleted. `ExerciseFormVersion` has `effectiveFrom`/`retiredOn`.

**Provenance/timestamps**: `createdAt`/`updatedAt`, `ExternalProvenance` (origin, licenseSpdx, registryRef)

**Gap**: No full-text search with relevance ranking beyond simple `q` parameter. No "exercise performance history per user" in knowledge layer — that's in workout/progression repositories.

---

### 2.3 Training Plans, Workout Logs & Performance Progression

| Area | Domain type | Repository | Service | Public methods |
|------|-----------|------------|---------|----------------|
| Training plan | `TrainingPlan`, `TrainingPlanVersion`, `TrainingSession`, `PlannedExercise` (`packages/domain/src/training.ts`) | `PrismaTrainingPlanRepository` (`packages/db/src/repositories/training.ts`) | `TrainingPlannerService` (`apps/api/src/services/planner.ts`) | `create`, `addVersion`, `findById`, `findActive`, `listForUser`, `listTemporary`, `setStatus` |
| Workout logs | `Workout`, `ExerciseSet`, `CardioEntry` (`packages/domain/src/training.ts`) | `PrismaWorkoutRepository` (`packages/db/src/repositories/training.ts`) | `TrainingService` (`apps/api/src/services/training.ts`) | `create`, `addExercise`, `addSet`, `complete`, `findById`, `history` |
| Performance ledger | `ProgressionEvaluation`, `ProgressionLedgerEntry`, `ProgressionRecommendation`, `ProgressionEvaluationOutcome` (`packages/domain/src/training.ts`) | `PrismaProgressionLedgerRepository` (`packages/db/src/repositories/progression.ts`) | `TrainingContinuityService` (`apps/api/src/services/continuity.ts`) | ledger entry build, evaluation, decision events |
| Exercise performance | `ExercisePerformance`, `ExercisePerformanceSummary` | via progression ledger | `TrainingContinuityService` | per-exercise performance summaries |

**Routes**: `POST/GET /v0/users/:userId/training-plans`, `GET /v0/users/:userId/training-plans/active`, `POST /v0/users/:userId/training-plans/:planId/versions`, `GET /v0/users/:userId/training-plans/:planId`, `POST /v0/users/:userId/training-plans/generate`, `POST/GET /v0/users/:userId/workouts`, `POST /v0/users/:userId/workouts/:workoutId/sets`, `POST /v0/users/:userId/workouts/:workoutId/complete`, `GET /v0/users/:userId/workouts/:workoutId`, `POST /v0/users/:userId/progression/evaluate`, `GET /v0/users/:userId/progression/ledger`

**Frontend**: `apps/web/src/api/endpoints.ts` — `generatePlan`, `getActivePlan`, `recordWorkout`, `addSet`, `completeWorkout`, `getWorkoutHistory`

**History**: Training plans are interval-versioned (`supersedesId`). Workouts are append-only until completion (frozen after `completed`/`partial`/`skipped`). Workout history indexed by `[userId, startedAt desc]`.

**Date-range**: `WorkoutHistoryQuery` supports `from`/`to` timestamps, `limit`. Activity history supports `from`/`to` dates.

**Provenance/timestamps**: `startedAt`/`endedAt` on workouts, `performedAt` on performance observations, `environmentKind`/`sessionClassification` on workouts, `performanceSource` on workout exercises

**Gap**: `recordDecision`/`listDecisions`/`replaceConstraints`/`listConstraints` on `TrainingPlanRepository` throw or return empty — `TrainingPlanDecision`/`TrainingPlanConstraint` models missing from Prisma schema. Cannot store plan-level coaching decisions persistently yet.

---

### 2.4 Nutrition Targets, Food Database, Barcode Scans, Meals, Recipes

| Area | Domain type | Repository | Service | Public methods |
|------|-----------|------------|---------|----------------|
| Food database | `Food`, `FoodSource`, `ServingDefinition`, `NutrientAmounts` | `PrismaFoodRepository` (`packages/db/src/repositories/nutrition.ts`) | `NutritionService` (`apps/api/src/services/nutrition.ts`) | food CRUD, search, barcode lookup |
| Meals | `Meal`, `MealItem`, `NutrientAmounts` | `PrismaMealRepository` | `NutritionService` | `createMeal`, add items, list meals for date |
| Recipes | `Recipe`, `RecipeItem` | `PrismaRecipeRepository` | `RecipeService` (`apps/api/src/services/recipe.ts`) | create, list, get, delete, nutrition per serving |
| Nutrition targets | `NutritionTargets` | via `PrismaNutritionTargetService` | `PrismaNutritionTargetService` (`apps/api/src/services/nutritionTargets.ts`) | `deriveAndStoreTargets`, `getTargets` |
| Nutrition trends | `DailyNutrition`, nutrition trend analysis | `PrismaNutritionRepository` | `NutritionAssessmentService` (`apps/api/src/services/nutritionAssessment.ts`) | adherence analysis |
| Barcode scans | `BarcodeLookupResponse` | via barcode service | `BarcodeScannerService` (`apps/api/src/services/barcode.ts`) | lookup, preview |

**Routes**: `POST/GET /v0/users/:userId/foods`, `GET /v0/foods/search`, `POST/GET /v0/users/:userId/meals`, `POST /v0/users/:userId/meals/:mealId/items`, `GET /v0/users/:userId/nutrition/daily`, `POST/GET /v0/users/:userId/recipes`, `GET /v0/recipes/:recipeId`, `GET /v0/recipes/:recipeId/nutrition`, `POST/GET /v0/users/:userId/nutrition/targets`, `GET /v0/users/:userId/nutrition/assessment`, `GET /v0/barcode/lookup`, `GET /v0/barcode/preview`

**Frontend**: `apps/web/src/api/endpoints.ts` — `createFood`, `searchFoods`, `createMeal`, `createRecipe`, `deriveNutritionTargets`, `getNutritionTargets`, `getNutritionAssessment`, `lookupBarcode`

**History**: Meals snapshotted with `totals` at logging time (survives later food/recipe edits). `DailyNutrition` aggregates per user-day. Food reference data retired, never deleted.

**Date-range**: Nutrition queries typically use `asOf`/`localDate` day anchors. Meal history filterable by date.

**Provenance/timestamps**: `FoodSource` has `kind` (curated_database, user_created, imported, estimate), `defaultConfidence`, `tier`. `MealItem` has `inputMethod` (search, natural_language, exact_entry, photo_assisted), `quantityEstimate` (Estimated with provenance/confidence/uncertainty), `computedNutrients` snapshotted.

**Gap**: `RecipeService.createRecipe` calls `this.repos.recipes.create` — the `RecipeRepository` may not be fully implemented (pre-existing test failures show `this.repos.recipes.create is not a function`). Need to verify before use.

---

### 2.5 Activity, Steps & Activity Sessions

| Area | Domain type | Repository | Service | Public methods |
|------|-----------|------------|---------|----------------|
| Activity records | `ActivityRecord`, `ActivityKind` (`packages/domain/src/body.ts`) | `PrismaActivityRepository` (`packages/db/src/repositories/body.ts`) | `ActivityService` (`apps/api/src/services/body.ts`) | `recordSteps` (idempotent upsert), `record` (cardio sessions), `history`, `getStateSnapshot` |
| Activity targets | `ActivityTargets` | via activity service | `ActivityIntelligenceService` (`apps/api/src/services/activityIntelligence.ts`) | `deriveActivityTargets` |
| Activity context | `DailyActivitySummary`, `ActivityStateSnapshot` | `ActivityRepository.getStateSnapshot` | `ActivityIntelligenceService` | aggregate steps, active minutes, cardio, trends |

**Routes**: `POST/GET /v0/users/:userId/activity`, `GET /v0/users/:userId/activity/daily`, `GET /v0/users/:userId/activity/targets`, `GET /v0/users/:userId/activity/context`

**Frontend**: `apps/web/src/api/endpoints.ts` — `recordActivity`, `getActivityHistory`, `getActivityDaily`, `getActivityTargets`, `getActivityContext`

**History**: Activity records append-only. Steps have partial unique index `(user_id, date, recorded_via)` with max-wins upsert (idempotent).

**Date-range**: `ActivityHistoryQuery` supports `kind`, `from`, `to`, `limit`. `getStateSnapshot` supports `asOf` + `windowDays` (default 28).

**Provenance/timestamps**: `recordedVia` (manual, phone_sensor, wearable, imported_dataset, etc.), `externalId` for dedupe, `createdAt`

**Gap**: None significant. Activity state snapshot provides aggregate trends.

---

### 2.6 Sleep, Recovery Indicators & Readiness

| Area | Domain type | Repository | Service | Public methods |
|------|-----------|------------|---------|----------------|
| Sleep observations | `SleepObservation`, `SleepStages` | `PrismaSleepRepository` (`packages/db/src/repositories/body.ts`) | `SleepService` (`apps/api/src/services/body.ts`) | `record`, `history`, `getStateSnapshot` |
| Recovery indicators | `RecoveryIndicator` | `PrismaRecoveryRepository` | `RecoveryService` (`apps/api/src/services/body.ts`) | `record`, `history`, `getStateSnapshot` |
| Recovery state | `RecoveryState` (computed) | via `RecoveryRepository.getStateSnapshot` | `RecoveryIntelligenceService` (`apps/api/src/services/activityIntelligence.ts`) | readiness score, sleep adequacy, HRV trend, fatigue accumulation |

**Routes**: `POST/GET /v0/users/:userId/sleep`, `POST/GET /v0/users/:userId/recovery/indicators`, `GET /v0/users/:userId/recovery/state`, `GET /v0/users/:userId/recovery/trends`

**Frontend**: `apps/web/src/api/endpoints.ts` — `recordSleep`, `getSleepHistory`, `recordRecoveryIndicator`, `getRecoveryHistory`, `getRecoveryState`, `getRecoveryTrends`

**History**: Sleep and recovery are append-only, indexed by `[userId, date desc]`. Idempotent on `(userId, date, source, externalId)`.

**Date-range**: `SleepHistoryQuery`/`RecoveryHistoryQuery` support `limit`, `from`, `to`, `source`. `getStateSnapshot` supports `asOf` + `windowDays` (default 14).

**Provenance/timestamps**: `source` (ObservationOrigin: manual, health_connect, apple_health, wearable, phone_sensor, imported_dataset, ai_parsed, photo_derived, system_computed), `externalId`, `confidence`, `createdAt`

**Gap**: None significant.

---

### 2.7 Body Measurements, Physique Goals & Body-Composition Estimates

| Area | Domain type | Repository | Service | Public methods |
|------|-----------|------------|---------|----------------|
| Body measurements | `BodyMeasurement`, `BodySite`, `MeasurementCondition` | `PrismaBodyMeasurementRepository` (`packages/db/src/repositories/body.ts`) | `BodyMeasurementService` (`apps/api/src/services/body.ts`) | `record` (idempotent), `history`, `getStateSnapshot` |
| Physique goals | `PhysiqueGoal`, `PhysiqueGoalPriority` | `PrismaPhysiqueGoalRepository` | `BodyIntelligenceService` | `create`, `get`, `update`, `delete`, `history`, `getDefaultForTrainingGoal` |
| Muscle development | via `fitness-core/body` | — | `BodyIntelligenceService` | `getMuscleDevelopmentAnalysis`, `getDisproportionateAnalysis` |
| Body assessment | `BodyAssessment` | — | `BodyIntelligenceService` | `getBodyAssessment` |

**Routes**: `POST/GET /v0/users/:userId/measurements`

**Frontend**: `apps/web/src/api/endpoints.ts` — `recordMeasurement`, `getMeasurementHistory`, `getBodyAssessment`

**History**: Body measurements append-only (trigger-enforced), corrections add new rows. Indexed by `[userId, recordedAt desc]`. Physique goals interval-versioned (one active per user).

**Date-range**: `MeasurementHistoryQuery` supports `limit`, `from`, `to` timestamps. `getStateSnapshot` supports `asOf` + `windowDays` (default 28).

**Provenance/timestamps**: `recordedAt` (distinct from `createdAt` logging time), `condition` (morning_fasted, post_workout, evening, random, other), `enteredVia`, `confidence`, `sourceName`, `externalId`, `photoRefs`

**Gap**: No method to get "circumference trend by site" directly — must query history and compute. No body-composition estimate storage (only raw measurements).

---

### 2.8 Projection & Trajectory Engine

| Area | Domain type | Repository | Service | Public methods |
|------|-----------|------------|---------|----------------|
| Projection snapshot | `ProjectionSnapshot`, `ProjectionMetric`, `ProjectionDivergence`, `ProjectionInputs`, `ProjectionAssumption` | via `prisma.projectionSnapshot` (in schema) | `UnifiedDecisionService` (includes projection_state slice in unified state) | `buildUnifiedState` includes `projection_state` |
| Projection request | `ProjectionRequest`, `ProjectionResult` | — | `fitness-core/src/projection.ts` | `generateProjection`, `detectProjectionDivergences`, `supersedeProjection` |

**Routes**: `GET /v0/users/:userId/unified-state` (includes projection_state slice)

**Frontend**: `apps/web/src/api/endpoints.ts` — `getUnifiedState` (returns slices including projection_state)

**History**: Projection snapshots versioned with `supersedesId`, status `current`/`superseded`/`diverged`. `ProjectionDivergence` records actual vs projected with `significant` flag.

**Date-range**: `ProjectionInputs` has `asOf`, `trainingWindowDays`, `nutritionWindowDays`, `bodyWindowDays`, `activityWindowDays`

**Provenance/timestamps**: `generatedAt`, `configVersion`, `computedAt` on slices, `ProjectionAssumption` with `sensitive` flag

**Gap**: No standalone projection API route — projections are only accessible via the unified state slice. No `getProjectionHistory` or `getProjectionDivergences` route.

---

### 2.9 Unified Decision Brain — Diagnoses, Interventions, Decisions, Outcomes

| Area | Domain type | Repository | Service | Public methods |
|------|-----------|------------|---------|----------------|
| Unified state | `UnifiedFitCoachState`, `UnifiedStateSlice` | via decision/repositories | `UnifiedDecisionService` (`apps/api/src/services/unifiedDecision.ts`) | `buildUnifiedStateForUser`, `generateDecision`, `getCurrentDecision`, `getDecision`, `listDecisions` |
| Diagnosis | `UnifiedDiagnosis`, `DecisionEvidence` | `PrismaDiagnosisRepository`, `PrismaDecisionEvidenceRepository` | `UnifiedDecisionService`, `CoachingService` | `createDiagnosis`, `listDiagnoses` |
| Intervention | `ValidatedInterventionCandidate`, `DecisionIntervention` | `PrismaDecisionInterventionRepository`, `PrismaInterventionRepository` | `UnifiedDecisionService`, `CoachingService` | `selectInterventions`, `createIntervention`, `listInterventions` |
| Decision snapshot | `DecisionSnapshot`, `DecisionAssumption` | `PrismaDecisionSnapshotRepository`, `PrismaDecisionAssumptionRepository` | `UnifiedDecisionService` | `create`, `findById`, `findByIdWithRelations`, `list`, `updateStatus` |
| Decision outcome | `DecisionOutcome`, `DecisionOutcomeEvaluationResult` | `PrismaDecisionOutcomeRepository` | `UnifiedDecisionService` | `recordDecisionOutcome`, `listDecisionOutcomes`, `shouldReevaluateDecision` |
| Recommendation | `Recommendation`, `Evidence` | `PrismaRecommendationRepository` | `CoachingService` | `createRecommendation`, `listRecommendations` |

**Routes**: `POST/GET /v0/users/:userId/decisions`, `GET /v0/users/:userId/decisions/current`, `GET /v0/users/:userId/decisions/:decisionId`, `POST/GET /v0/users/:userId/decisions/:decisionId/outcomes`, `GET /v0/users/:userId/decisions/:decisionId/reevaluate`, `POST/GET /v0/users/:userId/diagnoses`, `POST/GET /v0/users/:userId/recommendations`, `POST/GET /v0/users/:userId/interventions`, `GET /v0/users/:userId/unified-state`

**Frontend**: `apps/web/src/api/endpoints.ts` — `generateDecision`, `getCurrentDecision`, `getDecision`, `listDecisions`, `recordDecisionOutcome`, `getDecisionOutcomes`, `shouldReevaluateDecision`, `getUnifiedState`

**History**: Decision snapshots immutable with `supersedesId`, status `current`/`superseded`/`archived`/`diverged`. Decision outcomes linked to decision snapshot. Decision evidence linked with `relatedEntityIds`, `provenance`, `confidence`, `sensitive`.

**Date-range**: `ListDecisionsOptions` supports `status`, `limit`, `cursor`. `ListDecisionOutcomesOptions` supports `evaluationWindow`, `limit`.

**Provenance/timestamps**: `decidedAt`, `generatedAt` (unified state), `evaluatedAt` (outcomes), `createdAt`/`updatedAt`, `DecisionEvidence` has `provenance`, `confidence`, `sensitive`, `relatedEntityIds`

**Gap**: `getDecision`/`listDecisions` with relations (interventions, evidence, assumptions, outcomes) available via `findByIdWithRelations` but not all exposed through routes consistently.

---

### 2.10 Conversation Infrastructure

| Area | Status |
|------|--------|
| Domain types | **None exist.** No `Conversation`, `ConversationMessage`, `ChatMessage`, or AI-related types in `packages/domain`. |
| Repository | **None exist.** No conversation/message repositories in `packages/db/src/repositories/`. |
| Prisma schema | **None.** No `Conversation`, `Message` models in `prisma/schema.prisma`. |
| Service | **None exist.** No AI/conversation service in `apps/api/src/services/`. |
| Routes | **None exist.** No conversation/message routes in `apps/api/src/routes.ts`. |
| Frontend | **None exist.** No chat/conversation screens, endpoints, or components in `apps/web/src/`. |
| `packages/ai` | Exists but essentially empty: `src/index.ts` and `src/README.md` only. No implementation. |

**Gap**: **Complete.** Everything related to conversation persistence, intent recognition, context building, provider interface, and frontend chat UI must be built new.

---

### 2.11 Authentication, Authorization, DI, Frontend Conventions

| Area | Finding |
|------|---------|
| Authentication | **None.** No auth middleware, no session tokens, no JWT. Routes take `userId` from URL params. `User.externalAuthId` reserved but unused. |
| Authorization | **None.** `requireUser` in services only checks user exists in DB. No ownership enforcement at route level. RLS planned in schema design (every user-owned table has `user_id`) but not applied. |
| Repositories | `packages/db/src/repositories/index.ts` — `Repositories` interface (~24 typed repositories), `createRepositories(prisma: PrismaClient): Repositories` factory. |
| Services | `apps/api/src/services/index.ts` — `AppServices` interface (~18 services), `createServices(repos): AppServices` factory. Services are plain classes constructed from repository bundle. |
| Routes | `apps/api/src/routes.ts` — zero-framework `node:http` router. Handlers: validate → typed command → service → shaped response. Validation helpers in `apps/api/src/validation.ts` (`requiredString`, `optionalString`, `requiredEnum`, `optionalBoolean`, etc.). |
| Frontend API | `apps/web/src/api/client.ts` — `api.get/post/put` typed fetch wrapper with `ApiRequestError`. `apps/web/src/api/endpoints.ts` — typed endpoint functions grouped by domain. `apps/web/src/api/types.ts` — DTO types mirroring backend contracts. |
| Frontend state | No global state management (no Redux/Zustand). React context via `SessionContext`, `WorkoutContext`. |

**Gap**: No auth/authorization layer. AI Coach routes will need user identification — can reuse `userId` from URL params (same as existing routes) until auth exists.

---

## 3. Gap Analysis Summary

### 3.1 Ready for Reuse (No Changes Needed)

| Capability | Source | Confidence |
|------------|--------|------------|
| User profile + history | `UserRepository`, `ProfileRepository`, `ProfileRevision` | High |
| Active goal + goal history | `GoalRepository`, `Goal` interval versioning | High |
| Exercise catalog + knowledge | `KnowledgeRepository`, `ExerciseRepository` | High |
| User equipment inventory | `EquipmentRepository`, `UserEquipment` validity intervals | High |
| Training plan CRUD + versions | `TrainingPlanRepository` | High |
| Workout logging + history | `WorkoutRepository` | High |
| Performance ledger + progression | `ProgressionLedgerRepository`, `TrainingContinuityService` | High |
| Activity records + state snapshots | `ActivityRepository`, `getStateSnapshot` | High |
| Sleep/recovery records + state | `SleepRepository`, `RecoveryRepository`, `getStateSnapshot` | High |
| Body measurements + state snapshot | `BodyMeasurementRepository`, `getStateSnapshot` | High |
| Physique goals (interval versioned) | `PhysiqueGoalRepository` | High |
| Food database + search | `FoodRepository`, `NutritionService` | High |
| Meals + recipes (snapshot totals) | `MealRepository`, `RecipeRepository` | Medium (recipe create has pre-existing test failures) |
| Nutrition targets + assessment | `PrismaNutritionTargetService`, `NutritionAssessmentService` | High |
| Unified state + decision brain | `UnifiedDecisionService` | High |
| Decisions + outcomes + evidence | `DecisionSnapshotRepository`, `DecisionOutcomeRepository` | High |
| Diagnoses + recommendations | `CoachingService`, `DiagnosisRepository`, `RecommendationRepository` | High |
| DI container (Repositories + AppServices) | `packages/db/src/repositories/index.ts`, `apps/api/src/services/index.ts` | High |
| Conversation persistence | `ConversationRepository`, `ConversationMessageRepository` | High (Phase 9.1) |
| Evidence quality evaluation | `packages/ai/src/evidence.ts` | High (Phase 9.2) |
| Intent-aware context selection | `packages/ai/src/contextSources.ts` | High (Phase 9.2) |
| Personal Context Builder | `apps/api/src/services/aiCoaching/contextBuilder.ts` | High (Phase 9.2) |

| Route/validation conventions | `apps/api/src/routes.ts`, `apps/api/src/validation.ts` | High |
| Frontend typed API client | `apps/web/src/api/client.ts`, `endpoints.ts`, `types.ts` | High |

### 3.2 Small Extension Needed

| Capability | Extension | Why |
|------------|-----------|-----|
| `getProjectionHistory` / `getProjectionDivergences` route | Add route + service method wrapping existing Prisma models | Projections only accessible via unified state slice today |
| `TrainingPlanRepository.recordDecision` / `listDecisions` / `replaceConstraints` | Implement missing Prisma models or stub gracefully | Needed to persist plan-level coaching decisions |
| `getUserContextAt(date)` convenience method | Compose existing repos into a single point-in-time snapshot | AI Coach needs "what did we know at time T" |
| `getDecisionWithRelations` route exposure | Already in repository, just needs route + frontend endpoint | AI Coach needs full decision traceability |

### 3.3 Missing Functionality (New Implementation)

| Capability | What's needed |
|------------|---------------|
| Conversation domain types | `Conversation`, `ConversationMessage`, `MessageRole`, `MessageStatus` |
| Conversation repository | `ConversationRepository`, `MessageRepository` (Prisma models + implementations) |
| Intent recognition | Classify user message into coaching intent categories |
| Personal Context Builder | Compose evidence from all specialist systems into `PersonalContextSnapshot` |
| Evidence freshness/completeness/reliability evaluation | Score each evidence source by staleness, coverage, confidence |
| Provider-independent AI interface | `AIProvider` interface with mock implementation |
| Structured prompt/request contracts | `CoachingRequest`, `ProviderRequest`, `ProviderResponse` types |
| Response validation | Validate AI output against evidence, constraints, safety |
| Typed action registry | `ProposedAction` with explicit confirmation + domain-service execution |
| Conversation persistence + summaries | Store/retrieve conversations, summarize for context window management |
| API routes | `POST/GET /v0/users/:userId/conversations`, `POST /v0/users/:userId/conversations/:id/messages` |
| Frontend chat UI | Conversation screen, message components, input |
| Mock AI provider | Label responses as mock, never pretend to be real AI |

### 3.4 Cannot Validate Without PostgreSQL

| Capability | Blocker |
|------------|---------|
| Full repository persistence tests | `prisma migrate status` fails: P1001 Can't reach database server at 127.0.0.1:5432 |
| Clean-database migration validation | No PostgreSQL server available |
| Decision creation/supersession/outcome persistence E2E | Requires running DB |
| Rollback/transaction behavior | Requires running DB |
| `embedded-postgres` | Dev dependency in `apps/api/package.json` but not configured |

---

## 4. Dependency Map

```
┌─────────────────────────────────────────────────────────────────┐
│                          FRONTEND (React/Vite)                  │
│  apps/web/src/api/endpoints.ts  apps/web/src/api/client.ts      │
│  apps/web/src/api/types.ts      (chat UI — to be built)         │
└─────────────────────────────────────────────────────────────────┘
                                 │ HTTP /v0
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                          API (node:http)                        │
│  apps/api/src/routes.ts   apps/api/src/services/*               │
│  apps/api/src/validation.ts                                      │
└─────────────────────────────────────────────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│  Domain repos  │  │  Domain services│ │ AI Coach layer │
│  (Prisma)      │  │  (UnifiedDecision│ │ (NEW — Phase 9) │
│  Repositories  │  │   Service etc.) │  │                │
└────────────────┘  └────────────────┘  └────────────────┘
              │                  │                  │
              └──────────────────┴──────────────────┘
                                 │ Prisma
                                 ▼
                    ┌───────────────────────┐
                    │   PostgreSQL (Prisma) │
                    └───────────────────────┘

Key: existing = solid, Phase 9 new = dotted
```

Package dependency direction (must be preserved):
```
packages/domain  →  packages/fitness-core  →  packages/db  →  apps/api  →  apps/web
                              ↑              ↑              ↑
                        packages/nutrition  packages/ai  (Phase 9 consumer)
```

**Critical**: `packages/ai` currently depends only on `@fitcoach/domain`. Phase 9 should keep it that way — the AI package should not import `packages/db` or `apps/api`. The AI Coach orchestration layer belongs in `apps/api` (or a new service layer), consuming `packages/ai` for provider interfaces and `packages/db` for repositories.

---

## 5. Unresolved Questions

1. **Where does the AI Coach orchestration live?** `apps/api` has the service/DI pattern; `packages/ai` is the AI boundary. Recommend: orchestration service in `apps/api/src/services/coaching.ts` extension or new file, provider interfaces in `packages/ai`.

2. **How is user identity established without auth?** Routes use `userId` from URL params. AI Coach routes should follow the same convention until auth exists.

3. **RecipeRepository implementation status** — pre-existing test failures show `this.repos.recipes.create is not a function`. Need to verify before AI Coach depends on recipe data.

4. **Projection data access** — no standalone route for projection history/divergences. AI Coach needs this for scenario D (weight/physique question with projections).

5. **Conversation summary strategy** — how to truncate long conversations while preserving evidence references? Need to define summary schema and retrieval rule.

6. **Mock provider labeling** — frontend must clearly label mock responses. What visual treatment? (To be defined in frontend architecture.)

7. **Action confirmation flow** — when AI proposes an action (e.g., "adjust nutrition target"), what confirmation UI pattern? Modal? Inline? (To be defined.)