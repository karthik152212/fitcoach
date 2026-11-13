# FitCoach AI Coach — Acceptance Scenarios

**Phase 9.3 — Coaching Orchestrator & Response Integrity**
**Status: Implemented**
**Verified against**: `apps/api/src/__tests__/aiCoaching.integration.ts` (12 integration tests through real HTTP routes, real service composition, in-memory repos, mock provider — no API key, no network)

---

## 1. Purpose

Defines 8 E2E acceptance scenarios (A–H) for the AI Coach. Each scenario:

- Exercises **real service composition** — existing repositories, services, and routes
- Uses a **mock AI provider** (no API key, clearly labeled)
- Asserts that **context actually reaches the coaching orchestration** and the
  response **references the correct evidence**
- Does **not** merely mock a context object and assert it exists

**Test convention**: Follows Phase 8 patterns — `createDecisionStore`-style in-memory
fixtures, `withServer` harness, real HTTP routes, real `UnifiedDecisionService`.

---

## 2. Test Harness Pattern (Phase 8 Style)

All scenarios use the same pattern established in
`apps/api/src/__tests__/unifiedDecision.integration.ts`:

```typescript
const store = createDecisionStore();
// ... set up fixture data ...
await withServer(store, async (baseUrl) => {
  const response = await fetch(`${baseUrl}/v0/users/${userId}/conversations`, {
    method: "POST",
    body: JSON.stringify({ ... }),
  });
  assert.ok(response.status === 201);
  const body = await response.json();
  // assert on evidence references, decision context, quality, etc.
});
```

**Fixtures needed** (extend `createDecisionStore` or create per-scenario):
- User with profile, timezone, training days per week, session duration
- Active goal + physique target
- Training plan with sessions/exercises + completed workouts with sets
- Nutrition: daily nutrition records, targets, meals
- Activity: steps, cardio sessions
- Sleep: observations (14 days)
- Recovery: indicators (14 days)
- Body: measurements (weight, circumferences)
- Current decision snapshot + diagnoses + outcomes

---

## 3. Scenario A — Stalled Progress Question

**Intent**: `stalled_progress`

### Setup
Create a user with:
- Profile: training experience "intermediate", trainingDaysPerWeek 4, sessionDurationMinutes 60
- Active goal: kind "hypertrophy", priorities ["chest_size", "strength"]
- Training plan: 4 sessions/week, bench press + squat + rows + overhead press
- Completed workouts: 3 sessions in last 14 days, bench press at 60kg × 8 reps @ RIR 2 (same as 3 weeks ago — stalled)
- Nutrition: daily nutrition showing protein at 78% of target, calories at 95%
- Recovery: readiness score 78/100, sleep adequate
- Body: weight stable at 80kg for 4 weeks
- Current decision: `no_change`, reason "progressing adequately", confidence 0.7
- Decision evidence: training_state slice shows plateauSignals for bench press

### Action
POST `/v0/users/:userId/conversations/:conversationId/messages`
Body: `{ message: "Why am I not progressing on bench press?" }`

### Expected Context Retrieval
- `training_state` slice: progressionStatus for bench press = "stalled", bestReps 8, bestLoadKg 60
- `nutrition_state` slice: proteinPercent 78, adherence below target
- `recovery_state` slice: readinessScore 78, fatigueAccumulation "low"
- `body_state` slice: weightTrend 0kg over 4 weeks
- `decision_context`: current decision `no_change`, confidence 0.7

### Expected Decision Integration
- `decisionSnapshot.kind` === "no_change"
- `decisionSnapshot.summary` references "progressing"
- `evidenceReferences` includes training evidence with code related to plateau/stagnation
- `quality.sufficientForAdvice` === true

### Assertions
1. Response answer mentions training (not generic "eat more protein")
2. `evidenceReferences` contains at least one entry with `source` === "training_state"
3. `evidenceReferences` contains at least one entry with `code` related to bench press or progression
4. `decisionContext.decisionSnapshot.kind` === "no_change"
5. `quality.missingDataWarnings` does NOT claim "no data" (data exists)
6. `isMock` === true (mock provider clearly labeled)

### Fail Conditions
- Answer is generic ("eat more protein and train harder") without referencing actual training data
- No evidence references from training domain
- Decision context missing or null
- `isMock` === false (real provider used accidentally)

---

## 4. Scenario B — Today's Workout Question

**Intent**: `todays_workout`

