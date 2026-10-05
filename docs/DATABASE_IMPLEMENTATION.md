# Database implementation — Phase 1

Status: **implemented**. This document describes what `packages/db` and
`apps/api` actually ship today: schema, migrations, repositories, seed,
tests, environment and commands. The contract it implements is
`docs/DATABASE_DESIGN.md`; design divergences are listed in §9 and must be
reviewed before Phase 2.

Design date: 2026-08-25 · Implementation: Phase 1 milestone
Inputs: `docs/DATABASE_DESIGN.md`, `docs/PRODUCT_SPEC.md`, `packages/domain/`.

---

## 1. What runs today

| Piece | Choice |
|---|---|
| Database | PostgreSQL 17 (embedded binary for tests, any PG ≥ 14 for dev/prod) |
| Schema tooling | Prisma 6.19 — schema + migrations; hand-written SQL appended to `0001_init` |
| Query client | `@prisma/client` behind repository interfaces |
| IDs | Application-generated UUIDv7 (RFC 9562) — `packages/db/src/ids.ts` |
| Tests | `node:test` over real PostgreSQL (embedded or `FITCOACH_TEST_DATABASE_URL`) |
| API | Zero-framework `node:http` router over application services |

Layout:

```text
packages/db/
├── prisma/
│   ├── schema.prisma            # 37 domain models (clusters A–E)
│   └── migrations/
│       ├── migration_lock.toml  # provider = postgresql
│       └── 0001_init/
│           └── migration.sql    # generated core + ~400 lines hand-written SQL
└── src/
    ├── index.ts                 # barrel (ids, errors, client, mapping, repositories, seed, testing)
    ├── ids.ts                   # UUIDv7 generation/parse/order
    ├── errors.ts                # RepositoryError taxonomy + Prisma mapping
    ├── mapping.ts               # row ↔ record mapping (timestamps, decimals, snapshots)
    ├── client.ts                # createPrismaClient (query logging off — health data)
    ├── repositories/            # 15 repositories + createRepositories(prisma)
    ├── seed/                    # fixtures.ts, seed.ts (idempotent), cli.ts
    ├── testing/postgres.ts      # startTestPostgres / migrateDeploy
    └── __tests__/               # unit.test.ts + persistence.integration.ts
```

## 2. Setup and environment variables

```bash
npm install                 # hoists everything; postinstall runs `prisma generate`
cp .env.example .env        # then edit DATABASE_URL
npm run db:migrate:dev      # create/apply migrations against DATABASE_URL
npm run db:seed             # idempotent development fixtures
npm run api:start           # build + run the API on PORT (default 8787)
```

| Variable | Required | Read by | Meaning |
|---|---|---|---|
| `DATABASE_URL` | yes (for CLI + API) | Prisma CLI, `createPrismaClient`, seed | `postgresql://user:pass@host:port/db?schema=public` |
| `PORT` | no (default 8787) | `apps/api` | API listen port |
| `FITCOACH_TEST_DATABASE_URL` | no | `startTestPostgres` | Disposable external DB for integration/smoke tests; migrations are applied to it automatically |

How `.env` is loaded (verified, not assumed):

* **Root npm scripts** (`db:*`, `api:start`, `test`) pass
  `--env-file-if-exists=.env` — Node ≥ 22.9 (see `engines`).
* **Workspace scripts** (`npm start -w @fitcoach/api`, `npm run
  test:integration -w @fitcoach/db`, …) load `../.env`, i.e. the same root
  file, because npm runs workspace scripts with the workspace directory as
  cwd.
* **The Prisma CLI** loads `.env` *from its working directory only* — it
  never searches upward. That is why the documented commands are the root
  `db:*` scripts (cwd = repository root). The `packages/db` `db:*` scripts
  still exist for CI, where `DATABASE_URL` is exported by the pipeline.

`.env` is gitignored (`.gitignore`: `.env`, `.env.*`, `!.env.example`).

### Windows note (elevated shells)

PostgreSQL refuses to start under an elevated user account
(`Execution of PostgreSQL by a user with administrative permissions is not
permitted`). On an elevated Windows shell the embedded test cluster cannot
boot. Two supported ways out:

1. run the database-backed tests from a **non-elevated** shell, or
2. point `FITCOACH_TEST_DATABASE_URL` at any disposable external PostgreSQL.

The pattern used during this milestone to run tests from an elevated shell:

```bash
runas /trustlevel:0x20000 'cmd /c cd /d E:\Projects\fitcoach && node --test packages\db\dist\__tests__\persistence.integration.js > tmp-int.log 2>&1'
```

### Encoding

Test clusters are initialized with `--encoding=UTF8 --locale=C`
(`src/testing/postgres.ts`). Windows `initdb` otherwise inherits the ANSI
locale (often WIN1252) and rejects any non-ASCII value a client sends —
accents, emoji, the typographic minus — with SQLSTATE `22P05`. External
databases (`FITCOACH_TEST_DATABASE_URL`) must likewise be UTF-8.

## 3. Commands

Run from the repository root:

| Command | What it does |
|---|---|
| `npm run db:generate` | Regenerate `@prisma/client` from `schema.prisma`. |
| `npm run db:validate` | Validate the schema (needs `DATABASE_URL` in root `.env`). |
| `npm run db:migrate:dev` | Create/apply migrations during development (interactive). |
| `npm run db:migrate:deploy` | Apply pending migrations to `DATABASE_URL` (non-interactive). |
| `npm run db:migrate:status` | Show applied/pending migration status. |
| `npm run db:seed` | Build, then run the idempotent development seed. |
| `npm run api:start` | Build, then run the API (`PORT`, `DATABASE_URL`). |
| `npm test` | Build, then run **unit** tests only (`**/dist/**/*.test.js`). |
| `npm run test:integration -w @fitcoach/db` | DB integration tests (embedded/external PG). |
| `npm run test:smoke -w @fitcoach/api` | End-to-end HTTP smoke test over a real DB. |

Naming is deliberate: the unit glob matches `*.test.js`; the database suites
are `persistence.integration.js` and `smoke.js` so a plain `npm test` never
boots PostgreSQL.

## 4. Schema and migrations

* **`schema.prisma`** — 37 domain models covering design clusters A–E
  (identity/profile, goals + versioning, training/plans/workouts, body +
  activity, nutrition, coaching). Text columns + CHECK constraints mirror the
  domain union types (Prisma enums were rejected in the design).
* **`migrations/0001_init/migration.sql`** (1370 lines) = two layers:
  1. the `prisma migrate diff --from-empty` core (tables, FKs, basic indexes);
  2. a hand-written block implementing everything Prisma cannot express:
     * **98 CHECK constraints** (enums, ranges, mutual-exclusion rules);
     * **partial/expression unique indexes** — `goals_one_active_per_user`,
       `training_plans_one_active_per_user`, `users_email_lower_unique`,
       `activity_records_steps_source_day_unique` (COALESCE expression),
       `body_measurements_import_unique`, `exercise_sets_position_unique`,
       partial status indexes, GIN on `exercises.aliases`,
       covering index on `body_measurement_values (site) INCLUDE (value_cm)`;
     * **deferred FKs** (divergence D11, see §9);
     * **integrity triggers** — `fitcoach_forbid_update` (append-only tables),
       `fitcoach_guard_lifecycle_columns` (goals/diagnoses/recommendations/
       interventions may only move lifecycle columns),
       `fitcoach_guard_steps_import` (only cumulative step rows may update),
       `fitcoach_guard_workout_exercise_frozen` / `fitcoach_guard_set_frozen`
       (children freeze when the workout finishes),
       `fitcoach_check_measurement_has_datum` (deferred constraint trigger).
* The migration was verified end-to-end against a real PostgreSQL:
  table/check/trigger counts, second-active-goal rejection, append-only
  enforcement, lifecycle-only updates, deferred-FK cascade behaviour, steps
  upsert semantics, account erasure. (Script deleted after use; the same
  guarantees are re-asserted by the integration suite.)

Migration workflow:

```bash
# 1. edit packages/db/prisma/schema.prisma
npm run db:validate
npm run db:migrate:dev          # dev: creates prisma/migrations/<name>/
#    (append hand-written SQL to the generated migration, keep it idempotent-safe)
npm run db:migrate:deploy       # everyone else
npm run db:migrate:status
```

Never edit an already-deployed migration; add a new one.

## 5. Seed

`npm run db:seed` — safe to run repeatedly (natural-key upserts, fixed ids):

* 10 equipment, 16 muscles, 12 exercises (relations rebuilt declaratively);
* 3 fixture foods + servings under a labeled fixture source;
* dev user `dev@fitcoach.local` (timezone `Asia/Kolkata`) with a profile.

Every fixture is first-party and hand-written — labeled
`SEED_FIXTURE_LABEL` — no third-party dataset or media is involved
(provenance rules: `data/provenance/THIRD_PARTY.md` remains untouched).
Fixture food/user ids use a fixed UUIDv7 *shape*
(`00000000-0000-7000-8000-…`) so they are valid, stable and obviously fake.

## 6. Repositories (`packages/db/src/repositories`)

Application code depends on the `Repositories` bundle only; nothing outside
`createRepositories(prisma)` knows Prisma exists.

| Repository | Aggregate | Notable guarantees |
|---|---|---|
| `PrismaUserRepository` | account | case-insensitive email uniqueness, timezone validation, cascading erasure |
| `PrismaProfileRepository` | profile | material changes append `profile_revisions`; cosmetic (`unit_system`) never does |
| `PrismaGoalRepository` | goals | interval versioning: supersession closes the old row in-txn; one active per user |
| `PrismaEquipmentRepository` | equipment | catalog upsert by slug; point-in-time `listUserEquipment(userId, at)` |
| `PrismaExerciseRepository` | catalog | muscle/exercise upsert by slug; relation replacement |
| `PrismaTrainingPlanRepository` | plan | versions append (`version_number` = max+1); content rows are append-only |
| `PrismaWorkoutRepository` | workout | idempotent on `(user, clientRequestId)` with race recovery; freeze after final |
| `PrismaBodyMeasurementRepository` | measurements | append-only; idempotent on `(user, entered_via, external_id)` |
| `PrismaActivityRepository` | activity | race-free step upsert (max-wins, raw SQL `ON CONFLICT`); cardio dedupe on `external_id` |
| `PrismaFoodRepository` | foods | current-state nutrients; history protected by write-time snapshots |
| `PrismaMealRepository` | meals | write-time item snapshots; totals refreshed from frozen snapshots; idempotent on `clientRequestId` |
| `PrismaNutritionRepository` | daily nutrition | one row per (user, day), upserted |
| `PrismaDiagnosisRepository` | diagnosis | evidence append-only; status transitions only |
| `PrismaRecommendationRepository` | recommendation | evidence copied at write time (never linked); lifecycle-only status |
| `PrismaInterventionRepository` | intervention | one outcome per `(intervention, evaluation_window)`; explicit supersession chain |

Cross-cutting rules:

* **Errors** — every Prisma failure is translated to `RepositoryError`
  (`not_found | conflict | validation | immutable | internal`); trigger
  messages (`append-only`, `content is frozen`, `is frozen`, `lifecycle`,
  `must record`) map to `immutable`. SQL, parameters and driver types never
  escape this boundary.
* **Transactions** — a read-back inside `$transaction` must use the tx
  client (`load(id, tx)`), never the outer pool: the outer connection cannot
  see uncommitted rows. This bug class was found by the integration suite and
  is now covered by tests.
* **UUIDv7** — generated in the application (monotonic, clock-regression
  safe); the database only stores `uuid` columns.

## 7. Tests

| Suite | Command | Needs DB | Count |
|---|---|---|---|
| Unit (all packages) | `npm test` | no | 55 |
| DB integration | `npm run test:integration -w @fitcoach/db` | yes | 14 |
| API smoke | `npm run test:smoke -w @fitcoach/api` | yes | 9 |

Integration/smoke setup (`startTestPostgres`):

