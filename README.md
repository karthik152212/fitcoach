# FitCoach

Adaptive personal fitness coaching system.

## Product principle

Measure → Understand → Diagnose → Recommend → Track → Compare → Adjust.

The system optimizes the user's trajectory toward their chosen goal rather than rewarding isolated numbers.

## Product and roadmap

- `docs/PRODUCT_SPEC.md` — what the product must be able to do (V2 vision)
- `docs/FITCOACH_ROADMAP.md` — what gets built, in what order
- `docs/ARCHITECTURE.md` — system structure, AI boundary, privacy boundaries

## Architecture

- `apps/api` — application API
- `apps/mobile` — future mobile client
- `packages/domain` — canonical domain models
- `packages/fitness-core` — deterministic training, muscle-coverage, progression and diagnosis logic
- `packages/nutrition` — food, meal and nutrition logic
- `packages/db` — database layer
- `packages/ai` — AI orchestration/explanation layer
- `data/provenance` — third-party source and license registry
- `docs` — product and technical specifications

## Development

Setup, workspace layout and commands: see `docs/DEVELOPMENT.md`.

## Current status

Phase 1 backend foundation: PostgreSQL + Prisma schema/migrations, 15
repositories, application API (`/v0`), idempotent seed, unit + integration +
HTTP smoke tests (docs/DATABASE_IMPLEMENTATION.md).

Phase 2 exercise/muscle/equipment intelligence: the deterministic knowledge
catalog, coverage/redundancy/substitution engines and exercise decisions
(`docs/FITCOACH_PHASE2_VERIFICATION.md`).

Phase 3 adaptive training engine: deterministic split generation, volume and
frequency targets, duration budgeting with repair, goal alignment, progression
rules, plateau signals, smallest-useful-change adaptation (with first-class
`no_change`), plan versioning/comparison and structured decisions — all in
`packages/fitness-core` plus the planner service and `/v0` routes
(`docs/FITCOACH_PHASE3_TRAINING_ENGINE.md`).

Phase 3.1 performance/progression ledger + training continuity: a per-exercise
append-only ledger separating *recommended* / *accepted* / *actually performed*
progression (so `progressionsCompleted` is a real count, including bodyweight
work), first-class training environments, and a bounded temporary
environment-adapted plan that preserves the original gym plan and states
honestly what an environment cannot train — plus adapted-vs-missed sessions and
explicit return-to-gym restoration. Deterministic engines only; no UI
(`docs/FITCOACH_PHASE3_TRAINING_ENGINE.md` §30–44).

Phase 3.1.1 equipment-free training knowledge: 28 new body-only exercises
(squat/lunge, bridge, posterior-chain, calf, push-up/pike, core and
scapular/postural families) so a `home_no_equipment` week is genuinely
staffed — with pulling/back limits still stated honestly rather than faked,
and bodyweight progression flowing into the ledger
(`docs/FITCOACH_PHASE3_TRAINING_ENGINE.md` §45).

The architecture was reviewed against the expanded V2 product vision on
2026-10-05: specification, architecture, database design (supported vs deferred
review), package plans and roadmap updated without implementing future systems —
no UI, AI coach, 3D renderer, computer vision, Health Connect or wearable code,
and no imported datasets.

No openGym source has been copied into this repository.

Open-source components and datasets will be evaluated individually and either:
1. used under compatible licenses with required notices,
2. reimplemented from observed behavior/specifications, or
3. excluded.

The final architecture is intended to be independent of openGym.
