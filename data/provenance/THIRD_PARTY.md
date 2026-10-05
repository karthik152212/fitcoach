# Third-party provenance register

This file is intentionally created before importing external code/data.

| Component / Dataset | Source | License | Intended use | Status |
|---|---|---|---|---|
| openGym application code | https://github.com/arvids-unavailable/openGym | AGPL-3.0 | Reference / individually evaluated components | Audit required before reuse |
| openGym exercise dataset | https://github.com/hasaneyldrm/exercises-dataset | Upstream terms | Exercise content candidate | License verification required |
| MuscleMap-derived body paths | Referenced by openGym NOTICE | MIT | Possible reference/asset | Verify upstream attribution before use |

## Import boundary (set in the V2 architecture milestone; nothing imported)

Before any dataset is imported, all of the following must be true:

1. the licence/usage terms are **verified** and recorded above, including whether
   redistribution is permitted or attribution is required;
2. an `external_sources` row exists carrying the licence, so imported rows keep
   provenance in the database rather than only in this file;
3. the trust tier is decided (`first_party`, `verified_external`, `branded`,
   `restaurant`, `user_created`, `photo_derived_estimate`, `ai_parsed`) — an
   imported estimate is never promoted to verified data;
4. the source's actual precision is preserved: whatever basis it publishes
   (per 100 g raw, per serving cooked, label-declared) is recorded, and nutrients
   it does not publish stay unknown rather than becoming zero;
5. the import is reproducible from a documented script, so the dataset can be
   re-derived or removed.

Candidate categories (exercise definitions, food composition, branded/restaurant
foods, body/sleep/activity datasets) are listed with their boundaries in
`docs/OPEN_SOURCE_AUDIT.md`. None is imported yet; the first licensed import is
scheduled for Phase 4 (`docs/FITCOACH_ROADMAP.md`).

## Rule

No third-party code, data, media, icon, animation or model is added to the product repository without an entry here and a verified license/usage decision.
