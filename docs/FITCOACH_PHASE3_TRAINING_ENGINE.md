# FitCoach Phase 3 — Adaptive Training Engine

Status: **implemented** (working tree).
Config version: `fitcoach.training.v1` (`TRAINING_CONFIG_VERSION`).
Scope guard: no UI, no nutrition work, no unified coach, and no LLM anywhere in
the planning path — every number below is computed by `@fitcoach/fitness-core`.

This document is the model reference for Phase 3. It records what the engine
does, which assumption each number encodes, and where a number is a range rather
than a claim. `packages/fitness-core/src/__tests__/training.test.ts` is written
against this document.

---

## 1. Objective

Turn the Phase 2 knowledge engine (muscles, structures, equipment, suitability)
into a **deterministic personalized planning engine**:

- generate a weekly plan from available days, session length, equipment,
  preferences and goal;
- prescribe volume and frequency per muscle as ranges;
- budget session duration and repair overruns;
- select exercises through Phase 2 reasoning (never a static table);
- progress, detect plateaus and adapt with the **smallest useful change**;
- treat `no_change` as a first-class outcome;
- version plans, compare versions, explain every decision;
- report infeasibility explicitly instead of emitting a plausible-looking plan.

## 2. Layering

```text
packages/domain          types only (TrainingContext, TrainingPlan, decisions…)
packages/fitness-core    pure engines — no Prisma, no clock, no randomness
packages/db              repositories + migration 0003 (persistence of plans)
apps/api/src/services    TrainingPlannerService — context loading + persistence
apps/api/src/routes      HTTP contracts (validation only, no business logic)
```

Engines never read a clock: every entry point takes `asOf`, so an identical
request produces an identical plan. The service layer is the only place that
touches repositories.

## 3. Configuration and versioning

`trainingConfig.ts` is the single source of tunables. `TRAINING_CONFIG_VERSION`
is stamped onto every plan version (`config_version`) and progression rule, so a
plan can be explained against the configuration that produced it.

Key tunables (all overridable by passing a configuration object):

| Group | Constant | Values |
|---|---|---|
| Effective sets | `DEFAULT_EFFECTIVE_SET_COEFFICIENTS` | direct 1.0, indirect 0.5, supporting 0.25, stabilizer 0.1, structure emphasis +0.25, same-muscle overlap penalty 0.15 |
| Duration | `DEFAULT_SESSION_DURATION_BUDGET` | warm-up 8 min, transition 120 s/exercise, rest 90 s/set, logging 5 min |
| Rest by goal | `REST_SECONDS_BY_GOAL` | hypertrophy 90, strength 180, athletic 120, general fitness 60 |
| Warm-up by session type | `WARMUP_MINUTES_BY_SESSION_TYPE` | full body 10, upper/lower/legs 8, push/pull 6 |
| Progression | `DEFAULT_PROGRESSION_CONFIGURATION` | default RIR 2, hypertrophy 8–15 reps, strength 3–6 reps, load step 2.5 kg, 2 reps before load, 2 sessions at top before progressing, ≤3 progressions/week |
| Adaptation | `DEFAULT_ADAPTATION_THRESHOLDS` | adherence 0.6, stagnation 3 sessions, volume adjustment 20 %, under-target fraction 0.7 |
| Plan quality | `PLAN_QUALITY_WEIGHTS` | coverage 0.20, goal alignment 0.15, volume 0.15, frequency 0.10, equipment 0.10, suitability 0.10, duration 0.05, preferences 0.05, redundancy 0.05, progression readiness 0.05 |

## 4. Inputs

`TrainingContext` (per request): user id, timezone, birth date/sex/height,
training experience, limitations, available days, max session minutes, exercise
preferences, available and temporarily-unavailable equipment, `asOf`.

`GoalContext`: goal id, kind, start date, priorities.

`TrainingHistory`: logged workouts and sets, read through repository queries and
reduced to per-exercise performance (`bestReps`, `recentRir`,
`completedSessions`, `incompleteSessions`, `trend`).

