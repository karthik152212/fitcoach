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

## Decision

Use openGym as:
1. an architectural reference,
2. a source of ideas and UX patterns,
3. a candidate source for individually evaluated components where licensing permits.

Do not make it the permanent architectural base of FitCoach.

## Source

https://github.com/arvids-unavailable/openGym
