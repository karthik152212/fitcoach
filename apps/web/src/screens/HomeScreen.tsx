import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as endpoints from "../api/endpoints";
import { useAsync } from "../api/hooks";
import type { TrainingPlan, TrainingState, ActivityTargets, ActivityContext, RecoveryState, DecisionSnapshot, ExerciseDetail } from "../api/types";
import { AnatomyFigure, highlightsFromTargetMap, bestViewFor, type AnatomyHighlight } from "../anatomy/AnatomyFigure";
import { Button, Chip, StateBlock } from "../components/controls";
import { humaniseProse, sentence, formatNumber } from "../lib/text";
import { useSession } from "../session/SessionContext";
import { todaySessionOf, weekdayLabel } from "./schedule";

/**
 * Adaptive Home: a priority-driven surface, not a metric dashboard.
 *
 * The content model is an ordered list of prioritized sections derived from
 * training state — today's session, environment notes, progression signals,
 * or the intentional "no change recommended". Future domains (nutrition,
 * activity, recovery, coaching) plug into the same section pipeline.
 */

export interface HomeSection {
  id: string;
  priority: number;
  tone: "quiet" | "insight" | "intervention";
  title: string;
  body?: string;
  action?: { label: string; to: string };
}

function deriveActivityHomeSection(targets: ActivityTargets | null, context: ActivityContext | null): HomeSection | null {
  if (!targets || !context) return null;
  const gap = targets.dailyStepsTarget - context.averageSteps;
  if (gap > 2000) {
    return {
      id: "activity_gap",
      priority: 18,
      tone: "intervention",
      title: `Steps target: ${formatNumber(targets.dailyStepsTarget)}/day`,
      body: `Recent average: ${formatNumber(context.averageSteps)} — gap of ${formatNumber(gap)}. Increases capped at 2,000/day.`,
      action: { label: "View activity", to: "/activity" },
    };
  }
  if (gap > 500) {
    return {
      id: "activity_moderate_gap",
      priority: 14,
      tone: "insight",
      title: `Steps target: ${formatNumber(targets.dailyStepsTarget)}/day`,
      body: `${formatNumber(gap)} steps short of target. Small consistent increases work best.`,
      action: { label: "View activity", to: "/activity" },
    };
  }
  return null;
}

function deriveRecoveryHomeSection(state: RecoveryState | null): HomeSection | null {
  if (!state) return null;
  if (state.readinessScore < 50) {
    return {
      id: "recovery_low",
      priority: 22,
      tone: "intervention",
      title: `Readiness: ${state.readinessScore}/100`,
      body: "Low recovery. Prioritize sleep, nutrition, and low-intensity movement today.",
      action: { label: "View recovery", to: "/recovery" },
    };
  }
  if (state.readinessScore < 75) {
    return {
      id: "recovery_moderate",
      priority: 16,
      tone: "insight",
      title: `Readiness: ${state.readinessScore}/100`,
      body: "Moderate recovery. Consider reducing training volume if sessions feel hard.",
      action: { label: "View recovery", to: "/recovery" },
    };
  }
  // Only show high readiness if there are limiting factors
  if (state.limitingFactors.length > 0) {
    return {
      id: "recovery_limiters",
      priority: 12,
      tone: "insight",
      title: `Readiness: ${state.readinessScore}/100`,
      body: `Limiters: ${state.limitingFactors.slice(0, 2).join(", ")}.`,
      action: { label: "View recovery", to: "/recovery" },
    };
  }
  return null;
}

function deriveDecisionHomeSection(decision: DecisionSnapshot | null): HomeSection[] {
  const sections: HomeSection[] = [];
  if (!decision || decision.kind === "no_change") return sections;

  // Decision summary section
  sections.push({
    id: "decision_summary",
    priority: 24,
    tone: "intervention",
    title: `Decision: ${sentence(decision.kind.replace("_", " "))}`,
    body: decision.summary,
    action: { label: "View decision", to: "/coach" },
  });

  // Individual intervention sections
  decision.interventions.forEach((intervention, index) => {
    sections.push({
      id: `decision_intervention_${index}`,
      priority: 23 - index,
      tone: "insight",
      title: sentence(intervention.kind.replace("_", " ")),
      body: intervention.rationale,
      action: { label: "Details", to: "/coach" },
    });
  });

  // Active diagnoses
  if (decision.diagnosesAddressed.length > 0) {
    sections.push({
      id: "decision_diagnoses",
      priority: 15,
      tone: "insight",
      title: `Addressing ${decision.diagnosesAddressed.length} diagnosis${decision.diagnosesAddressed.length === 1 ? "" : "es"}`,
      body: decision.diagnosesAddressed.map((d) => sentence(d.replace("_", " "))).join(", "),
    });
  }

  return sections;
}

