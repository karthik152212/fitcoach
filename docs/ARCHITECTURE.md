# Technical Architecture v2.0

Architecture/design revision: 2026-10-05. Supersedes v0.1.
Product requirements: `docs/PRODUCT_SPEC.md`.
Persistence: `docs/DATABASE_DESIGN.md` (design) and
`docs/DATABASE_IMPLEMENTATION.md` (Phase 1 reality).
Delivery order: `docs/FITCOACH_ROADMAP.md`.

## 1. Principle

**The LLM is not the source of truth.** Deterministic domain logic calculates
facts and constraints. The AI layer interprets those facts, handles
natural-language input, explains decisions and presents validated conclusions.

The second principle, added in V2: **the renderer is not the model**. A 3D
representation visualizes a physiological estimate; it never determines one.

## 2. System map

```text
                        ┌──────────────────────────────────────┐
                        │ HOME (dashboard aggregation only)   │
                        └───────────────┬──────────────────────┘
                                        │ reads domain summaries
   ┌───────────────┬───────────────┬───┴───────────┬───────────────────┐
   │ A TRAINING    │ B NUTRITION   │ C LIFESTYLE/  │ D BODY/PHYSIQUE   │
   │ plans, sets,  │ foods,        │ ACTIVITY/     │ measurements,     │
   │ exercises,    │ recipes,      │ RECOVERY      │ body model,       │
   │ progression   │ meals,        │ steps, cardio,│ current physique, │
   │               │ nutrients     │ sleep         │ physique targets  │
   └───────┬───────┴───────┬───────┴───────┬───────┴───────────────────┘
           │               │               │
           └───────────────┴───────┬───────┘
                                   v
             ┌──────────────────────────────────────────────┐
             │ E COACHING / DIAGNOSIS / PROJECTION          │
             │ evidence · diagnoses · recommendations ·     │
             │ interventions · outcomes · projections       │
             └───────────────┬──────────────────────────────┘
                             v
             ┌──────────────────────────────────────────────┐
             │ AI LAYER (parse, explain, present, ask)      │
             └──────────────────────────────────────────────┘
```

Dependencies point one way: clients → API → application services → domains +
repositories. Nothing in `packages/domain`, `packages/fitness-core` or
`packages/nutrition` imports `apps/*` or `packages/ai`.

## 3. Package responsibilities

| Package | Owns | Never owns |
|---|---|---|
| `packages/domain` | canonical, persistence-agnostic entities and value types | storage, engines, I/O |
| `packages/fitness-core` | deterministic training/activity/body/diagnosis/intervention/projection engines | I/O, persistence, AI |
| `packages/nutrition` | deterministic nutrient, serving, recipe, meal, day and trend logic | I/O, persistence, AI |
| `packages/db` | PostgreSQL schema, migrations, repositories, seed | domain logic |
| `packages/ai` | natural-language parsing, explanation, presentation | facts, numbers, diagnoses |
| `apps/api` | HTTP transport, validation, application services | domain logic |

## 4. Dashboard as an aggregation layer

The home dashboard is a **composition of domain summaries**, produced by a
future dashboard composition service that:

1. calls each domain's summary service (nutrition summary, activity summary,
   body summary, training summary, recovery summary, goal summary, projection
   summary, coaching summary),
2. assembles a read model for presentation,
3. contains no domain business logic — no target math, no trend detection, no
   diagnosis,
4. writes nothing. It is never a second database of duplicate truth; any cache
   is a derived read model with an explicit refresh rule, and the domain
   aggregates remain authoritative.

Domain screens (TRAINING, NUTRITION, ACTIVITY, BODY, RECOVERY, COACH) remain
the place where behaviour lives.

## 5. Nutrition architecture

```text
food source (provenance + license/terms + trust tier)
   → food (name + brand + raw/cooked state + preparation method + density basis)
      → serving definitions
      → nutrient values (amount, unit, serving basis, confidence, uncertainty)
   → recipe (ingredients + preparation states + yield + servings + version)
      → per-serving and per-gram nutrition
   → meal item (quantity or servings; possibly an ESTIMATED quantity with a range)
      → write-time nutrition snapshot
   → meal totals → daily totals vs targets
```

Design rules encoded in the domain (see `packages/domain/src/nutrition.ts`):

- energy, macros and fat detail are first-class; micronutrients live in an
  extension bag keyed by canonical nutrient key, so adding a micronutrient never
  redesigns meals, recipes or snapshots,
- absence is preserved end to end: an undeclared nutrient stays `undefined`
  through scale → sum → divide, never becoming `0`,
- every value can carry source, unit, serving basis, confidence, uncertainty and
  raw/cooked state,
- provenance tier (`first_party`, `verified_external`, `branded`, `restaurant`,
  `user_created`, `photo_derived_estimate`, `ai_parsed`) travels with the data.

## 6. Food input architecture

Four input methods converge on one internal representation
(`MealItem` + snapshot):

| Method | Produces | Precision claim |
|---|---|---|
| search | exact reference food + chosen serving | measured / label-declared |
| natural language | candidate items awaiting user confirmation | estimated until confirmed |
| exact entry | user-entered ingredients and quantities | measured |
| photo-assisted | candidates + estimated portions + ranges + confidence | estimated, never exact |

Photo-derived quantities are stored as an estimate with range and confidence and
support later user correction **without rewriting the estimate's provenance**. No
computer vision is implemented in this milestone; only this contract is designed.

## 7. Activity and step data architecture

```text
RAW OBSERVATION → SOURCE NORMALIZATION → DEDUPLICATION → DAILY AGGREGATION
  → ACTIVITY MODEL → COACHING ENGINE
```

