# Exercise media manifest

The exercise catalogue contains **73 exercises** (`packages/db/src/seed/knowledgeExercises*.ts`).
**47 of 73** now ship a reviewed photograph; **26** render the FitCoach anatomy
figure because no honestly matching licensed image exists for that variation.

Nothing here is decorative. A photograph only replaces the anatomy figure when
it shows the same movement, with the same equipment, as the exercise it is
registered against.

## Source and licence

All 47 photographs come from **[free-exercise-db](https://github.com/yuhonas/free-exercise-db)**
— "Open Public Domain Exercise Dataset", released under the **Unlicense**
(public domain), itself derived from `wrkout/exercises.json`. Each registry entry
records the exact source file URL, so provenance can be checked line by line.

- Files are copied into `apps/web/public/exercise-media/<exercise-slug>.jpg`,
  served locally (no hotlinking, no runtime dependency on GitHub).
- Intrinsic sizes vary: 850×567, 850×569, 750×500, 1280×720. Each registry entry
  records its own `width`/`height`, so the box is reserved before decode.
- The UI crops to a 4:3 box with `object-fit: cover`; the originals are wider,
  so nothing important sits at the horizontal edges.
- Where the dataset ships two frames, the **working position** (`1.jpg`) is
  used, not the set-up frame: the set-up frame for a plank is a man kneeling,
  which is not a plank. `romanian_deadlift` is the one exception — its working
  frame is the hinge, which is `0.jpg`.
- Every shipped image was opened and checked against the exercise it is
  registered to before being wired up.

## How exercise media reaches the screen

```
exercise slug ──► mediaFor(slug) ──► ExerciseMedia ──► <img>          (asset registered)
                                                  └──► anatomy figure (no asset, or asset fails to load)
```

- Registry: `apps/web/src/exercise/media.ts` — keyed by **catalogue slug**
  (`detail.exercise.slug`), not the database UUID, so entries stay stable across
  environments.
- Component: `apps/web/src/components/ExerciseMedia.tsx` — fixed aspect box,
  `loading="lazy"`, `decoding="async"`, required `alt`, and an `onError`
  fallback to the anatomy figure so a missing file can never become a broken
  image box.
- Used by `ExerciseScreen`'s hero. The guide overlay still plays a catalogue
  video when `ExerciseDetail.media` carries an `active` video asset; none does
  today, so it shows the anatomy plus the FitCoach form guide.

## Adding or replacing an asset

1. Put the file under `apps/web/public/exercise-media/<exercise-slug>.jpg`
   (or reference an absolute, reviewed CDN URL).
2. Requirements: the correct movement and variation, the equipment that
   exercise actually uses, landscape orientation, at least 750px wide,
   consistent lighting and cropping with the rest of the set.
3. Add one entry to `EXERCISE_MEDIA` with `src`, `width`, `height`, `alt`
   (describe the position, not the file), `source` and `licence`.
4. `source`/`licence` are mandatory in the type: an asset without provenance
   must not ship.
5. Update this manifest.

Do **not** add generic fitness photography, a different variation of the
movement, an image whose licence you cannot state, or a photo of the same
movement with the wrong equipment. A wrong demonstration is worse than the
anatomy figure, which is always accurate about what the movement trains.

## Why 26 exercises have no photograph

These were checked against the dataset and deliberately left on the anatomy
figure rather than matched to a lookalike:

- **Tempo and pause variations** (`pause_bodyweight_squat`, `tempo_bodyweight_squat`,
  `long_pause_glute_bridge`, `pause_push_up`, `tempo_push_up`, `hollow_body_hold`).
  A still cannot show a tempo or a hold, and reusing the parent movement's photo
  would imply a demonstration that does not exist.
- **Equipment mismatch** (`cable_lateral_raise` — only a seated cable version
  exists; `machine_lateral_raise`; `assisted_pull_up` — the dataset has band
  assistance, this exercise is machine-assisted; `kettlebell_shrug` — no
  kettlebell shrug; `standing_calf_raise` — only machine/barbell versions; and
  `bodyweight_good_morning` — only a barbell good morning).
- **No matching entry at all** (`hip_abduction_machine`, `split_squat`,
  `reverse_lunge`, `forward_lunge`, `skater_squat`, `single_leg_bodyweight_rdl`,
  `hamstring_bridge`, `single_leg_calf_raise`, `bent_knee_calf_raise`,
  `knee_push_up`, `archer_push_up`, `pike_push_up`, `prone_y_raise`,
  `reverse_snow_angel`).

## Current inventory

| Group | Exercise slug | Name | Local asset | free-exercise-db id | Renders |
| --- | --- | --- | --- | --- | --- |
| Push | `barbell_bench_press` | Barbell bench press | `barbell_bench_press.jpg` | `Barbell_Bench_Press_-_Medium_Grip` | Photo |
| Push | `incline_dumbbell_press` | Incline dumbbell press | `incline_dumbbell_press.jpg` | `Incline_Dumbbell_Press` | Photo |
| Push | `machine_chest_press` | Machine chest press | `machine_chest_press.jpg` | `Machine_Bench_Press` | Photo |
| Push | `cable_fly` | Cable crossover | `cable_fly.jpg` | `Cable_Crossover` | Photo |
| Push | `push_up` | Push-up | `push_up.jpg` | `Pushups` | Photo |
| Push | `barbell_overhead_press` | Barbell overhead press | `barbell_overhead_press.jpg` | `Standing_Military_Press` | Photo |
| Push | `dumbbell_seated_shoulder_press` | Seated dumbbell shoulder press | `dumbbell_seated_shoulder_press.jpg` | `Dumbbell_Shoulder_Press` | Photo |
| Push | `dumbbell_lateral_raise` | Dumbbell lateral raise | `dumbbell_lateral_raise.jpg` | `Side_Lateral_Raise` | Photo |
| Push | `cable_lateral_raise` | Cable lateral raise | — | — | Anatomy figure |
| Push | `machine_lateral_raise` | Machine lateral raise | — | — | Anatomy figure |
| Push | `face_pull` | Cable face pull | `face_pull.jpg` | `Face_Pull` | Photo |
| Push | `bent_over_dumbbell_reverse_fly` | Bent-over dumbbell reverse fly | `bent_over_dumbbell_reverse_fly.jpg` | `Reverse_Flyes` | Photo |
| Pull | `lat_pulldown_wide_grip` | Wide-grip lat pulldown | `lat_pulldown_wide_grip.jpg` | `Wide-Grip_Lat_Pulldown` | Photo |
| Pull | `lat_pulldown_neutral_grip` | Neutral-grip lat pulldown | `lat_pulldown_neutral_grip.jpg` | `V-Bar_Pulldown` | Photo |
| Pull | `cable_pulldown_single_arm` | Single-arm cable pulldown | `cable_pulldown_single_arm.jpg` | `One_Arm_Lat_Pulldown` | Photo |
| Pull | `pull_up` | Pull-up | `pull_up.jpg` | `Pullups` | Photo |
| Pull | `assisted_pull_up` | Assisted pull-up | — | — | Anatomy figure |
| Pull | `barbell_bent_over_row` | Barbell bent-over row | `barbell_bent_over_row.jpg` | `Bent_Over_Barbell_Row` | Photo |
| Pull | `seated_cable_row` | Seated cable row | `seated_cable_row.jpg` | `Seated_Cable_Rows` | Photo |
| Pull | `chest_supported_dumbbell_row` | Chest-supported dumbbell row | `chest_supported_dumbbell_row.jpg` | `Dumbbell_Incline_Row` | Photo |
| Pull | `straight_arm_cable_pulldown` | Straight-arm cable pulldown | `straight_arm_cable_pulldown.jpg` | `Straight-Arm_Pulldown` | Photo |
| Pull | `kettlebell_shrug` | Kettlebell shrug | — | — | Anatomy figure |
| Arms | `barbell_curl` | Barbell curl | `barbell_curl.jpg` | `Barbell_Curl` | Photo |
| Arms | `incline_dumbbell_curl` | Incline dumbbell curl | `incline_dumbbell_curl.jpg` | `Incline_Dumbbell_Curl` | Photo |
| Arms | `preacher_curl` | Preacher curl | `preacher_curl.jpg` | `Preacher_Curl` | Photo |
| Arms | `spider_curl` | Spider curl | `spider_curl.jpg` | `Spider_Curl` | Photo |
| Arms | `hammer_curl` | Hammer curl | `hammer_curl.jpg` | `Hammer_Curls` | Photo |
| Arms | `cable_curl_underhand` | Underhand cable curl | `cable_curl_underhand.jpg` | `Standing_Biceps_Cable_Curl` | Photo |
| Arms | `close_grip_bench_press` | Close-grip bench press | `close_grip_bench_press.jpg` | `Close-Grip_Barbell_Bench_Press` | Photo |
| Arms | `skull_crusher_ez_bar` | EZ-bar skull crusher | `skull_crusher_ez_bar.jpg` | `EZ-Bar_Skullcrusher` | Photo |
| Arms | `overhead_cable_extension` | Overhead cable triceps extension | `overhead_cable_extension.jpg` | `Cable_Rope_Overhead_Triceps_Extension` | Photo |
| Arms | `cable_triceps_pushdown` | Cable triceps pushdown | `cable_triceps_pushdown.jpg` | `Triceps_Pushdown` | Photo |
| Legs & core | `barbell_back_squat` | Barbell back squat | `barbell_back_squat.jpg` | `Barbell_Squat` | Photo |
| Legs & core | `goblet_front_squat` | Goblet squat | `goblet_front_squat.jpg` | `Goblet_Squat` | Photo |
| Legs & core | `leg_press` | Leg press | `leg_press.jpg` | `Leg_Press` | Photo |
| Legs & core | `romanian_deadlift` | Romanian deadlift | `romanian_deadlift.jpg` | `Romanian_Deadlift` | Photo |
| Legs & core | `leg_extension` | Leg extension | `leg_extension.jpg` | `Leg_Extensions` | Photo |
| Legs & core | `lying_leg_curl` | Lying leg curl | `lying_leg_curl.jpg` | `Lying_Leg_Curls` | Photo |
| Legs & core | `hip_thrust` | Hip thrust | `hip_thrust.jpg` | `Barbell_Hip_Thrust` | Photo |
| Legs & core | `hip_abduction_machine` | Seated hip abduction | — | — | Anatomy figure |
| Legs & core | `standing_calf_raise` | Standing calf raise | — | — | Anatomy figure |
| Legs & core | `seated_calf_raise` | Seated calf raise | `seated_calf_raise.jpg` | `Seated_Calf_Raise` | Photo |
| Legs & core | `plank` | Plank | `plank.jpg` | `Plank` | Photo |
| Legs & core | `dead_bug` | Dead bug | `dead_bug.jpg` | `Dead_Bug` | Photo |
| Legs & core | `pallof_press` | Pallof press | `pallof_press.jpg` | `Pallof_Press` | Photo |
| Bodyweight | `bodyweight_squat` | Bodyweight squat | `bodyweight_squat.jpg` | `Bodyweight_Squat` | Photo |
| Bodyweight | `pause_bodyweight_squat` | Pause bodyweight squat | — | — | Anatomy figure |
| Bodyweight | `tempo_bodyweight_squat` | Tempo bodyweight squat | — | — | Anatomy figure |
| Bodyweight | `split_squat` | Split squat | — | — | Anatomy figure |
| Bodyweight | `reverse_lunge` | Reverse lunge | — | — | Anatomy figure |
| Bodyweight | `forward_lunge` | Forward lunge | — | — | Anatomy figure |
| Bodyweight | `walking_lunge` | Walking lunge | `walking_lunge.jpg` | `Bodyweight_Walking_Lunge` | Photo |
| Bodyweight | `skater_squat` | Skater squat | — | — | Anatomy figure |
| Bodyweight | `glute_bridge` | Glute bridge | `glute_bridge.jpg` | `Butt_Lift_Bridge` | Photo |
| Bodyweight | `long_pause_glute_bridge` | Long-pause glute bridge | — | — | Anatomy figure |
| Bodyweight | `single_leg_glute_bridge` | Single-leg glute bridge | `single_leg_glute_bridge.jpg` | `Single_Leg_Glute_Bridge` | Photo |
| Bodyweight | `bodyweight_good_morning` | Bodyweight good morning | — | — | Anatomy figure |
| Bodyweight | `single_leg_bodyweight_rdl` | Single-leg bodyweight Romanian deadlift | — | — | Anatomy figure |
| Bodyweight | `hamstring_bridge` | Hamstring bridge | — | — | Anatomy figure |
| Bodyweight | `single_leg_calf_raise` | Single-leg calf raise | — | — | Anatomy figure |
| Bodyweight | `bent_knee_calf_raise` | Bent-knee calf raise | — | — | Anatomy figure |
| Bodyweight | `knee_push_up` | Knee push-up | — | — | Anatomy figure |
| Bodyweight | `pause_push_up` | Pause push-up | — | — | Anatomy figure |
| Bodyweight | `tempo_push_up` | Tempo push-up | — | — | Anatomy figure |
| Bodyweight | `diamond_push_up` | Diamond push-up | `diamond_push_up.jpg` | `Push-Ups_-_Close_Triceps_Position` | Photo |
| Bodyweight | `archer_push_up` | Archer push-up | — | — | Anatomy figure |
| Bodyweight | `pike_push_up` | Pike push-up | — | — | Anatomy figure |
| Bodyweight | `prone_y_raise` | Prone Y raise | — | — | Anatomy figure |
| Bodyweight | `reverse_snow_angel` | Reverse snow angel | — | — | Anatomy figure |
| Bodyweight | `superman_hold` | Superman hold | `superman_hold.jpg` | `Superman` | Photo |
| Bodyweight | `side_plank` | Side plank | `side_plank.jpg` | `Side_Bridge` | Photo |
| Bodyweight | `reverse_crunch` | Reverse crunch | `reverse_crunch.jpg` | `Reverse_Crunch` | Photo |
| Bodyweight | `hollow_body_hold` | Hollow-body hold | — | — | Anatomy figure |

## Totals

| Group | Exercises | With photo | Fallback |
| --- | --- | --- | --- |
| Push | 12 | 10 | 2 |
| Pull | 10 | 8 | 2 |
| Arms | 10 | 10 | 0 |
| Legs & core | 13 | 11 | 2 |
| Bodyweight | 28 | 8 | 20 |
| **Total** | **73** | **47** | **26** |

Total shipped bytes: ~2.9 MB across 47 files (~62 KB per photograph).

## Verified by

`apps/web/src/__tests__/exercise-media.test.tsx` covers the asset path, the
anatomy fallback for an unregistered exercise, a registered exercise resolving
to its photograph, the load-error fallback, and the rule that every registry
entry carries alt text plus provenance.