export function deriveHomeSections(input: {
  trainingState: TrainingState | null;
  plan: TrainingPlan | null;
  adaptedCount: number;
  activityTargets: ActivityTargets | null;
  activityContext: ActivityContext | null;
  recoveryState: RecoveryState | null;
  /** Set when a workout was completed today: Home must not ask to start it again. */
  completedWorkoutId?: string;
  /** Current unified decision snapshot. */
  decision?: DecisionSnapshot | null;
}): HomeSection[] {
  const sections: HomeSection[] = [];
  const { trainingState, plan, decision } = input;
  const environment = trainingState?.environment;

  // Decision sections first (highest priority when present)
  if (decision) {
    sections.push(...deriveDecisionHomeSection(decision));
  }

  if (environment?.constrained) {
    sections.push({
      id: "environment",
      priority: 10,
      tone: "insight",
      title: `Training ${environment.kind === "home_no_equipment" ? "at home with no equipment" : `in a ${environment.kind.replaceAll("_", " ")} setup`}`,
      body:
        (environment.limitations[0] ? humaniseProse(environment.limitations[0].description) : undefined) ??
        "Your plan is adapted to what is available right now.",
      action: { label: "Review setup", to: "/you" },
    });
  }

  if (plan) {
    const session = todaySessionOf(plan.versions.at(-1));
    if (session && input.completedWorkoutId) {
      sections.push({
        id: "today_complete",
        priority: 25,
        tone: "quiet",
        title: `${session.name} — complete`,
        body: "Today's session is recorded. Review what you performed, or let the rest of the day recover.",
        action: { label: "Review session", to: `/review/${input.completedWorkoutId}` },
      });
    } else if (session) {
      sections.push({
        id: "today",
        priority: 20,
        tone: "quiet",
        title: `${session.name} — today`,
        body: `${session.slots.length} exercises planned.`,
        action: { label: "Start training", to: "/train" },
      });
    } else {
      sections.push({
        id: "rest",
        priority: 15,
        tone: "quiet",
        title: "Rest day",
        body: "No session planned for today. Recovery is part of the plan.",
      });
    }
    if (plan.kind === "temporary_environment") {
      sections.push({
        id: "temporary",
        priority: 12,
        tone: "insight",
        title: "Temporary adapted plan",
        body: "This week runs on your adapted plan. Your gym plan is preserved and resumes when your environment is restored.",
        action: { label: "View plan", to: "/plan" },
      });
    }
  }

  // Recovery section (high priority when low)
  const recoverySection = deriveRecoveryHomeSection(input.recoveryState);
  if (recoverySection) sections.push(recoverySection);

  // Activity section
  const activitySection = deriveActivityHomeSection(input.activityTargets, input.activityContext);
  if (activitySection) sections.push(activitySection);

  if (input.adaptedCount > 0) {
    sections.push({
      id: "continuity",
      priority: 8,
      tone: "quiet",
      title: `${input.adaptedCount} adapted session${input.adaptedCount === 1 ? "" : "s"} logged`,
      body: "Training continued through a changed environment. It counts.",
    });
  }

  if (sections.length === 0) {
    sections.push({
      id: "ontrack",
      priority: 0,
      tone: "quiet",
      title: "You're on track.",
      body: "No change recommended.",
    });
  }

  return sections.sort((a, b) => b.priority - a.priority);
}

