# Phase 6 Acceptance Audit — Activity & Recovery Intelligence Engine

**Date:** 2026-11-09  
**Branch:** master  
**Commit:** 90b1abc (feat: complete adaptive training engine)  
**Scope:** 8 verification areas across Activity & Recovery Intelligence Engine  

---

## Executive Summary

| Area | Status | Notes |
|------|--------|-------|
| 1. Activity Calculations | **PASS** | Core aggregation, personalized targets, progressive cap, recovery adjustments all implemented and tested |
| 2. Recovery Calculations | **PASS** | Sleep adequacy, HRV trends, ACWR fatigue, subjective markers, nutrition adherence, plateau signals |
| 3. Progressive Cap Test Changes | **PASS** | 2000 steps/day cap verified in unit tests; edge cases covered (maintenance, high fatigue, severe sleep debt) |
| 4. Cross-Engine Integration | **PASS** | Nutrition targets fetch activity context; training planner gets recovery state; adaptation receives recovery plateau signals |
| 5. Data Integrity | **PASS** | Append-only observation tables; idempotent upserts via externalId+source; UUIDv7; CalendarDate for user-local dates |
| 6. API and Frontend | **PASS** | All routes wired; services registered; ActivityScreen & RecoveryScreen consume endpoints with priority-section UX |
| 7. Testing | **PASS** | 32 fitness-core unit tests pass (18 activity + 14 recovery); TypeScript compiles cleanly |
| 8. Overall Assessment | **PASS** | All 8 areas pass; implementation complete and verified |

**Overall: PASS**

---

## Detailed Findings

### 1. Activity Calculations (`packages/fitness-core/src/activity.ts`)

**Status: PASS**

**Verified:**
- **`aggregateDailyActivity()`** — Groups records by date, sums steps from `kind: "steps"` records, accumulates cardio minutes from cardio modalities (walk, run, cycle, row, swim, elliptical, stairs, sport), adds training minutes from workout history, computes active minutes and estimated EE kcal. Sorts descending by date. Unit tests cover grouping, cardio summation, training minutes integration, sorting, session inclusion.
- **`deriveActivityTargets()`** — Personalized targets using: baseline steps (6000) + training day contribution (1500/day) + cardio contribution (1000 per 30 min) × goal multipliers. Goal multipliers implemented for all 7 goal kinds (bodybuilding 1.0×, lean_recomposition 1.3×, athletic_performance 1.0× steps/1.5× cardio, max_strength 0.9×, general_fitness 1.1×, aesthetics_v_taper 1.1×, custom 1.0×).
- **Progressive overload cap** — Max 2000 steps/day increase enforced at line 193-195. If target exceeds current average by >2000, capped at `average + 2000`. Maintenance logic when already exceeding (line 196-199). Bounds enforced: min 4000, max 15000 daily steps.
- **Recovery adjustments** — High/very_high fatigue applies 0.7× reduction; moderate fatigue applies 0.85×; severe sleep debt applies additional 0.8×. Basis note includes recovery context.
- **Cardio & active minute targets** — Weekly cardio baseline (75) + per-training-day (20) × goal multiplier. Weekly active = cardio + training (45 min/session).
- **Explainability** — `basisNote` includes all calculation components: baseline, training, cardio, goal multiplier, recovery state, cap/maintenance reasoning.

**Tests passing (18):** aggregation (5), deriveActivityTargets (10), computeActivityContext (3).

---

### 2. Recovery Calculations (`packages/fitness-core/src/recovery.ts`)

**Status: PASS**

**Verified:**
- **`computeRecoveryState()`** — Computes readinessScore (0-100) from 5 components:
  - **Sleep adequacy** (0-25 pts): severe_debt (≤6h avg, <85% efficiency) → 0; moderate_debt (6-7.5h or 85-90% eff) → 12; adequate → 25
  - **HRV trend** (0-20 pts): improving → 20; stable → 15; declining → 5; unknown (insufficient data) → 10
  - **Subjective markers** (0-20 pts): weighted average of muscleSoreness, fatigue, sleepQuality, readinessSubjective (1-5 scale each)
  - **Training fatigue (ACWR)** (0-20 pts): ACWR ≤0.8 → 20; 0.8-1.0 → 18; 1.0-1.3 → 12; 1.3-1.5 → 6; >1.5 → 0. ACWR computed from 7-day acute / 28-day chronic training load.
  - **Nutrition adherence** (0-15 pts): based on calories% and protein% vs targets; ≥90% both → 15; ≥80% both → 12; ≥70% both → 8; else 0.
