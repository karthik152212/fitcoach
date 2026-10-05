# Open-source audit: openGym

Audit date: 2026-08-25

## Findings

The current openGym repository is a React 19 + Vite frontend, Node backend, nginx/Docker deployment, WebAuthn/passkey authentication, and a JSON-file storage model. It contains training logic as pure functions with tests. It also supports a standalone Capacitor mobile build. See the upstream repository and CONTRIBUTING documentation.

Useful concepts/components to study:
- exercise domain model
- workout/set logging
- progression logic
- RIR/RPE
- 1RM estimation
- body-weight tracking
- cardio logging
- equipment filtering
- exercise/muscle mapping
- guided workout UX
- import/export behavior
- mobile/PWA implementation patterns

## License boundary

openGym's own code is AGPL-3.0. Its NOTICE file states that exercise names/instructions/images/animations come from `hasaneyldrm/exercises-dataset` and are not covered by openGym's AGPL license.

Therefore:
- do not assume the exercise dataset is AGPL;
- do not copy third-party media into our product until its terms are verified;
- keep attribution/provenance records;
- do not copy AGPL code into a closed proprietary core unless the resulting licensing obligations are acceptable.

## Security observations

The upstream project explicitly documents that it has no application-level rate limiting and relies on the reverse proxy for TLS/security headers. Its current nginx configuration does not set CSP/HSTS/X-Frame-Options.

For our product, security controls will be designed independently rather than inherited blindly.

## Future dataset categories (policy set, no import performed)

The V2 product will want external data in several categories. None has been
imported, and each is subject to the same rule: verify the licence, register it
in `data/provenance/THIRD_PARTY.md`, then import with provenance attached to the
rows (`external_sources`, `food_sources`).

| Category | Examples considered | Boundary |
|---|---|---|
| Exercise definitions/media | openGym's dataset, other exercise corpora | verify upstream terms per asset; media never copied without a clear grant; imported as `external_sources` rows with `license_spdx` |
| Food composition | national food composition databases, open food datasets | check redistribution vs attribution-only terms; record the nutrient basis (raw/cooked, per 100 g) the source actually publishes; never present an imported value as more precise than it is |
| Branded/packaged food data | manufacturer data, crowdsourced databases | terms differ per source; may require attribution or may forbid redistribution — decide before import, in Phase 4 |
| Restaurant/regional data | user-entered or partner data | provenance tier `restaurant`; never silently merged into generic foods |
| Body/sleep/activity data | public research datasets | check redistribution terms; keep separable from user data |
| Device/platform data | Health Connect, Apple Health, wearable SDKs | platform APIs, not redistributable datasets; requires user consent and per-platform review |

Explicit non-goals for this milestone: no external food database, no openGym
import, no exercise dataset import, no platform health integration.

## Decision

Use openGym as:
1. an architectural reference,
2. a source of ideas and UX patterns,
3. a candidate source for individually evaluated components where licensing permits.

Do not make it the permanent architectural base of FitCoach.

The end state is a clean, independent FitCoach codebase — not a wrapper around
another project. Third-party material is either used under a verified
compatible licence with attribution, reimplemented from observed behavior, or
excluded.

## Source

https://github.com/arvids-unavailable/openGym
