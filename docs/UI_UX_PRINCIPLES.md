# FitCoach UI/UX Principles

**Status:** Foundational design constitution  
**Product:** FitCoach  
**Scope:** Product UI, UX, interaction design, visual language, anatomy
system, training experience, and future connected domain experiences.

------------------------------------------------------------------------

## 1. Purpose

This document defines the core UI/UX principles for FitCoach.

It exists so future implementation does not drift toward generic
fitness-app patterns, design decisions remain connected across the
product, new screens can be evaluated against the same principles, and
the product can evolve without losing its identity.

This document is a **design constitution**, not a screen-by-screen
implementation specification.

------------------------------------------------------------------------

# 2. Core Product UI Philosophy

## 2.1 FitCoach must feel like one system

FitCoach must never feel like a collection of unrelated fitness screens.

The user should feel that Home, training, exercise detail, anatomy,
workout execution, set logging, instructional video, progress,
measurements, nutrition, activity, recovery, and coaching are all
different views of the **same understanding of the person**.

> **Every screen is another state of the same coaching system.**

## 2.2 The product is body-centric, not metric-centric

FitCoach should not primarily communicate through numbers, dashboards,
badges, or generic fitness statistics.

The hierarchy is:

**Body → Context → Action → Evidence → Raw data**

The user should understand:

1.  What part/system is relevant?
2.  Why does it matter?
3.  What should I do?
4.  Why does FitCoach recommend that?
5.  What are the underlying numbers?

------------------------------------------------------------------------

# 3. Visual Identity

## 3.1 Anatomy is the visual language

The human anatomical model is a core part of FitCoach’s identity. It is
not decorative imagery attached to exercise screens.

It should connect:

- exercise discovery;
- workout previews;
- exercise detail;
- workout execution;
- set logging;
- instructional videos;
- training reviews;
- progress;
- coaching;
- future physique experiences.

The anatomy system should make FitCoach recognizable even without the
logo.

## 3.2 Anatomy style

The reference direction is a realistic anatomical muscle illustration
like the provided reference.

Required characteristics:

- realistic human anatomy;
- clearly visible muscle structures;
- detailed muscle definition;
- neutral grayscale/low-saturation base;
- restrained presentation;
- clean enough for a premium product interface;
- no cartoon/anime treatment;
- no generic muscular fitness avatar;
- no gaming-style body rendering;
- no unnecessary decoration.

## 3.3 Target highlighting rule

### Hard rule

> **Only highlight the muscle or structure being trained.**

Everything else remains neutral.

If an exercise targets the lats, highlight the latissimus dorsi rather
than broadly coloring the entire back. If an exercise targets a specific
deltoid region, highlight that region while keeping unrelated anatomy
neutral.

## 3.4 Muscle-head specificity

FitCoach should communicate meaningful anatomical specificity.

For example, when relevant:

- Biceps — long head
- Biceps — short head

Do not simply say “biceps” when the training knowledge can responsibly
communicate a specific head emphasis.

The same principle applies to other muscles where meaningful heads,
regions, or structures are represented.

Distinguish primary, secondary, supporting, stabilizing, and
emphasis/bias relationships where the underlying training knowledge
provides them.

Do not turn an emphasis/bias relationship into an isolation claim.

------------------------------------------------------------------------

# 4. TargetMap Is the Source of Visual Targeting

The frontend must not independently decide which muscles to highlight.

Architecture:

**Exercise knowledge → TargetMap → Anatomy renderer → UI**

The anatomy visualization is a rendering of structured domain knowledge.

The UI must not invent target muscles, muscle heads, exercise
relationships, emphasis, substitutions, or anatomical claims.

------------------------------------------------------------------------

# 5. Anatomy Views

The initial anatomy system supports:

- **Front**
- **Back**
- **Side**

The initial implementation does not require freely rotatable 3D anatomy.

3D rotation can be considered later if assets, performance, and product
value justify it.

Priorities are:

- clarity;
- consistency;
- performance;
- reliable target rendering;
- correct muscle identification.

------------------------------------------------------------------------

# 6. Anatomy Must Persist Across the Experience

The target visualization should remain consistent across the exercise
journey.

Examples:

- Exercise discovery → target highlighted.
- Exercise detail → same target.
- Workout preview → relevant trained muscles.
- Logging mode → anatomy remains visible.
- Guide video → same target anatomy as an overlay.
- Review/progress → same visual language.
- Coaching → same anatomy system when relevant.

> **The target muscle representation should not change merely because
> the user changed screens.**

------------------------------------------------------------------------

# 7. Exercise Information Hierarchy

The exercise experience should communicate information in this order:

1.  Anatomical model
2.  Exercise name
3.  Target muscle/structure
4.  Relevant head/region/emphasis
5.  Concise important focus
6.  Expandable details
7.  Start action

**Anatomy → Exercise → Target → Specific focus → Details → Start**

Do not lead with a wall of metadata.

------------------------------------------------------------------------

# 8. Exercise Detail vs Performance Mode

FitCoach intentionally separates:

### Understand

Before starting:

- anatomy;
- exercise name;
- target;
- important anatomical focus;
- concise explanation;
- expandable full details;
- guide access;
- Start action.

### Perform

After pressing **Start**, the interface becomes a dedicated
performance/logging mode.

> **Understand → Start → Perform → Record**

The user should not have to repeatedly read information they already
received.

------------------------------------------------------------------------

# 9. Workout Logging Philosophy

Workout logging is intentionally **extremely minimal**.

The user is in the gym and should not feel like they are filling out a
form.

The primary task is:

> **Record the actual set with as little friction as possible.**

## 9.1 Logging mode

Once the user enters logging/performance mode:

- keep anatomy visible;
- remove repeated exercise explanations;
- remove unnecessary metadata;
- remove motivational noise;
- remove generic dashboard content;
- focus on the current movement and set recording.

Conceptually:

**Anatomy → Exercise name → +**

Tap `+` to add a set.

## 9.2 Set entry

Primary set inputs:

- weight/load where applicable;
- repetitions;
- failure option.

Additional performance dimensions such as RIR/RPE can exist underneath
and be surfaced when useful, but should not clutter primary logging.

Respect the distinction between loaded, bodyweight, and assisted
exercises. Never imply external load where none exists.

## 9.3 Logged set presentation

Logged sets should remain compact.

Example:

``` text
60 kg × 10
60 kg × 9 · Failure

+
```

The user should be able to continue adding sets immediately.

The interface should feel like a **training instrument**, not a
spreadsheet.

------------------------------------------------------------------------

# 10. Workout Logging Must Not Become a Dashboard

During actual training, do not prioritize:

- calories burned;
- workout score;
- completion percentage;
- badges;
- streak pressure;
- motivational slogans;
- large duration counters;
- generic “great job” messages;
- repeated explanations.

Training execution should be calm and focused.

------------------------------------------------------------------------

# 11. Guide Video

Instructional video is **optional assistance**, not the default
experience.

A user who already understands an exercise should be able to:

**See anatomy → Start → Log**

A user who needs help should be able to access the guide immediately.

## 11.1 Video entry

The anatomy is an entry point to the guide:

**Tap anatomy → premium transition → full-screen guide video**

## 11.2 Video presentation

The guide video opens **full screen**.

The transition should feel intentional and premium, with anatomy/target
acting as the visual bridge between exercise detail and guide video.

## 11.3 Video content

Preferred guide:

> **Real human demonstration + anatomical target overlay**

The human demonstrates the actual movement while the same target
muscle/structure remains visually represented.

The video must not become a disconnected stock clip.

## 11.4 Video consistency

The anatomical overlay in video must use the same target information as
the rest of FitCoach.

**TargetMap → anatomy visualization → video overlay**

Do not create a separate muscle-targeting system for video.

------------------------------------------------------------------------

# 12. Video Return Behavior

Closing the guide must return the user to the exact state they left.

Example:

**Exercise → Start → Logging → Guide → Logging**

not:

**Exercise → Start → Logging → Guide → generic exercise page**

------------------------------------------------------------------------

# 13. Motion Language

Motion should be **subtle and purposeful**.

Motion exists to communicate relationships and state changes, not merely
to look impressive.

Appropriate motion:

- anatomy → guide video;
- exercise detail → performance mode;
- summary → expanded detail;
- `+` → new set;
- completed set → next interaction;
- muscle target → another target;
- Home priority changing;
- returning from video to the previous state.

Avoid:

- bouncing UI;
- excessive spring effects;
- confetti;
- gamified celebration;
- aggressive parallax;
- constant moving anatomy;
- distracting looping animation.

------------------------------------------------------------------------

# 14. Home Experience

The Home screen is **not a conventional dashboard**.

It should answer:

> **What does FitCoach think matters to me right now?**

## 14.1 Adaptive Home

Home may prioritize different information depending on what matters.

Examples:

### Training day

Show today’s training, relevant anatomy, important training context, and
action.

### Progression issue

Bring the progression issue forward.

### Nutrition issue

Bring the relevant nutrition state forward.

### Recovery limitation

Bring recovery context forward.

### No meaningful issue

Do not invent one. Communicate that the user is on track and no change
is recommended.

## 14.2 Home anatomy prominence

Anatomy has **medium prominence** on Home.

It should establish FitCoach identity without dominating the entire
screen.

## 14.3 Home should be priority-driven

The UI should be able to consume structured prioritized content.

Eventually:

**Training + Nutrition + Activity + Recovery + Body + Goal + History →
Priority → Home**

Phase 4 does not need the complete Unified FitCoach Brain, but the UI
should not be architected around a permanently fixed set of dashboard
cards.

------------------------------------------------------------------------

# 15. Coaching Communication Hierarchy

FitCoach has three communication levels.

## Level 1 — Quiet

Normal information.

> Training is progressing as expected.

## Level 2 — Meaningful insight

Something deserves attention.

> **Your pressing progress has slowed**

Then provide concise context and a review action.

## Level 3 — Intervention

An actual change is recommended.

> **Your training needs an adjustment**

Clearly communicate what changed, why, evidence, and recommended action.

## 15.1 `no_change` is valid

> **No change recommended.**

This is a real coaching outcome. Do not manufacture recommendations.

------------------------------------------------------------------------

# 16. Card Philosophy

FitCoach uses a **hybrid layout**.

It is not a card-heavy dashboard.

Primary structure comes from:

- whitespace;
- typography;
- anatomy;
- section hierarchy;
- spatial relationships.

Cards are used only when they genuinely improve organization or
separation.

Avoid making the UI a stack of bordered cards.

------------------------------------------------------------------------

# 17. Typography

Typography is **balanced between technical precision and
premium/editorial hierarchy**.

Use:

- stronger typography for major states;
- clear hierarchy for exercise names;
- compact typography for training data;
- quieter typography for supporting information;
- highly legible controls.

Avoid:

- giant typography everywhere;
- overly technical text everywhere;
- excessive uppercase;
- decorative typography.

Hierarchy:

**Meaning → Action → Supporting detail → Raw data**

------------------------------------------------------------------------

# 18. Spacing and Density

FitCoach uses **balanced density**.

There should be enough whitespace to feel premium without wasting the
user’s time or forcing unnecessary scrolling.

Target:

> **Fast to understand → fast to interact → never visually crowded.**

Especially during training.

------------------------------------------------------------------------

# 19. Themes

## 19.1 Device-controlled themes only

FitCoach follows the user’s phone/device appearance.

- Device Light → FitCoach Light.
- Device Dark → FitCoach Dark.
- Device changes → FitCoach follows.

## 19.2 No in-app theme selector

Do not provide a separate Light/Dark/System setting.

## 19.3 Light and Dark are both first-class designs

Dark mode must not simply be an inverted Light theme.

Light direction:

- clean neutral background;
- near-black primary text;
- subtle hierarchy;
- restrained borders;
- quiet anatomical base;
- clear target highlighting.

Dark direction:

- deep charcoal/near-black surfaces;
- carefully elevated surfaces;
- soft text hierarchy;
- restrained borders;
- quiet anatomical base;
- clear target highlighting.

Avoid a neon/gaming fitness aesthetic.

------------------------------------------------------------------------

# 20. Accent Color

The exact FitCoach accent color is intentionally **not decided yet**.

Define a semantic accent token first.

The eventual accent must work for:

- anatomy target highlighting;
- active states;
- controls;
- selected states;
- progression;
- important interactions;
- video transitions;
- Light;
- Dark.

Do not choose a color merely because it is fashionable.

------------------------------------------------------------------------

# 21. Generic Fitness-App Patterns to Avoid

