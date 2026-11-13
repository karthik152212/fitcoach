import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { newClientRequestId } from "../api/client";
import * as endpoints from "../api/endpoints";
import { useAsync } from "../api/hooks";
import type { EquipmentItem, GoalKind, TrainingEnvironmentKind } from "../api/types";
import { Button, StateBlock } from "../components/controls";
import { useSession } from "../session/SessionContext";

/**
 * Onboarding: a progressive interview, not a form.
 * FitCoach learns the person step by step — body, training, goal,
 * environment, equipment — then the engine builds the first plan.
 */

type Step =
  | { key: "welcome" }
  | { key: "body" }
  | { key: "training" }
  | { key: "goal" }
  | { key: "environment" }
  | { key: "equipment" }
  | { key: "building" };

const GOAL_OPTIONS: { kind: GoalKind; title: string; body: string }[] = [
  { kind: "bodybuilding", title: "Build muscle", body: "Maximum hypertrophy focus." },
  { kind: "aesthetics_v_taper", title: "Aesthetics / V-taper", body: "Shape, proportion and shoulder-to-waist lines." },
  { kind: "lean_recomposition", title: "Recomposition", body: "Build muscle while staying lean." },
  { kind: "athletic_performance", title: "Athletic", body: "Power, movement quality and performance." },
  { kind: "max_strength", title: "Strength", body: "Heavier lifting, lower rep ranges." },
  { kind: "general_fitness", title: "General fitness", body: "Balanced, sustainable training." },
];

const ENVIRONMENT_OPTIONS: { kind: TrainingEnvironmentKind; title: string; body: string }[] = [
  { kind: "gym", title: "Gym", body: "Full equipment universe." },
  { kind: "home", title: "Home", body: "Whatever you have at home." },
  { kind: "home_no_equipment", title: "Home — no equipment", body: "Just your body and the floor." },
];

const EXPERIENCE_OPTIONS = [
  { value: "untrained", title: "New to training" },
  { value: "beginner", title: "Beginner" },
  { value: "intermediate", title: "Intermediate" },
  { value: "advanced", title: "Advanced" },
] as const;

/** Progressive equipment interview groups (never one giant checklist). */
const EQUIPMENT_STAGES: { title: string; body: string; slugs: string[] }[] = [
  {
    title: "Free weights",
    body: "Anything you can pick up and load.",
    slugs: ["dumbbells", "kettlebell", "ez_bar"],
  },
  {
    title: "Barbell, bench and rack",
    body: "The classic lifting setup.",
    slugs: ["barbell", "adjustable_bench", "squat_rack", "smith_machine"],
  },
  {
    title: "Bodyweight anchors",
    body: "Bars and bands for bodyweight work.",
    slugs: ["pull_up_bar", "resistance_bands"],
  },
  {
    title: "Machines and cables",
    body: "Guided and cable stations.",
    slugs: [
      "cable_machine",
      "lat_pulldown_machine",
      "chest_press_machine",
      "pec_deck",
      "lateral_raise_machine",
      "leg_press",
      "leg_extension_machine",
      "leg_curl_machine",
      "hip_abduction_machine",
      "calf_raise_machine",
      "assisted_pull_up_machine",
    ],
  },
];

export interface InterviewAnswers {
  email: string;
  heightCm: number;
  weightKg: number | null;
  days: number;
  sessionMinutes: number;
}

/**
 * Step-local validation, kept pure so the rules can be tested directly.
 * Nothing reaches the engine until the answers describe a real person and a
 * real week; the server is not a form validator.
 */