export function HomeScreen() {
  const { userId } = useSession();
  const navigate = useNavigate();
  const state = useAsync(async () => {
    if (!userId) {
      return {
        plan: null,
        trainingState: null,
        continuity: null,
        highlights: [] as readonly AnatomyHighlight[],
        completedWorkoutId: undefined as string | undefined,
        activityTargets: null as ActivityTargets | null,
        activityContext: null as ActivityContext | null,
        recoveryState: null as RecoveryState | null,
        decision: null as DecisionSnapshot | null,
      };
    }
    const [
      planResponse,
      trainingState,
      continuity,
      recentWorkouts,
      activityTargetsRes,
      activityContextRes,
      recoveryStateRes,
      decisionRes,
    ] = await Promise.all([
      endpoints.getActivePlan(userId),
      endpoints.getTrainingState(userId),
      endpoints.getContinuity(userId),
      endpoints.listWorkouts(userId, 7).catch(() => ({ workouts: [] })),
      endpoints.getActivityTargets(userId).catch(() => ({ targets: null })),
      endpoints.getActivityContext(userId, 14).catch(() => ({ context: null })),
      endpoints.getRecoveryState(userId).catch(() => ({ state: null })),
      endpoints.getCurrentDecision(userId).catch(() => ({ decision: null })),
    ]);
    // Session-level anatomy: light the muscles today's session trains.
    const session = planResponse.plan ? todaySessionOf(planResponse.plan.versions.at(-1)) : undefined;
    const exerciseIds = (session?.slots ?? []).map((slot) => slot.exerciseId);
    const details = await Promise.all(
      exerciseIds.slice(0, 5).map((id) => endpoints.getExerciseDetail(id).catch(() => null)),
    );
    const highlights = details.flatMap((detail: ExerciseDetail | null) =>
      detail ? highlightsFromTargetMap(detail.targetMap).filter((h) => h.state === "primary") : [],
    );
    // A finished session changes Home's primary action: the next thing is the
    // review, not another "Start training".
    const todayKey = new Date().toDateString();
    const completedToday = recentWorkouts.workouts
      .map((entry) => entry.workout)
      .find(
        (entry) =>
          entry.status === "completed" && new Date(entry.startedAt).toDateString() === todayKey,
      );
    return {
      plan: planResponse.plan,
      trainingState: trainingState.trainingState,
      continuity,
      highlights,
      completedWorkoutId: completedToday?.id,
      activityTargets: activityTargetsRes.targets,
      activityContext: activityContextRes.context,
      recoveryState: recoveryStateRes.state,
      decision: decisionRes.decision,
    };
  }, [userId]);

  const sections = useMemo(() => {
    if (state.status !== "ready") return [];
    return deriveHomeSections({
      trainingState: state.data.trainingState,
      plan: state.data.plan,
      adaptedCount: state.data.continuity?.sessions.adapted ?? 0,
      activityTargets: state.data.activityTargets,
      activityContext: state.data.activityContext,
      recoveryState: state.data.recoveryState,
      decision: state.data.decision,
      ...(state.data.completedWorkoutId ? { completedWorkoutId: state.data.completedWorkoutId } : {}),
    });
  }, [state]);

  if (!userId) {
    return (
      <div className="fc-screen fc-home">
        <section className="fc-home__hero motion-rise">
          <p className="t-caption t-muted">FitCoach</p>
          <h1 className="t-display">Training that understands your body.</h1>
          <p className="t-body t-secondary fc-measure">
            Anatomy-first, adaptive, honest about what your environment can and cannot do.
          </p>
          <Button size="large" full onClick={() => navigate("/onboarding")}>
            Begin
          </Button>
        </section>
      </div>
    );
  }

  if (state.status === "loading") return <StateBlock kind="loading" title="Reading your training state" />;
  if (state.status === "error") {
    return <StateBlock kind="error" title="FitCoach is unreachable" body={state.error.message} action={<Button onClick={state.retry}>Retry</Button>} />;
  }

  const { plan, highlights } = state.data;
  const primary = sections[0];
  const rest = sections.slice(1);

  return (
    <div className="fc-screen fc-home">
      {!plan ? (
        <section className="fc-home__hero motion-rise">
          <h1 className="t-title">No training plan yet</h1>
          <p className="t-body t-secondary fc-measure">
            FitCoach builds your week from your goal, your days and your equipment.
          </p>
          <Button size="large" full onClick={() => navigate("/onboarding")}>
            Build my plan
          </Button>
        </section>
      ) : (
        <>
          <section className="fc-home__today motion-rise" aria-labelledby="home-primary">
            {/* No session today means no target to show: a blank figure would
                be decoration, so the anatomy appears only when it means something. */}
            {highlights.length > 0 ? (
              <div className="fc-home__today-anatomy">
                <Link to="/train" aria-label="Open today's training">
                  <AnatomyFigure view={bestViewFor(highlights)} highlights={highlights} size={150} />
                </Link>
              </div>
            ) : null}
            <div className="fc-home__today-text">
              <p className="t-caption t-muted">{weekdayLabel(new Date().getDay())}</p>
              <h1 className="t-title" id="home-primary">
                {primary?.title ?? "You're on track."}
              </h1>
              {primary?.body ? <p className="t-body t-secondary">{primary.body}</p> : null}
              {primary?.action ? (
                <Button size="large" onClick={() => navigate(primary.action!.to)}>
                  {primary.action.label}
                </Button>
              ) : null}
            </div>
          </section>

          {rest.length > 0 ? (
            <section className="fc-home__sections" aria-label="What matters now">
              {rest.map((section) => (
                <article key={section.id} className={`fc-note fc-note--${section.tone}`}>
                  <div className="fc-note__text">
                    <h2 className="fc-note__title">{section.title}</h2>
                    {section.body ? <p className="fc-note__body">{section.body}</p> : null}
                  </div>
                  {section.action ? (
                    <Link className="fc-note__action" to={section.action.to}>
                      {section.action.label}
                    </Link>
                  ) : null}
                </article>
              ))}
            </section>
          ) : null}

          <section className="fc-home__planline">
            <Chip tone="accent">{state.data.trainingState?.trainingGoalKind ? sentence(state.data.trainingState.trainingGoalKind) : "training"}</Chip>
            {state.data.plan?.kind === "temporary_environment" ? <Chip tone="warning">temporary plan</Chip> : null}
            <Link to="/plan" className="fc-home__planlink t-small">
              View full plan
            </Link>
          </section>
        </>
      )}
    </div>
  );
}