Avoid dependence on:

- generic stock workout photos;
- random muscular people as decoration;
- calorie-burn estimates as a headline;
- workout duration as a headline;
- streak pressure;
- badges;
- excessive gamification;
- giant progress rings everywhere;
- generic motivational slogans;
- card grids for everything;
- excessive gradients;
- neon fitness colors;
- unnecessary shadows;
- excessive borders;
- cluttered forms;
- repetitive metadata;
- artificial precision.

FitCoach’s identity should come from:

**Anatomy + intelligence + context + restraint.**

------------------------------------------------------------------------

# 22. Human Imagery

Human imagery is allowed when it serves a clear purpose, especially:

- exercise demonstration;
- form instruction;
- movement education;
- future computer-vision/form feedback.

Avoid generic stock fitness photography used only as decoration.

Human imagery should remain visually connected to the FitCoach anatomy
system where appropriate.

------------------------------------------------------------------------

# 23. Information Principles

Before displaying a metric, ask:

1.  Does the user need this now?
2.  Does it change a decision?
3.  Does it explain something?
4.  Does it help execute the current task?
5.  Is the precision justified?

If not, it should not dominate the UI.

------------------------------------------------------------------------

# 24. No Fake Precision

The UI must not imply certainty that the underlying system does not
have.

Do not:

- make calorie burn a precise-looking headline;
- claim exercise equivalence when the engine only supports partial
  substitution;
- imply a muscle is isolated when the knowledge model describes
  emphasis/bias;
- present uncertain physique projections as guaranteed outcomes.

Visual polish must never turn uncertainty into false confidence.

------------------------------------------------------------------------

# 25. Domain Logic vs UI

The UI is a renderer and interaction layer.

It should not become a second fitness engine.

The frontend should consume structured outputs for:

- exercise selection;
- TargetMap;
- muscle relationships;
- substitutions;
- training decisions;
- progression;
- plan changes;
- coaching states.

The frontend should not independently calculate fitness facts merely to
render a screen.

------------------------------------------------------------------------

# 26. Summary → Detail Interaction

A compact summary can expand into deeper contextual review.

The detail view should answer:

1.  What is this?
2.  Why does it matter?
3.  What evidence/context produced it?
4.  What should I do?
5.  What happens if something changes?

The detail view should not simply dump more data.

------------------------------------------------------------------------

# 27. Training Experience Principle

The training journey should feel like:

> **Understand → Start → Perform → Record → Review → Adapt**

When understanding is needed, show context.

When performing, remove distractions.

When recording, minimize interaction.

When reviewing, surface meaning.

When adapting, explain the decision.

------------------------------------------------------------------------

# 28. Workout Execution Principle

During actual exercise execution:

### The app should be quiet.

The user’s attention belongs to the movement.

The UI should:

- minimize reading;
- minimize navigation;
- minimize decisions;
- preserve exercise context;
- make set entry fast;
- make the next action obvious.

------------------------------------------------------------------------

# 29. Anatomy and Video Principle

The anatomy model and instructional video are one connected system.

The relationship is:

**Anatomy → target → human movement → anatomical overlay → user performs
movement**

This is a core FitCoach interaction pattern.

------------------------------------------------------------------------

# 30. Future Domain Consistency

The same principles extend beyond training.

## Nutrition

Same contextual hierarchy, restrained presentation, summary → detail,
evidence → action, adaptive Home priority.

## Activity

Same system.

## Body measurements

Same system.

## Recovery

Same system.

## Physique

Same anatomy foundation.

## Coaching

Same context → evidence → action hierarchy.

The product should grow horizontally without visually fragmenting.

------------------------------------------------------------------------

# 31. Accessibility and Clarity

Premium does not mean difficult to read.

Maintain:

- strong text contrast;
- clear interactive states;
- readable typography;
- sufficiently large touch targets;
- predictable navigation;
- meaningful labels;
- non-color-only communication when color carries important meaning.

Target muscle highlighting should be supported by appropriate
labels/structure information where needed.

------------------------------------------------------------------------

# 32. Mobile-First, Responsive by Design

The primary interaction is mobile.

Design around:

- one-handed interaction where practical;
- thumb-friendly controls;
- minimal gym-time typing;
- clear touch targets;
- fast transitions.