## 5. Split generation

`selectSplit` chooses a structure from days, duration, experience and goal:

- 0 days → `createImpossibleSplit` (explicit infeasibility, never a guess);
- 1–2 days → full body;
- 3 days → full body, or an upper/lower/full-body hybrid for strength/athletic;
- 4 days → upper/lower (2×/week frequency for every major group);
- 5 days → upper/lower + a V-taper specialization day when that is the priority,
  otherwise push/pull/legs plus a focus day;
- 6 days → push/pull/legs;
- 7+ days → push/pull/legs + a weak-point day for intermediate/advanced lifters,
  otherwise a capped variant that never exceeds the weekly target.

A per-duration exercise ceiling is applied to whatever structure is chosen, so a
45-minute user is never handed a 90-minute session. Each session carries a
weekday hint, and the split ships a human `rationale` plus
`selectionJustification` that are persisted on the version.

## 6. Frequency

`distributeFrequency` allocates weekly sets to sessions using the muscle
frequency targets (`min`/`preferred`/`max` per muscle, each with a documented
rationale). Distribution is round-robin and stable, so the same inputs produce
the same session-by-session assignment.

## 7. Volume model (effective sets)

Volume is reported in **effective sets**, never raw sets:

```text
effective_sets(muscle) = Σ over planned sets (sets × role coefficient)
                          + structure emphasis bonus
                          − same-muscle overlap penalty
```

- a whole-muscle entry carries the base contribution; structure (head/region)
  entries add only their `emphasis` bonus — this prevents double counting one
  exposure as several;
- direct (primary mover) 1.0, indirect (secondary) 0.5, supporting 0.25,
  stabilizer 0.1;
- secondary contributions are capped (`compoundIndirectCap`) so a compound
  exercise cannot silently supply a muscle's whole weekly volume.

## 8. Volume targets

`DEFAULT_MUSCLE_VOLUME_TARGETS` holds `min`/`preferred`/`max` per tracked muscle,
with a goal profile and an experience modifier. Reported volume is compared to
these **ranges**; the plan reports `underTargetMuscles` and
`potentiallyExcessiveMuscles` instead of a single pass/fail number.

## 9. Session duration model

```text
duration = warmup
         + Σ per exercise (transition + sets × (work + rest))
         + logging
```

`estimateSessionDuration` returns the estimate, the target, the variance, a
breakdown per exercise, and `exceedsBudget`. Rest comes from the goal profile;
warm-up from the session type.

## 10. Session repair

`repairOverBudgetSession` trims redundant sets first and drops low-priority work
only if the budget still cannot be met. Strength/athletic sessions keep a floor
of 2 sets per exercise; other goals 1. Every repair emits a `SessionRepairChange`
and a warning, so a repaired session is visible rather than silent.

## 11. Exercise selection (delegated to Phase 2)

`buildSessionFromAssignments` selects exercises through the Phase 2 knowledge
engine: muscle targets, structures, movement patterns, roles, equipment
requirements, stability/loading characteristics and suitability tiers. Each
planned exercise carries its `planRole`, a `selectionReason`, viable
substitution ids, and a Phase 2 `exerciseDecisionSnapshot`.

## 12. Equipment, availability and preferences

- availability is a validity interval, not a boolean: `listUserEquipment(userId,
  asOf)` answers "what did they have on that day?", and
  `temporarily_unavailable` equipment is excluded from selection but still known;
- a request may override equipment for a single generation;
- preferences are `preferred`/`neutral`/`disliked`/`excluded`;
- `excluded` is a hard filter; `disliked` applies a bounded adjustment and is
  chosen only when no alternative exists.

## 13. Hard filters

Excluded exercises, unavailable equipment compressing a muscle's pool to nothing,
and the set floors in §10 are enforced during construction, and then re-checked
as constraints (§15). Construction and evaluation are separate so a failure is
reported, not hidden.

