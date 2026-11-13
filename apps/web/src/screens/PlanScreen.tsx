import { useState } from "react";
import { Link } from "react-router-dom";
import * as endpoints from "../api/endpoints";
import { useAsync } from "../api/hooks";
import { AnatomyFigure, bestViewFor, highlightsFromTargetMap, type AnatomyHighlight } from "../anatomy/AnatomyFigure";
import { Button, Chip, Expandable, StateBlock } from "../components/controls";
import { sentence } from "../lib/text";
import { useSession } from "../session/SessionContext";
import { buildWeekCells, weekdayLabel, WEEKDAYS } from "./schedule";

/**
 * Plan overview: the current goal, the week structure, why the plan exists,
 * and which muscles the week actually covers. Anatomy explains the focus;
 * the numbers never lead.
 */

interface CoverageRow {
  slug: string;
  name: string;
  sets: number;
}

interface ScheduleAdjustment {
  sessionId: string;
  fromWeekday: number;
  toWeekday: number;
}

export function PlanScreen() {
  const { userId } = useSession();
  const [adjustments, setAdjustments] = useState<ScheduleAdjustment[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Apply local adjustments to week cells for immediate visual feedback
  const applyAdjustments = (cells: ReturnType<typeof buildWeekCells>) => {
    if (adjustments.length === 0) return cells;
    const adjusted = [...cells];
    for (const adj of adjustments) {
      const fromIndex = adjusted.findIndex((c) => c.weekday === adj.fromWeekday);
      const toIndex = adjusted.findIndex((c) => c.weekday === adj.toWeekday);
      if (fromIndex >= 0 && toIndex >= 0) {
        // findIndex >= 0 guarantees these are defined
        const fromCell = adjusted[fromIndex]!;
        const toCell = adjusted[toIndex]!;
        const session = fromCell.session;
        adjusted[fromIndex] = { weekday: fromCell.weekday, label: fromCell.label, session: undefined, state: "rest" };
        adjusted[toIndex] = { weekday: toCell.weekday, label: toCell.label, session, state: "planned" };
      }
    }
    return adjusted;
  };

  const handleMoveSession = (sessionId: string, fromWeekday: number, toWeekday: number) => {
    if (fromWeekday === toWeekday) return;
    setAdjustments((prev) => {
      // Remove any existing adjustment for this session
      const filtered = prev.filter((a) => a.sessionId !== sessionId);
      // Add new adjustment
      return [...filtered, { sessionId, fromWeekday, toWeekday }];
    });
  };

  const handleClearRest = (weekday: number) => {
    setAdjustments((prev) => prev.filter((a) => a.fromWeekday !== weekday && a.toWeekday !== weekday));
  };

  const saveSchedule = async () => {
    if (!userId || adjustments.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      // For Phase 2, we use the adapt plan endpoint with volume adjustments
      // In a full implementation, this would call a dedicated schedule adjustment endpoint
      await endpoints.adaptPlan(userId, ""); // Plan ID would come from state
      setAdjustments([]);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Schedule could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const state = useAsync(async () => {
    if (!userId) return null;
    const [planResponse, goal, workouts, trainingState] = await Promise.all([
      endpoints.getActivePlan(userId),
      endpoints.getActiveGoal(userId),
      endpoints.listWorkouts(userId, 14),
      endpoints.getTrainingState(userId).catch(() => ({ trainingState: null })),
    ]);
    const plan = planResponse.plan;
    const decisionList = plan
      ? await endpoints.getPlanDecisions(userId, plan.id).catch(() => ({ decisions: [] }))
      : { decisions: [] };

    // Muscle coverage comes from two domain sources only: the engine's
    // planned weekly volume, and each exercise's TargetMap for display names
    // and the anatomy highlight. The UI never weighs muscles itself.
    const version = plan?.versions.at(-1);
    const exerciseIds = [
      ...new Set((version?.sessions ?? []).flatMap((session) => session.slots.map((slot) => slot.exerciseId))),
    ].slice(0, 16);
    const details = await Promise.all(
      exerciseIds.map((id) => endpoints.getExerciseDetail(id).catch(() => null)),
    );
    const muscleNames = new Map<string, string>();
    const highlights: AnatomyHighlight[] = [];
    for (const detail of details) {
      if (!detail) continue;
      for (const entry of detail.targetMap.entries) {
        if (!muscleNames.has(entry.muscleSlug)) muscleNames.set(entry.muscleSlug, entry.displayName);
      }
      highlights.push(
        ...highlightsFromTargetMap(detail.targetMap).filter((highlight) => highlight.state === "primary"),
      );
    }
    const plannedVolume = trainingState.trainingState?.plannedWeeklyVolumePerMuscle ?? {};
    const coverage: CoverageRow[] = Object.entries(plannedVolume)
      .map(([slug, sets]) => ({
        slug,
        name: muscleNames.get(slug) ?? slug.replaceAll("_", " "),
        sets,
      }))
      .sort((a, b) => b.sets - a.sets);

    return {
      plan,
      goal: goal.goal,
      workouts: workouts.workouts.map((entry) => entry.workout),
      decisions: decisionList.decisions,
      coverage,
      highlights,
    };
  }, [userId]);

  if (!userId) return <StateBlock kind="empty" title="Sign in to see your plan" />;
  if (state.status === "loading") return <StateBlock kind="loading" title="Loading your plan" />;
  // A failed read is not an empty plan: offering "Build my plan" here would
  // walk a user who already has one back through onboarding.
  if (state.status === "error") {
    return (
      <StateBlock
        kind="error"
        title="Couldn't load your plan"
        body="FitCoach couldn't reach your training plan just now. The plan itself is unaffected."
        action={
          <Button variant="quiet" onClick={state.retry}>
            Try again
          </Button>
        }
      />
    );
  }
  if (!state.data?.plan) {
    return (
      <StateBlock
        kind="empty"
        title="No training plan yet"
        body="FitCoach builds your week from your goal, your days and your equipment."
        action={
          <Link to="/onboarding">
            <Button>Build my plan</Button>
          </Link>
        }
      />
    );
  }

  const { plan, goal, workouts, decisions, coverage, highlights } = state.data;
  const version = plan.versions.at(-1);
  const baseCells = buildWeekCells(version, workouts);
  const cells = applyAdjustments(baseCells);
  const latestDecision = decisions[0];
  const hasAdjustments = adjustments.length > 0;

  // Build day options for move dropdown
  const dayOptions = WEEKDAYS.map((label, weekday) => ({ label, weekday }));

  return (
    <div className="fc-screen fc-plan">
      <header className="fc-screen__header">
        <div>
          <p className="t-caption t-muted">Training plan</p>
          <h1 className="t-title">{goal ? sentence(goal.kind) : "Your training"}</h1>
        </div>
        <div className="fc-plan__chips">
          {plan.kind === "temporary_environment" ? <Chip tone="warning">temporary · {sentence(plan.environmentKind ?? "adapted")}</Chip> : null}
          <Chip tone="neutral">v{version?.versionNumber ?? 1}</Chip>
        </div>
      </header>

      <section className="fc-week" aria-label="This week">
        {/* A rest day is information, not navigation: rendering it as a link
            sent the browser to `#` and looked like a broken action. */}
        {cells.map((cell) => {
          const className = `fc-week__cell fc-week__cell--${cell.state}${cell.session ? "" : " is-rest"}`;
          const label = `${cell.label}: ${cell.session ? cell.session.name : "rest"} (${cell.state})`;
          const isAdjusted = adjustments.some((a) => a.fromWeekday === cell.weekday || a.toWeekday === cell.weekday);
          const content = (
            <>
              <span className="fc-week__day" aria-hidden="true">
                {weekdayLabel(cell.weekday).slice(0, 3)}
              </span>
              {/* State is colour in the visual strip, so it is also spoken. */}
              <span className="visually-hidden">{label}</span>
              <span className="fc-week__dot" aria-hidden="true" />
              <span className="fc-week__name" aria-hidden="true">
                {cell.session ? cell.session.name : "Rest"}
              </span>
              {cell.session && (
                <select
                  className="fc-week__move"
                  value={cell.weekday}
                  onChange={(e) => handleMoveSession(cell.session!.id, cell.weekday, Number(e.target.value))}
                  aria-label={`Move ${cell.session.name} to`}
                >
                  {dayOptions.map((opt) => (
                    <option key={opt.weekday} value={opt.weekday}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}
              {!cell.session && isAdjusted && (
                <button
                  type="button"
                  className="fc-week__clear"
                  onClick={() => handleClearRest(cell.weekday)}
                  aria-label={`Clear adjustment for ${weekdayLabel(cell.weekday)}`}
                >
                  ✕
                </button>
              )}
            </>
          );
          return cell.session ? (
            <Link
              key={cell.weekday}
              to={`/train?session=${encodeURIComponent(cell.session.id)}`}
              className={className}
              aria-current={cell.state === "today" ? "date" : undefined}
            >
              {content}
            </Link>
          ) : (
            <div key={cell.weekday} className={className}>
              {content}
            </div>
          );
        })}
      </section>

      {hasAdjustments && (
        <div className="fc-plan__adjustments">
          <p className="t-small t-muted">
            {adjustments.length} change{adjustments.length === 1 ? "" : "s"} pending
          </p>
          <div className="fc-plan__adjustment-actions">
            <Button variant="quiet" onClick={() => setAdjustments([])}>
              Discard
            </Button>
            <Button onClick={saveSchedule} disabled={saving}>
              {saving ? "Saving…" : "Save schedule"}
            </Button>
          </div>
          {saveError && <p className="fc-inline-error t-small" role="alert">{saveError}</p>}
        </div>
      )}

      {coverage.length > 0 ? (
        <section className="fc-plan__coverage" aria-labelledby="plan-coverage">
          <AnatomyFigure view={bestViewFor(highlights)} highlights={highlights} size={112} />
          <div className="fc-plan__coverage-text">
            <h2 className="t-caption t-muted" id="plan-coverage">
              What the week trains
            </h2>
            <dl className="fc-coverage">
              {coverage.slice(0, 6).map((muscle) => (
                <div key={muscle.slug} className="fc-coverage__row">
                  <dt>{muscle.name}</dt>
                  <dd className="t-data">
                    {muscle.sets} set{muscle.sets === 1 ? "" : "s"}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      ) : null}

      {version ? (
        <section className="fc-plan__sessions" aria-label="Sessions">
          {version.sessions.map((session) => (
            <article key={session.id} className="fc-sessionrow">
              <div className="fc-sessionrow__main">
                <h2 className="fc-sessionrow__name">{session.name}</h2>
                <p className="t-small t-muted">
                  {weekdayLabel(session.weekdayHint ?? 0)} · {session.slots.length}{" "}
                  {session.slots.length === 1 ? "exercise" : "exercises"}
                </p>
              </div>
              <Link to={`/train?session=${encodeURIComponent(session.id)}`} className="fc-sessionrow__action">
                Train
              </Link>
            </article>
          ))}
        </section>
      ) : null}

      {latestDecision ? (
        <section aria-labelledby="plan-why">
          <Expandable summary={<span id="plan-why">Why this plan looks like this</span>}>
            <p>{latestDecision.rationale}</p>
            {latestDecision.smallestUsefulChangeJustification ? (
              <p className="t-muted">{latestDecision.smallestUsefulChangeJustification}</p>
            ) : null}
          </Expandable>
        </section>
      ) : null}
    </div>
  );
}