export function validateInterviewStep(key: Step["key"], answers: InterviewAnswers): string | null {
  if (key === "welcome") {
    const candidate = answers.email.trim();
    if (candidate && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
      return "That email doesn't look complete. Check it, or leave it empty — it is optional on this device.";
    }
    return null;
  }
  if (key === "body") {
    if (!Number.isFinite(answers.heightCm) || answers.heightCm < 120 || answers.heightCm > 230) {
      return "Height needs to be between 120 and 230 cm.";
    }
    if (
      answers.weightKg !== null &&
      (!Number.isFinite(answers.weightKg) || answers.weightKg < 30 || answers.weightKg > 300)
    ) {
      return "Body weight needs to be between 30 and 300 kg, or left empty.";
    }
    return null;
  }
  if (key === "training") {
    if (!Number.isFinite(answers.days) || answers.days < 1 || answers.days > 7) {
      return "Training days need to be between 1 and 7.";
    }
    if (
      !Number.isFinite(answers.sessionMinutes) ||
      answers.sessionMinutes < 20 ||
      answers.sessionMinutes > 150
    ) {
      return "Sessions need to be between 20 and 150 minutes.";
    }
    return null;
  }
  return null;
}

/**
 * Engine infeasibility reasons arrive as `code: sentence`. The sentence stays
 * verbatim (it is the engine's own account); the internal code is dropped, and
 * the sentence is capitalised so it reads as product copy.
 */
export function plainReasons(reasons: readonly string[] | undefined): string {
  const sentences = (reasons ?? [])
    .map((reason) => reason.replace(/^[a-z][a-z0-9_]*:\s*/, "").trim())
    .filter((reason) => reason.length > 0);
  if (sentences.length === 0) return "The week could not be staffed with these constraints.";
  return sentences
    .map((sentence) => sentence[0]!.toUpperCase() + sentence.slice(1))
    .join(" ");
}