1. `FITCOACH_TEST_DATABASE_URL` if set — migrated in place (must be
   disposable), otherwise an embedded PostgreSQL cluster in a temp dir;
2. `prisma migrate deploy` applies `prisma/migrations` — the tests always run
   against the real migration, never against `db push`;
3. the cluster is stopped and the directory removed afterwards.

If no database can be started the suites **fail loudly** — a green run that
never touched the database would be a lie.

Coverage highlights:

* **idempotency** — workouts, meals, step imports, measurement imports,
  duplicate email, outcome windows, seed re-runs;
* **historical integrity** — editing a food never rewrites logged meals;
  a superseded goal never rewrites recommendations/diagnoses that cite it; a
  workout stays traceable to the plan version it was written against after
  new versions are appended;
* **append-only / lifecycle at the database level** — tests bypass the
  repository with raw Prisma writes and assert the *triggers* refuse them;
* **account erasure** — every user-owned table cascades, including
  deferred-FK history rows;
* **API smoke** — real HTTP against real services: validation envelopes that
  never echo submitted values, 404/405/409/409-frozen mappings, timezone
  defaults, idempotent replay, snapshot totals.

## 8. API structure (`apps/api`)

```text
index.ts        composition root: DATABASE_URL → Prisma → repositories → services → server; shutdown hooks
server.ts       createServer({ services? }) — example/health routes always; DB routes only when services are injected
routes.ts       /v0 route table — parse → validate → service → respond (no storage details)
validation.ts   fail-fast field helpers; error messages state the rule, never the value
http.ts         router with :param matching, 1 MB body cap, stable error envelope
services/       use-case layer (identity, body, training, nutrition, coaching) — owns defaults (timezone-derived dates, active-goal/plan resolution)
```

Route inventory (all under `/v0`):

```
GET    /healthz                                   liveness (no DB)
GET    /v0/example-profile                        placeholder payload (no DB)
POST   /v0/users                                  GET    /v0/users/:userId
PUT    /v0/users/:userId/profile                  GET    /v0/users/:userId/profile[?revisions=true]
POST   /v0/users/:userId/goals                    GET    /v0/users/:userId/goals
GET    /v0/users/:userId/goals/active
POST   /v0/users/:userId/equipment                GET    /v0/users/:userId/equipment[?at=YYYY-MM-DD]
POST   /v0/users/:userId/measurements             GET    /v0/users/:userId/measurements[?limit&from&to]
POST   /v0/users/:userId/training-plans           GET    /v0/users/:userId/training-plans[/active]
POST   /v0/users/:userId/training-plans/:planId/versions   GET /v0/users/:userId/training-plans/:planId
POST   /v0/users/:userId/workouts                 GET    /v0/users/:userId/workouts[?limit&from&to]
GET    /v0/users/:userId/workouts/:workoutId
POST   /v0/users/:userId/workouts/:workoutId/exercises | /sets | /complete
POST   /v0/users/:userId/activity                 GET    /v0/users/:userId/activity[?kind&from&to&limit]
POST   /v0/users/:userId/foods                    GET    /v0/foods/:foodId
POST   /v0/users/:userId/meals                    GET    /v0/users/:userId/meals[?date=]
POST   /v0/users/:userId/meals/:mealId/items
GET    /v0/users/:userId/nutrition/daily[?date=]
POST   /v0/users/:userId/diagnoses                GET    /v0/users/:userId/diagnoses[?status&limit]
POST   /v0/users/:userId/diagnoses/:diagnosisId/evidence
POST   /v0/users/:userId/recommendations          GET    /v0/users/:userId/recommendations[?limit]
POST   /v0/users/:userId/interventions            GET    /v0/users/:userId/interventions[?status&limit]
POST   /v0/users/:userId/interventions/:id/outcomes       GET (same path)
```

Error envelope (stable for clients, safe for logs):

```json
{ "error": "validation_failed|not_found|conflict|immutable_record|method_not_allowed|payload_too_large|internal_error",
  "message": "rule, not the submitted value",
  "path": "field.path" }
```