## 14. Goal alignment

`evaluateGoalAlignment` scores the plan against goal-valued roles and muscle
exposure (e.g. lateral deltoid exposure for a v-taper goal). Priorities from the
goal are mapped to muscle slugs for repair ordering. The result is a 0–1 score
plus the reasons behind it.

## 15. Constraints (explicit, persisted)

Every generated version stores one row per evaluated constraint with a literal
result — `satisfied`, `violated` or `warning` — plus a detail when it fails:

| Key | Kind | Hard |
|---|---|---|
| `days_per_week` | schedule | yes |
| `exercise_availability` | equipment | yes |
| `session_duration` | duration | yes |
| `excluded_exercises` | preference | yes |
| `disliked_exercises` | preference | no |
| `volume_range` | volume | no |

"Not evaluated" is not an outcome. A violated hard constraint other than
`session_duration` makes the request **infeasible**; a duration violation is
`feasible_with_tradeoffs` because it is a stated, visible compromise.

## 16. Plan quality

`evaluatePlanQuality` decomposes the plan into weighted components (see §3),
lists `hardViolations` and `missingEvidence`, and returns a total in [0,100].
`scoreFromAssessment` and `scoreSessionDuration` convert assessment counts and
overrun minutes into component scores. Quality is a summary, not an argument: the
constraints and volume report remain the evidence.

## 17. Infeasibility

Explicit, with reasons:

- 0 available days → no split, `infeasibilityReasons` populated;
- a hard constraint violation such as `exercise_availability` (a session that
  cannot be filled at all) → **no plan is persisted**, and the reasons come back
  with the response;
- API returns 200 with `feasibility: "infeasible"` and no `plan`, because
  infeasibility is a modelled answer, not a transport error.

## 18. Determinism

Identical input → byte-identical plan:

- no `Date.now()` in any engine — `asOf` is injected;
- stable sorts with explicit tie-breaks (`localeCompare` on exercise ids/slugs);
- deterministic decision ladders (§21) and muscle iteration order;
- the planner test suite generates the same request twice and compares session
  shapes and quality scores.

## 19. Progression

`buildProgressionRule` attaches one rule per planned slot: trigger, condition,
action, bounds, reset behaviour and rationale, all text, all persisted
(`training_plan_progression_rules`). The default scheme is double progression:
add reps inside the range first, then load in 2.5 kg steps, hold after missed
reps, and never exceed the configured progressions per week. `recommendProgression`
bridges the Phase 1 shape; `evaluateProgression` returns action, reasoning and
evidence for the current session.

## 20. Plateau signals

`detectPlateauSignals` emits typed signals — repeated performance stagnation,
declining performance, adherence gaps, insufficient volume — each with an
observation, the affected entity, a severity and an observed window. Signals are
data: nothing is inferred from "looks flat".

## 21. Adaptation decision ladder

`makeAdaptationDecision` is ordered and deterministic:

1. no signals → `no_change`;
2. exactly one stagnating exercise → `modify_progression`;
3. declining performance → `reduce_training_stress`;
4. volume below target → `adjust_volume` (escalated wording when ≥70 % of trained
   muscles are under target);
5. three or more unrelated signals → `no_change` pending structural review;
6. otherwise → `no_change` while monitoring.

## 22. `no_change` is an outcome, not a failure

Whenever the ladder stops at `no_change`, the API still writes a decision row
with its reason codes and monitoring plan, and **creates no new version** —
history is not rewritten to say "something happened".

## 23. Smallest useful change

Interventions are bounded and applied, not merely announced:
`applyVolumeAdjustments` spreads a muscle's signed delta one set at a time across
that muscle's primary-mover exercises in stable exercise-id order, respecting
`minSets`/`maxSets`, and returns a new array. `stressReduction` derives the trims
from the same volume report. The regenerated version stores the decision with
before/after snapshots and the comparison summary, so the change is auditable.

## 24. Plan versioning and lifecycle

