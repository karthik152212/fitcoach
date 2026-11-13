import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as endpoints from "../api/endpoints";
import { useAsync } from "../api/hooks";
import { AnatomyFigure, bestViewFor, highlightsFromTargetMap } from "../anatomy/AnatomyFigure";
import type { TargetMapEntry, TargetMapStructure } from "../api/types";
import { ExerciseMedia } from "../components/ExerciseMedia";
import { Button, Chip, Expandable, StateBlock } from "../components/controls";
import { mediaFor } from "../exercise/media";
import { useSession } from "../session/SessionContext";
import { useWorkout } from "../session/WorkoutContext";
import { GuideOverlay } from "./GuideOverlay";
import { beginWorkoutForExercise } from "./beginWorkout";

/**
 * Exercise detail: Anatomy → Name → Target → Emphasis → Focus → Details → Start.
 * One coherent composition; tapping the anatomy opens the guide.
 */
export function ExerciseScreen() {
  const { exerciseId = "" } = useParams();
  const { userId } = useSession();
  const navigate = useNavigate();
  const workout = useWorkout();
  const [guideOpen, setGuideOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const state = useAsync(() => endpoints.getExerciseDetail(exerciseId), [exerciseId]);

  const highlights = useMemo(
    () => (state.status === "ready" ? highlightsFromTargetMap(state.data.targetMap) : []),
    [state],
  );

  if (state.status === "loading") return <StateBlock kind="loading" title="Loading exercise" />;
  if (state.status === "error") {
    return <StateBlock kind="error" title="Exercise unavailable" body={state.error.message} action={<Button onClick={() => navigate(-1)}>Back</Button>} />;
  }

  const detail = state.data;
  const primaries = detail.targetMap.entries.filter((entry: TargetMapEntry) => entry.state === "primary");
  const steps = [...(detail.formGuidance?.steps ?? [])].sort((a, b) => a.position - b.position);

  const start = async () => {
    if (!userId) return;
    setStarting(true);
    setStartError(null);
    try {
      await beginWorkoutForExercise(userId, workout, detail.exercise.id, detail.exercise.name, detail);
      navigate(`/exercise/${detail.exercise.id}/perform`);
    } catch (cause) {
      // Starting a session is a real backend write; if it fails the user must
      // know rather than being left on a button that appears to do nothing.
      setStartError(cause instanceof Error ? cause.message : "The session could not be started.");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="fc-screen fc-exercise">
      <header className="fc-exercise__hero motion-fade">
        <div className="fc-exercise__anatomy">
          {/* A reviewed photograph replaces the figure when one exists; the
              anatomy figure is the accurate default and the load fallback. */}
          <ExerciseMedia
            asset={mediaFor(detail.exercise.slug)}
            className="fc-exercise__photo"
            fallback={
              <AnatomyFigure
                view={bestViewFor(highlights)}
                highlights={highlights}
                size={210}
                interactive
                onActivate={() => setGuideOpen(true)}
              />
            }
          />
        </div>
        <div className="fc-exercise__heading">
          <h1 className="t-display">{detail.exercise.name}</h1>
          {detail.exercise.variationLabel ? <p className="t-small t-muted">{detail.exercise.variationLabel}</p> : null}
        </div>
      </header>

      <section className="fc-exercise__target" aria-label="Target">
        <h2 className="t-caption t-muted">Target</h2>
        <ul className="fc-targetlist" role="list">
          {primaries.map((entry: TargetMapEntry) => (
            <li key={entry.muscleId} className="fc-targetlist__item">
              <span className="fc-targetlist__name">{entry.displayName}</span>
              {entry.structures.length > 0 ? (
                <span className="fc-targetlist__structure t-small t-muted">
                  {entry.structures.map((s: TargetMapStructure) => s.displayName).join(" · ")}
                  {entry.emphasis ? ` — ${entry.emphasis.replaceAll("_", " ")}` : ""}
                </span>
              ) : entry.emphasis ? (
                <span className="fc-targetlist__structure t-small t-muted">{entry.emphasis.replaceAll("_", " ")}</span>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="fc-exercise__meta">
          {detail.exercise.unilateral ? <Chip tone="neutral">one side at a time</Chip> : null}
          {detail.exercise.loadingCharacteristic === "bodyweight_only" ? <Chip tone="neutral">bodyweight</Chip> : null}
        </div>
      </section>

      {detail.exercise.instructions ? (
        <p className="fc-exercise__focus t-body t-secondary">{detail.exercise.instructions}</p>
      ) : null}

      {steps.length > 0 ? (
        <Expandable summary="Details">
          <ol className="fc-formsteps" role="list">
            {steps.map((step) => (
              <li key={step.key}>
                <span className="fc-formsteps__heading">{step.heading}</span>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </Expandable>
      ) : null}

      <div className="fc-exercise__start">
        {startError ? (
          <p className="fc-inline-error t-small" role="alert">
            {startError}
          </p>
        ) : null}
        <Button size="large" full onClick={() => void start()} disabled={!userId || starting}>
          {starting ? "Starting…" : "Start"}
        </Button>
      </div>

      {guideOpen ? <GuideOverlay detail={detail} onClose={() => setGuideOpen(false)} /> : null}
    </div>
  );
}
