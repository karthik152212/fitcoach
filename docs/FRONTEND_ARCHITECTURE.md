# FitCoach frontend architecture (Phase 4)

The product UI. It renders the deterministic Phase 3 engine and submits the
user's real training actions back to it. It is **not** a second fitness engine:
no muscle weighting, no plan building, no progression decisions, no invented
metrics.

`docs/UI_UX_PRINCIPLES.md` remains the design constitution. This document
describes how the implementation is put together.

---

## 1. Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Framework | React 18 + TypeScript | The repository was already TypeScript end to end; no framework migration. |
| Build | Vite 5 (`@fitcoach/web`) | Fast dev server, real production build, no framework runtime. |
| Routing | `react-router-dom` v6 (`createBrowserRouter`) | Flat, explicit product routes. |
| Styling | Hand-written CSS with CSS custom properties | The design system is semantic tokens; a utility framework would hide it and a CSS-in-JS runtime is unnecessary weight. |
| Icons | Inline SVG (`shell/AppShell.tsx`) | Six glyphs do not justify a dependency. |
| Tests | Vitest + `@testing-library/react` (jsdom) | Same runner as the rest of the repository. |

Total runtime dependencies: `react`, `react-dom`, `react-router-dom`. Nothing
else was added.

## 2. Repository layout

```
apps/web/
  index.html
  vite.config.ts        # dev proxy: /v0 → http://127.0.0.1:8787
  src/
    main.tsx            # providers + stylesheet order
    router.tsx          # route table
    api/                # thin typed client, endpoint wrappers, DTOs
    anatomy/            # atlas (owned SVG) + AnatomyFigure renderer
    components/         # Button, Chip, StateBlock, Expandable, Stepper
    lib/text.ts         # slug → human words helpers
    screens/            # one file per product surface
    session/            # SessionContext (who) + WorkoutContext (what now)
    shell/              # AppShell: frame + navigation
    theme/              # tokens.css (semantic tokens) + base.css
```

## 3. Routes

| Path | Screen | Purpose |
| --- | --- | --- |
| `/` | `HomeScreen` | Adaptive, priority-driven surface |
| `/onboarding` | `OnboardingScreen` | Progressive interview → goal → equipment → plan |
| `/plan` | `PlanScreen` | Week structure, muscle coverage, why the plan exists |
| `/train` | `TrainScreen` | Today's session: anatomy, sequence, Start |
| `/exercise/:exerciseId` | `ExerciseScreen` | Anatomy → name → target → focus → details → Start |
| `/exercise/:exerciseId/perform` | `PerformScreen` | Minimal set logging |
| `/review/:workoutId` | `ReviewScreen` | What was performed + the engine's conclusion |
| `/progress` | `ProgressScreen` | Recorded sessions, continuity, progressions |
| `/you` | `YouScreen` | Body/goal context, environment and equipment |

Navigation is Home · Train · Progress · You: the four places the current product
actually needs. Bottom bar on mobile, fixed side rail ≥900px.

## 4. Data layer

`api/client.ts` is a typed `fetch` wrapper with one rule: safe server messages
only. `api/endpoints.ts` has one function per endpoint and no logic.
`api/hooks.ts` exposes `useAsync(fn, deps)` → `{status, data, error, retry}` so
every screen renders designed loading / error / empty states instead of a bare
spinner.

Contracts consumed (verified against the running API, not assumed):

- `GET /v0/users/:id/training-plans/active` → `{ plan: { id, kind, status,
  versions: [{ id, versionNumber, lifecycleStatus, sessions: [{ id, name,
  weekdayHint, slots: [{ id, exerciseId, targetSets, targetRepRange,
  targetRir, restSeconds, notes }] }] }] } }`. `kind` is `primary` or
  `temporary_environment`.
- `GET /v0/users/:id/workouts?limit=` and `GET /v0/users/:id/workouts/:id`
  both return `{ workout: { workout, exercises: [{ …, sets }] } }` — the list
  is a list of those pairs, not of bare workout rows.
- `GET /v0/users/:id/training-continuity` →
  `{ environment, sessions: { total, completed, adapted, home, skipped, open },
  missedSessions, temporaryPlans, totalCompletedProgressions }`.
- `POST /v0/users/:id/workouts` requires `sessionClassification` from
  `planned | adapted | makeup | unplanned`.
- `POST /v0/users/:id/progression/evaluate` →
  `{ persisted, reason?, evaluation?: { outcome, recommendation, performance } }`.
  `persisted: false` means "no evidence", which the UI renders as
  *Insufficient data* rather than inventing a recommendation.
- `GET /v0/users/:id/training-state` carries `plannedWeeklyVolumePerMuscle`,
  which is the only source of the plan's muscle coverage numbers.

## 5. Session state

- `SessionContext` — who is using the device (`fitcoach.userId` in
  `localStorage`). Onboarding creates or resumes the user; there is no account
  system in this phase.
