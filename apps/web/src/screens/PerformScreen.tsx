import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { newClientRequestId } from "../api/client";
import * as endpoints from "../api/endpoints";
import { useAsync } from "../api/hooks";
import type { ExerciseSet, ProgressionEvaluationResult } from "../api/types";
import { AnatomyFigure, bestViewFor, highlightsFromTargetMap } from "../anatomy/AnatomyFigure";
import { Button, StateBlock, Stepper } from "../components/controls";
import { useSession } from "../session/SessionContext";
import { useWorkout } from "../session/WorkoutContext";
import { GuideOverlay } from "./GuideOverlay";

/**
 * Performance mode. The user is training: anatomy stays visible, explanation
 * is gone, and the only job is recording the actual set.
 *
 *   [ anatomy ]
 *   EXERCISE NAME
 *   60 kg × 10
 *   60 kg × 9 · Failure
 *         +
 */

export function progressionLabel(outcome: string): string {
  switch (outcome) {
    case "increase_load":
    case "increase_reps":
      return "Progression available";
    case "change_exercise":
      return "Harder variation available";
    case "reduce_load":
    case "reduce_target":
      return "Performance is declining";
    case "modify_rep_range":
    case "modify_rir_target":
      return "Target adjusted";
    case "insufficient_data":
      return "Insufficient data";
    case "maintain":
    case "repeat":
    case "no_change":
      return "No change recommended";
    default:
      return "No change recommended";
  }
}

export function formatSet(set: ExerciseSet): string {
  const load =
    set.loadKind === "bodyweight"
      ? "Bodyweight"
      : set.loadKind === "assisted_bodyweight"
        ? `Assisted −${set.assistanceLoadKg ?? 0} kg`
        : set.loadKind === "weighted_bodyweight"
          ? `Bodyweight +${set.addedLoadKg ?? 0} kg`
          : `${set.loadKg ?? 0} kg`;
  const reps = set.reps !== undefined ? ` × ${set.reps}` : "";
  return `${load}${reps}${set.kind === "failure" ? " · Failure" : ""}`;
}