### Setup
Create a user with:
- Active training plan with today's session (e.g., "Upper A": bench press, rows, overhead press)
- No completed workout for today yet
- Recovery: readiness score 65/100 (moderate fatigue), sleep 6.5h avg (moderate debt)
- Current decision: `no_change`
- Training environment: "gym" (all equipment available)

### Action
POST message: "Should I train today?"

### Expected Context Retrieval
- `training_state`: today's session planned, exercises with target sets/reps/RIR
- `recovery_state`: readinessScore 65, fatigueAccumulation "moderate", sleepAdequacy "moderate_debt"
- `decision_context`: current decision

### Expected Decision Integration
- Decision context shows current plan is active
- No decision forces rest (decision is `no_change`, not recovery-blocking)

### Assertions
1. Response references today's planned session (exercise names from plan)
2. Response references recovery state (readiness 65, sleep moderate debt)
3. Response does NOT prescribe specific sets/reps/load (that's the plan's job, not AI's)
4. `evidenceReferences` includes recovery_state source
5. `evidenceReferences` includes training_state source
6. Response communicates uncertainty if recovery is borderline

### Fail Conditions
- Answer prescribes specific load/sets (AI oversteps into training prescription)
- No reference to today's actual plan
- No reference to recovery state
- `isMock` === false

---

## 5. Scenario C — Nutrition Question

**Intent**: `nutrition_question`

### Setup
Create a user with:
- Nutrition targets: caloriesKcal 2400, proteinGrams 180
- Daily nutrition: last 7 days, calories averaging 2100 (87.5%), protein averaging 140g (77.8%)
- Meals: 3 meals logged yesterday, 2 meals logged today
- Food sources: mix of "curated_database" and "user_created" with confidence levels
- Current decision: `nutrition_target_adjustment` intervention active (protein increase)

### Action
POST message: "Am I eating enough protein?"

### Expected Context Retrieval
- `nutrition_state`: daily nutrition totals, targets, adherence (proteinPercent 77.8)
- `nutrition_state`: meals with inputMethod (search, photo_assisted, etc.)
- `decision_context`: active intervention `nutrition_target_adjustment`
- `evidenceReferences`: nutrition evidence with code like "protein_intake_below_target"

### Expected Decision Integration
- `decisionContext.activeInterventions` includes `nutrition_target_adjustment`
- `decisionContext.interventions` has parameters (target: "protein", adjustmentType: "increase")

### Assertions
1. Response references actual protein intake (140g vs 180g target = 77.8%)
2. Response references the active nutrition intervention
3. `evidenceReferences` includes nutrition_state source with code related to protein
4. Response distinguishes measured vs estimated food data (confidence/provenance)
5. Response does NOT invent a new calorie target
6. `quality.staleDataWarnings` empty or appropriate (7 days of data is recent)

### Fail Conditions
- Answer invents a new calorie/protein target not in context
- No reference to actual meal data
- No reference to active intervention
- `isMock` === false

---

## 6. Scenario D — Weight/Physique Question

**Intent**: `weight_physique`

### Setup
Create a user with:
- Body measurements: 4 records over 8 weeks, weight 82 → 80 → 79.5 → 79 kg
- Waist circumference: 84 → 83 → 82.5 → 82 cm
- Physique goal: direction "lose", targetTimeframeWeeks 12
- Projection snapshot: body_weight_kg projected 77kg at 3 months, confidence "estimated", significant divergence flag false
- Current decision: `no_change`
- Body state: weightTrend slope -0.375kg/week

### Action
POST message: "Why is my weight not dropping faster?"

### Expected Context Retrieval
- `body_state`: weightTrend, latest measurement, measurement count
- `projection_state`: projected weight at 3 months, divergence info
- `physique_goals`: direction "lose", timeframe 12 weeks
- `decision_context`: current decision

### Expected Decision Integration
- `decisionContext.decisionSnapshot.kind` === "no_change"
- Projection shows expected trajectory vs actual

### Assertions
1. Response references actual weight trend (79kg current, -0.375kg/week)
2. Response references projection (77kg expected at 3 months)
3. Response references physique goal (12-week timeframe)
4. `evidenceReferences` includes body_state source
5. `evidenceReferences` includes projection_state source
6. Response communicates uncertainty (projection confidence "estimated", range)
7. Response does NOT invent a new weight target or timeline

### Fail Conditions
- Answer invents a specific weight loss timeline not in projection
- No reference to actual measurements
- No reference to projection data
- No uncertainty communication for estimated projection
- `isMock` === false

---

## 7. Scenario E — Follow-up Question Preserves Context

**Intent**: `follow_up` (linked to previous turn)

### Setup
Same as Scenario A (stalled progress), plus:
- First turn: "Why am I not progressing?" → response with evidence refs and decision context
- Conversation persisted with messageId for first turn

### Action
1. POST first message: "Why am I not progressing on bench press?" → get `messageId`
2. POST follow-up: "What should I change?" with `conversationId` from first turn

### Expected Context Retrieval
- Previous conversation messages loaded (last N)
- Previous `PersonalContextSnapshot` referenced (or rebuilt from current data)
- Same evidence sources as Scenario A (training, nutrition, recovery, body, decision)
- New data check: if no new logs since first turn, context is similar

### Expected Decision Integration
- Same decision context as Scenario A (no_change)
- Follow-up references the previous turn's reasoning

### Assertions
1. `conversationId` matches between turns
2. Response references previous turn's evidence (e.g., "As we discussed, your bench press is stalled at 60kg")
3. Response does NOT repeat generic advice — builds on previous context
4. `evidenceReferences` from second turn overlap with first turn's evidence
5. `decisionContext.decisionSnapshot.id` matches first turn's decision
6. If new data arrived (e.g., a workout logged between turns), context reflects it

### Fail Conditions
- Second turn treats message as unrelated (no reference to previous turn)
- `conversationId` not persisted or mismatched
- Evidence references completely different from first turn without new data justification
- `isMock` === false

---

## 8. Scenario F — Missing/Stale Data Produces Honest Uncertainty

**Intent**: `general_coaching` or `nutrition_question`

### Setup
Create a user with:
- Profile: minimal (no height, no training experience)
- No active goal
- No completed workouts in last 28 days
- No meals logged in last 7 days
- No sleep/recovery data
- No body measurements
- No current decision
- Current date: 2026-11-11

### Action
POST message: "What should I eat today?"

### Expected Context Retrieval
- `nutrition_state`: null or empty (no data)
- `training_state`: null or empty (no plan)
- `recovery_state`: null or empty
- `body_state`: null or empty
- `decision_context`: null (no decision)

### Expected Decision Integration
- `decisionContext.decisionSnapshot` === null
- `quality.sufficientForAdvice` === false
- `quality.missingDataWarnings` non-empty
- `quality.staleDataWarnings` non-empty

### Assertions
1. Response expresses uncertainty ("I don't have enough data about your eating habits")
2. Response suggests clarification questions ("Have you been logging meals? What's your goal?")
3. Response does NOT invent calorie targets, meal plans, or specific foods
4. `quality.sufficientForAdvice` === false
5. `isMock` === true

### Fail Conditions
- Answer invents a meal plan or calorie target
- Answer gives specific nutrition advice without data
- `quality.sufficientForAdvice` === true (should be false with no data)
- `isMock` === false

---

## 9. Scenario G — Challenging the Current Recommendation

**Intent**: `follow_up` or `general_coaching`

### Setup
Create a user with:
- Current decision: `training_volume_adjustment` (intervention: increase volume by 10%)
- Decision evidence: training_state shows under-target volume for chest
- Diagnosis: `training_volume_deficit`, severity "watch"
- Completed workouts: user has been completing all planned sessions
- Current decision confidence: 0.6

### Action
POST message: "I don't think I need more volume. I'm recovering fine."

### Expected Context Retrieval
- `training_state`: plateauSignals, volume per muscle, completion rate
- `recovery_state`: readinessScore, fatigueAccumulation
- `decision_context`: current decision with intervention parameters
- User's challenge is noted but does NOT override the decision

### Expected Decision Integration
- `decisionContext.decisionSnapshot.kind` === "training_volume_adjustment"
- Response explains the Decision Brain's reasoning (under-target volume evidence)
- Response acknowledges user's recovery data but explains why volume adjustment stands
- No new decision is created (AI doesn't override)

### Assertions
1. Response explains the actual decision reasoning (volume deficit evidence)
2. Response references user's recovery data (readiness score) but contextualizes it
3. Response does NOT create a new decision or reverse the existing one
4. `evidenceReferences` includes training_state evidence for volume deficit
5. `decisionContext.decisionSnapshot.id` unchanged
6. `isMock` === true

### Fail Conditions
- Answer reverses the decision without going through the decision workflow
- Answer invents a new volume target not in the decision
- No reference to the actual decision evidence
- `isMock` === false

---

## 10. Scenario H — New Logs Refresh Context

**Intent**: `general_coaching`

### Setup
Create a user with:
- No completed workouts initially
- Current decision: `no_change`
- Context snapshot generated at time T1

### Action
1. POST message: "Should I train today?" → get response R1 (context: no workouts)
2. Log a workout: POST `/v0/users/:userId/workouts` + sets (completed session)
3. POST message: "Should I train today?" again → get response R2

### Expected Context Retrieval
- R1: `training_state` shows no recent workouts, adherence low
- R2: `training_state` shows the newly completed workout, adherence updated
- Context snapshot `generatedAt` updated between R1 and R2

### Expected Decision Integration
- Decision may remain `no_change` but context reflects new data
- Response R2 differs from R1 (acknowledges the completed workout)

### Assertions
1. R1 and R2 answers differ (R2 acknowledges the logged workout)
2. `contextSnapshot.generatedAt` is later for R2 than R1
3. `evidenceReferences` in R2 include the newly logged workout
4. `training_state` in R2 shows updated adherence/completion
5. `isMock` === true for both

### Fail Conditions
- R1 and R2 are identical (context not refreshed)
- R2 doesn't reference the newly logged workout
- Context snapshot timestamp not updated
- `isMock` === false

---

## 11. Test Infrastructure Requirements

### Fixtures to Extend

Extend `createDecisionStore()` in `apps/api/src/__tests__/unifiedDecision.integration.ts` or create per-scenario setup helpers:

```typescript
interface CoachingFixture {
  userId: string;
  profile: Profile;
  goal: Goal;
  physiqueTarget?: PhysiqueTarget;
  plan: PlanAggregate;
  workouts: WorkoutRecord[];
  dailyNutrition: DailyNutritionRecord[];
  nutritionTargets: NutritionTargets;
  sleepRecords: SleepObservationRecord[];
  recoveryRecords: RecoveryIndicatorRecord[];
  bodyMeasurements: BodyMeasurementRecord[];
  currentDecision: DecisionSnapshot;
  diagnoses: UnifiedDiagnosis[];
  outcomes: DecisionOutcomeRecord[];
}
```

### Mock Provider Implementation

`packages/ai/src/mockProvider.ts`:

```typescript
export class MockAIProvider implements AIProvider {
  readonly name = "mock";
  readonly isMock = true;

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    // Build structured response based on intent and context
    // Echo back key evidence facts
    // Return proposedActions from action registry
    // NEVER pretend to be real AI
  }
}
```

### Assertion Helpers

```typescript
function assertEvidenceReferenced(response: CoachingResponse, source: string, code?: string) {
  const refs = response.evidenceReferences.filter(r => r.source === source);
  assert.ok(refs.length > 0, `Expected evidence from ${source}`);
  if (code) {
    assert.ok(refs.some(r => r.code === code), `Expected evidence code ${code}`);
  }
}

function assertMockLabeled(response: CoachingResponse) {
  assert.equal(response.isMock, true, "Mock provider should be labeled");
}

function assertNoInventedTargets(response: CoachingResponse) {
  // Answer should not contain specific calorie/protein numbers not in evidence
  // (heuristic: check that all numbers in answer appear in evidence references)
}
```

---

## 12. Run Commands

```bash
# Build
npm run build

# Run AI Coach integration tests (when implemented)
node --env-file-if-exists=.env --test apps/api/dist/__tests__/aiCoaching.integration.js

# Run frontend tests
cd apps/web && npx vitest run

# Typecheck
npm run typecheck
```

---

## 13. Acceptance Summary

| Scenario | Intent | Key Assertion | Status |
|----------|--------|---------------|--------|
| A | stalled_progress | Response uses actual training data, not generic advice | Passed |
| B | todays_workout | Response references today's plan + recovery state | Passed |
| C | nutrition_question | Response references actual meals + active intervention | Passed |
| D | weight_physique | Response references measurements + projection with uncertainty | Passed |
| E | follow_up | Second turn references first turn's evidence | Passed |
| F | missing_data | Response expresses uncertainty, no invented targets | Passed |
| G | challenge_decision | Response explains decision reasoning, doesn't override | Passed |
| H | context_refresh | New logs invalidate/refresh context snapshot | Passed |

**All 8 scenarios must pass through real API routes and real service composition** with a mock AI provider. No scenario may pass by mocking the context alone.