# Development guide

## Repository structure

```text
fitcoach/
├── apps/
│   └── api/            # @fitcoach/api — application API (HTTP → services → repositories)
├── packages/
│   ├── domain/         # @fitcoach/domain — canonical domain models + time/timezone helpers
│   ├── fitness-core/   # @fitcoach/fitness-core — deterministic training logic
│   ├── nutrition/      # @fitcoach/nutrition — deterministic nutrition logic
│   ├── db/             # @fitcoach/db — PostgreSQL schema, migrations, repositories, seed
│   └── ai/             # @fitcoach/ai — AI orchestration boundary
├── data/
│   └── provenance/     # third-party license/provenance register
├── docs/
├── .env.example        # environment template (copy to .env)
├── package.json        # npm workspaces root
└── tsconfig*.json      # shared TypeScript configuration
```

## How npm workspaces are organized

- The root `package.json` declares `workspaces: ["apps/*", "packages/*"]`.
  One `npm install` at the repository root installs everything; dependencies
  are hoisted to the root `node_modules`, and each `@fitcoach/*` package is
  symlinked there, so workspace imports resolve by name.
- All internal packages live under the `@fitcoach` scope and depend on each
  other with `"*"` versions resolved through the workspace.
- Dependency direction: `api → domain, db, nutrition`; `db → domain`;
  `fitness-core → domain`; `nutrition → domain, fitness-core`;
  `ai → domain` (contracts only). Nothing depends upward on `ai`.

## Environment

- Copy `.env.example` to `.env` at the repository root and set
  `DATABASE_URL` (and optionally `PORT`, `FITCOACH_TEST_DATABASE_URL`).
  `.env` is gitignored.
- Root scripts (`db:*`, `api:start`, `test`) and workspace scripts load this
  file via Node's `--env-file-if-exists` (Node ≥ 22.9 — see `engines`).
- The Prisma CLI reads `.env` only from its working directory, so use the
  root `db:*` scripts (see docs/DATABASE_IMPLEMENTATION.md §2).

## TypeScript setup

- `tsconfig.base.json` holds the shared strict compiler settings.
- Every package/app has its own `tsconfig.json` extending the base, compiled
  as a composite project; `packages/*/package.json` point `main` at built
  output (`dist/index.js`) while `types` points at source (`src/index.ts`),
  so typechecking works from source before any build, and runtime imports
  work after a build.
- The root `tsconfig.json` includes all sources with `noEmit` for a fast,
  whole-repository typecheck that does not require prior builds.
- `tsconfig.build.json` wires the project-reference graph used by `tsc -b`.

## Commands

Run from the repository root:

| Command | What it does |
|---|---|
| `npm install` | Install all workspace dependencies once (runs `prisma generate`). |
| `npm run typecheck` | Strict typecheck of every package, no emit, no build needed. |
| `npm run build` | Compile all packages to their `dist/` folders via project references. |
| `npm test` | Build, then run **unit** tests with Node's built-in runner over `dist/**/*.test.js`. |
| `npm run lint` | Placeholder; no linter configured yet. |
| `npm run db:migrate:dev` | Create/apply Prisma migrations against `DATABASE_URL`. |
| `npm run db:migrate:deploy` | Apply pending migrations (non-interactive). |
| `npm run db:seed` | Build, then run the idempotent development seed. |
| `npm run api:start` | Build and run the API on port 8787 (`PORT` env var overrides). |
| `npm run test:integration -w @fitcoach/db` | DB integration tests — boots PostgreSQL (embedded or `FITCOACH_TEST_DATABASE_URL`). |
| `npm run test:smoke -w @fitcoach/api` | HTTP smoke test over real services and a real database. |

Tests use `node:test` and `node:assert` only — zero test-framework
dependencies. Unit test files live next to sources as
`src/**/__tests__/*.test.ts`; the database-backed suites are named
`persistence.integration.ts` / `smoke.ts` so `npm test` never starts a
database. Full database documentation: docs/DATABASE_IMPLEMENTATION.md.

## Architecture rules

1. **Domain logic stays independent of UI and AI.** `domain`,
   `fitness-core` and `nutrition` contain deterministic logic and plain data
   models. They never import from `apps/*`, `packages/ai`, or any UI code.
2. **The LLM is not the source of truth.** `packages/ai` may parse natural
   language, explain findings and present validated recommendations, but all
   facts come from deterministic calculation. See docs/ARCHITECTURE.md.
3. **Domain models are not database models.** `packages/db` maps between
   them; nothing else knows about storage.
4. **Third-party code/data requires provenance.** Anything external must be
   registered in `data/provenance/THIRD_PARTY.md` with a verified license.

## Current status / intentional gaps

- **`db` is implemented**: 37-table PostgreSQL schema with migrations,
  CHECK/partial-unique indexes, append-only and lifecycle triggers, 15
  repositories, UUIDv7 ids, idempotent seed, unit + integration tests
  (docs/DATABASE_IMPLEMENTATION.md).
- **`apps/api` is implemented** for Phase 1: validation, router, services and
  the full `/v0` route table, with an HTTP smoke test. No auth yet — routes
  are unauthenticated by design until an identity strategy exists.
- `fitness-core` and `nutrition` modules are typed boundaries whose functions
  throw `NotImplementedError`; they deliberately do not pretend to work
  (deterministic snapshot helpers in `nutrition` are the exception).
- `ai` has no SDK/provider integration yet.
- No UI framework, auth, AI SDK, or fitness API dependencies exist yet — this
  phase is foundation only.
