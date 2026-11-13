import { Link, useNavigate, useSearchParams } from "react-router-dom";
import * as endpoints from "../api/endpoints";
import { useAsync } from "../api/hooks";
import { AnatomyFigure, bestViewFor, highlightsFromTargetMap, type AnatomyHighlight } from "../anatomy/AnatomyFigure";
import type { ExerciseDetail, TargetMapEntry } from "../api/types";
import { Button, Chip, StateBlock } from "../components/controls";
import { useSession } from "../session/SessionContext";
import { useWorkout } from "../session/WorkoutContext";
import { todaySessionOf, weekdayLabel } from "./schedule";

/**
 * Today's workout: what the session is, which muscles it trains, the exercise
 * sequence with compact targets — and one obvious action. No calorie
 * headline, no duration headline, no score.
 */
export function TrainScreen() {
  const { userId } = useSession();
  const navigate = useNavigate();
  const workout = useWorkout();
  // The plan can hand any scheduled session over for training. Without a
  // `session` parameter this is still "today", so the tab keeps its meaning.
  const [searchParams] = useSearchParams();
  const requestedSessionId = searchParams.get("session");
  const state = useAsync(async () => {
    if (!userId) return null;
    const [planResponse, trainingState] = await Promise.all([
      endpoints.getActivePlan(userId),
      endpoints.getTrainingState(userId),
    ]);
    const version = planResponse.plan?.versions.at(-1);
    const session =
      (requestedSessionId
        ? version?.sessions.find((candidate) => candidate.id === requestedSessionId)
        : undefined) ?? todaySessionOf(version);
    const slots = session?.slots ?? [];
    const details = await Promise.all(slots.map((slot) => endpoints.getExerciseDetail(slot.exerciseId).catch(() => null)));
    const highlights: AnatomyHighlight[] = details.flatMap((detail: ExerciseDetail | null) =>
      detail ? highlightsFromTargetMap(detail.targetMap).filter((h) => h.state === "primary") : [],
    );
    // Muscle names actually trained today, from TargetMap — never invented.
    const focusNames = [
      ...new Set(
        details.flatMap((detail) =>
          detail
            ? detail.targetMap.entries
                .filter((entry: TargetMapEntry) => entry.state === "primary")
                .map((entry: TargetMapEntry) => entry.displayName)
            : [],
        ),
      ),
    ];
    return {
      plan: planResponse.plan,
      session,
      slots,
      details,
      highlights,
      focusNames,
      environment: trainingState.trainingState.environment,
      requested: requestedSessionId !== null,
    };
  }, [userId, requestedSessionId]);

  if (!userId) return <StateBlock kind="empty" title="Sign in to train" />;
  if (state.status === "loading") return <StateBlock kind="loading" title="Preparing today's session" />;
  if (state.status === "error") {
    return <StateBlock kind="error" title="Could not load today's training" body={state.error.message} action={<Button onClick={state.retry}>Retry</Button>} />;
  }
  const data = state.data;
  if (!data?.plan || !data.session) {
    return (
      <StateBlock
        kind="empty"
        title="Rest day"
        body="No session is planned for today. Recovery is part of the plan."
        action={
          <Link to="/plan">
            <Button variant="secondary">View the week</Button>
          </Link>
        }
      />
    );
  }

  const { session, slots, details, environment, focusNames } = data;
  const activeExercise = workout.active?.exercise;
  const activeExerciseIndex = activeExercise
    ? slots.findIndex((slot) => slot.exerciseId === activeExercise.exerciseId)
    : -1;
  const isActiveSession = Boolean(workout.active) && activeExerciseIndex >= 0;
  const completedCount = slots.filter((slot) => workout.active?.setsByExercise[slot.exerciseId]?.length ?? 0 > 0).length;
  const inProgressCount = activeExerciseIndex >= 0 ? 1 : 0;
  const pendingCount = slots.length - completedCount - inProgressCount;

  // Determine the action for the primary button
  const getPrimaryAction = () => {
    if (isActiveSession && activeExerciseIndex >= 0 && activeExercise) {
      // Continue current exercise
      return () => navigate(`/exercise/${activeExercise.exerciseId}/perform`);
    }
    if (activeExerciseIndex > 0) {
      // Move to next exercise
      const nextSlot = slots[activeExerciseIndex];
      if (nextSlot) return () => navigate(`/exercise/${nextSlot.exerciseId}`);
    }
    // Start first exercise
    return () => navigate(`/exercise/${slots[0]!.exerciseId}`);
  };

  const getPrimaryLabel = () => {
    if (isActiveSession) return "Continue";
    if (activeExerciseIndex > 0) return `Next: ${details[activeExerciseIndex]?.exercise.name ?? "exercise"}`;
    return "Start";
  };

  return (
    <div className="fc-screen fc-train">
      <header className="fc-screen__header">
        <div>
          <p className="t-caption t-muted">
            {data.requested && session.weekdayHint !== undefined
              ? weekdayLabel(session.weekdayHint)
              : "Today"}
          </p>
          <h1 className="t-title">{session.name}</h1>
        </div>
        {environment?.constrained ? <Chip tone="warning">adapted · {environment.kind.replaceAll("_", " ")}</Chip> : null}
      </header>

      <div className="fc-train__anatomy">
        <AnatomyFigure view={bestViewFor(data.highlights)} highlights={data.highlights} size={170} />
        <p className="t-small t-muted fc-train__anatomycaption">
          {focusNames.length > 0 ? `Focus · ${focusNames.slice(0, 5).join(" · ")}` : "Today's session"}
        </p>
      </div>

      {/* Session progress indicator */}
      <div className="fc-train__progress" role="status" aria-label="Session progress">
        <div className="fc-train__progress-bar">
          <div
            className="fc-train__progress-fill"
            style={{ width: `${((completedCount + inProgressCount) / Math.max(1, slots.length)) * 100}%` }}
          />
        </div>
        <p className="t-caption t-muted">
          {completedCount} complete{inProgressCount > 0 ? ` · 1 in progress` : ""}{pendingCount > 0 ? ` · ${pendingCount} remaining` : ""}
        </p>
      </div>

      <ol className="fc-exlist" aria-label="Exercises">
        {slots.map((slot, index) => {
          const detail = details[index] ?? null;
          const primary = detail?.targetMap.entries.filter((entry: TargetMapEntry) => entry.state === "primary") ?? [];
          const range = slot.targetRepRange;
          const setsLogged = workout.active?.setsByExercise[slot.exerciseId]?.length ?? 0;
          const isActive = index === activeExerciseIndex;
          const isComplete = setsLogged > 0 && !isActive;
          const isPending = setsLogged === 0 && !isActive;
          return (
            <li key={slot.id ?? slot.exerciseId} className={`fc-exlist__item${isActive ? " is-active" : ""}${isComplete ? " is-complete" : ""}${isPending ? " is-pending" : ""}`}>
              <Link
                to={isActive ? `/exercise/${slot.exerciseId}/perform` : `/exercise/${slot.exerciseId}`}
                className="fc-exrow"
                aria-current={isActive ? "step" : undefined}
              >
                <span className="fc-exrow__position" aria-hidden="true">
                  {isActive ? (
                    <span className="fc-exrow__pulse" aria-hidden="true" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="fc-exrow__main">
                  <span className="fc-exrow__name">{detail?.exercise.name ?? "Exercise"}</span>
                  <span className="fc-exrow__target t-small t-muted">
                    {primary.map((entry: TargetMapEntry) => entry.displayName).join(" · ") || slot.notes?.replaceAll("_", " ")}
                  </span>
                  {setsLogged > 0 && (
                    <span className="fc-exrow__logged t-small t-muted">
                      {setsLogged} set{setsLogged === 1 ? "" : "s"} logged
                    </span>
                  )}
                </span>
                <span className="fc-exrow__sets t-data">
                  {slot.targetSets}×{range ? `${range.min}–${range.max}` : "—"}
                </span>
                {isActive && <span className="fc-exrow__active" aria-hidden="true">▸</span>}
                {isComplete && <span className="fc-exrow__check" aria-hidden="true">✓</span>}
              </Link>
            </li>
          );
        })}
      </ol>

      {slots.length > 0 ? (
        <div className="fc-train__start">
          <Button size="large" full onClick={getPrimaryAction()}>
            {getPrimaryLabel()}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