- `WorkoutContext` — the in-progress session: workout id, environment,
  classification, the exercise being logged, and every set recorded so far.
  Mirrored to `sessionStorage`, so a guide overlay, a route change or a reload
  returns to the exact same logging state. All mutations are functional
  updates: starting a session and selecting its first exercise happen in the
  same tick, and a closure over stale state would silently drop the session.

Facts are never inferred here: set `loadKind`, rep counts and IDs are what the
backend returned.

## 6. Design system

`theme/tokens.css` defines the semantic tokens (`--background`, `--surface`,
`--surface-elevated`, `--text-primary|secondary|muted`, `--border`,
`--accent`, `--success`, `--warning`, `--important`, `--error`,
`--anatomy-*`, `--interactive`, `--focus`, `--touch-target`, motion and
shape). Components consume tokens; a component never carries a raw hex value.

`--accent` and `--anatomy-target` are **provisional** development values behind
their semantic tokens (UI/UX principles §20). Replacing the brand accent is a
two-line change in `tokens.css`.

### Theme

Device-controlled only: `prefers-color-scheme` selects the light or dark token
block. There is no in-app Light/Dark/System switch anywhere in the product.
Light and dark were designed independently (light: warm neutral surfaces, near
black text, quiet anatomy; dark: near-black surfaces with deliberate elevation,
soft text hierarchy, anatomy bright enough to stay legible).

## 7. Anatomy system

```
exercise knowledge → TargetMap (backend) → AnatomyFigure → UI
```

- `anatomy/atlas.ts` is **first-party** vector anatomy: 83 regions across
  `front`, `back` and `side` views in a single `0 0 200 460` viewBox. Every path
  is hand-authored FitCoach content, so there is no third-party artwork,
  licensing or provenance question.
- Region keys are `<view>:<muscle_slug>[.<structure_slug>]`. `resolveAnatomyRegions`
  maps a TargetMap highlight (muscle slug, optional structure slug) onto those
  keys. Deep muscles without distinct surface geometry resolve to their surface
  region — documented anatomical honesty, not a decorative blob.
- `AnatomyFigure` takes `{ view, highlights, size, interactive, onActivate }`
  and lights exactly what TargetMap says: `primary` strong, `secondary` softer,
  `supporting` faint, everything else neutral. It never decides which muscle is
  trained.
- `highlightsFromTargetMap` prefers structure-level relations when the domain
  supplies them, so a head-specific target (e.g. lateral deltoid, long head of
  the biceps) reads as that head.
- `bestViewFor(highlights)` picks the view that actually shows the target.
- The `role="img"` accessible name lists the highlighted muscles, so target
  information is never colour-only.
- Reused in Home, Train, Exercise detail, performance mode, the guide overlay
  and the plan overview — one implementation, one visual language.

**Asset dependency:** the atlas is the owned v1 layer. Commissioned
illustration can replace the path data without touching a screen, because the
contract is `AnatomyRegion.key` ↔ taxonomy slug.

## 8. Workout experience

1. `TrainScreen` — today's session: anatomy of the muscles it trains, the
   exercise sequence with compact `sets × reps`, one Start action. No calorie
   or duration headline.
2. `ExerciseScreen` — anatomy, name, exact target (+ head/emphasis), one
   concise focus line, `Details` (form guidance) collapsed by default, Start.
   Tapping the anatomy opens the guide.
3. `PerformScreen` — the explanation is gone, the anatomy stays. Logged sets
   read `60 kg × 10`, `60 kg × 9 · Failure`; `+` opens the compact entry
   (weight where the load kind has one, reps, Failure, Save). Bodyweight
   exercises have no weight field; assisted/weighted bodyweight sets render as
   assistance/added load, not as external load.
4. Progression feedback comes from `progression/evaluate` after a set exists:
   *Progression available* / *No change recommended* / *Insufficient data* /
   *Performance is declining*, with the engine's rationale when it has one.
5. `Finish workout` completes the session and lands on `ReviewScreen`:
   performed work, then the engine's conclusion — `No change recommended.` is
   a first-class, intentional outcome. No confetti, no score.
6. Guide: the anatomy is the entry point; the overlay keeps the same target
   highlight, states plainly that the demonstration video is still in
   production, and shows the engine's form guidance. Closing it returns to the
   exact previous logging state.

## 9. Adaptive Home

`deriveHomeSections()` is a pure function from training state → ordered
sections, each `{ id, priority, tone, title, body?, action? }`:

| id | priority | when |
| --- | --- | --- |
| `today` | 20 | a session is planned for today |
| `rest` | 15 | the plan exists but today is not a training day |
| `temporary` | 12 | the active plan is a temporary environment plan |
| `environment` | 10 | the environment is constrained (limited equipment/travel) |
| `continuity` | 8 | adapted sessions are logged |
| `ontrack` | 0 | nothing needs attention — shown deliberately |

Sections sort by priority; the first is the hero, the rest render as calm
notes. Adding nutrition, activity or recovery later means adding sections to
the same pipeline — not redesigning Home.

