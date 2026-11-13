import { Link } from "react-router-dom";
import * as endpoints from "../api/endpoints";
import { useAsync } from "../api/hooks";
import { Chip, StateBlock } from "../components/controls";
import { useSession } from "../session/SessionContext";

/**
 * Training history/progress: recorded performance, session classifications
 * and progression facts. No chart overload — lists that answer questions.
 */
export function ProgressScreen() {
  const { userId } = useSession();
  const state = useAsync(async () => {
    if (!userId) return null;
    const [workouts, ledger, continuity] = await Promise.all([
      endpoints.listWorkouts(userId, 30),
      endpoints.getLedger(userId).catch(() => ({ entries: [], totalCompletedProgressions: 0 })),
      endpoints.getContinuity(userId),
    ]);
    return { workouts: workouts.workouts, ledger, continuity };
  }, [userId]);

  if (!userId) return <StateBlock kind="empty" title="Sign in to see progress" />;
  if (state.status === "loading") return <StateBlock kind="loading" title="Reading your history" />;
  if (state.status === "error" || !state.data) {
    return <StateBlock kind="error" title="History unavailable" body={state.status === "error" ? state.error.message : undefined} />;
  }

  const { workouts: workoutEntries, ledger, continuity } = state.data;
  const workouts = workoutEntries.map((entry) => entry.workout);
  const completedByExercise = new Map<string, number>();
  for (const entry of ledger.entries) {
    if (entry.completed) {
      completedByExercise.set(
        entry.evaluation.exerciseId,
        (completedByExercise.get(entry.evaluation.exerciseId) ?? 0) + 1,
      );
    }
  }

  return (
    <div className="fc-screen fc-progress">
      <header className="fc-screen__header">
        <div>
          <p className="t-caption t-muted">Progress</p>
          <h1 className="t-title">Training record</h1>
        </div>
      </header>

      <section className="fc-progress__facts" aria-label="Continuity">
        <dl className="fc-facts">
          <div className="fc-facts__row">
            <dt>Completed</dt>
            <dd className="t-data">{continuity.sessions.completed}</dd>
          </div>
          <div className="fc-facts__row">
            <dt>Adapted</dt>
            <dd className="t-data">{continuity.sessions.adapted}</dd>
          </div>
          <div className="fc-facts__row">
            <dt>Missed</dt>
            <dd className="t-data">{continuity.missedSessions}</dd>
          </div>
          <div className="fc-facts__row">
            <dt>Completed progressions</dt>
            <dd className="t-data">{ledger.totalCompletedProgressions}</dd>
          </div>
        </dl>
      </section>

      <section aria-label="Sessions">
        {workouts.length === 0 ? (
          <StateBlock kind="empty" title="No sessions recorded yet" body="Your completed, adapted and missed sessions will appear here." />
        ) : (
          <ul className="fc-history" role="list">
            {workouts.map((workout) => {
              const when = new Date(workout.startedAt);
              const date = when.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
              const time = when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
              return (
              <li key={workout.id} className="fc-history__row">
                {/* A recorded session is reviewable; an open one has nothing to
                    review yet, so only completed sessions are links. */}
                {workout.status === "completed" ? (
                  <Link to={`/review/${workout.id}`} className="fc-history__main fc-history__link">
                    <span className="fc-history__date">{date}</span>
                    <span className="t-small t-muted">{time} · Review</span>
                  </Link>
                ) : (
                  <div className="fc-history__main">
                    <span className="fc-history__date">{date}</span>
                    <span className="t-small t-muted">{time}</span>
                  </div>
                )}
                <div className="fc-history__chips">
                  {workout.sessionClassification === "adapted" ? <Chip tone="warning">adapted</Chip> : null}
                  <Chip
                    tone={
                      workout.status === "completed"
                        ? "success"
                        : workout.status === "skipped"
                          ? "error"
                          : workout.status === "in_progress"
                            ? "accent"
                            : "neutral"
                    }
                  >
                    {workout.status.replaceAll("_", " ")}
                  </Chip>
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </section>

      {completedByExercise.size > 0 ? (
        <section aria-label="Progressions">
          <h2 className="t-heading fc-progress__subhead">Progressions earned</h2>
          <p className="t-body t-secondary">
            {ledger.totalCompletedProgressions} verified progression
            {ledger.totalCompletedProgressions === 1 ? "" : "s"} across {completedByExercise.size} exercise
            {completedByExercise.size === 1 ? "" : "s"} — each one recommended, accepted and evidenced
            in recorded performance.
          </p>
        </section>
      ) : null}
    </div>
  );
}