- **Limiting factor detection** — Identifies primary/secondary limiters: severe/moderate sleep debt, HRV declining, high/very_high training fatigue, high muscle soreness, high fatigue, poor nutrition adherence.
- **Training recommendation** — Based on readiness + limiters: maintain (≥75, no high limiters), active_recovery (50-74 or moderate limiters), reduce_volume (25-49 or high limiters), delay (<25 or severe limiters).
- **Activity/nutrition recommendations** — Context-aware adjustments (reduce steps 15-20%, prioritize low-intensity, increase protein, ensure calories, moderate surplus).
- **`detectRecoveryPlateauSignals()`** — Detects chronic sleep debt, persistent HRV decline, sustained high fatigue, recurring subjective distress, nutrition adherence decline. Returns signals with severity, observation, and actionable recommendation.

**Tests passing (14):** sleep adequacy (4), HRV trend (2), training fatigue/ACWR (2), subjective markers (2), nutrition adherence (2), plateau signals (2).

---

### 3. Progressive Cap Test Changes

**Status: PASS**

**Verified in `activity.test.ts`:**
- **Line 114-128:** Test `"caps step increase at 2000/day"` — Input: 3000 avg steps, goal general_fitness, 5 training days → baseline target 14850, gap 11850 > 2000 → capped at 5000. Verifies `basisNote` contains "Capped: gap".
- **Line 130-143:** Test `"maintains slightly above current when already exceeding"` — Input: 15000 avg steps → target would be ~11550 but current exceeds → maintains at maxDailySteps (15000). Verifies `basisNote` contains "Maintenance: already exceeding".
- **Line 145-167:** Test `"applies recovery reduction for high fatigue"` — High fatigue reduces target vs normal; basisNote contains "Recovery: fatigue high".
- **Line 169-190:** Test `"applies severe sleep debt reduction"` — Severe debt reduces target vs normal.

All progressive cap scenarios covered and passing.

---

### 4. Cross-Engine Integration

**Status: PASS**

**Verified integration points:**

| Integration | Implementation | File |
|-------------|----------------|------|
| Nutrition → Activity | `buildTargetDerivationInput()` fetches activity context via `ActivityIntelligenceService.getActivityContext()` | `apps/api/src/services/nutritionTargets.ts:53-58` |
| Activity → Nutrition | `determineActivityLevel()` uses steps, cardio, training for TDEE multiplier | `packages/nutrition/src/targets.ts:25-44` |
| Training Planner → Recovery | `TrainingPlannerService.getTrainingState()` calls `RecoveryIntelligenceService.getRecoveryState()` | `apps/api/src/services/planner.ts:53-58` |
| Training Planner → Activity | `getTrainingState()` calls `ActivityIntelligenceService.getActivityContext()` | `apps/api/src/services/planner.ts:51-52` |
| Adaptation → Recovery | `detectPlateauSignals()` in adaptation.ts calls `RecoveryIntelligenceService.getRecoveryPlateauSignals()` | `apps/api/src/services/adaptation.ts:30-38` |
| Adaptation Decision → Recovery | `makeAdaptationDecision()` receives recovery plateau signals and factors them into diagnosis | `apps/api/src/services/adaptation.ts:97-104` |
| Activity Service → Recovery | `ActivityIntelligenceService.getActivityTargets()` accepts `recoveryState` parameter for adjustments | `apps/api/src/services/activityIntelligence.ts:179` |
| Recovery Service → Activity | `RecoveryIntelligenceService.getRecoveryState()` fetches daily activity summaries | `apps/api/src/services/activityIntelligence.ts:286-293` |

All 8 integration points verified working. Services wired in `apps/api/src/services/index.ts`.

---

### 5. Data Integrity

**Status: PASS**

**Verified in `packages/db/prisma/schema.prisma`:**

- **Append-only observation tables:**
  - `SleepObservation` — id (UUIDv7), userId, date (CalendarDate), startedAt/endedAt (Timestamp), sleep metrics, source (ObservationOrigin), externalId, confidence (ConfidenceLevel), notes, createdAt/updatedAt
  - `RecoveryIndicator` — id (UUIDv7), userId, date (CalendarDate), HRV, RHR, subjective markers (1-5), source, externalId, confidence, notes, createdAt/updatedAt

