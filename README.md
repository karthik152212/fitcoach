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

Phase 1 working backend foundation: PostgreSQL + Prisma schema/migrations,
15 repositories, application API (`/v0`), idempotent seed, unit +
integration + HTTP smoke tests (docs/DATABASE_IMPLEMENTATION.md).

The architecture was reviewed against the expanded V2 product vision on
2026-10-05: specification, architecture, database design (supported vs deferred
review), package plans and roadmap updated without implementing future systems —
no UI, AI coach, 3D renderer, computer vision, Health Connect, wearable or
adaptive-training code, and no imported datasets.

No openGym source has been copied into this repository.

Open-source components and datasets will be evaluated individually and either:
1. used under compatible licenses with required notices,
2. reimplemented from observed behavior/specifications, or
3. excluded.

The final architecture is intended to be independent of openGym.
