# FitCoach Delivery Roadmap

Revision: 2026-10-05. Supersedes the "MVP / Phase 1–3" list in
`docs/PRODUCT_SPEC.md` v0.1 and the roadmap that lived there.

Scope rules that apply to every phase:

- a phase ships only when its tests pass (`typecheck`, `build`, `test`, plus the
  DB-backed suites whenever schema or repository code changed);
- every new persistent concept goes through the review process used for
  `docs/DATABASE_DESIGN.md` §23 — decide supported-vs-deferred, write the
  rationale, then migrate;
- deterministic engines ship before any AI that explains them;
- external data is only imported after its licence is verified and registered in
  `data/provenance/THIRD_PARTY.md`;
- nothing in this roadmap authorizes work on a later phase than the one the user
  has asked for.

## Phase map

| Phase | Scope | Depends on |
|---|---|---|
| 1 | Backend foundation — **COMPLETE** | — |
| 2 | Exercise + muscle + equipment intelligence | 1 |
| 3 | Adaptive training engine | 2 |
| 4 | Nutrition + food intelligence | 1 |
| 5 | Activity, steps + recovery architecture/integrations | 1 |
| 6 | Body measurement + physique modeling | 1 |
| 7 | Projection + trajectory engine | 3, 4, 5, 6 |
| 8 | Diagnosis + intervention engine | 3, 4, 5, 6, 7 |
| 9 | AI coaching layer | 8 |
| 10 | Mobile/web product experience | 9 |

Why this order: 7 and 8 consume derived facts from 3–6, and 9 may only explain
what 8 has already concluded deterministically. Phases 4, 5 and 6 are
independent of each other and may be reordered if capacity dictates.

## PHASE 1 — Backend foundation (COMPLETE)

Delivered: PostgreSQL + Prisma schema (37 models) and migrations, domain /
persistence separation, 15 repositories, application services, `/v0` API,
idempotent seed, UUIDv7 ids, append-only history, idempotency foundations,
documentation, 74 tests green at the Phase 1 checkpoint.

Details: `docs/DATABASE_IMPLEMENTATION.md`. Architecture milestone since
completed: product spec, architecture, database review and package plans
updated for the V2 vision (this document, `docs/ARCHITECTURE.md` §1–15,
`docs/DATABASE_DESIGN.md` §23).

## PHASE 2 — Exercise, muscle and equipment intelligence

Goal: the training domain can answer "what does this exercise actually
stimulate, and is it available to this user".

- deterministic exercise intelligence: muscle relationships, primary/secondary
  stimulus, movement patterns, joint/equipment constraints
- equipment → exercise availability derived from the user's inventory (D1:
  availability is a validity interval, not a boolean)
- substitutions for unavailable equipment, with redundancy accounting
- provenance for every exercise definition (no unverified dataset import)

Exit criteria: `fitness-core` exercise/muscle/equipment modules implemented with
unit tests; catalog repositories exercised by integration tests; no AI involved.

## PHASE 3 — Adaptive training engine

Goal: plans that respond to the individual and to their history.

- split generation from available days/session length/equipment
- volume, progression, stimulus and recovery modelling
- plan versioning already exists in the schema; this phase makes it operational
  (regeneration on equipment/profile change, supersession chains)
- training volume/load derived facts feeding the coaching chain

Exit criteria: deterministic plan generation + progression implemented and
tested; `Workout` ↔ `plan_version` linkage resolved (domain divergence D2/D3).

## PHASE 4 — Nutrition and food intelligence

Goal: nutrition becomes a first-class domain with honest data.

- nutrient registry (`nutrient_definitions`) + `food_nutrient_values`
- fat detail and micronutrients without new snapshot columns
- food preparation state (raw/cooked/method) and the resulting food identity rule
  (D13)
- recipe yield, per-ingredient preparation state, recipe versioning; "240 g of
  this curry" resolves from recipe + yield
- food provenance tiers, license/terms recording, and the **first** licensed
  dataset import — only after its licence is verified and registered
- meal/day totals and trend analysis over the extended nutrient set
- natural-language food entry produces `MealItem` candidates with
  `input_method` recorded

