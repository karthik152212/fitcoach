# FitCoach

Adaptive personal fitness coaching system.

## Product principle

Measure → Understand → Diagnose → Recommend → Track → Compare → Adjust.

The system optimizes the user's trajectory toward their chosen goal rather than rewarding isolated numbers.

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

## Current status

Phase 0/1 scaffold. No openGym source has been copied into this repository.

Open-source components and datasets will be evaluated individually and either:
1. used under compatible licenses with required notices,
2. reimplemented from observed behavior/specifications, or
3. excluded.

The final architecture is intended to be independent of openGym.
