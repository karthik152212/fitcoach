# fitness-core

Deterministic fitness domain logic. **No LLM calls belong in this package**, and
neither do I/O, persistence or clock access — every function is pure over its
inputs so its output can be recomputed, tested and cited as evidence.

Current state: modules are **typed boundaries** whose functions throw
`NotImplementedError`. They do not pretend to work. Only what is implemented may
be cited as evidence by the coaching layer.

## Module groups and the phase that implements them

### Training (Phases 2–3)

| Module | Purpose |
|---|---|
| `muscleCoverage` | which muscles a session actually trains, including indirect stimulus |
| `exerciseSelection` | choose exercises for available equipment and target muscles |
| `redundancy` | drop duplicate stimulus before volume is added |
| `volume` | sets × reps × load, per muscle and per session |
| `progression` | progression scheme and its failure conditions |
| `splitGeneration` | split structure from available days/session length/equipment |
| `exerciseSelection`, `splitGeneration` | plan regeneration when equipment or profile changes |

### Nutrition (Phase 4)

Targets, meal analysis and nutrition trends are calculated in
`packages/nutrition`, not here. This package consumes their **derived facts**
(and only those) when reasoning across domains.

### Activity and recovery (Phase 5)

| Planned module | Purpose |
|---|---|
| `activity/stepsNormalization` | per-source step normalization and overlap handling |
| `activity/activityTotals` | steps, sessions, active energy, duration per user-local day |
| `activity/cardio` | cardio load and its contribution to weekly activity |
| `activity/activityTargets` | per-person useful activity targets — never a universal step constant |
| `recovery/recoveryFacts` | recovery signals derived from sleep + training load, with confidence |

### Body (Phase 6)

| Planned module | Purpose |
|---|---|
| `body/measurementTrends` | robust trends that resist single noisy readings |
| `body/bodyCompositionEstimate` | estimates labelled `estimated`/`inferred`, with uncertainty |
| `body/physiqueMetrics` | ratios (waist:height, shoulder:waist, …) for V-taper style goals |

### Projection (Phase 7)

| Planned module | Purpose |
|---|---|
| `projection/trajectory` | time-aware trajectory over current/1/3/6/12-month/custom horizons |
| `projection/uncertainty` | ranges from assumption spread, not false precision |
| `projection/divergence` | actual vs projected divergence as structured input for diagnosis |

### Diagnosis (Phase 8)

| Planned module | Purpose |
|---|---|
| `trendDetection` | trend direction, slope and stability over a window |
| `goalAlignment` | progress judged against goal + priorities + outcome level |
| `diagnosis` | trend/mismatch/plateau/disproportionate-change detection |
| `interventionSelection` | candidate interventions, smallest useful change first |

`interventionSelection` must be able to return **no change** as the preferred
candidate when the trajectory is already good.

### Intervention and outcome (Phase 8)

| Planned module | Purpose |
|---|---|
| `intervention/outcomeTracking` | evaluate an intervention against its window |
| `intervention/noChangeDecisions` | explicit no-change reasoning and evidence |

## Rules

1. Pure functions: inputs in, deterministic output out. No clock, no randomness
   without a passed-in seed/clock.
2. Every result that can end up in a diagnosis carries the facts it was derived
   from (metric, window, observed, expected) so evidence rows can be written
   without re-deriving them later.
3. Estimates carry provenance and uncertainty; they are never returned as bare
   numbers that a caller could present as measurements.
4. No target is a hardcoded constant: calorie, protein, step and volume targets
   are functions of the individual, their goal and their history.
5. If a module cannot be computed honestly with available data, return an
   explicit "insufficient evidence" result — never a guess.