Exit criteria: nutrition tests cover the extended nutrient set and absence
semantics; a licensed dataset import is reproducible from a documented script.

## PHASE 5 — Activity, steps and recovery

Goal: activity becomes an input the coach reasons with, without a universal step
target.

- raw observation layer (`activity_observations`) → normalization → dedupe →
  daily aggregation (`activity_records`) → activity model → coaching input
- device/source records (`data_sources`) and per-observation confidence
- sleep observations (`sleep_observations`) and recovery derived facts
- per-person activity target logic (no 10,000-step constant)
- Health Connect / Apple Health ingestion behind the same pipeline (platform work
  may land later than the internal pipeline; the pipeline ships first)

Exit criteria: dedupe/re-aggregation is idempotent under repeated syncs, proven by
integration tests; activity targets are person-specific and evidence-backed.

## PHASE 6 — Body measurement and physique modeling

Goal: a current physique that is explicitly labelled as measured/estimated.

- user-defined measurement sites (`body_measurement_sites`, D14)
- body model parameters with `provenance` (measured/estimated/inferred) — no
  inferred dimension presented as measured
- physique snapshots (`physique_snapshots`) referencing object storage only
- trend analysis that resists single noisy readings
- representation layer contract; **renderer is visualization only** and may be
  deferred past this phase

Exit criteria: every physique value carries provenance; estimation is
distinguishable in the API response.

## PHASE 7 — Projection and trajectory engine

Goal: time-aware, range-based projections that recalculate on divergence.

- projection snapshots, assumptions, metrics (low/central/high + confidence)
- horizons: current, 1, 3, 6, 12 months, custom
- inputs digest so a projection is reproducible and stale ones detectable
- immutable snapshots with supersession (D15); no overwriting history

Exit criteria: a projection is reproducible from its stored assumptions and
inputs; recalculation produces a new snapshot rather than mutating the old.

## PHASE 8 — Diagnosis and intervention engine

Goal: the full evidence chain, driven by derived facts only.

- trend detection, mismatch detection, plateau detection, disproportionate change
- outcome levels (LEVEL 1/2/3) and typed physique priorities affecting how progress
  is judged
- "make me better": trajectory vs desired outcome → requirement delta → smallest
  useful change
- NO_CHANGE as a successful, first-class outcome
- projection divergence as a diagnosis input
- evidence persisted structurally; every recommendation answerable afterwards

Exit criteria: the worked "why did you recommend this?" example from
`docs/PRODUCT_SPEC.md` §21 is reproduced from stored evidence in a test.

## PHASE 9 — AI coaching layer

Goal: an AI that explains, parses and communicates — and invents nothing.

- natural-language parsing (food, workouts, check-ins) into domain commands
- explanations of deterministic findings and evidence
- uncertainty communication and trade-off framing
- clarification questions when required data is missing
- no raw conversation persistence by default; structured evidence only
- presentation of recommendations and no-change states

Exit criteria: AI outputs contain no numbers that are absent from deterministic
inputs (property-style tests over a fixture set).

## PHASE 10 — Mobile/web product experience

Goal: the navigation of `docs/PRODUCT_SPEC.md` §3, including the aggregation-only
HOME dashboard.

- HOME dashboard composition service (no domain logic, no duplicate truth)
- domain screens for TRAINING, NUTRITION, ACTIVITY, BODY, RECOVERY, COACH
- identity/auth, and the secure storage boundaries Phase 1 documented
- projection display with ranges and assumptions visible, never a single number

Exit criteria: dashboard content is reproducible from domain summaries alone;
erasure covers raw media and derived data per `docs/ARCHITECTURE.md` §13.

## LATER — beyond the core roadmap

Ordered by expected value, none of them blocking the phases above:

- Health Connect and Apple Health ingestion (pipeline first, then platform)
- wearable integrations
- barcode scanning
- food photo recognition (computer vision) — only behind the photo-assisted
  estimate contract
- restaurant and regional food integrations
- advanced 3D physique rendering (visualization only)
- advanced recovery modeling

## Deferred, deliberately

Not on any timeline and not to be started opportunistically:

- importing openGym data or code without verified licensing
- any AI-generated nutrition data treated as measured
- rendering or presentation code inside deterministic packages