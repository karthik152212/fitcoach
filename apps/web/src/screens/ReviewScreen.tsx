import { Link, useParams } from "react-router-dom";
import * as endpoints from "../api/endpoints";
import { useAsync } from "../api/hooks";
import { Button, StateBlock } from "../components/controls";
import { useSession } from "../session/SessionContext";
import { formatSet } from "./PerformScreen";

/**
 * Workout completion/review: what was actually performed, and what the
 * progression engine concluded from it. No celebration screen, no score —
 * "No change recommended" is an intentional outcome.
 */
export function ReviewScreen() {
  const { workoutId = "" } = useParams();
  const { userId } = useSession();

  const state = useAsync(async () => {
    if (!userId) return null;
    const [{ workout }, ledger] = await Promise.all([
      endpoints.getWorkout(userId, workoutId),
      endpoints.getLedger(userId).catch(() => ({ entries: [], totalCompletedProgressions: 0 })),
    ]);
    const details = await Promise.all(
      workout.exercises.map((exercise) => endpoints.getExerciseDetail(exercise.exerciseId).catch(() => null)),
    );
    const evaluations = await Promise.all(
      workout.exercises.map((exercise) =>
        endpoints
          .evaluateProgression(userId, exercise.exerciseId, new Date().toISOString().slice(0, 10))
          .catch(() => null),
      ),
    );
    return { workout, details, evaluations, totalCompletedProgressions: ledger.totalCompletedProgressions };
  }, [userId, workoutId]);

  if (state.status === "loading") return <StateBlock kind="loading" title="Reviewing the session" />;
  if (state.status === "error" || !state.data) {
    return <StateBlock kind="error" title="Review unavailable" body={state.status === "error" ? state.error.message : undefined} action={<Link to="/"><Button>Home</Button></Link>} />;
  }

  const { workout, details, evaluations } = state.data;
  const totalSets = workout.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
  const outcomeOf = (evaluation: Awaited<ReturnType<typeof endpoints.evaluateProgression>> | null) =>
    evaluation?.evaluation?.outcome;
  const meaningful = evaluations.filter((evaluation) => {
    const outcome = outcomeOf(evaluation);
    return outcome !== undefined && outcome !== "insufficient_data" && outcome !== "maintain" && outcome !== "no_change";
  });

  return (
    <div className="fc-screen fc-review">
      <header className="fc-screen__header">
        <div>
          <p className="t-caption t-muted">Session complete</p>
          <h1 className="t-title">
            {workout.workout.sessionClassification === "adapted" ? "Adapted session" : "Session"} · {totalSets} set
            {totalSets === 1 ? "" : "s"}
          </h1>
        </div>
      </header>

      <section aria-label="Performed work">
        <ul className="fc-review__exercises" role="list">
          {workout.exercises.map((exercise, index) => {
            const detail = details[index];
            return (
              <li key={exercise.id} className="fc-review__exercise">
                <h2 className="fc-review__name">{detail?.exercise.name ?? "Exercise"}</h2>
                <ul className="fc-review__sets" role="list">
                  {exercise.sets.map((set) => (
                    <li key={set.id}>{formatSet(set)}</li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="What FitCoach concludes">
        {meaningful.length > 0 ? (
          <ul className="fc-review__outcomes" role="list">
            {evaluations.map((evaluation, index) =>
              evaluation && meaningful.includes(evaluation) ? (
                <li key={workout.exercises[index]!.id} className="fc-review__outcome">
                  <span className="fc-review__outcome-name">{details[index]?.exercise.name}</span>
                  <span className="t-small t-secondary">{evaluation.evaluation?.recommendation.rationale}</span>
                </li>
              ) : null,
            )}
          </ul>
        ) : (
          <p className="fc-review__nochange">No change recommended.</p>
        )}
      </section>

      <div className="fc-review__actions">
        <Link to="/">
          <Button size="large" full>
            Done
          </Button>
        </Link>
      </div>
    </div>
  );
}
