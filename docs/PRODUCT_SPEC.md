# FitCoach Product Specification v2.0

Architecture/design revision: 2026-10-05. Supersedes v0.1 (Phase 1 scope).
Implementation status and phase-by-phase delivery: `docs/FITCOACH_ROADMAP.md`.
System structure: `docs/ARCHITECTURE.md`. Persistence: `docs/DATABASE_DESIGN.md`.

This document describes **what the product must eventually be able to do**. It
is not a statement of what is implemented. Implementation truth lives in
`docs/DATABASE_IMPLEMENTATION.md` (Phase 1) and `docs/FITCOACH_ROADMAP.md`.

## 1. Core promise

FitCoach is an **adaptive personal fitness coach**. It understands the person's
complete trajectory — body, goals, training, nutrition, activity, steps, cardio,
sleep/recovery, adherence, historical trends, interventions and outcomes.

The core loop remains:

```text
MEASURE → UNDERSTAND → DIAGNOSE → RECOMMEND → TRACK → COMPARE → ADJUST
```

The objective is **not** "do more". The objective is:

> Make the smallest useful change that moves the user toward their goal.

If the trajectory is already good, **`NO_CHANGE` is a valid and often preferred
outcome**, and the system must be able to say so (§10).

## 2. Five systems

Four product domains feed a fifth system:

| | System | Owns |
|---|---|---|
| A | **TRAINING** | plans, exercises, sets/reps/load, progression, volume, muscle stimulus |
| B | **NUTRITION** | foods, recipes, meals, nutrients, targets, nutrition trends |
| C | **LIFESTYLE / ACTIVITY / RECOVERY** | steps, walking/running/cycling/cardio, sleep, recovery signals |
| D | **BODY / PHYSIQUE** | measurements, body model, current physique, physique targets |
| E | **COACHING / DIAGNOSIS / PROJECTION** | evidence, diagnoses, recommendations, interventions, outcomes, projections |

Domains A–D are *sources of observations and derived facts*. System E is the
only place where cross-domain judgement happens. A domain must never write
another domain's tables.

## 3. Product structure (navigation)

```text
HOME        integrated daily/weekly view across all domains
TRAINING    plans, sessions, exercises, progression
NUTRITION   foods, meals, nutrients, targets, trends
ACTIVITY    steps, cardio, movement, activity trends
BODY        measurements, trends, physique targets, current physique
RECOACH     sleep, recovery signals, recovery trends
COACH       evidence, diagnoses, recommendations, interventions, outcomes
```

HOME is an **aggregation view**, never a replacement for a domain screen and
never a second source of truth (§4).

## 4. Home dashboard

The dashboard summarizes, at minimum:

- current physique summary
- projected physique summary (with horizon and confidence)
- today's workout
- nutrition progress: calories, protein, carbohydrates, fat
- fat detail and fiber where known
- steps and total activity
- sleep/recovery
- weight trend and waist trend
- important body measurements
- current goal and current trajectory
- active coaching recommendation
- explicit no-change state
- alerts requiring attention

Rules:

1. It is assembled **from domain summaries/services**, not from its own queries
   over raw tables.
2. It contains **no domain business logic** — no target computation, no trend
   detection, no diagnosis. It renders what the domains report.
3. It is **not persisted as duplicate truth**; anything cached is a read-model
   derived from domain services with an explicit refresh rule.

## 5. Nutrition

Nutrition is a **first-class domain**, not "calories + protein". The model must
support at least:

- **Energy**: calories
- **Macronutrients**: protein, carbohydrates, total fat
- **Fat detail**: saturated, monounsaturated, polyunsaturated, trans (where the
  source supports it), omega-3 and omega-6 (where the source supports it)
- **Other**: fiber, sugar, sodium, cholesterol where available
- **Micronutrients**: addable without redesigning the meal/food system

Non-negotiable rules:

- Missing nutrients are **representable**. A nutrient nobody published is
  *unknown*, never zero.
- Every value carries **source, serving basis, unit, confidence, optional
  uncertainty, and raw/cooked state where relevant**.
- **Never invent nutritional precision.**

## 6. Food data model

The food system must support raw ingredients, cooked ingredients, packaged,
branded, restaurant, regional, homemade, recipes, composite dishes and
user-created foods.

The same food name can have different nutritional characteristics depending on
raw vs cooked state, preparation method, recipe, brand and serving size.
Accordingly, "100 g chicken curry" is **not** one universal record: it is a
recipe-derived, preparation-specific, source-attributed record (or an explicit
low-confidence estimate, clearly labelled as such).

## 7. Recipes

