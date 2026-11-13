import { Chip } from "./controls";
import { formatNumber } from "../lib/text";

/**
 * Surfaces data-quality context from the context builder: missing data,
 * stale data, and whether the context is sufficient for substantive advice.
 *
 * Nothing here is invented — every warning is derived from the assessed
 * context quality returned by the backend.
 */

export function CoachQualityBanner({
  quality,
}: {
  quality: {
    overallScore: number;
    missingDataWarnings: readonly string[];
    staleDataWarnings: readonly string[];
    recommendedFollowUpQuestions: readonly string[];
    sufficientForAdvice: boolean;
  };
}) {
  const hasWarnings =
    quality.missingDataWarnings.length > 0 || quality.staleDataWarnings.length > 0;

  if (!hasWarnings && quality.sufficientForAdvice) return null;

  return (
    <div className="fc-coach__quality-banner">
      {!quality.sufficientForAdvice && (
        <div className="fc-coach__quality-line">
          <span className="fc-coach__quality-label">Not enough data for a full answer</span>
          <Chip tone="important" size="sm">
            {formatNumber(quality.overallScore)}/100 context
          </Chip>
        </div>
      )}
      {quality.missingDataWarnings.length > 0 && (
        <div className="fc-coach__quality-line">
          <span className="fc-coach__quality-label">Missing data:</span>
          <ul className="fc-coach__quality-list">
            {quality.missingDataWarnings.map((w, i) => (
              <li key={i} className="fc-coach__quality-item">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}
      {quality.staleDataWarnings.length > 0 && (
        <div className="fc-coach__quality-line">
          <span className="fc-coach__quality-label">Stale data:</span>
          <ul className="fc-coach__quality-list">
            {quality.staleDataWarnings.map((w, i) => (
              <li key={i} className="fc-coach__quality-item">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}
      {quality.recommendedFollowUpQuestions.length > 0 && quality.sufficientForAdvice === false && (
        <div className="fc-coach__quality-line">
          <span className="fc-coach__quality-label">To help, could you tell me:</span>
          <ul className="fc-coach__quality-list">
            {quality.recommendedFollowUpQuestions.map((q, i) => (
              <li key={i} className="fc-coach__quality-item">
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
