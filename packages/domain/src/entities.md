# Canonical domain entities

Status: 2026-10-05 (V2 architecture milestone). This file is the **entity plan**:
what exists now, what is contract-only, and what later phases add. It is not an
inventory of the database — persistence lives in `docs/DATABASE_DESIGN.md`.

Status legend: **[live]** implemented and persisted · **[typed]** implemented as a
domain type with no engine behind it yet · **[contract]** declared now because a
later phase needs the shape · **[planned]** will be added, with the phase named.

## Design requirement

All entities retain timestamps and enough history to reconstruct what the system
knew and recommended at a given point in time.

## Identity, goals, equipment **[live]**

| Entity | Status | Notes |
|---|---|---|
| User | live | IANA timezone defines local-day math |
| Profile | live | current state; revisions recorded separately |
| ProfileRevision | live | history of material profile changes |
| Goal | live | interval-versioned; supersession chain |
| PhysiqueTarget | live | explicit numeric targets; absent ≠ zero |
| GoalPriority | live | ordered priority tags (V2: V-taper, shoulders, …) |
| Equipment / UserEquipment | live | availability is a validity interval (divergence D1) |
| GoalOutcomeLevel | planned | Phase 8 — LEVEL 1/2/3 with their constraints |

## Reference catalog **[live]**

| Entity | Status | Notes |
|---|---|---|
| ExternalSource | live | licensed external source with SPDX id |
| Muscle / Exercise / ExerciseMuscleRelation | live | provenance-bearing catalog |
| ExerciseRequiredEquipment | live | junction table (safety-relevant filtering input) |

## Training **[typed]**

| Entity | Status | Notes |
|---|---|---|
| TrainingPlan / PlanVersion / Session / ExerciseSlot | typed + persisted | versions are the unit of change |
| Workout / WorkoutExercise / ExerciseSet | live | workouts are events; plan linkage is D2/D3 |
| MuscleStimulus / ExerciseIntelligence | planned | Phase 2 |
| VolumeLoad / ProgressionState | planned | Phase 3 (derived facts, not stored truth) |

## Body and physique **[live → planned]**

| Entity | Status | Notes |
|---|---|---|
| BodyMeasurement | live | append-only observation; corrections add rows |
| BodyMeasurementValue | live | per-site circumferences |
| BodyMeasurementSite | planned | Phase 6 — user-defined sites (D14) |
| BodyModel / BodyModelParameter | planned | Phase 6 — measured/estimated/inferred per value |
| CurrentPhysique | planned | Phase 6 — representation metadata; media stays in object storage |

## Activity, steps, recovery **[live → planned]**

| Entity | Status | Notes |
|---|---|---|
| ActivityRecord | live | daily steps aggregate + discrete sessions; idempotent step upsert |
| ActivityObservation | planned | Phase 5 — raw provider observations before aggregation |
| DataSource (device) | planned | Phase 5 — device/provider records |
| SleepObservation | planned | Phase 5 — per-night sleep data, append-only |
| RecoveryFact | planned | Phase 5/8 — derived, never stored as truth |

## Nutrition **[live → planned]**

| Entity | Status | Notes |
|---|---|---|
| FoodSource | live | provenance + trust tier (tier is contract-only, D12) |
| Food | live | name + brand + density basis; preparation state is contract-only |
| FoodServing | live | exactly one size basis |
| NutrientAmounts / NutrientValue | contract | extended nutrient set, units, uncertainty, per-value provenance |
| Recipe / RecipeItem | live | yield and per-item preparation state are contract-only |
| RecipeVersion | planned | Phase 4 — recipe history |
| FoodPhotoObservation | planned | later — photo-derived candidates/portions |
| Meal / MealItem / DailyNutrition | live | write-time snapshots; `inputMethod` and quantity estimates are contract-only |

## Coaching, diagnosis, projection **[live → planned]**

| Entity | Status | Notes |
|---|---|---|
| Diagnosis / DiagnosisEvidence | live | evidence is persisted structure |
| Recommendation / RecommendationEvidence | live | evidence copied at write time |
| Intervention / InterventionOutcome | live | `no_change` is a first-class kind |
| ProjectionSnapshot / ProjectionAssumption / ProjectionMetric | planned | Phase 7 — immutable snapshots, range + confidence |
| ProjectionDivergence | planned | Phase 8 — actual vs projected, as a diagnosis input |

## Shared value types **[contract]**

| Type | Status | Purpose |
|---|---|---|
| `EntityId`, `CalendarDate`, `Timestamp` | live | identity/time primitives |
| `ExternalProvenance` | live | origin + SPDX licence + register reference |
| `ConfidenceLevel` | live (moved to `shared.ts` in V2) | measured / label_declared / estimated / unknown |
| `ProvenanceClass` | contract | measured / estimated / inferred — physique and projection labelling |
| `ObservationOrigin` | contract | manual / health_connect / apple_health / wearable / phone_sensor / imported_dataset / ai_parsed / photo_derived / system_computed |
| `UncertaintyRange` | contract | low/high/note — used wherever a point estimate would be dishonest |
| `Estimated<T>` | contract | value + provenance + confidence + uncertainty |

## Rules for extending this model

1. Additive and optional beats a new entity when the concept is an attribute.
2. Absence stays absence: optional ≠ zero, and `undefined` must survive mapping
   and arithmetic.
3. Any estimated value carries provenance; anything else risks being read as
   fact.
4. New persistent entities need a `docs/DATABASE_DESIGN.md` §23-style
   supported-vs-deferred decision first.