A user-created recipe must support ingredient quantities (g / ml / servings),
per-ingredient preparation state, recipe **yield** (finished weight), number of
servings, per-serving and per-gram nutrition, and **versioning/history**.

Consequence: "I ate 240 g of this curry" is resolved from the recipe and its
yield (`240 / yield` of the batch), not treated as a generic fixed food. Logged
meals retain the nutrition snapshot known at logging time.

## 8. Food input methods

| Method | Behaviour |
|---|---|
| **A. Search** | user searches the food database |
| **B. Natural language** | "2 rotis, 150 g chicken curry, one bowl dal and buttermilk" is parsed into structured candidates; the user confirms/corrects them |
| **C. Exact entry** | user enters ingredients and quantities |
| **D. Photo-assisted** | user photographs a meal; the system estimates candidates, portions, approximate quantities and confidence |

Photo-assisted logging **must never silently claim exact grams**. Photo-derived
quantities support an estimated value **plus range**, a confidence level, user
correction, and provenance. Computer vision is not built in the architecture
milestone; only the data contract is designed (§8 of ARCHITECTURE.md).

## 9. Food provenance

Food data is tiered by trust and the tier travels with the value:

1. first-party FitCoach data
2. verified external dataset
3. branded (label-derived)
4. restaurant
5. user-created
6. photo-derived estimate
7. AI-parsed entry

Every externally sourced nutrition record carries provenance; license and usage
terms are recorded before import. No external food database is imported in the
architecture milestone — only the boundary for future imports is defined
(`docs/DATABASE_DESIGN.md` §23).

## 10. Activity and steps

Activity is a first-class domain: steps, walking, running, cycling, cardio,
active energy where available, duration, distance where available, source/device,
timestamps, confidence, and imported vs manual origin.

**Steps are an input, not a target.** 10,000 steps is not inherently better than
6,000. Useful activity targets are derived per person from body, goal, calorie
intake, training load, cardio, recovery, weight trend, waist trend and adherence.

## 11. Sleep and recovery

Sleep/recovery is a first-class domain, initially minimal. Future data: sleep
duration, bedtime, wake time, consistency, source/device, quality indicators and
recovery indicators.

It must eventually influence training recommendations, recovery decisions,
activity targets, diagnosis and physique projections. Example the system must
eventually be able to detect: training frequency rises, sleep falls
significantly, strength stalls → recovery becomes a candidate constraint.

## 12. Body measurements

Measurements are **observations**, append-only: height, weight, waist, chest,
shoulders, arms, thighs, calves, neck, body-fat percentage where available,
plus user-defined sites where appropriate.

Each carries timestamp, source, confidence, measurement conditions when useful,
and supports historical comparison and trend analysis. The system must **avoid
overreacting to a single noisy measurement**.

## 13. Physique modelling — two distinct systems

**A. CURRENT PHYSIQUE**

```text
RAW MEASUREMENTS → BODY MODEL → CURRENT PHYSIQUE REPRESENTATION
```

**B. PROJECTED PHYSIQUE**

```text
BODY + GOAL + TRAINING + NUTRITION + ACTIVITY + SLEEP + ADHERENCE + TIME
  → PHYSIQUE PROJECTION → PROJECTED PHYSIQUE REPRESENTATION
```

They must not be the same system. Current physique represents *now*; projected
physique represents *a modelled future* under stated assumptions.

Both distinguish **MEASURED / ESTIMATED / INFERRED** values. An estimated body
dimension is never presented as measured fact. The 3D renderer is
visualization only and is never responsible for determining physiological
predictions.

## 14. Projections

A projection is a **range with assumptions**, never a promise:

- projection + time horizon
- uncertainty/range
- assumptions (training adherence, calorie adherence, protein adherence,
  average steps, sleep, recovery, training experience)
- confidence and contributing factors

Supported horizons: current, 1 month, 3 months, 6 months, 12 months, custom.

Projections must **recalculate when reality diverges** from assumptions (e.g.
predicted +0.5 kg/month vs actual +1.4 kg/month with disproportionate waist gain
and flat strength), and the coaching engine must eventually diagnose the
divergence. The projection algorithm is not implemented in this milestone; the
architecture and persistence contract are.

## 15. Goals and outcome levels

Users must eventually be able to say "I want a better physique" or "I want to go
further". The system therefore supports multiple outcome levels:

- **LEVEL 1** — current realistic target
- **LEVEL 2** — more ambitious target
- **LEVEL 3** — long-term advanced target

Each level implies its own requirements (training days, activity range,
nutrition, recovery). **These numbers are never hardcoded as universal rules**;
the future engine computes requirements for the individual.

## 16. "Make me better" refinement