export function OnboardingScreen() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Step-local validation: the engine is only asked once the answers make
  // sense, so an invalid height or email never becomes a build failure.
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [infeasible, setInfeasible] = useState(false);
  const [busy, setBusy] = useState(false);
  // Retrying must not create a second user: the interview's answers stay put
  // and the engine is simply asked again with a changed constraint.
  const [createdUserId, setCreatedUserId] = useState<string | null>(null);
  const [provisioned, setProvisioned] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [heightCm, setHeightCm] = useState(178);
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [experience, setExperience] = useState<(typeof EXPERIENCE_OPTIONS)[number]["value"]>("beginner");
  const [days, setDays] = useState(3);
  const [sessionMinutes, setSessionMinutes] = useState(60);
  const [goal, setGoal] = useState<GoalKind>("general_fitness");
  const [environment, setEnvironment] = useState<TrainingEnvironmentKind>("gym");
  const [equipmentIds, setEquipmentIds] = useState<Set<string>>(new Set());
  const [stageIndex, setStageIndex] = useState(0);

  const catalogState = useAsync(() => endpoints.getEquipmentCatalog(), []);

  // "Gym" means the full equipment universe. The planner works from recorded
  // equipment rows, so a gym answer must record them — otherwise the engine
  // quietly builds a bodyweight-only week for someone standing in a gym.
  const equipmentTouched = useRef(false);
  useEffect(() => {
    if (environment !== "gym" || equipmentTouched.current) return;
    if (catalogState.status !== "ready") return;
    const all = catalogState.data.equipment.map((item) => item.id);
    setEquipmentIds(new Set(all));
  }, [environment, catalogState.status, catalogState.status === "ready" ? catalogState.data.equipment : null]);
  const steps: Step[] = useMemo(
    () => [
      { key: "welcome" },
      { key: "body" },
      { key: "training" },
      { key: "goal" },
      { key: "environment" },
      ...(environment === "home_no_equipment" ? [] : [{ key: "equipment" } as Step]),
      { key: "building" },
    ],
    [environment],
  );
  const step = steps[Math.min(stepIndex, steps.length - 1)]!;

  const toggleEquipment = (id: string) => {
    equipmentTouched.current = true;
    setEquipmentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const finish = async (overrideDays?: number) => {
    const trainingDays = overrideDays ?? days;
    setBusy(true);
    setError(null);
    setInfeasible(false);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const today = new Date().toISOString().slice(0, 10);
      let userId = createdUserId;
      if (!userId) {
        const { user } = await endpoints.createUser({
          email: email.trim() || `fitcoach-${newClientRequestId().slice(0, 8)}@local.fitcoach`,
          displayName: displayName.trim() || "FitCoach athlete",
          timezone,
        });
        userId = user.id;
        setCreatedUserId(user.id);
      }
      // The profile always reflects the latest answers, so re-running the
      // build after changing a constraint records what the user actually chose.
      await endpoints.putProfile(userId, {
        heightCm,
        trainingExperience: experience,
        trainingDaysPerWeek: trainingDays,
        sessionDurationMinutes: sessionMinutes,
        unitSystem: "metric",
        revisionReason: "onboarding",
      });
      if (!provisioned) {
        if (weightKg !== null) {
          // The result is not shown back here, but a failed measurement must
          // surface: an unrecorded weight makes the first plan's sizing wrong.
          await endpoints.recordMeasurement(userId, {
            bodyWeightKg: weightKg,
            recordedAt: new Date().toISOString(),
            enteredVia: "manual",
            externalId: `onboarding-${newClientRequestId()}`,
          });
        }
        await endpoints.createGoal(userId, { kind: goal, effectiveFrom: today });
        if (environment !== "gym") {
          await endpoints.setEnvironment(userId, {
            kind: environment,
            effectiveFrom: today,
            reason: "onboarding",
          });
        }
        for (const equipmentId of equipmentIds) {
          await endpoints.addUserEquipment(userId, equipmentId, today);
        }
        setProvisioned(true);
      }
      const generated = await endpoints.generatePlan(userId, {
        asOf: today,
        goalKind: goal,
        availableTrainingDays: trainingDays,
        maxSessionDurationMinutes: sessionMinutes,
        experience,
      });
      if (generated.feasibility === "infeasible") {
        // A modelled engine outcome, not a crash: keep every answer and offer
        // the smallest change that can make the week buildable.
        setInfeasible(true);
        setError(plainReasons(generated.infeasibilityReasons));
        return;
      }
      signIn(userId);
      navigate("/", { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong. Retry in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const adjustDays = (next: number) => {
    setDays(next);
    setFieldError(null);
    setError(null);
    setInfeasible(false);
  };

  const validateStep = (): string | null =>
    validateInterviewStep(step.key, { email, heightCm, weightKg, days, sessionMinutes });

  const next = () => {
    if (step.key === "building") {
      void finish();
      return;
    }
    // An unreadable catalogue must not silently become "no equipment": the
    // engine would then plan a bodyweight-only week for someone in a gym.
    if (step.key === "equipment" && catalogState.status !== "ready") {
      setFieldError(
        catalogState.status === "loading"
          ? "The equipment list is still loading."
          : "The equipment list did not load, so your answer would be incomplete. Use Try again.",
      );
      return;
    }
    const problem = validateStep();
    if (problem) {
      setFieldError(problem);
      return;
    }
    setFieldError(null);
    if (step.key === "equipment" && stageIndex < EQUIPMENT_STAGES.length - 1) {
      setStageIndex((i) => i + 1);
      return;
    }
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  };
  const back = () => {
    setFieldError(null);
    if (step.key === "equipment" && stageIndex > 0) {
      setStageIndex((i) => i - 1);
      return;
    }
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const catalog: EquipmentItem[] = catalogState.status === "ready" ? catalogState.data.equipment : [];
  const stage = EQUIPMENT_STAGES[stageIndex]!;
  const progress = (stepIndex + 1) / steps.length;

  return (
    <div className="fc-screen fc-onboarding">
      <div
        className="fc-onboarding__progress"
        role="progressbar"
        aria-label="Setup progress"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${progress * 100}%` }} />
      </div>

      {error ? (
        <section className="fc-onboarding__step motion-rise" aria-labelledby="ob-error">
          <h1 className="t-title" id="ob-error">
            {infeasible ? "This week doesn't fit yet" : "FitCoach could not finish setup"}
          </h1>
          <p className="t-body t-secondary fc-measure" role="alert">
            {error}
          </p>
          <p className="t-small t-muted">
            {infeasible
              ? "Your answers are kept. A smaller week is usually the honest fix — the engine will not pad it with work it cannot justify."
              : "Your answers are kept, so nothing needs re-entering."}
          </p>
          <div className="fc-onboarding__erroractions">
            {infeasible && days > 1 ? (
              <Button
                disabled={busy}
                onClick={() => {
                  adjustDays(days - 1);
                  void finish(days - 1);
                }}
              >
                Try {days - 1} day{days - 1 === 1 ? "" : "s"}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => {
                setError(null);
                setInfeasible(false);
                setStepIndex(steps.findIndex((item) => item.key === "training"));
              }}
            >
              Change my answers
            </Button>
            <Button variant="quiet" disabled={busy} onClick={() => void finish()}>
              {busy ? "Building…" : "Retry"}
            </Button>
          </div>
        </section>
      ) : null}

      {!error && step.key === "welcome" ? (
        <section className="fc-onboarding__step motion-rise" aria-labelledby="ob-welcome">
          <p className="t-caption t-muted">FitCoach</p>
          <h1 className="t-display" id="ob-welcome">
            Training that understands your body.
          </h1>
          <p className="t-body t-secondary fc-measure">
            A calm, anatomy-first coach. It learns how you train, builds your week, and adapts when
            life changes — honestly, never with fake promises.
          </p>
          <label className="fc-field">
            <span className="fc-field__label">What should FitCoach call you?</span>
            <input className="fc-field__input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" autoComplete="name" />
          </label>
          <label className="fc-field">
            <span className="fc-field__label">Email <span className="t-muted">(optional on this device)</span></span>
            <input className="fc-field__input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          </label>
        </section>
      ) : null}

      {!error && step.key === "body" ? (
        <section className="fc-onboarding__step motion-rise" aria-labelledby="ob-body">
          <h1 className="t-title" id="ob-body">Your body</h1>
          <p className="t-body t-secondary">FitCoach uses this to size your training, not to judge it.</p>
          <label className="fc-field">
            <span className="fc-field__label">Height</span>
            <span className="fc-field__inline">
              <input className="fc-field__input" type="number" inputMode="numeric" min={120} max={230} value={heightCm} onChange={(e) => setHeightCm(Number(e.target.value))} />
              <span className="t-muted">cm</span>
            </span>
          </label>
          <label className="fc-field">
            <span className="fc-field__label">Body weight <span className="t-muted">(optional)</span></span>
            <span className="fc-field__inline">
              <input
                className="fc-field__input"
                type="number"
                inputMode="decimal"
                min={30}
                max={300}
                value={weightKg ?? ""}
                placeholder="—"
                onChange={(e) => setWeightKg(e.target.value === "" ? null : Number(e.target.value))}
              />
              <span className="t-muted">kg</span>
            </span>
          </label>
        </section>
      ) : null}

      {!error && step.key === "training" ? (
        <section className="fc-onboarding__step motion-rise" aria-labelledby="ob-training">
          <h1 className="t-title" id="ob-training">Your training</h1>
          <div className="fc-choice-grid" role="radiogroup" aria-label="Training experience">
            {EXPERIENCE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={experience === option.value}
                className={`fc-choice${experience === option.value ? " is-selected" : ""}`}
                onClick={() => setExperience(option.value)}
              >
                {option.title}
              </button>
            ))}
          </div>
          <label className="fc-field">
            <span className="fc-field__label">Days per week you can train</span>
            <span className="fc-field__inline">
              <input className="fc-field__input" type="number" inputMode="numeric" min={1} max={7} value={days} onChange={(e) => setDays(Math.max(1, Math.min(7, Number(e.target.value))))} />
              <span className="t-muted">days</span>
            </span>
          </label>
          <label className="fc-field">
            <span className="fc-field__label">Time per session</span>
            <span className="fc-field__inline">
              <input className="fc-field__input" type="number" inputMode="numeric" min={20} max={150} step={5} value={sessionMinutes} onChange={(e) => setSessionMinutes(Number(e.target.value))} />
              <span className="t-muted">min</span>
            </span>
          </label>
        </section>
      ) : null}

      {!error && step.key === "goal" ? (
        <section className="fc-onboarding__step motion-rise" aria-labelledby="ob-goal">
          <h1 className="t-title" id="ob-goal">What are you training for?</h1>
          <div className="fc-choice-grid fc-choice-grid--stack" role="radiogroup" aria-label="Goal">
            {GOAL_OPTIONS.map((option) => (
              <button
                key={option.kind}
                type="button"
                role="radio"
                aria-checked={goal === option.kind}
                className={`fc-choice fc-choice--rich${goal === option.kind ? " is-selected" : ""}`}
                onClick={() => setGoal(option.kind)}
              >
                <span className="fc-choice__title">{option.title}</span>
                <span className="fc-choice__body">{option.body}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {!error && step.key === "environment" ? (
        <section className="fc-onboarding__step motion-rise" aria-labelledby="ob-env">
          <h1 className="t-title" id="ob-env">Where do you train?</h1>
          <div className="fc-choice-grid fc-choice-grid--stack" role="radiogroup" aria-label="Training environment">
            {ENVIRONMENT_OPTIONS.map((option) => (
              <button
                key={option.kind}
                type="button"
                role="radio"
                aria-checked={environment === option.kind}
                className={`fc-choice fc-choice--rich${environment === option.kind ? " is-selected" : ""}`}
                onClick={() => setEnvironment(option.kind)}
              >
                <span className="fc-choice__title">{option.title}</span>
                <span className="fc-choice__body">{option.body}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {!error && step.key === "equipment" ? (
        <section className="fc-onboarding__step motion-rise" aria-labelledby="ob-equip">
          <p className="t-caption t-muted">
            Equipment · {stageIndex + 1} of {EQUIPMENT_STAGES.length}
          </p>
          <h1 className="t-title" id="ob-equip">{stage.title}</h1>
          <p className="t-body t-secondary">{stage.body}</p>
          {catalogState.status === "loading" ? <StateBlock kind="loading" title="Loading equipment" /> : null}
          {catalogState.status === "error" ? (
            <StateBlock
              kind="error"
              title="Couldn't load the equipment list"
              body="FitCoach can't read the catalogue right now. Continuing without it would quietly plan a bodyweight-only week, so nothing is submitted until the list loads."
              action={
                <Button variant="quiet" onClick={catalogState.retry} disabled={busy}>
                  Try again
                </Button>
              }
            />
          ) : null}
          <div className="fc-choice-grid">
            {catalog
              .filter((item) => stage.slugs.includes(item.slug))
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={equipmentIds.has(item.id)}
                  className={`fc-choice${equipmentIds.has(item.id) ? " is-selected" : ""}`}
                  onClick={() => toggleEquipment(item.id)}
                >
                  {item.name}
                </button>
              ))}
          </div>
          {catalogState.status === "ready" ? (
            <p className="t-small t-muted">
              {environment === "gym"
                ? "Your gym's equipment is selected. Deselect anything it does not have."
                : "Select what you have — skip what you don't."}
            </p>
          ) : null}
        </section>
      ) : null}

      {!error && step.key === "building" ? (
        <section className="fc-onboarding__step motion-rise" aria-labelledby="ob-build">
          <h1 className="t-title" id="ob-build">FitCoach is ready to build your week.</h1>
          <p className="t-body t-secondary fc-measure">
            Your goal, your days, your equipment — the engine builds a plan that fits, and states
            honestly what it cannot do.
          </p>
        </section>
      ) : null}

      {!error && fieldError ? (
        <p className="fc-inline-error t-small" role="alert">
          {fieldError}
        </p>
      ) : null}

      {!error ? (
        <div className="fc-onboarding__actions">
          {stepIndex > 0 ? (
            <Button variant="quiet" onClick={back} disabled={busy}>
              Back
            </Button>
          ) : (
            <span />
          )}
          <Button size="large" onClick={next} disabled={busy}>
            {step.key === "building" ? (busy ? "Building your plan…" : "Build my plan") : "Continue"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