- a plan holds an append-only chain of versions;
- appending supersedes the previously active version (lifecycle only — content
  stays frozen), records `parent_version_id`, `generation_reason` and
  `config_version`;
- `generation_reason` ∈ `initial_plan`, `plan_adjustment`,
  `exercise_substitution`, `volume_adjustment`, `frequency_adjustment`,
  `split_adjustment`, `progression_adjustment`, `no_change`;
- exactly one active version per plan (partial unique index);
- only `lifecycle_status` and `superseded_at` may ever change on a version row.

## 25. Comparison and summaries

`comparePlans` produces muscle-volume changes, frequency changes, exercise
changes (added/removed/replaced), session-duration changes, split/progression/
constraint/goal-alignment notes and a deterministic `orderedBy`.
`summarizePlanComparison` renders the same comparison as human sentences.
`planSummaryFor` builds the compact snapshot stored on decisions.

## 26. Explainability

Every generated or adapted version carries a `training_plan_decisions` row:
decision kind, reason codes, evidence sentence, satisfied/violated constraints,
affected muscles and exercises, optional before/after snapshots, confidence,
assumptions and the configuration version. `PlanReasonCode` values are the
shared vocabulary between the engine and the API surface.

## 27. Persistence (migration 0003)

`packages/db/prisma/migrations/0003_phase3_adaptive_training/migration.sql`:

- extends `training_plan_versions` with lifecycle/generation metadata, backfills
  older versions to `superseded`, and replaces the blanket append-only trigger
  with `training_plan_versions_lifecycle_only`;
- adds the one-active-version partial unique index and CHECK domains for
  lifecycle state, generation reason, self-parentage and timestamp ordering;
- adds `training_plan_decisions`, `training_plan_constraints` and
  `training_plan_progression_rules` with CHECK domains, uniqueness, foreign keys
  and update-forbidding triggers (a changed mind is a new row);
- `replaceConstraints` swaps a version's evaluation transactionally, which is why
  constraint rows are replaceable (delete + insert) while still being
  non-updatable.

## 28. API contracts

All routes are thin: validate → service → shape. All plan reads are
ownership-checked; another user's plan id returns 404.

| Method | Path | Notes |
|---|---|---|
| POST | `/v0/users/:userId/training-plans/generate` | 201 with plan, or 200 with `feasibility: "infeasible"` and reasons |
| GET | `/v0/users/:userId/training-plans/:planId` | ownership-checked plan read |
| GET | `/v0/users/:userId/training-plans/:planId/versions/:versionNumber` | frozen version content |
| POST | `/v0/users/:userId/training-plans/:planId/adapt` | always writes a decision; may append a version |
| GET | `/v0/users/:userId/training-plans/:planId/compare?from=&to=` | comparison + summary |
| GET | `/v0/users/:userId/training-plans/:planId/decisions?version=` | audit trail |
| GET | `/v0/users/:userId/training-plans/:planId/constraints?version=` | explicit evaluations |
| GET | `/v0/users/:userId/training-plans/:planId/coverage?version=` | volume report + assessment |
| GET | `/v0/users/:userId/training-plans/:planId/progression?version=` | recommendations + rules |
| GET | `/v0/users/:userId/training-state` | active plan, prescribed/effective volume, distribution, plateau signals, recent changes |

## 29. Tests, verification and known limits

