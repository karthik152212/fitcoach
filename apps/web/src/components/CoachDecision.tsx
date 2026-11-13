import { Chip } from "./controls";
import { sentence } from "../lib/text";

/**
 * Presents the current Unified Decision Brain snapshot: kind (including
 * `no_change`), summary, active interventions, and confidence.
 *
 * `no_change` is a valid, first-class outcome and is presented as such rather
 * than manufactured into a recommendation.
 */

export function CoachDecision({
  decisionContext,
}: {
  decisionContext: {
    decisionSnapshot: { id: string; kind: string; status: string; decidedAt: string; summary: string; confidence: string } | null;
    activeInterventions: readonly string[];
    diagnoses: readonly { code: string; title: string; severity: string }[];
  };
}) {
  const { decisionSnapshot, activeInterventions = [], diagnoses = [] } = decisionContext;
  if (!decisionSnapshot) return null;

  return (
    <div className="fc-coach__decision">
      <p className="fc-coach__decision-kind">
        {sentence(decisionSnapshot.kind.replaceAll("_", " "))}
        {decisionSnapshot.kind === "no_change" ? " — no change recommended" : null}
      </p>
      <p className="fc-coach__decision-summary">{decisionSnapshot.summary}</p>
      <div className="fc-coach__decision-meta">
        <Chip tone="neutral" size="sm">
          confidence: {decisionSnapshot.confidence}
        </Chip>
        {activeInterventions.length > 0 && (
          <>
            <span className="fc-coach__decision-label">Active interventions:</span>
            {activeInterventions.map((k, i) => (
              <Chip key={i} tone="accent" size="sm">
                {sentence(k.replaceAll("_", " "))}
              </Chip>
            ))}
          </>
        )}
        {diagnoses.length > 0 && (
          <>
            <span className="fc-coach__decision-label">Diagnoses:</span>
            {diagnoses.map((d, i) => (
              <Chip key={i} tone="important" size="sm">
                {d.title}
              </Chip>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