export function PerformScreen() {
  const { exerciseId = "" } = useParams();
  const { userId } = useSession();
  const workout = useWorkout();
  const navigate = useNavigate();

  const [entryOpen, setEntryOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [load, setLoad] = useState(60);
  const [reps, setReps] = useState(10);
  const [failure, setFailure] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const detailState = useAsync(() => endpoints.getExerciseDetail(exerciseId), [exerciseId]);
  const historyState = useAsync(
    () => (userId ? endpoints.getPerformanceHistory(userId, exerciseId, 10) : Promise.resolve({ observations: [] })),
    [userId, exerciseId],
  );

  const activeExercise = workout.active?.exercise;
  const sets = workout.active?.setsByExercise[exerciseId] ?? [];
  const loadKind = activeExercise?.loadKind ?? "external_load";

  const highlights = useMemo(
    () => (detailState.status === "ready" ? highlightsFromTargetMap(detailState.data.targetMap) : []),
    [detailState],
  );

  // Progression feedback: evaluated by the engine from recorded evidence,
  // refreshed as the set count grows. Never forced — when the engine has no
  // evidence it says so, and the UI says so too.
  const [progression, setProgression] = useState<ProgressionEvaluationResult | null>(null);
  const outcome = progression?.evaluation?.outcome;
  const rationale = progression?.evaluation?.recommendation.rationale;
  useEffect(() => {
    if (!userId || sets.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    let cancelled = false;
    endpoints
      .evaluateProgression(userId, exerciseId, today)
      .then((result) => {
        if (!cancelled) setProgression(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, exerciseId, sets.length]);

  if (detailState.status === "loading") return <StateBlock kind="loading" title="Preparing performance mode" />;
  if (detailState.status === "error") {
    return <StateBlock kind="error" title="Exercise unavailable" body={detailState.error.message} action={<Button onClick={() => navigate(-1)}>Back</Button>} />;
  }
  if (!workout.active || !activeExercise || activeExercise.exerciseId !== exerciseId) {
    return (
      <StateBlock
        kind="empty"
        title="No active session for this exercise"
        body="Start from the exercise screen so FitCoach can record against the right session."
        action={<Button onClick={() => navigate(`/exercise/${exerciseId}`)}>Open exercise</Button>}
      />
    );
  }

  const detail = detailState.data;
  const lastSessionBest = historyState.status === "ready"
    ? historyState.data.observations.filter((o) => o.completed).at(-1)
    : undefined;

  const saveSet = async () => {
    if (!userId || !workout.active) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { set } = await endpoints.addSet(userId, workout.active.workoutId, {
        workoutExerciseId: activeExercise.workoutExerciseId,
        kind: failure ? "failure" : "working",
        ...(loadKind === "external_load" ? { loadKg: load, loadKind: "external_load" as const } : { loadKind: "bodyweight" as const }),
        reps,
        clientRequestId: newClientRequestId(),
      });
      workout.recordSet(exerciseId, set);
      setEntryOpen(false);
      setFailure(false);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Set could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const finishWorkout = async () => {
    if (!userId || !workout.active) return;
    setFinishing(true);
    setFinishError(null);
    try {
      const workoutId = workout.active.workoutId;
      await endpoints.completeWorkout(userId, workoutId, new Date().toISOString());
      workout.clear();
      navigate(`/review/${workoutId}`);
    } catch (cause) {
      // Completion is a real backend write. A silent failure would leave the
      // session open while the user believes it is finished — and navigating to
      // a review of a session that is still in progress would be a lie.
      setFinishError(cause instanceof Error ? cause.message : "The workout could not be completed.");
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div className="fc-screen fc-perform">
      <header className="fc-perform__head">
        <AnatomyFigure
          view={bestViewFor(highlights)}
          highlights={highlights}
          size={150}
          interactive
          onActivate={() => setGuideOpen(true)}
        />
        <h1 className="t-heading fc-perform__name">{activeExercise.name}</h1>
        {lastSessionBest?.reps !== undefined ? (
          <p className="t-small t-muted">
            Last time {lastSessionBest.loadKind === "bodyweight" ? "bodyweight" : `${lastSessionBest.loadKg ?? 0} kg`} × {lastSessionBest.reps}
          </p>
        ) : null}
      </header>

      <ol className="fc-setlist" aria-label="Logged sets">
        {sets.map((set) => (
          <li
            key={set.id}
            data-set-id={set.id}
            className={`fc-setlist__item${set.kind === "failure" ? " is-failure" : ""}`}
          >
            {formatSet(set)}
          </li>
        ))}
      </ol>

      {progression ? (
        <p className={`fc-progression${outcome === "insufficient_data" || !outcome ? " is-quiet" : ""}`} role="status">
          <span className="fc-progression__label">{outcome ? progressionLabel(outcome) : "Insufficient data"}</span>
          {rationale && outcome !== "insufficient_data" ? (
            <span className="fc-progression__rationale t-small t-muted">{rationale}</span>
          ) : null}
        </p>
      ) : null}

      {entryOpen ? (
        <section className="fc-setentry motion-rise" aria-label="Add set">
          {loadKind === "external_load" ? (
            <Stepper label="Weight" value={load} onChange={setLoad} step={2.5} min={0} max={500} unit="kg" />
          ) : null}
          <Stepper label="Reps" value={reps} onChange={setReps} step={1} min={1} max={100} />
          <button
            type="button"
            className={`fc-failure${failure ? " is-on" : ""}`}
            aria-pressed={failure}
            onClick={() => setFailure((f) => !f)}
          >
            Failure
          </button>
          {saveError ? (
            <p className="fc-inline-error t-small" role="alert">
              {saveError}
            </p>
          ) : null}
          <div className="fc-setentry__actions">
            <Button variant="quiet" onClick={() => setEntryOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void saveSet()} disabled={saving}>
              {saving ? "Saving…" : "✓ Save set"}
            </Button>
          </div>
        </section>
      ) : null}

      <div className="fc-perform__actions">
        {!entryOpen ? (
          <button type="button" className="fc-addset" onClick={() => setEntryOpen(true)} aria-label="Add set">
            +
          </button>
        ) : null}
        {sets.length > 0 && !entryOpen ? (
          <>
            {finishError ? (
              <p className="fc-inline-error t-small" role="alert">
                {finishError}
              </p>
            ) : null}
            <Button variant="quiet" disabled={finishing} onClick={() => void finishWorkout()}>
              {finishing ? "Finishing…" : "Finish workout"}
            </Button>
          </>
        ) : null}
      </div>

      {guideOpen ? <GuideOverlay detail={detail} onClose={() => setGuideOpen(false)} /> : null}
    </div>
  );
}