Verified after Phase 3.1 (counts are re-measured, never carried over):

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc -p tsconfig.json --noEmit` | 0 errors |
| Build | `npm run build` | pass |
| Unit tests | `npm test` | 332 / 332 pass |
| Prisma validate | `npx prisma validate --schema packages/db/prisma/schema.prisma` | valid |
| Prisma generate | `npx prisma generate --schema …/schema.prisma` | pass |
| DB integration | `node --test packages/db/dist/__tests__/persistence.integration.js` (de-elevated `runas`) | 22 / 22 pass |
| API smoke | `node apps/api/dist/__tests__/smoke.js` (de-elevated `runas`) | 11 / 11 pass |
| No-equipment week | `node apps/api/dist/__tests__/noEquipmentWeek.js` (de-elevated `runas`) | 1 / 1 pass |

Engine coverage: `packages/fitness-core` **272/272** — `training.test.ts` 80,
`performanceLedger.test.ts` 34, `trainingEnvironment.test.ts` 40,
`noEquipmentPlanner.test.ts` 9, plus the Phase 3 suites. DB fixtures:
`unit.test.ts` 20. API: `planner.test.ts` 8, `continuity.test.ts` 3 journeys.

Known limits, stated rather than hidden:

- Adaptation regenerates the current week; it does not yet apply multi-week
  block periodization or deload scheduling.
- Recovery/sleep inputs are not part of the training context yet (Phase 5).
- Nutrition remains stubbed (Phase 4) and is deliberately absent from plan
  generation.
- Loaded pulling still has no honest no-equipment answer (see §45): the
  equipment-free catalog staffs everything else, and the remaining gap is
  reported, never filled with a pretend substitute.

---

# Phase 3.1 — Performance & Progression Ledger and Training Continuity

Config versions: `fitcoach.training.v1` (unchanged), `fitcoach.progression.v1`,
`fitcoach.environment.v1`. Domain types carry `PROGRESSION_LEDGER_VERSION` and
`ENVIRONMENT_VERSION`; the schema strings are the compatibility contract.

## 30. Performance logging

`packages/fitness-core/src/performanceLedger.ts` turns performed sets into
`PerformanceObservation`s. `inferLoadKind` recognises external load, bodyweight,
weighted bodyweight, assisted bodyweight, band and none; `isCompletedSet`
separates a completed set from an attempted-and-failed one; `sortObservations`
fixes a total order (performed date, timestamp, id). `getTrainingState` exposes
`performanceHistory` per exercise so the future UI reads one shaped contract.

Sets persist `load_kind`, `assistance_load_kg` and a set-level `client_request_id`
(unique per workout-exercise) — a retried submission is the same set (§32).

## 31. The progression ledger

Two append-only tables, no update path:

- `progression_evaluations` — what was evaluated, from which observations, the
  deterministic recommendation, a `fingerprint` and the config version;
  unique on `(user_id, fingerprint)`, so identical evidence evaluates once.
- `progression_decision_events` — what the user did (`recommended` / `accepted` /
  `rejected` / `deferred`), later the actual change and the resulting
  performance; unique on `(evaluation_id, idempotency_key)`.

Both carry a `fitcoach_forbid_update()` trigger. A changed mind is a new row,
which is exactly what makes "recommended", "accepted" and "actually performed"
distinguishable forever.

## 32. Progression evaluation

The evaluation ladder in `evaluateProgressionFromHistory` is fixed and
deterministic: `insufficient_data → change_exercise → declining →`
`at-top × 2 sessions → well above range → below range → easier → maintain`.
`countCompletedProgressions` counts an entry as completed only when the user
**accepted** it, the outcome is a real progression, the recorded
`actualChange` is not `none`, and the resulting performance met at least
half-way to the target. This is why `progressionStatus.progressionsCompleted`
is a real count, not a permanently-zero placeholder.

`POST /progression/evaluate` returns 200 even when nothing is persisted (no
performed sets is a modelled outcome with a reason), and is idempotent on the
evidence fingerprint.

## 33. Bodyweight progression

`progressionMechanismsFor` gives loaded work `["load","reps","rir","sets"]` and
bodyweight/assisted work `["reps","rir","variation","rom","tempo","sets"]` —
load is simply not offered where there is no load. Weighted bodyweight adds
added-load increments; assisted bodyweight progresses by *reducing* assistance.
A bodyweight or band set records its load kind, so it is never mistaken for
missing data.

## 34. Training environments

`TrainingEnvironmentKind` = gym, home, home_no_equipment,
home_limited_equipment, hotel, travel, outdoor, custom.
`packages/fitness-core/src/trainingEnvironment.ts` resolves the environment in
force on a day from interval-versioned periods (later period wins; ties by
`effectiveFrom` then id), filters explicitly unavailable equipment *out* of the
available universe, and emits structured `EnvironmentLimitation`s in a fixed
order: `muscle_coverage`, `movement_pattern`, `load_progression`, `equipment`.
Persisted in `training_environment_periods` (interval-versioned like
`user_equipment`); closing a period is the only permitted update.

## 35. Temporary environment adaptation

`PlannerService.generateTemporaryPlan` builds a `temporary_environment` plan
from the active **primary** plan. It never touches the primary plan: the
temporary row links back with `temporary_for_version_id` and is bounded by
`effective_until` (the environment window's last day, or a documented 14-day
default when the environment is open-ended — the schema forbids an unbounded
temporary plan). Sessions are adapted **before** the duration estimate, so the
budget reflects what the plan will actually contain.

## 36. Home / no-equipment training

The `home_no_equipment` and `travel` profiles have `loadProgressionAvailable`
false, `unsupportedMovementPatterns` `["horizontal_pull", "vertical_pull"]`, and
constrained muscle slugs including lats, rhomboids, traps, biceps, hamstrings
and spinal erectors. The honesty note is explicit: pulling and back work cannot
be reproduced without equipment, and the plan says so rather than pretending a
band row is a heavy row.

## 37. Exercise substitution

`adaptExercisesToEnvironment` scores candidates
`0.6·muscle_recall + 0.25·movement_jaccard + 0.15·category` (min similarity
0.35), drops an exercise when no candidate clears the bar, and **never claims
equivalence without load** — a substitution that loses external load is
labelled as such. Substitutions are surfaced as `environment_substitution` and
`environment_limitations` constraints and on the exercise group
(`substituted_from_exercise_id`, `substitution_reason`).

## 38. Plan continuity

`TrainingContinuityService` declares environments (`setEnvironment`), resolves
them, and generates/retires temporary plans. `GET /training-continuity` returns
the environment, its periods, temporary plans, session counts
(total/completed/adapted/home/skipped/open), `missedSessions`
(`max(0, planned − completed)`) and completed progressions. A repeated
`generate-temporary` for the same window refreshes the same temporary plan
rather than spawning a parallel one.

## 39. Return to the gym

`restoreEnvironment(asOf)` closes the covering period at `asOf` and retires
active temporary plans, returning `retiredPlanIds`. It is honest when there is
nothing to close (a period starting on `asOf` is a no-op). The primary plan is
still active and untouched throughout: `findActive` reads only `kind = 'primary'`.

## 40. Missed vs adapted

A workout carries `environment_kind` and `session_classification`
(`planned` / `adapted` / `makeup` / `unplanned`). A session performed somewhere
else with less equipment is **adapted** — it counts as training and is visible
in history; a planned session that never happened stays **missed** through the
`missedSessions` formula. The two are never conflated (Journey C).

## 41. Scientific limitations

The engine states uncertainty instead of hiding it: an environment's withheld
stimulus is enumerated; a bodyweight substitution that loses load is
labelled; `insufficient_data` is a first-class outcome; and a plan that cannot
staff a session is reported `infeasible` with reasons rather than returned as
an empty "feasible" plan. Nothing in the deterministic math calls an LLM.

## 42. Unified FitCoach integration

`getTrainingState` now merges the training plan with `environment`,
`availableEquipmentIds`, `temporaryConstraints`, `environmentChanges`,
`performanceHistory`, `progressionRecommendations` (only
`decision === "recommended"`), `completedProgressions`, and
`adaptedSessions` / `missedSessions` / `homeSessions`. Nutrition, recovery and
activity are **not** implemented here; where relevant they are exposed as facts
in `TrainingState` for later phases — never invented.

## 43. Phase 3.1 persistence (migration 0004)

`packages/db/prisma/migrations/0004_phase31_progression_ledger_and_environments`
adds `training_environment_periods`, `progression_evaluations`,
`progression_decision_events`; extends `training_plans` with
`kind` / `environment_kind` / `effective_until` / `temporary_for_version_id`
(backfilling existing rows to `kind = 'primary'`); extends `workouts` and
`workout_exercises`; and extends `exercise_sets` with load kind, assistance and
set-level idempotency. It also re-scopes the one-active-plan index to
`kind = 'primary'`, so a temporary plan can coexist with the gym plan it was
adapted from. Every new column is nullable or defaulted, so no pre-existing row
changes meaning.

## 44. Phase 3.1 API contracts

| Method | Path | Notes |
|---|---|---|
| POST | `/v0/users/:userId/training-environments` | 201 created, 200 on idempotent replay |
| GET | `/v0/users/:userId/training-environments/active?asOf=` | resolved environment |
| POST | `/v0/users/:userId/training-environments/restore` | closes the period, retires temporary plans |
| GET | `/v0/users/:userId/training-continuity?asOf=` | continuity summary |
| POST | `/v0/users/:userId/training-plans/generate-temporary` | 201 created, else 200 |
| GET | `/v0/users/:userId/performance-history?exerciseId=&limit=` | observations + summaries |
| POST | `/v0/users/:userId/progression/evaluate` | 200 (persisted or reasoned) |
| GET | `/v0/users/:userId/progression/ledger` | entries + completed counts |
| POST | `/v0/users/:userId/progression/ledger/:evaluationId/events` | decision + required `idempotencyKey` |

Workout routes accept `environmentKind` / `sessionClassification`,
`slotId` / `substitutedFromExerciseId` / `performanceSource` /
`substitutionReason`, and `loadKind` / `assistanceLoadKg` / `clientRequestId`.

Phase 4 handoff: the same context-loading + engine + decision-record pattern
should be reused for nutrition targets, and `training_plan_decisions` is the
model to copy for nutrition decisions.

---

# Phase 3.1.1 — Equipment-Free Training Knowledge

Phase 3.1 identified one remaining product/content limitation: the seed
catalog was gym-oriented, so a `home_no_equipment` week could only be partly
staffed. Phase 3.1.1 fixes that at the knowledge layer — no planner
architecture change, no environment-specific hardcoded lists. The pipeline is
unchanged: environment → equipment constraints → exercise universe →
ExerciseDecision → plan generation. The catalog simply carries the knowledge
the pipeline was missing.

## 45. Equipment-Free Training Knowledge

### Supported categories

28 new canonical exercises, all with `equipment: []` (the user's body and the
floor — no band, bar, bench, chair, wall or furniture), plus four existing
entries corrected to the same contract (`push_up`, `plank`, `dead_bug`,
`standing_calf_raise`). The catalog now carries **32 genuinely equipment-free
exercises** across:

- **Squat / knee-dominant** — bodyweight squat, pause squat, tempo squat,
  split squat, reverse/forward/walking lunge, skater squat (the advanced
  unilateral end; pistol-to-support is deliberately absent because no support
  object is modelled).
- **Glute / hip-dominant** — glute bridge, long-pause glute bridge,
  single-leg glute bridge (floor only; elevated-surface variations stay out of
  the no-equipment universe).
- **Hamstrings / posterior chain** — hamstring bridge (long-lever hip
  extension), bodyweight good morning, single-leg bodyweight RDL. These are
  honest hip-extension stimuli; none claims equivalence with a leg curl or a
  loaded RDL.
- **Calves** — standing, single-leg and bent-knee (soleus-biased) calf
  raises; progression through reps, unilateral loading, ROM, tempo and sets.
- **Push** — knee push-up (regression), pause and tempo push-ups, diamond
  push-up (triceps-biased press, never claimed as isolation), archer push-up
  (near-unilateral progression), pike push-up (equipment-free vertical push).
- **Core** — side plank, reverse crunch, hollow-body hold, alongside the
  existing plank and dead bug: anti-extension, trunk flexion and lateral
  stability as distinct relations, not "core = everything".
- **Scapular / postural** — prone Y raise, reverse snow angel, superman hold.

### Environment semantics

`home_no_equipment` still allows only the `bodyweight` equipment slug, and the
expanded catalog requires nothing at all, so the universe resolves to the
equipment-free set with no ownership rows involved. `home` /
`home_limited_equipment` / `gym` are unaffected: the new exercises are simply
also available there.

### Progression families

Families share a `variationKey` prefix — `squat:*`, `lunge:*`,
`glute_bridge:*`, `calf_raise:*`, `push_up:*` — ordering regressions,
standards and harder leverage/unilateral variations qualitatively. The ledger
levers for a bodyweight load kind remain `reps → rir → variation → rom →
tempo → sets`: 20 push-ups at target RIR recommends a harder variation
(`change_exercise`), never endless reps and never invented load.

### Limitations and pulling honesty

A floor cannot reproduce loaded pulling. No equipment-free exercise carries a
`horizontal_pull`/`vertical_pull` pattern or a lat/biceps primary relation;
the prone floor movements model their actual scapular, rear-deltoid and
postural contributions and say so in their notes. When a gym plan is adapted,
the pulldown/row slots are dropped with a named warning, lats appear in
`muscleCoverageLost`, and the plan carries the environment's muscle-coverage
limitations. The curated substitution edges that point at floor work are
rankHint-0 and worded as partial.

### Substitution and redundancy

The 0.6 muscle / 0.25 movement / 0.15 category scoring with the 0.35 floor is
unchanged; the engine now has real candidates. Seeded examples: back squat →
bodyweight squat (partial), bench → push-up (partial), RDL → single-leg
bodyweight RDL, seated calf raise → bent-knee calf raise (soleus preserved),
lat pulldown → prone Y raise (honest partial, rankHint 0). Redundancy stays
controlled by the existing engine: the planner selects at most a primary plus
one meaningfully different secondary per muscle per session, not a stack of
squat near-copies.

### No-equipment week behaviour

The acceptance journey (`apps/api/src/__tests__/noEquipmentWeek.ts`, run with
`npm run test:no-equipment-week -w @fitcoach/api`) drives the real seed end to
end: gym plan → 7-day `home_no_equipment` period → temporary plan with every
session staffed from the equipment-free universe (lower body, push, calves,
core), sessions within the 60-minute budget, feasibility
`feasible_with_tradeoffs` (never silently "feasible", never
"equivalent"-labelled substitutions), no lat-primary exercise, determinism on
replay, a logged bodyweight home workout entering the progression ledger, and
the 7-day restore retiring the temporary plan while the original gym plan
survives untouched.

### Tracked-slug bridge

One planner-level integration fix was required: the volume/frequency
configuration tracks group-level slugs (`calves`, `abdominals`,
`deltoid_anterior`, `deltoid_lateral`, `rhomboids`, `spinal_erectors`) while
the knowledge catalog targets muscle-level slugs (`gastrocnemius`,
`rectus_abdominis`, `deltoid_front`, `deltoid_side`, `rhomboid_major/minor`,
`erector_spinae`). Those slots were silently unfillable against the real
catalog. `expandAssignmentsToCatalogMuscles` (apps/api `planner.ts`) now
bridges the two — only where the catalog actually offers the muscle-level
slug, splitting the assignment's sets deterministically; a catalog that
already uses group slugs is untouched.

### Database

No schema or migration change: the existing exercise, alias,
exercise-muscle-relation, required-equipment, movement-function and variation
fields model everything above. 53 models / 4 migrations, unchanged.

### Seed counts (verified, not carried over)

73 canonical exercises (45 → 73), 32 equipment-free; 143 aliases; 25 reviewed
substitution edges; 21 equipment rows; 28 muscles; 19 structures; 33 movement
functions.