Status mapping: repository `validation` → 400, `not_found` → 404,
`conflict` → 409, `immutable` → 409; unknown failures → generic 500 with the
error *class* logged server-side only.

Semantic notes:

* `PUT /profile` is **full-state replacement** (PUT semantics): a request
  carries the whole profile; omitted material fields become absent — which
  itself is a material change and appends a revision. `unit_system` is
  cosmetic and never produces a revision.
* Activity `from`/`to` are strict `YYYY-MM-DD` calendar days (the row is a
  day-level fact); measurement/workout `from`/`to` are timestamps.
* All daily defaults (goal start date, steps day, meal `localDate`) derive
  from the user's IANA timezone — never from server UTC.

## 9. Divergences from `DATABASE_DESIGN.md`

| # | Design | Implemented | Why |
|---|---|---|---|
| D8 | nullable string arrays (`photo_refs`, `substitution_exercise_ids`) | `String[] @default([])` (NOT NULL, default empty) | Prisma cannot map nullable arrays; empty ≡ absent at the domain boundary |
| D9 | `foods.source_id` ON DELETE RESTRICT | ON DELETE CASCADE | user-created food sources cascade from `users`; erasure must take their foods with them |
| D10 | plan versions RESTRICT; partial uniques expressed as partial indexes | versions CASCADE from plans; partial uniques on nullable columns expressed as plain `@unique` (PG treats NULLs as distinct) | erasure determinism; Prisma cannot express partial indexes |
| D11 | history FKs RESTRICT | same guarantee as `NO ACTION DEFERRABLE INITIALLY DEFERRED`; additionally `goals.superseded_by_goal_id → goals(id)` is deferred | reachable history tables sit inside the `users(id)` cascade tree — immediate checks make erasure order-dependent; supersession links forward to a row inserted later in the same transaction

| D12 | V2 domain fields (cholesterol, mono/poly/trans fat, omega-3/6, `additionalNutrients`, food preparation state, recipe yield, food-provenance tier, `meal_items.input_method`/`quantityEstimate`) | domain-only; `mapping.ts` persists the Phase 1 nutrient set | Persistence lands with the phase that uses it (Phase 4 nutrient registry + preparation/recipe columns — `docs/DATABASE_DESIGN.md` §23.2). No Phase 1 writer accepts the new fields, so nothing is silently lost |
| D13 | food identity including raw/cooked state | `foods` uniqueness remains `(source_id, external_id)` | Depends on the chosen dataset's shape; decided in Phase 4 |
| D14 | user-defined measurement sites | `body_measurement_values.site` remains a closed CHECK list | Needs a per-user site catalog (Phase 6) |
| D15 | projections as mutable current state | (not implemented) immutable snapshots + supersession | Phase 7 design decision, recorded now so no mutable "current projection" row is ever created | |

Other decisions worth explicit approval:

1. **`User.timezone` is required and IANA-validated** at the repository
   boundary (`Intl`); the domain gained `time.ts`
   (`toUserLocalDate`, `startOfLocalDay` — DST-correct, `addCalendarDays`,
   `calendarDaysBetween`).
2. **UUIDv7 in the application**, not the database (client-generatable ids
   are the foundation of idempotent writes).
3. **No query logging** in `PrismaClient` (Prisma query events contain bind
   parameters — meals, body metrics and notes are health data).
4. **`PUT /profile` replaces** (see §8) rather than merges.
5. **Hand-written SQL lives inside `0001_init`** instead of follow-up
   migrations, because Phase 1 ships one atomic baseline.

## 10. Security checklist (milestone §15)

* [x] `DATABASE_URL`/credentials only in gitignored `.env` (`.env.example` committed);
* [x] no query logging / no bind parameters in logs;
* [x] validation error messages never echo submitted values (asserted by test);
* [x] unknown failures render a generic 500 — no SQL/driver details leak;
* [x] request bodies capped at 1 MB;
* [x] idempotency keys on every side-effecting import (`clientRequestId`,
      `external_id`) so client retries never duplicate rows;
* [x] append-only history enforced by the database itself, not by convention.