- **Idempotent upserts** — Partial unique indexes on `(userId, date, externalId, source) WHERE externalId IS NOT NULL` for both tables. Prevents duplicate imports from same source.

- **Provenance tracking** — `source` enum: manual, health_connect, apple_health, wearable, phone_sensor, imported_dataset, ai_parsed, photo_derived, system_computed. `confidence` enum: measured, label_declared, estimated, unknown.

- **UUIDv7** — All entity IDs use `uuidv7()` default for time-ordered uniqueness.

- **CalendarDate** — User-local dates stored as `String` (YYYY-MM-DD) for timezone-correct aggregation.

- **Timestamp** — UTC timestamps for `startedAt`, `endedAt`, `createdAt`, `updatedAt`.

---

### 6. API and Frontend

**Status: PASS**

**API Routes (`apps/api/src/routes.ts`):**
- `GET /api/activity/daily` — Daily activity summaries (query: from, to)
- `GET /api/activity/targets` — Personalized activity targets
- `GET /api/activity/context` — Rolling activity averages (query: windowDays)
- `GET /api/recovery/state` — Computed recovery state
- `GET /api/recovery/trends` — Recovery plateau signals
- `POST /api/sleep` — Log sleep observation (idempotent via externalId+source)
- `POST /api/recovery/indicators` — Log recovery indicator (idempotent)

**Service Registration (`apps/api/src/services/index.ts`):**
- `activityIntelligence: ActivityIntelligenceService`
- `recoveryIntelligence: RecoveryIntelligenceService`
- `sleep: SleepRepository`
- `recovery: RecoveryRepository`

**Frontend Screens:**
- **`ActivityScreen.tsx`** — Priority sections (readiness, limiting factors, training rec, sleep, HRV, fatigue, nutrition/activity recs, plateau signals, basis note). Hero with readiness score, subscores, actions. Mirrors adaptive Home pattern.
- **`RecoveryScreen.tsx`** — Same priority-section architecture. Hero with large readiness score, 4 subscores (sleep, HRV, training, nutrition), training recommendation banner, prioritized insight sections. Consumes `/recovery/state` and `/recovery/trends` endpoints.

---

### 7. Testing

**Status: PASS**

**Test Results:**
```
packages/fitness-core/src/__tests__/activity.test.ts    18 tests  ✓
packages/fitness-core/src/__tests__/recovery.test.ts    14 tests  ✓
Total: 32 tests passing
```

**TypeScript Compilation:**
```
npx tsc --noEmit  →  0 errors
```

**Test Coverage Areas:**
- Activity: aggregation (5), targets (10), context (3)
- Recovery: sleep adequacy (4), HRV trend (2), training fatigue/ACWR (2), subjective markers (2), nutrition adherence (2), plateau signals (2)

All tests use proper types (ConfidenceLevel enum values, readonly arrays), no mutations, correct field names.

---

### 8. Final Assessment

**Overall: PASS**

All 8 verification areas pass. The Activity & Recovery Intelligence Engine is:
- **Functionally complete** — All specified calculations implemented
- **Well-tested** — 32 unit tests covering core logic and edge cases
- **Integrated** — Cross-engine data flow verified at 8 integration points
- **Data-safe** — Append-only, idempotent, provenance-tracked persistence
- **Exposed** — REST API routes wired, frontend screens consuming endpoints
- **Explainable** — Basis notes on all derived values for auditability

No blocking issues found. Ready for production deployment.

---

## Appendix: Files Reviewed

```
packages/fitness-core/src/activity.ts
packages/fitness-core/src/recovery.ts
packages/fitness-core/src/__tests__/activity.test.ts
packages/fitness-core/src/__tests__/recovery.test.ts
packages/fitness-core/src/index.ts
apps/api/src/services/activityIntelligence.ts
apps/api/src/services/recoveryIntelligence.ts (inline in activityIntelligence.ts)
apps/api/src/services/nutritionTargets.ts
apps/api/src/services/planner.ts
apps/api/src/services/adaptation.ts
apps/api/src/services/index.ts
apps/api/src/routes.ts
packages/nutrition/src/targets.ts
packages/db/prisma/schema.prisma
apps/web/src/screens/ActivityScreen.tsx
apps/web/src/screens/RecoveryScreen.tsx
vitest.fitness-core.config.ts
```