Desktop is a responsive expansion of the same system, not a separate
product.

------------------------------------------------------------------------

# 33. What Phase 4 Should Not Do

Do not prematurely implement:

- nutrition intelligence;
- full food database;
- unified cross-domain decision engine;
- sleep/recovery intelligence;
- physique projection;
- computer vision;
- Health Connect;
- Apple Health;
- wearable integrations;
- barcode scanning;
- food photo analysis;
- advanced 3D physique rendering;
- conversational AI coach.

Architect for future integration, but keep Phase 4 focused on the core
training product experience.

------------------------------------------------------------------------

# 34. Phase 4 Core Product Loop

**Onboarding**  
→ understand body/goal/equipment

**Training context**  
→ show personalized plan

**Today’s workout**  
→ show relevant anatomy and exercises

**Exercise detail**  
→ understand target and purpose

**Start**  
→ enter performance mode

**Log**  
→ quickly record actual sets

**Guide**  
→ optional full-screen human demonstration + anatomy overlay

**Review**  
→ understand performance

**Progression**  
→ receive deterministic progression guidance

**Adaptation**  
→ reflect plan changes when justified

This should feel like one continuous experience.

------------------------------------------------------------------------

# 35. Design Review Checklist

Before accepting a UI component:

### Identity

- Does this feel unmistakably like FitCoach?
- Is it consistent with the anatomy-first visual language?

### Context

- Does the user understand why this information is here?
- Is the most important information visually prioritized?

### Anatomy

- If a target muscle is relevant, is the correct structure shown?
- Are only appropriate trained structures highlighted?
- Does visualization agree with TargetMap?

### Interaction

- Is the action obvious?
- Is there unnecessary friction?
- Does this add cognitive load during training?

### Information

- Is this metric actually useful?
- Is precision justified?
- Are we showing data because it matters, or because we have it?

### Visual quality

- Does it work in both device-controlled themes?
- Is it premium without becoming decorative?
- Is spacing balanced?
- Are cards actually necessary?

### Motion

- Does animation explain a relationship or state change?
- Could motion distract during training?

### Scientific honesty

- Does the UI imply anything the domain engine does not support?
- Are emphasis, assistance, substitution, and equivalence represented
  accurately?

### Future consistency

- Can this pattern be reused across nutrition, activity, body, recovery,
  and coaching?

------------------------------------------------------------------------

# 36. Non-Negotiable Principles

1.  **FitCoach must feel like one connected system.**
2.  **Anatomy is a core visual language, not decoration.**
3.  **Only the trained target muscle/structure is highlighted.**
4.  **Meaningful muscle-head specificity should be communicated.**
5.  **TargetMap is the source of anatomical targeting.**
6.  **Exercise understanding happens before performance mode.**
7.  **Workout logging must be extremely minimal.**
8.  **During training, the UI gets out of the user’s way.**
9.  **Guide video is optional and full-screen.**
10. **Guide video uses human demonstration + the same anatomical target
    overlay.**
11. **Anatomy → video transitions should feel intentional and premium.**
12. **Home is adaptive, not a fixed metric dashboard.**
13. **`no_change` is a valid and meaningful outcome.**
14. **Information hierarchy is context → action → evidence → raw data.**
15. **Generic fitness-app visual patterns should be avoided.**
16. **Light/dark follows the user’s device; no in-app theme selector.**
17. **Light and Dark are both deliberately designed.**
18. **Motion is subtle and purposeful.**
19. **Cards are used selectively, not as the entire visual system.**
20. **The UI must never manufacture scientific certainty.**
21. **The frontend does not become a second fitness engine.**
22. **Every new domain must feel like it belongs to the same FitCoach
    system.**

------------------------------------------------------------------------

# 37. Product Identity in One Sentence

> **FitCoach is a calm, premium, anatomy-centered adaptive coaching
> system where the body provides the visual language, evidence provides
> the intelligence, and the interface gets out of the user’s way when it
> is time to act.**

------------------------------------------------------------------------

# 38. Short Design Test

If the FitCoach logo were removed from a screen, the screen should still
feel recognizable as FitCoach because of:

**Anatomy + target highlighting + restrained hierarchy + purposeful
motion + contextual intelligence + minimal interaction.**

If it looks like a generic fitness app without the logo, the design has
failed.