## 10. Responsive

One system, mobile-first: 320–430px phones are the primary surface (44px touch
targets, bottom navigation, one-handed reach, anatomy bounded to ~38vh so the
name and target stay visible), 430–900px large phones/tablets, ≥900px desktop
with the same single reading column centred beside a fixed side rail. There is
no second desktop layout.

## 11. Accessibility

Semantic landmarks and headings per screen, `role="img"` anatomy with muscle
names, `role="status"` on progression feedback, `role="alert"` on errors,
`aria-pressed` on Failure, labelled set controls, visible focus rings
(`--focus`), non-colour-only state (adaptation and limitation status are
textual), and `prefers-reduced-motion` collapsing the motion tokens to zero.

## 12. Development

```bash
npm install

# terminal 1 — API (needs DATABASE_URL, see docs/DEVELOPMENT.md)
npm run db:migrate:deploy
npm run db:seed
npm run api:start          # API on :8787

# terminal 2 — product UI
npm run dev:web            # Vite on :5173, proxies /v0 → :8787

# checks
npm run typecheck                          # whole repo
npm run build -w @fitcoach/web             # production build
npm run test:web                           # UI tests (vitest)
npm run test                               # backend/domain tests
```

`apps/web` has no `.env`; the API needs `DATABASE_URL` (see
`docs/DEVELOPMENT.md`).

## 13. Tests

`apps/web/src/__tests__/`:

| File | Covers |
| --- | --- |
| `design-system.test.tsx` | tokens for both themes, no in-app theme selector, component variants, designed states |
| `anatomy.test.tsx` | target-only highlighting, structure-level targets, view selection, accessible labels |
| `exercise.test.tsx` | Anatomy → Name → Target → Focus → Details → Start, guide entry, error state |
| `perform.test.tsx` | minimal performance mode, set logging, failure, bodyweight (no weight field), progression feedback |
| `guide.test.tsx` | guide open/return and state preservation |
| `home.test.tsx` | priority model and adaptive Home states |
| `onboarding.test.tsx` | full interview → plan → signed-in acceptance journey |
| `journey.test.tsx` | regressions found in browser QA: same-tick session start, nested workout list, plan coverage, environment limitation wording |

`mockApi.ts` intercepts `fetch` per `(method, path)`; fixtures mirror the real
response envelopes, so a contract drift shows up as a failing test.

## 14. Known limitations (as observed against the running stack)

These are honest gaps, not hidden ones.

1. **Plan generation can be infeasible for a brand-new user.** The UI submits
   the interview answers to `POST /training-plans/generate` and renders the
   engine's answer. In this environment, several goal/day combinations come
   back `infeasible` with `exercise_availability: Session(s) … have no eligible
   exercise for the available equipment` — reproduced for `general_fitness`
   (1 day is feasible, 2–4 days are not) and for multi-session `bodybuilding`
   splits, with an empty, a partial and a full (21-item) equipment record. The
   Phase 3 engine is frozen for this milestone, so the UI does the honest thing
   instead of hiding it: it keeps every answer, names the constraint the engine
   named, and offers the smallest change that can help (fewer days), an edit
   path back to the training/goal steps, and a retry that reuses the user it
   already created. Fixing the staffing itself is Phase 3 work.
2. **No demonstration video assets.** The guide overlay is built for
   full-screen video: the anatomy is the entry point, the target overlay and
   the state preservation are real. Until the per-exercise media are produced,
   the overlay says so plainly and shows the engine's form guidance. Nothing
   pretends a video exists.
3. **Anatomy artwork is v1.** `atlas.ts` is first-party vector anatomy (83
   regions, three views). It is deliberately replaceable: screens consume
   region keys, not paths. Commissioned illustration can drop in without a UI
   change; higher fidelity (and deeper muscle heads) is an art dependency.
4. **One person per device.** `SessionContext` stores a user id in
   `localStorage`; there is no account, session security or multi-device sync
   in this phase.
5. **No browser/e2e harness in the repository.** Acceptance coverage is
   jsdom-level (`@testing-library/react`) plus the manual browser QA described
   in §12. The critical journey is exercised in `onboarding.test.tsx`,
   `perform.test.tsx`, `guide.test.tsx` and `journey.test.tsx`.
6. **Calories, nutrition, recovery, activity and coaching are not
   implemented** — by design. Home's section model and the shell's navigation
   are the extension points for them.

## 15. Extension points

- Home: add a section producer to `deriveHomeSections` (nutrition, activity,
  recovery, unified coach).
- Shell: add a destination to `NAV_ITEMS` when a surface earns it.
- Anatomy: replace `atlas.ts` path data, or add views; screens do not change.
- Guide: the overlay already has the video slot — drop the asset in and the
  anatomy-to-video transition stays.
- API: new endpoints go in `endpoints.ts` + `types.ts` only; screens never
  call `fetch` directly.