- Sources are named, not special-cased: Android Health Connect, Apple Health,
  wearables, phone sensors, manual entry (`ObservationOrigin` in the domain).
- Deduplication is by provider event id + user + time window, so repeated syncs
  are idempotent (existing `external_id` uniques).
- Source metadata (device, origin, confidence) is preserved per observation.
- Daily aggregation is per user-local day, defined by `users.timezone`.
- Steps are an **input** to coaching; the system derives useful activity targets
  per person rather than applying 10,000 steps as a constant.

FitCoach does not build a proprietary step counter that ignores platform health
frameworks; it consumes the most reliable available source and keeps provenance.

## 8. Sleep and recovery architecture

Sleep is modelled as observations (duration, bedtime, wake time, consistency,
source/device, quality/recovery indicators) feeding a recovery model that later
influences training recommendations, activity targets, diagnosis and projections.
The minimal schema and manual-entry path land with Phase 5; platform
integrations are later. Recovery is expressed as derived facts with confidence,
never as a single opaque "readiness score" that the AI invented.

## 9. Body and physique architecture

```text
MEASUREMENTS (append-only) → BODY MODEL → CURRENT PHYSIQUE REPRESENTATION

BODY + GOAL + TRAINING + NUTRITION + ACTIVITY + SLEEP + ADHERENCE + TIME
  → PHYSIQUE PROJECTION → PROJECTED PHYSIQUE REPRESENTATION
```

- The body model separates MEASURED / ESTIMATED / INFERRED values
  (`ProvenanceClass`); inference is labelled, never presented as fact.
- Projections are time-aware (current / 1 / 3 / 6 / 12 months / custom horizon)
  and carry range, assumptions, confidence and contributing factors.
- A projection is versioned: when reality diverges from assumptions, a new
  projection snapshot is produced and the divergence becomes diagnosable input
  to system E. Projections are never overwritten silently.
- Representations (2D/3D) are generated **from** the models; the renderer owns no
  physiology.

## 10. Goal and outcome-level architecture

Goals are interval-versioned. Outcome levels (LEVEL 1/2/3) and physique
priorities (V-taper, shoulders, leanness, strength, athletic, …) are first-class
attributes of a goal version, not free-text notes, because they change how
progress is judged:

```text
trajectory vs desired outcome
  → requirement delta (training, nutrition, activity, recovery, time)
  → SMALLEST USEFUL CHANGE   (or NO_CHANGE)
```

Requirement numbers are computed per individual; none are hardcoded constants.

## 11. Evidence and coaching architecture

```text
OBSERVATIONS → DERIVED FACTS → EVIDENCE → DIAGNOSIS → RECOMMENDATION
  → INTERVENTION → OUTCOME → FOLLOW-UP
```

- Every link is a persisted structure (`diagnosis_evidence`,
  `recommendation_evidence`, `interventions`, `intervention_outcomes`), not chat
  history.
- Derived facts are produced by deterministic code in `fitness-core` /
  `nutrition`; evidence rows copy the metric, window, observed and expected
  values at write time, so a recommendation stays reproducible after the
  underlying data changes.
- `NO_CHANGE` is a first-class intervention (`InterventionKind` already
  includes `no_change`), and "uncertain" outcomes are representable.

## 12. AI boundary

| Deterministic systems own (never the LLM) | AI may do |
|---|---|
| nutrition/macro/fiber totals, activity totals | parse natural language |
| measurement trends, training volume | interpret validated facts |
| exercise relationships, muscle stimulus | explain results |
| projection inputs, constraints | ask clarifying questions |
| evidence, diagnosis candidates | present recommendations |
| uncertainty and confidence | communicate uncertainty and trade-offs |

The AI never invents medical, nutritional or training facts, and never writes to
domain tables directly.

## 13. Privacy and data boundaries

- Provenance is explicit on every derived value (source, origin, confidence,
  uncertainty).
- Minimum necessary storage: store keys/references for media, never binaries in
  the relational database (`photo_refs` holds object-storage keys).
- Raw images are separated from derived data (measurement values are
  independent of photo retention) so derived data can be kept or deleted
  separately.
- Account erasure cascades from `users(id)`; extended datasets (sleep, photo
  observations, projections) must live inside that cascade tree when added.
- Raw AI conversations are not persisted by default; only structured evidence
  and user-visible recommendations are.
- No query logging or bind-parameter logging (Prisma query events would contain
  health data).

Authentication/authorization is out of scope for this milestone; the boundaries
above are what the identity phase must respect.

## 14. Database direction

PostgreSQL remains the primary datastore (rationale: `docs/DATABASE_DESIGN.md`
§1). The V2 review (`docs/DATABASE_DESIGN.md` §23) records, concept by concept,
what the Phase 1 schema already supports and what is deliberately deferred, and
the schema is designed so deferred concepts attach without redesign: generic
nutrient registry, food preparation states, recipe versioning, observation tables
for activity/sleep/photos, device/source records, projection snapshots and goal
outcome levels all extend existing clusters through the same conventions
(append-only observations, interval versioned state, write-time snapshots).

## 15. Open-source strategy

Do not make the product a fork with a permanent dependency on openGym.

- Use compatible open-source libraries/components where their licenses permit.
- Independently reimplement behavior where appropriate.
- Use separately licensed datasets only when redistribution/usage rights are
  clear, registered in `data/provenance/THIRD_PARTY.md` with provenance attached
  to the data itself (`external_sources`).

The final FitCoach codebase is a clean project, not a wrapper around another
project.