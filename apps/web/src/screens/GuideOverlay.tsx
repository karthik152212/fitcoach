import { useEffect, useRef, useState } from "react";
import type { ExerciseDetail } from "../api/types";
import { AnatomyFigure, bestViewFor, highlightsFromTargetMap } from "../anatomy/AnatomyFigure";

/**
 * Guide overlay: anatomy → full-screen guide.
 *
 * The highlighted anatomy is the visual bridge — the overlay rises, the
 * interface recedes, the same target figure anchors the guide. Video content
 * is a documented asset dependency: when the catalog carries a hosted guide
 * video for the exercise it plays here with the anatomy overlay; until then
 * the guide presents the FitCoach form instruction with the same target
 * figure — an honest state, never a fake stock clip.
 *
 * Closing returns to the exact previous state: the overlay is local state on
 * the calling screen, so logging/exercise state is untouched.
 */
export function GuideOverlay({
  detail,
  onClose,
}: {
  detail: ExerciseDetail;
  onClose: () => void;
}) {
  const [entered, setEntered] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const highlights = highlightsFromTargetMap(detail.targetMap);
  const video = detail.media.find((asset) => asset.mediaType === "video" && asset.status === "active");
  const steps = [...(detail.formGuidance?.steps ?? [])].sort((a, b) => a.position - b.position);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className={`fc-guide${entered ? " is-entered" : ""}`} role="dialog" aria-modal="true" aria-label={`${detail.exercise.name} guide`}>
      <div className="fc-guide__backdrop" onClick={onClose} />
      <div className="fc-guide__surface">
        <header className="fc-guide__header">
          <div>
            <p className="t-caption t-muted">Guide</p>
            <h2 className="t-heading">{detail.exercise.name}</h2>
          </div>
          <button ref={closeRef} type="button" className="fc-guide__close" onClick={onClose} aria-label="Close guide">
            ✕
          </button>
        </header>

        <div className="fc-guide__media">
          {video ? (
            <video
              className="fc-guide__video"
              src={video.storageKey}
              controls
              autoPlay
              playsInline
              aria-label={`${detail.exercise.name} demonstration video`}
            />
          ) : (
            <div className="fc-guide__pending">
              <AnatomyFigure view={bestViewFor(highlights)} highlights={highlights} size={220} />
              <p className="t-small t-muted">
                Human demonstration video for this exercise is in production. The anatomy shows
                exactly what this movement trains; the steps below are the FitCoach form guide.
              </p>
            </div>
          )}
          {video ? (
            <div className="fc-guide__overlay" aria-hidden="true">
              <AnatomyFigure view={bestViewFor(highlights)} highlights={highlights} size={96} labelled={false} />
            </div>
          ) : null}
        </div>

        {steps.length > 0 ? (
          <ol className="fc-guide__steps" aria-label="Form guide">
            {steps.slice(0, 6).map((step) => (
              <li key={step.key} className="fc-guide__step">
                <span className="fc-guide__step-heading">{step.heading}</span>
                <span className="fc-guide__step-body">{step.body}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}