Given a desired outcome, the system compares current trajectory vs desired
outcome and determines what additional requirements may be necessary:
additional training, different exercise selection, different volume, nutrition
adjustment, protein adjustment, activity adjustment, recovery adjustment, or a
longer horizon.

The system must **not automatically prescribe more work**. It must identify the
**smallest useful change**.

## 17. Physique priorities

Goal modelling supports physique-specific priorities: V-taper, shoulder
development, chest development, waist reduction, arm development, leg
development, overall muscle gain, leanness, strength, athletic performance.

Priorities influence training, measurement, projection, diagnosis and progress
interpretation. Example: for a V-taper goal, chest growth alongside
disproportionate waist growth is **not automatically good progress**.

## 18. Coaching principles

1. Never judge a food as morally good or bad.
2. Never assume more steps are automatically better.
3. Never compensate for one food choice with punitive exercise.
4. Use trends rather than single noisy measurements.
5. Account for indirect training stimulus.
6. Minimize redundant exercise volume.
7. Prefer the smallest intervention likely to solve the problem.
8. If the plan is working, say so and do not change it unnecessarily.
9. Explain every material recommendation.
10. Reassess interventions against subsequent real-world data.
11. Judge progress against the user's goal and priorities, not against averages.
12. Never present an estimate as a measurement.

## 19. Scientific and product honesty

The product must never:

1. invent fake precision,
2. promise a guaranteed future physique,
3. apply a universal step target,
4. apply a universal calorie target,
5. apply a universal protein target,
6. assume more training is always better,
7. treat a single measurement as a trend,
8. treat AI-generated nutrition data as exact,
9. treat image-based food portions as exact,
10. treat 3D physique prediction as exact.

Where a number is not known precisely, the product uses **ranges, confidence,
assumptions and uncertainty** (§5, §8, §13, §14).

## 20. AI boundary

The AI layer is **not** the source of truth.

Deterministic systems own: nutrition/macro/fiber/activity totals, measurement
trends, training volume, exercise relationships, projection inputs, constraints,
evidence and diagnosis candidates.

The AI may: parse natural language, interpret validated facts, explain results,
ask clarifying questions, present recommendations, communicate uncertainty and
help the user reason about trade-offs.

The AI must never invent medical, nutritional or training facts.

## 21. Evidence-first coaching

```text
OBSERVATIONS → DERIVED FACTS → EVIDENCE → DIAGNOSIS → RECOMMENDATION
  → INTERVENTION → OUTCOME → FOLLOW-UP
```

Every material recommendation must be reproducible: the system must be able to
answer *"why did you recommend this?"*. Evidence is **persisted structurally**;
historical LLM conversation text is never the source of truth.

Worked example the architecture must support:

```text
Protein target 150 g; 7-day average 126 g; goal hypertrophy;
5 training days/week; strength trend flat
→ evidence rows → diagnosis "protein intake below target"
→ recommendation "increase protein" → intervention → outcome → follow-up
```

## 22. Privacy and sensitive data

The expanded product handles highly sensitive data: body measurements,
photographs, food habits, health/activity data, sleep data and body composition.

Requirements (documented now, implemented with the identity phase):

- explicit provenance on every derived value
- minimum necessary storage
- user deletion support, including derived data
- raw images stored separately from derived data
- no unnecessary raw AI conversation persistence
- secure storage boundaries

No authentication or security implementation is part of this milestone.

## 23. Worked examples

**Aesthetic / V-taper.** Chest grows while waist grows disproportionately:
do not simply celebrate chest growth; check weight, nutrition, activity,
training and measurement trends; determine whether the waist trend is real;
choose the smallest appropriate intervention; record it; reassess after a defined
interval.

**Within calories.** The user eats ice cream but stays within the daily calorie
target: no compensation is required; check protein and other targets; suggest a
protein-rich option only if a target is actually missed.

**Single bad day.** Calories are high but the weekly trajectory is appropriate:
do not overreact to one day; use the rolling trend.

**Recovery constraint.** Training frequency rises, sleep falls, strength stalls:
recovery becomes a candidate diagnosis; the smallest useful change may be a
sleep or recovery adjustment rather than more training.

**"Make me better."** The user asks for more definition: compare trajectory vs
desired outcome; if the current level is already on track, say so; otherwise
identify the single smallest change that closes the gap.

## 24. Scope of this document

Implementation of anything beyond Phase 1 is planned in
`docs/FITCOACH_ROADMAP.md`. The current milestone is architectural: it updates
specification, architecture, database design, package plans and the roadmap
without building the UI, the AI coach, the 3D renderer, computer vision,
Health Connect, wearables or the adaptive training engine.